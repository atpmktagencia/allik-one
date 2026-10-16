import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashToken } from "./auth";
import { getDb, getPool } from "./db";
import * as signatureService from "./document-signatures";
import { userAdminResponse } from "./user-admin";
import { documentDeliveryResponse } from "./document-delivery";
import { encounterDocumentsResponse } from "./encounter-documents";
import { careAppointmentsResponse } from "./care-appointments";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function deliveryFixture() {
  const f = await fixture();
  await getPool().query(
    "UPDATE inventory_patients SET email='synthetic-recipient@example.test',phone='+5585999999999',consent_status='RECORDED',consent_recorded_at=now() WHERE id=$1",
    [f.patientId],
  );
  const finalResponse = await f.post({ action: "FINALIZE" });
  expect(finalResponse.status).toBe(201);
  const document = (await finalResponse.json()).data;
  // Reuse the real session token from a fresh dedicated session, never a hardcoded password.
  const token = randomUUID();
  await getPool().query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [f.userId, hashToken(token)],
  );
  const send = (extra: Record<string, unknown> = {}) =>
    documentDeliveryResponse(
      new Request(`${origin}/api/v1/inventory/document-delivery`, {
        method: "POST",
        headers: {
          origin,
          cookie: `allik_inventory_session=${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "SEND_EMAIL",
          documentId: document.id,
          operationId: randomUUID(),
          confirmedRecipient: "synthetic-recipient@example.test",
          allowUnsigned: true,
          ...extra,
        }),
      }),
    );
  const context = () =>
    documentDeliveryResponse(
      new Request(`${origin}/api/v1/inventory/document-delivery?documentId=${document.id}`, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  vi.stubEnv("RESEND_API_KEY", "synthetic-only-not-a-real-key");
  vi.stubEnv("AUTH_EMAIL_FROM", "Allik Test <sender@example.test>");
  return { ...f, document, send, context };
}
describe("Prescription delivery and prescriber identity", () => {
  it("requires complete registered contact and rejects a forged issuer", async () => {
    const f = await fixture();
    await getPool().query("UPDATE inventory_users SET prescribing_phone=NULL WHERE id=$1", [
      f.userId,
    ]);
    expect((await f.post({ action: "FINALIZE" })).status).toBe(409);
    await getPool().query(
      "UPDATE inventory_users SET prescribing_phone='+5585999999999' WHERE id=$1",
      [f.userId],
    );
    expect(
      (
        await f.post({
          action: "FINALIZE",
          prescriptionPrintData: { issuerAddress: "Forged clinic" },
        })
      ).status,
    ).toBe(409);
    const response = await f.post({ action: "FINALIZE" });
    expect(response.status).toBe(201);
    const doc = (await response.json()).data;
    const before = await (await f.get(`documentId=${doc.id}&print=true`)).text();
    await getPool().query(
      "UPDATE inventory_users SET prescribing_address='Changed clinic address',prescribing_phone='+5585999998888' WHERE id=$1",
      [f.userId],
    );
    expect(await (await f.get(`documentId=${doc.id}&print=true`)).text()).toBe(before);
  });
  it("sends exactly one attachment for concurrent identical intents and replays acceptance", async () => {
    const f = await deliveryFixture(),
      operationId = randomUUID();
    const outgoing: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        outgoing.push(JSON.parse(String(init.body)));
        return Response.json({ id: randomUUID() });
      }),
    );
    const results = await Promise.all([f.send({ operationId }), f.send({ operationId })]);
    expect(results.map((r) => r.status)).toContain(200);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]!["to"]).toEqual(["synthetic-recipient@example.test"]);
    const attachments = outgoing[0]!["attachments"] as Array<{ content: string }>;
    expect(Buffer.from(attachments[0]!.content, "base64").subarray(0, 4).toString()).toBe("%PDF");
    expect((await f.send({ operationId })).status).toBe(200);
    expect(outgoing).toHaveLength(1);
    const audit = (
      await getPool().query(
        "SELECT action,actor_user_id,signed FROM inventory_document_delivery_events WHERE document_id=$1 ORDER BY created_at",
        [f.document.id],
      )
    ).rows;
    expect(audit).toEqual([
      { action: "EMAIL_REQUESTED", actor_user_id: f.userId, signed: false },
      { action: "EMAIL_ACCEPTED", actor_user_id: f.userId, signed: false },
    ]);
    expect((await f.send()).status).toBe(429);
    expect(outgoing).toHaveLength(1);
  });
  it("blocks an unconfirmed unsigned file, forged recipient, another author and foreign unit", async () => {
    const f = await deliveryFixture(),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await f.send({ allowUnsigned: false })).status).toBe(409);
    expect((await f.send({ confirmedRecipient: "another@example.test" })).status).toBe(409);
    const other = await deliveryFixture();
    expect((await other.send({ documentId: f.document.id })).status).toBe(404);
    const unit = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Unauthorized unit')",
      [unit, f.organizationId],
    );
    await getPool().query(
      "UPDATE inventory_unit_access SET unit_id=$2 WHERE membership_id IN (SELECT id FROM inventory_memberships WHERE user_id=$1)",
      [f.userId, unit],
    );
    expect((await f.send()).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("records an ambiguous provider result and prevents automatic or immediate duplicate sends", async () => {
    const f = await deliveryFixture(),
      operationId = randomUUID(),
      fetcher = vi.fn(async () => {
        throw new Error("simulated transport failure");
      });
    vi.stubGlobal("fetch", fetcher);
    expect((await f.send({ operationId })).status).toBe(503);
    expect((await f.send({ operationId })).status).toBe(409);
    expect((await f.send()).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      (
        await getPool().query(
          "SELECT action FROM inventory_document_delivery_events WHERE operation_id=$1 ORDER BY created_at",
          [operationId],
        )
      ).rows,
    ).toEqual([{ action: "EMAIL_REQUESTED" }, { action: "EMAIL_UNCONFIRMED" }]);
  });
  it("prepares the private PDF for WhatsApp and keeps its audit append-only", async () => {
    const f = await deliveryFixture(),
      operationId = randomUUID(),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const context = (await (await f.context()).json()).data;
    expect(context).toMatchObject({
      email: "synthetic-recipient@example.test",
      phone: "5585999999999",
      signed: false,
    });
    const response = await f.send({
      action: "PREPARE_WHATSAPP",
      confirmedRecipient: "5585999999999",
      operationId,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe("%PDF");
    expect(fetcher).not.toHaveBeenCalled();
    const events = (
      await getPool().query(
        "SELECT id,action FROM inventory_document_delivery_events WHERE operation_id=$1",
        [operationId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("WHATSAPP_PREPARED");
    await expect(
      getPool().query(
        "UPDATE inventory_document_delivery_events SET action='EMAIL_ACCEPTED' WHERE id=$1",
        [events[0].id],
      ),
    ).rejects.toThrow(/immutable|append|history/i);
    await expect(
      getPool().query("DELETE FROM inventory_document_delivery_events WHERE id=$1", [events[0].id]),
    ).rejects.toThrow();
  });
  it("uses the signed PDF bytes rather than rendering an unsigned replacement", async () => {
    const f = await deliveryFixture(),
      signed = Buffer.from("%PDF-synthetic-signed-content");
    const download = vi
      .spyOn(signatureService, "documentSignaturesResponse")
      .mockResolvedValue(new Response(signed, { headers: { "Content-Type": "application/pdf" } }));
    const outgoing: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        outgoing.push(JSON.parse(String(init.body)));
        return Response.json({ id: randomUUID() });
      }),
    );
    expect((await f.send({ allowUnsigned: false })).status).toBe(200);
    expect(new URL((download.mock.calls[0]![0] as Request).url).searchParams.get("download")).toBe(
      "true",
    );
    const attachments = outgoing[0]!["attachments"] as Array<{ content: string }>;
    expect(Buffer.from(attachments[0]!.content, "base64")).toEqual(signed);
    expect(
      (
        await getPool().query(
          "SELECT signed FROM inventory_document_delivery_events WHERE document_id=$1 AND action='EMAIL_ACCEPTED'",
          [f.document.id],
        )
      ).rows[0].signed,
    ).toBe(true);
  });
  it("only lets an administrator edit the registered contact and audits the persisted change", async () => {
    const f = await fixture(),
      token = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [f.userId, hashToken(token)],
    );
    const body = {
      action: "UPDATE",
      userId: f.userId,
      name: "Draft author",
      email: f.userId + "@example.test",
      profession: "Médico",
      professionalCouncil: "CRM",
      councilNumber: "12345",
      councilRegion: "CE",
      role: "SUPER_ADMIN",
      unitIds: [f.unitId],
      prescribingAddress: "Synthetic clinic street 100",
      prescribingCity: "Fortaleza",
      prescribingState: "CE",
      prescribingPhone: "+5585999997777",
    };
    const update = () =>
      userAdminResponse(
        new Request(`${origin}/api/v1/inventory/users`, {
          method: "POST",
          headers: {
            origin,
            cookie: `allik_inventory_session=${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    expect((await update()).status).toBe(403);
    await getPool().query("UPDATE inventory_memberships SET role='SUPER_ADMIN' WHERE user_id=$1", [
      f.userId,
    ]);
    expect((await update()).status).toBe(200);
    expect(
      (
        await getPool().query(
          "SELECT prescribing_address,prescribing_phone FROM inventory_users WHERE id=$1",
          [f.userId],
        )
      ).rows[0],
    ).toEqual({
      prescribing_address: body.prescribingAddress,
      prescribing_phone: body.prescribingPhone,
    });
    const change = (
      await getPool().query(
        "SELECT actor_user_id,after_data FROM inventory_user_changes WHERE user_id=$1",
        [f.userId],
      )
    ).rows[0];
    expect(change.actor_user_id).toBe(f.userId);
    expect(change.after_data.prescribingAddress).toBe(body.prescribingAddress);
  });
});

describe("superseded and protected clinical records", () => {
  async function rectify(f: Awaited<ReturnType<typeof deliveryFixture>>) {
    const create = await f.post({
      action: "CREATE_AMENDMENT",
      documentId: f.document.id,
      version: f.document.version,
      amendmentKind: "RECTIFICATION",
      amendmentReason: "Correção da posologia informada",
      title: "RETIFICAÇÃO — RECEITA MÉDICA",
    });
    expect(create.status).toBe(201);
    const child = (await create.json()).data;
    const final = await f.post({
      action: "FINALIZE",
      documentId: child.id,
      version: child.version,
      title: "RETIFICAÇÃO — RECEITA MÉDICA",
      content: "Posologia corrigida, preservando o registro original.",
    });
    expect(final.status).toBe(200);
    return child;
  }
  it("marks a rectified original as superseded and refuses to send or sign it", async () => {
    const f = await deliveryFixture();
    const outgoing = vi.fn(async () => Response.json({ id: randomUUID() }));
    vi.stubGlobal("fetch", outgoing);
    const child = await rectify(f);
    const html = await (await f.get(`documentId=${f.document.id}&print=true`)).text();
    expect(html).toContain("SUBSTITUÍDO POR RETIFICAÇÃO");
    expect(html).toContain(`A1-${child.id.toUpperCase()}`);
    const childHtml = await (await f.get(`documentId=${child.id}&print=true`)).text();
    expect(childHtml).not.toContain("SUBSTITUÍDO POR RETIFICAÇÃO");
    const sent = await f.send({ confirmAmendments: true });
    expect(sent.status).toBe(409);
    expect((await sent.json()).error).toContain("retificação");
    expect(outgoing).not.toHaveBeenCalled();
    const token = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [f.userId, hashToken(token)],
    );
    const start = await signatureService.documentSignaturesResponse(
      new Request(`${origin}/api/v1/inventory/document-signatures`, {
        method: "POST",
        headers: {
          origin,
          cookie: `allik_inventory_session=${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "START",
          documentId: f.document.id,
          operationId: randomUUID(),
        }),
      }),
    );
    expect(start.status).toBe(409);
  });
  it("refuses delivery after the patient revokes consent", async () => {
    const f = await deliveryFixture();
    const outgoing = vi.fn(async () => Response.json({ id: randomUUID() }));
    vi.stubGlobal("fetch", outgoing);
    await getPool().query(
      "UPDATE inventory_patients SET consent_status='REVOKED',consent_recorded_at=now() WHERE id=$1",
      [f.patientId],
    );
    const sent = await f.send();
    expect(sent.status).toBe(409);
    expect((await sent.json()).error).toContain("consentimento");
    expect(outgoing).not.toHaveBeenCalled();
  });
  it("keeps an encounter with finalized records from being canceled or marked as no-show", async () => {
    const f = await deliveryFixture();
    const token = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [f.userId, hashToken(token)],
    );
    await getPool().query("UPDATE inventory_users SET profession='Médico' WHERE id=$1", [f.userId]);
    const appointment = (
      await getPool().query("SELECT * FROM inventory_care_appointments WHERE id=$1", [
        f.appointmentId,
      ])
    ).rows[0];
    const status = (value: string) =>
      careAppointmentsResponse(
        new Request(`${origin}/api/v1/inventory/care-appointments`, {
          method: "POST",
          headers: {
            origin,
            cookie: `allik_inventory_session=${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "UPDATE_STATUS",
            id: f.appointmentId,
            unitId: f.unitId,
            patientId: f.patientId,
            professionalUserId: f.userId,
            careType: "CONSULTATION",
            startsAt: appointment.starts_at.toISOString(),
            endsAt: appointment.ends_at.toISOString(),
            room: appointment.room,
            chair: null,
            notes: "",
            status: value,
            version: appointment.version,
            reason: "Tentativa de cancelar atendimento com documento final.",
          }),
        }),
      );
    const canceled = await status("CANCELED");
    expect(canceled.status).toBe(409);
    expect((await canceled.json()).error).toContain("finalizados");
    expect(
      (
        await getPool().query("SELECT status FROM inventory_care_appointments WHERE id=$1", [
          f.appointmentId,
        ])
      ).rows[0].status,
    ).toBe("SCHEDULED");
  });
});

describe("Explicit consent for document delivery", () => {
  it("blocks pending consent for email and WhatsApp before any outgoing call", async () => {
    const f = await deliveryFixture();
    await getPool().query(
      "UPDATE inventory_patients SET consent_status='PENDING',consent_recorded_at=NULL WHERE id=$1",
      [f.patientId],
    );
    const outgoing = vi.fn();
    vi.stubGlobal("fetch", outgoing);
    expect((await f.send()).status).toBe(409);
    expect(
      (await f.send({ action: "PREPARE_WHATSAPP", confirmedRecipient: "5585999999999" })).status,
    ).toBe(409);
    expect(outgoing).not.toHaveBeenCalled();
    const events = await getPool().query(
      "SELECT count(*)::int AS count FROM inventory_document_delivery_events WHERE document_id=$1",
      [f.document.id],
    );
    expect(events.rows[0].count).toBe(0);
  });
});
