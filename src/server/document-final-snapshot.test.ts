import * as integrationEvents from "./integration-events";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashToken } from "./auth";
import { getDb, getPool } from "./db";
import { documentVerificationCode } from "../lib/clinical-document-identity";
import { encounterDocumentsResponse } from "./encounter-documents";

const origin = "http://localhost:4317";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Integration tests require a dedicated *_test database.");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});

async function fixture() {
  const organizationId = randomUUID(),
    unitId = randomUUID(),
    patientId = randomUUID();
  const userId = randomUUID(),
    appointmentId = randomUUID(),
    membershipId = randomUUID();
  const token = randomUUID();
  await getPool().query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    organizationId,
    `Snapshot test organization ${organizationId}`,
  ]);
  await getPool().query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Snapshot unit original')",
    [unitId, organizationId],
  );
  await getPool().query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Draft author',$2,'CRM','12345','CE')",
    [userId, `${userId}@example.test`],
  );
  await getPool().query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'PARTNER_ADMIN')",
    [membershipId, userId, organizationId],
  );
  await getPool().query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
    membershipId,
    unitId,
  ]);
  await getPool().query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [userId, hashToken(token)],
  );
  await getPool().query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'SNAP-ORIGINAL','Snapshot patient original')",
    [patientId, organizationId, unitId],
  );
  await getPool().query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION','2031-02-12T10:00:00Z','2031-02-12T11:00:00Z','Snapshot room')",
    [appointmentId, organizationId, unitId, patientId, userId],
  );
  await getPool().query(
    "UPDATE inventory_users SET prescribing_address='Clínica teste',prescribing_city='Fortaleza',prescribing_state='CE',prescribing_phone='+5585999999999' WHERE id=$1",
    [userId],
  );
  const post = (extra: Record<string, unknown> = {}) =>
    encounterDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/encounter-documents`, {
        method: "POST",
        headers: {
          cookie: `allik_inventory_session=${token}`,
          origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "SAVE_DRAFT",
          appointmentId,
          documentId: null,
          type: "PRESCRIPTION",
          title: "Snapshot document",
          content: "Frozen clinical instructions",
          version: null,
          ...extra,
        }),
      }),
    );
  const get = (query = `appointmentId=${appointmentId}`) =>
    encounterDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/encounter-documents?${query}`, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  return { organizationId, unitId, patientId, userId, appointmentId, post, get };
}

describe("final document snapshots", () => {
  it("rolls back prescription finalization when transactional event persistence fails", async () => {
    const f = await fixture();
    const draft = (await (await f.post()).json()).data;
    const failure = vi
      .spyOn(integrationEvents, "appendIntegrationEvent")
      .mockRejectedValueOnce(new Error("Synthetic outbox failure"));
    try {
      const response = await f.post({
        action: "FINALIZE",
        documentId: draft.id,
        version: draft.version,
      });
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(
        (
          await getPool().query(
            "SELECT status,version FROM inventory_encounter_documents WHERE id=$1",
            [draft.id],
          )
        ).rows,
      ).toEqual([{ status: "DRAFT", version: draft.version }]);
      expect(
        (
          await getPool().query(
            "SELECT id FROM inventory_integration_outbox WHERE aggregate_id=$1",
            [draft.id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      failure.mockRestore();
    }
    expect(
      (await f.post({ action: "FINALIZE", documentId: draft.id, version: draft.version })).status,
    ).toBe(200);
  });

  it("emits only a minimal finalized-prescription event, atomically and without replay duplication", async () => {
    const f = await fixture();
    const draft = (await (await f.post()).json()).data;
    expect(
      (
        await getPool().query("SELECT id FROM inventory_integration_outbox WHERE aggregate_id=$1", [
          draft.id,
        ])
      ).rowCount,
    ).toBe(0);
    const response = await f.post({
      action: "FINALIZE",
      documentId: draft.id,
      version: draft.version,
    });
    expect(response.status).toBe(200);
    const finalized = (await response.json()).data;
    const events = (
      await getPool().query(
        "SELECT event_type,aggregate_type,aggregate_id,aggregate_version,payload FROM inventory_integration_outbox WHERE organization_id=$1 AND aggregate_id=$2",
        [f.organizationId, draft.id],
      )
    ).rows;
    expect(events).toEqual([
      {
        event_type: "PRESCRIPTION_FINALIZED",
        aggregate_type: "PRESCRIPTION",
        aggregate_id: draft.id,
        aggregate_version: finalized.version,
        payload: { resourceId: draft.id, resourceVersion: finalized.version },
      },
    ]);
    expect(
      (await f.post({ action: "FINALIZE", documentId: draft.id, version: draft.version })).status,
    ).toBe(409);
    expect(
      (
        await getPool().query("SELECT id FROM inventory_integration_outbox WHERE aggregate_id=$1", [
          draft.id,
        ])
      ).rowCount,
    ).toBe(1);
    const instructions = await f.post({ action: "FINALIZE", type: "INSTRUCTIONS" });
    expect(instructions.status).toBe(201);
    const other = (await instructions.json()).data;
    expect(
      (
        await getPool().query("SELECT id FROM inventory_integration_outbox WHERE aggregate_id=$1", [
          other.id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("persists printing metadata and freezes it in final snapshots", async () => {
    const f = await fixture();
    await getPool().query(
      `UPDATE inventory_patients SET document_type='PASSPORT',document_number='SYNTHETIC-DOC',additional_data='{"address":"Rua teste, 10"}',birth_date=(current_date-interval '35 years 1 day')::date WHERE id=$1`,
      [f.patientId],
    );
    const prescriptionPrintData = {
      kind: "SPECIAL_CONTROL",
      patientDocument: "SYNTHETIC-DOC",
      patientAddress: "Rua teste, 10",
      patientAge: 35,
      patientSex: "Não informado",
      issuerAddress: "Clínica teste",
      issuerPhone: "+5585999999999",
      issuerCity: "Fortaleza",
      issuerState: "CE",
    };
    const response = await f.post({ prescriptionPrintData, twoCopies: true });
    expect(response.status).toBe(201);
    const draft = (await response.json()).data;
    expect((await (await f.get()).json()).data.documents[0].prescriptionPrintData).toEqual(
      prescriptionPrintData,
    );
    expect(
      (
        await f.post({
          action: "FINALIZE",
          documentId: draft.id,
          version: draft.version,
          prescriptionPrintData,
          twoCopies: true,
        })
      ).status,
    ).toBe(200);
    const saved = (
      await getPool().query(
        "SELECT final_snapshot,prescription_print_data FROM inventory_encounter_documents WHERE id=$1",
        [draft.id],
      )
    ).rows[0];
    expect(saved.final_snapshot.prescriptionPrintData).toEqual(prescriptionPrintData);
    expect(saved.prescription_print_data).toEqual(prescriptionPrintData);
    const printed = await (await f.get(`documentId=${draft.id}&print=true`)).text();
    expect(printed).toContain("RECEITA DE CONTROLE ESPECIAL");
    expect(printed).toContain("SYNTHETIC-DOC");
    expect(printed).toContain("1ª VIA — RETENÇÃO DA FARMÁCIA");
    await getPool().query("UPDATE inventory_patients SET document_number='CHANGED' WHERE id=$1", [
      f.patientId,
    ]);
    expect(await (await f.get(`documentId=${draft.id}&print=true`)).text()).toBe(printed);
    await expect(
      getPool().query(
        "UPDATE inventory_encounter_documents SET prescription_print_data='{}' WHERE id=$1",
        [draft.id],
      ),
    ).rejects.toThrow();
  });

  it("rejects malformed rich JSON at the database boundary for documents and templates", async () => {
    const f = await fixture();
    const draft = (await (await f.post()).json()).data;
    await expect(
      getPool().query(
        "UPDATE inventory_encounter_documents SET rich_content='{}'::jsonb WHERE id=$1",
        [draft.id],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "encounter_document_rich_valid" });
    const template = (await (await f.post({ action: "SAVE_TEMPLATE" })).json()).data;
    await expect(
      getPool().query(
        `INSERT INTO inventory_clinical_document_templates(organization_id,owner_user_id,type,title,content,rich_content)
         SELECT organization_id,owner_user_id,type,title,content,'{}'::jsonb
         FROM inventory_clinical_document_templates WHERE id=$1`,
        [template.id],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "clinical_document_template_rich_valid" });
  });

  it("rejects new final document snapshots with missing formatting or copy fields", async () => {
    const f = await fixture();
    const richContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Conteúdo final sintético" }] },
      ],
    };
    const final = (
      await (await f.post({ action: "FINALIZE", richContent, twoCopies: true })).json()
    ).data;
    for (const missing of ["richContent", "twoCopies"]) {
      await expect(
        getPool().query(
          `INSERT INTO inventory_encounter_documents SELECT (jsonb_populate_record(NULL::inventory_encounter_documents,
          to_jsonb(d) || jsonb_build_object('id',$1::text,'final_snapshot',(d.final_snapshot || jsonb_build_object('documentId',$1::text,'verificationCode','A1-'||upper($1::text))) - $2::text))).*
          FROM inventory_encounter_documents d WHERE d.id=$3`,
          [randomUUID(), missing, final.id],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "encounter_document_rich_snapshot_valid",
      });
    }
    await expect(
      getPool().query(
        `INSERT INTO inventory_encounter_documents SELECT (jsonb_populate_record(NULL::inventory_encounter_documents,
        to_jsonb(d) || jsonb_build_object('id',$1::text,'final_snapshot',NULL,'prescription_print_data',NULL))).*
        FROM inventory_encounter_documents d WHERE d.id=$2`,
        [randomUUID(), final.id],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "encounter_document_rich_snapshot_valid",
    });
  });
  it("preserves rich prescription formatting and both copies through finalization", async () => {
    const f = await fixture();
    const richContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "left" },
          content: [
            {
              type: "text",
              text: "Medicamento sintético",
              marks: [{ type: "bold" }, { type: "underline" }],
            },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Instrução de teste" }] },
              ],
            },
          ],
        },
      ],
    };
    const response = await f.post({ richContent, twoCopies: true });
    expect(response.status).toBe(201);
    const draft = (await response.json()).data;
    const listed = (await (await f.get()).json()).data.documents[0];
    expect(listed.richContent).toEqual(richContent);
    expect(listed.twoCopies).toBe(true);
    expect((await f.get(`documentId=${draft.id}&print=true&preview=true`)).status).toBe(200);
    expect(
      (
        await f.post({
          action: "FINALIZE",
          documentId: draft.id,
          version: draft.version,
          richContent,
          twoCopies: true,
        })
      ).status,
    ).toBe(200);
    const html = await (await f.get(`documentId=${draft.id}&print=true`)).text();
    expect(html).toContain("<strong>");
    expect(html).toContain("<u>");
    expect(html).toContain("<ol>");
    expect(html.match(/Medicamento sintético/g)).toHaveLength(2);
    expect(html).toContain("Não possui assinatura eletrônica");
    expect(
      (
        await f.post({
          documentId: draft.id,
          version: draft.version + 1,
          richContent,
          twoCopies: false,
        })
      ).status,
    ).toBe(409);
    await expect(
      getPool().query("UPDATE inventory_encounter_documents SET two_copies=false WHERE id=$1", [
        draft.id,
      ]),
    ).rejects.toThrow();
  });

  it("allows empty document creation but rejects empty finals and copies on non-prescriptions", async () => {
    const f = await fixture();
    const blank = await f.post({ content: "", richContent: null });
    expect(blank.status).toBe(201);
    const draft = (await blank.json()).data;
    expect(
      (
        await f.post({
          action: "FINALIZE",
          documentId: draft.id,
          version: draft.version,
          content: "",
        })
      ).status,
    ).toBe(400);
    expect((await f.post({ type: "EXAM_REQUEST", twoCopies: true })).status).toBe(400);
    for (const type of [
      "EXAM_REQUEST",
      "MEDICAL_CERTIFICATE",
      "REFERRAL",
      "MEDICAL_REPORT",
      "MEDICAL_OPINION",
      "INSTRUCTIONS",
    ]) {
      expect((await f.post({ type, content: "" })).status).toBe(201);
    }
  });

  it("rejects untrusted editor nodes and never treats plain legacy content as markup", async () => {
    const f = await fixture();
    expect(
      (
        await f.post({
          richContent: {
            type: "doc",
            content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }],
          },
        })
      ).status,
    ).toBe(400);
    const response = await f.post({ action: "FINALIZE", content: "<script>alert(1)</script>" });
    expect(response.status).toBe(201);
    const doc = (await response.json()).data;
    const html = await (await f.get(`documentId=${doc.id}&print=true`)).text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("scopes draft print previews to their author, organization and authorized unit", async () => {
    const f = await fixture();
    const draft = (await (await f.post()).json()).data;
    const otherOrganization = await fixture();
    expect(
      (await otherOrganization.get(`documentId=${draft.id}&print=true&preview=true`)).status,
    ).toBe(404);
    expect((await f.get(`documentId=${draft.id}&print=true`)).status).toBe(409);
    const originalAuthor = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_users(id,name,email) VALUES($1,'Other author',$2)",
      [originalAuthor, `${originalAuthor}@example.test`],
    );
    const membershipId = randomUUID(),
      token = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'PARTNER_ADMIN')",
      [membershipId, originalAuthor, f.organizationId],
    );
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [membershipId, f.unitId],
    );
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [originalAuthor, hashToken(token)],
    );
    const otherAuthorPreview = await encounterDocumentsResponse(
      new Request(
        `${origin}/api/v1/inventory/encounter-documents?documentId=${draft.id}&print=true&preview=true`,
        { headers: { cookie: `allik_inventory_session=${token}` } },
      ),
    );
    expect(otherAuthorPreview.status).toBe(409);
    await getPool().query("DELETE FROM inventory_unit_access WHERE unit_id=$1", [f.unitId]);
    expect((await f.get(`documentId=${draft.id}&print=true&preview=true`)).status).toBe(404);
  });

  it("freezes final patient/unit/current clinician identity and preserves stale version protection", async () => {
    const f = await fixture();
    const draft = (await (await f.post()).json()).data;
    await getPool().query(
      "UPDATE inventory_users SET name='Final author',council_number='54321' WHERE id=$1",
      [f.userId],
    );
    expect(
      (await f.post({ action: "FINALIZE", documentId: draft.id, version: draft.version + 1 }))
        .status,
    ).toBe(409);
    expect(
      (await f.post({ action: "FINALIZE", documentId: draft.id, version: draft.version })).status,
    ).toBe(200);
    const before = await (await f.get(`documentId=${draft.id}&print=true`)).text();
    expect(before).toContain("Final author");
    expect(before).toContain("54321");
    expect(before).toContain("Snapshot patient original");
    await getPool().query(
      "UPDATE inventory_patients SET full_name='Changed patient',internal_code='SNAP-CHANGED' WHERE id=$1",
      [f.patientId],
    );
    await getPool().query("UPDATE inventory_units SET name='Changed unit' WHERE id=$1", [f.unitId]);
    await getPool().query(
      "UPDATE inventory_users SET name='Changed author',council_number='11111' WHERE id=$1",
      [f.userId],
    );
    const after = await (await f.get(`documentId=${draft.id}&print=true`)).text();
    expect(after).toBe(before);
    const listed = (await (await f.get()).json()).data.documents[0];
    expect(listed.authorName).toBe("Final author");
    expect(listed.councilNumber).toBe("54321");
    await expect(
      getPool().query("UPDATE inventory_encounter_documents SET final_snapshot='{}' WHERE id=$1", [
        draft.id,
      ]),
    ).rejects.toThrow();
  });

  it("does not backfill legacy finals and labels their live header honestly", async () => {
    const f = await fixture();
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO inventory_encounter_documents(id,organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status,finalized_at)
      VALUES($1,$2,$3,$4,$5,$6,'Historical author','CRM','98765','CE','PRESCRIPTION','Legacy document','Legacy instructions','FINAL',now())`,
      [id, f.organizationId, f.unitId, f.appointmentId, f.patientId, f.userId],
    );
    const printed = await (await f.get(`documentId=${id}&print=true`)).text();
    expect(printed).toContain("Documento legado");
    expect(printed).toContain("Historical author");
    expect(
      (
        await getPool().query(
          "SELECT final_snapshot FROM inventory_encounter_documents WHERE id=$1",
          [id],
        )
      ).rows[0].final_snapshot,
    ).toBeNull();
    await expect(
      getPool().query("UPDATE inventory_encounter_documents SET final_snapshot='{}' WHERE id=$1", [
        id,
      ]),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_encounter_documents WHERE id=$1", [id]),
    ).rejects.toThrow();
  });

  it("snapshots documents created directly final", async () => {
    const f = await fixture();
    const final = await f.post({ action: "FINALIZE" });
    expect(final.status).toBe(201);
    const finalized = (await final.json()).data;
    const id = finalized.id;
    expect(finalized.version).toBe(0);
    const saved = (
      await getPool().query(
        "SELECT final_snapshot,finalized_at FROM inventory_encounter_documents WHERE id=$1",
        [id],
      )
    ).rows[0];
    const outbox = (
      await getPool().query(
        "SELECT aggregate_version,payload FROM inventory_integration_outbox WHERE aggregate_id=$1 AND event_type='PRESCRIPTION_FINALIZED'",
        [id],
      )
    ).rows;
    expect(outbox).toEqual([
      {
        aggregate_version: finalized.version,
        payload: { resourceId: id, resourceVersion: finalized.version },
      },
    ]);
    expect(saved.final_snapshot.patientName).toBe("Snapshot patient original");
    expect(saved.final_snapshot.finalizedAt).toBe(saved.finalized_at.toISOString());
  });
});

describe("document integrity and amendments", () => {
  it("seals final content and preserves the original through an independently finalized rectification", async () => {
    const f = await fixture();
    const original = await f.post({ action: "FINALIZE" });
    expect(original.status).toBe(201);
    const source = (await original.json()).data;
    const before = (
      await getPool().query("SELECT * FROM inventory_encounter_documents WHERE id=$1", [source.id])
    ).rows[0];
    const seal = (
      await getPool().query(
        "SELECT * FROM inventory_clinical_document_seals WHERE document_id=$1",
        [source.id],
      )
    ).rows[0];
    expect(seal.content_sha256).toMatch(/^[a-f0-9]{64}$/);
    const create = await f.post({
      action: "CREATE_AMENDMENT",
      documentId: source.id,
      version: source.version,
      amendmentKind: "RECTIFICATION",
      amendmentReason: "Correção do texto de orientação",
      title: "RETIFICAÇÃO — RECEITA MÉDICA",
    });
    expect(create.status).toBe(201);
    const child = (await create.json()).data;
    const list = (await (await f.get()).json()).data.documents;
    expect(list.find((d: { id: string }) => d.id === source.id).integrityVerified).toBe(true);
    expect(list.find((d: { id: string }) => d.id === child.id).amendment.parentDocumentId).toBe(
      source.id,
    );
    const final = await f.post({
      action: "FINALIZE",
      documentId: child.id,
      version: child.version,
      title: "RETIFICAÇÃO — RECEITA MÉDICA",
      content: "Orientação corrigida, preservando o registro original.",
    });
    expect(final.status).toBe(200);
    const after = (
      await getPool().query("SELECT * FROM inventory_encounter_documents WHERE id=$1", [source.id])
    ).rows[0];
    expect(after).toEqual(before);
    expect(
      (
        await getPool().query(
          "SELECT content_sha256 FROM inventory_clinical_document_seals WHERE document_id=$1",
          [source.id],
        )
      ).rows[0].content_sha256,
    ).toBe(seal.content_sha256);
    const snapshot = (
      await getPool().query(
        "SELECT final_snapshot FROM inventory_encounter_documents WHERE id=$1",
        [child.id],
      )
    ).rows[0].final_snapshot;
    expect(snapshot.amendment).toEqual({
      parentDocumentId: source.id,
      kind: "RECTIFICATION",
      reason: "Correção do texto de orientação",
      parentSha256: seal.content_sha256,
    });
    const print = await f.get(`documentId=${child.id}&print=true`);
    expect(print.status).toBe(200);
    const html = await print.text();
    expect(html).toContain(source.id);
    expect(html).toContain("Correção do texto de orientação");
    await expect(
      getPool().query(
        "UPDATE inventory_clinical_document_seals SET content_sha256=$2 WHERE document_id=$1",
        [source.id, "0".repeat(64)],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query(
        "UPDATE inventory_clinical_document_amendments SET reason='Outra razão' WHERE document_id=$1",
        [child.id],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_clinical_document_amendments WHERE document_id=$1", [
        child.id,
      ]),
    ).rejects.toThrow();
    await expect(
      getPool().query("UPDATE inventory_encounter_documents SET content='alterado' WHERE id=$1", [
        source.id,
      ]),
    ).rejects.toThrow();
  });
  it("rejects drafts, missing reasons, foreign documents and amendment chains as amendment sources", async () => {
    const f = await fixture();
    const draft = (await (await f.post()).json()).data;
    const amend = (id: string, version: number, reason = "Complementação da orientação") =>
      f.post({
        action: "CREATE_AMENDMENT",
        documentId: id,
        version,
        amendmentKind: "ADDENDUM",
        amendmentReason: reason,
      });
    expect((await amend(draft.id, draft.version)).status).toBe(409);
    const final = (
      await (
        await f.post({ action: "FINALIZE", documentId: draft.id, version: draft.version })
      ).json()
    ).data;
    expect((await amend(final.id, final.version, " ")).status).toBe(409);
    const other = await fixture();
    const foreign = (await (await other.post({ action: "FINALIZE" })).json()).data;
    expect((await amend(foreign.id, foreign.version)).status).toBe(404);
    const child = (await (await amend(final.id, final.version)).json()).data;
    const childFinal = (
      await (
        await f.post({ action: "FINALIZE", documentId: child.id, version: child.version })
      ).json()
    ).data;
    expect((await amend(childFinal.id, childFinal.version)).status).toBe(409);
  });
  it("denies direct cross-scope links and prevents finalizing a linked draft without its immutable metadata", async () => {
    const f = await fixture(),
      other = await fixture();
    const source = (await (await f.post({ action: "FINALIZE" })).json()).data;
    const draft = (await (await other.post()).json()).data;
    const seal = (
      await getPool().query(
        "SELECT content_sha256 FROM inventory_clinical_document_seals WHERE document_id=$1",
        [source.id],
      )
    ).rows[0].content_sha256;
    await expect(
      getPool().query(
        "INSERT INTO inventory_clinical_document_amendments(document_id,parent_document_id,kind,reason,parent_sha256) VALUES($1,$2,'ADDENDUM','Tentativa entre organizações',$3)",
        [draft.id, source.id, seal],
      ),
    ).rejects.toThrow();
    const child = (
      await (
        await f.post({
          action: "CREATE_AMENDMENT",
          documentId: source.id,
          version: source.version,
          amendmentKind: "ADDENDUM",
          amendmentReason: "Informação adicional confirmada",
        })
      ).json()
    ).data;
    await expect(
      getPool().query(
        "UPDATE inventory_encounter_documents SET status='FINAL',finalized_at=now(),final_snapshot=$2 WHERE id=$1",
        [
          child.id,
          (
            await getPool().query(
              "SELECT final_snapshot FROM inventory_encounter_documents WHERE id=$1",
              [source.id],
            )
          ).rows[0].final_snapshot,
        ],
      ),
    ).rejects.toThrow();
  });
  it("fails closed when the stored integrity marker differs from the snapshot", async () => {
    const f = await fixture();
    const source = (await (await f.post({ action: "FINALIZE" })).json()).data;
    // Simulate corruption with database-owner powers in this disposable database only.
    await getPool().query(
      "ALTER TABLE inventory_clinical_document_seals DISABLE TRIGGER clinical_document_seal_immutable",
    );
    try {
      await getPool().query(
        "UPDATE inventory_clinical_document_seals SET content_sha256=$2 WHERE document_id=$1",
        [source.id, "0".repeat(64)],
      );
    } finally {
      await getPool().query(
        "ALTER TABLE inventory_clinical_document_seals ENABLE TRIGGER clinical_document_seal_immutable",
      );
    }
    expect((await f.get(`documentId=${source.id}&print=true`)).status).toBe(409);
    const document = (await (await f.get()).json()).data.documents.find(
      (d: { id: string }) => d.id === source.id,
    );
    expect(document.integrityVerified).toBe(false);
    expect(document.canAmend).toBe(false);
    expect((await f.get(`verify=${documentVerificationCode(source.id)}`)).status).toBe(409);
  });
  it("freezes canonical patient identity and an authenticated verification identifier", async () => {
    const f = await fixture();
    await getPool().query(
      `UPDATE inventory_patients SET document_type='PASSPORT',document_number='SYNTH-123',birth_date='1990-01-01',additional_data='{"address":"Synthetic street"}' WHERE id=$1`,
      [f.patientId],
    );
    const response = await f.post({ action: "FINALIZE", type: "EXAM_REQUEST" });
    expect(response.status).toBe(201);
    const doc = (await response.json()).data;
    const code = documentVerificationCode(doc.id);
    const row = (
      await getPool().query(
        "SELECT final_snapshot FROM inventory_encounter_documents WHERE id=$1",
        [doc.id],
      )
    ).rows[0];
    expect(row.final_snapshot).toMatchObject({
      documentId: doc.id,
      verificationCode: code,
      patientIdentity: {
        documentNumber: "SYNTH-123",
        birthDate: "1990-01-01",
        address: "Synthetic street",
      },
    });
    const print = await (await f.get(`documentId=${doc.id}&print=true`)).text();
    expect(print).toContain(code);
    expect(print).toContain("SYNTH-123");
    expect(print).toContain("01/01/1990");
    const verify = await f.get(`verify=${code}`);
    expect(verify.status).toBe(200);
    const result = (await verify.json()).data;
    expect(result).toMatchObject({
      documentId: doc.id,
      integrityVerified: true,
      patientName: "Snapshot patient original",
      patientCode: "SNAP-ORIGINAL",
      amendments: [],
    });
    expect(result).not.toHaveProperty("content");
    expect(result.notice).toContain("Não comprova assinatura digital");
    await getPool().query(
      "UPDATE inventory_patients SET full_name='Changed',document_number='CHANGED' WHERE id=$1",
      [f.patientId],
    );
    expect(await (await f.get(`documentId=${doc.id}&print=true`)).text()).toBe(print);
    expect((await (await f.get(`verify=${code}`)).json()).data.patientName).toBe(
      "Snapshot patient original",
    );
    expect((await f.get()).status).toBe(200);
    const audit = (
      await getPool().query(
        "SELECT action FROM inventory_clinical_access_events WHERE document_id=$1 AND actor_user_id=$2",
        [doc.id, f.userId],
      )
    ).rows;
    expect(audit.filter((row) => row.action === "READ")).toHaveLength(2);
  });
  it("never treats a code as authorization and does not expose drafts", async () => {
    const f = await fixture(),
      other = await fixture();
    const draft = (await (await f.post()).json()).data;
    expect((await f.get(`verify=${documentVerificationCode(draft.id)}`)).status).toBe(404);
    const final = (await (await f.post({ action: "FINALIZE" })).json()).data;
    const code = documentVerificationCode(final.id);
    expect((await other.get(`verify=${code}`)).status).toBe(404);
    expect(
      (
        await encounterDocumentsResponse(
          new Request(`${origin}/api/v1/inventory/encounter-documents?verify=${code}`),
        )
      ).status,
    ).toBe(401);
    expect((await f.get("verify=invalid")).status).toBe(400);
    const foreignUnit = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Foreign unit')",
      [foreignUnit, f.organizationId],
    );
    await getPool().query("UPDATE inventory_memberships SET role='CLINICIAN' WHERE user_id=$1", [
      f.userId,
    ]);
    await getPool().query(
      "DELETE FROM inventory_unit_access WHERE membership_id IN (SELECT id FROM inventory_memberships WHERE user_id=$1)",
      [f.userId],
    );
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) SELECT id,$2 FROM inventory_memberships WHERE user_id=$1",
      [f.userId, foreignUnit],
    );
    expect((await f.get(`verify=${code}`)).status).toBe(404);
  });
  it("rejects forged patient print identity before finalization", async () => {
    const f = await fixture();
    const response = await f.post({
      action: "FINALIZE",
      prescriptionPrintData: {
        kind: "SIMPLE",
        patientDocument: "FORGED-DOC",
        issuerAddress: "Clínica teste",
        issuerCity: "Fortaleza",
        issuerState: "CE",
        issuerPhone: "+5585999999999",
      },
    });
    expect(response.status).toBe(409);
    expect(
      (
        await getPool().query(
          "SELECT id FROM inventory_encounter_documents WHERE appointment_id=$1",
          [f.appointmentId],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("binds a new identifier to its actual document row in PostgreSQL", async () => {
    const f = await fixture();
    const final = (await (await f.post({ action: "FINALIZE" })).json()).data;
    await expect(
      getPool().query(
        `INSERT INTO inventory_encounter_documents SELECT (jsonb_populate_record(NULL::inventory_encounter_documents,
      to_jsonb(d)||jsonb_build_object('id',$1::text))).* FROM inventory_encounter_documents d WHERE d.id=$2`,
        [randomUUID(), final.id],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "encounter_document_identifier_valid" });
  });
});

it("freezes manuscript signing instructions only on new documents in manual mode", async () => {
  const f = await fixture();
  vi.stubEnv("CLINICAL_SIGNATURE_MODE", "MANUSCRIPT");
  try {
    const response = await f.post({ action: "FINALIZE", type: "EXAM_REQUEST" });
    expect(response.status).toBe(201);
    const doc = (await response.json()).data;
    const saved = (
      await getPool().query(
        "SELECT final_snapshot FROM inventory_encounter_documents WHERE id=$1",
        [doc.id],
      )
    ).rows[0];
    expect(saved.final_snapshot.signatureMode).toBe("MANUSCRIPT");
    const printed = await (await f.get(`documentId=${doc.id}&print=true`)).text();
    expect(printed).toContain("Assinatura do profissional:");
    expect(printed).toContain("Imprima esta via para assinatura manuscrita");
    expect(printed).toContain("não comprova a assinatura no papel");
    vi.unstubAllEnvs();
    expect(await (await f.get(`documentId=${doc.id}&print=true`)).text()).toBe(printed);
    const original = await f.post({ action: "FINALIZE", type: "EXAM_REQUEST" });
    expect(original.status).toBe(201);
    expect(
      await (await f.get(`documentId=${(await original.json()).data.id}&print=true`)).text(),
    ).not.toContain("Imprima esta via para assinatura manuscrita");
  } finally {
    vi.unstubAllEnvs();
  }
});
