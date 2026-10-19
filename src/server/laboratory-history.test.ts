import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import * as accessAudit from "./clinical-access-audit";
import { laboratoryResultsResponse } from "./laboratory-results";
import { laboratoryHistoryResponse } from "./laboratory-history";
import { emptyLaboratoryRow } from "../lib/laboratory-results";
const origin = "http://localhost:4317";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await getPool().end();
});
async function fixture(role = "CLINICIAN") {
  const db = getPool(),
    org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    patient = randomUUID(),
    document = randomUUID(),
    token = randomUUID();
  await db.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    "Laboratory " + org,
  ]);
  await db.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Original'),($2,$3,'Current')",
    [unit, otherUnit, org],
  );
  await db.query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic clinician',$2,'CRM','12345','CE')",
    [user, user + "@example.test"],
  );
  await db.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
    [membership, user, org, "CLINICIAN"],
  );
  await db.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
    membership,
    unit,
  ]);
  await db.query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [user, hashToken(token)],
  );
  await db.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'LAB-TEST','Paciente fictício')",
    [patient, org, unit],
  );
  const bytes = "%PDF-1.7 synthetic laboratory original",
    sha = createHash("sha256").update(bytes).digest("hex");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO inventory_patient_documents(id,organization_id,unit_id,patient_id,title,categories,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id) VALUES($1,$2,$3,$4,'Laboratório sintético',ARRAY['LAB_RESULT'],$5,'test.pdf','application/pdf',$6,$7,$8)",
      [
        document,
        org,
        unit,
        patient,
        "patient-documents/" + org + "/" + patient + "/" + document + ".pdf",
        Buffer.byteLength(bytes),
        sha,
        user,
      ],
    );
    await c.query(
      "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
      [org, unit, document, user],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  if (role !== "CLINICIAN")
    await db.query("UPDATE inventory_memberships SET role=$2 WHERE id=$1", [membership, role]);
  const headers = {
    cookie: "allik_inventory_session=" + token,
    Origin: origin,
    "Content-Type": "application/json",
  };
  const post = (body: Record<string, unknown>) =>
    laboratoryResultsResponse(
      new Request(origin + "/api/v1/inventory/laboratory-results", {
        method: "POST",
        headers,
        body: JSON.stringify({ patientId: patient, documentId: document, ...body }),
      }),
    );
  const read = (p = patient) =>
    laboratoryResultsResponse(
      new Request(
        origin + "/api/v1/inventory/laboratory-results?patientId=" + p + "&documentId=" + document,
        { headers },
      ),
    );
  return {
    db,
    org,
    unit,
    otherUnit,
    user,
    membership,
    patient,
    document,
    bytes,
    post,
    read,
    headers,
  };
}
const confirmed = () => ({
  patientConfirmed: true,
  notes: "Revisado",
  rows: [
    {
      ...emptyLaboratoryRow(),
      name: "TSH",
      result: "<0,1",
      unit: "µUI/mL",
      reference: "0,27–4,2",
      collectedOn: "2026-01-02",
      verified: true,
    },
  ],
});
async function data(response: Response) {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()).data;
}

function history(f: Awaited<ReturnType<typeof fixture>>, patient: string = f.patient, extra = "") {
  return laboratoryHistoryResponse(
    new Request(origin + "/api/v1/inventory/laboratory-history?patientId=" + patient + extra, {
      headers: f.headers,
    }),
  );
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, version = 0, result = "<0,1") {
  const draft = confirmed();
  draft.rows[0]!.result = result;
  const saved = await data(await f.post({ action: "SAVE", version, draft }));
  return data(
    await f.post({ action: "VALIDATE", version: saved.import.version, operationId: randomUUID() }),
  );
}
describe("published laboratory history", () => {
  it("bounds the disclosed list to 500 observations and reports additional rows", async () => {
    const f = await fixture();
    for (let index = 0; index < 3; index++) {
      const documentId = index === 0 ? f.document : randomUUID();
      if (index > 0) {
        const c = await f.db.connect();
        try {
          await c.query("BEGIN");
          await c.query(
            `INSERT INTO inventory_patient_documents
             (id,organization_id,unit_id,patient_id,title,categories,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id)
             SELECT $1,organization_id,unit_id,patient_id,'Additional synthetic PDF',categories,$2,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id
             FROM inventory_patient_documents WHERE id=$3`,
            [
              documentId,
              "patient-documents/" + f.org + "/" + f.patient + "/" + documentId + ".pdf",
              f.document,
            ],
          );
          await c.query(
            "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
            [f.org, f.unit, documentId, f.user],
          );
          await c.query("COMMIT");
        } catch (error) {
          await c.query("ROLLBACK");
          throw error;
        } finally {
          c.release();
        }
      }
      await data(await f.post({ action: "OPEN", documentId }));
      const base = confirmed();
      const draft = {
        ...base,
        rows: Array.from({ length: 200 }, (_, ordinal) => ({
          ...base.rows[0]!,
          name: "Synthetic " + index + "/" + ordinal,
        })),
      };
      const saved = await data(await f.post({ action: "SAVE", documentId, version: 0, draft }));
      await data(
        await f.post({
          action: "VALIDATE",
          documentId,
          version: saved.import.version,
          operationId: randomUUID(),
        }),
      );
    }
    const response = await data(await history(f));
    expect(response.rows).toHaveLength(500);
    expect(response.hasMore).toBe(true);
    expect(response.offset).toBe(0);
    const remaining = await data(await history(f, f.patient, "&offset=500"));
    expect(remaining.rows).toHaveLength(100);
    expect(remaining.hasMore).toBe(false);
    expect(remaining.offset).toBe(500);
    const previousIds = new Set(response.rows.map((row: { id: string }) => row.id));
    expect(remaining.rows.every((row: { id: string }) => !previousIds.has(row.id))).toBe(true);
  });

  it("excludes drafts and superseded revisions while retaining published values during correction", async () => {
    const f = await fixture();
    await data(await f.post({ action: "OPEN" }));
    expect((await data(await history(f))).rows).toEqual([]);
    let published = await publish(f);
    let h = await data(await history(f));
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      reviewId: published.import.latest_review_id,
      documentId: f.document,
      payload: { result: "<0,1" },
    });
    expect(h.hasMore).toBe(false);
    expect(h.rows[0].previewUrl).toContain("sourceKind=GENERAL_DOCUMENT");
    const originalUrl = new URL(h.rows[0].previewUrl, origin);
    expect(originalUrl.searchParams.get("sourceId")).toBe(f.document);
    expect(originalUrl.searchParams.get("patientId")).toBe(f.patient);
    expect(originalUrl.searchParams.has("id")).toBe(false);
    const first = h.rows[0].id;
    published = await data(await f.post({ action: "REOPEN", version: published.import.version }));
    expect((await data(await history(f))).rows[0].id).toBe(first);
    published = await publish(f, published.import.version, "0,2");
    h = await data(await history(f));
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].id).not.toBe(first);
    expect(h.rows[0].payload.result).toBe("0,2");
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM inventory_laboratory_results WHERE patient_id=$1",
          [f.patient],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it("enforces organization, clinical role, selected unit, and original/current unit scope", async () => {
    const f = await fixture();
    await data(await f.post({ action: "OPEN" }));
    await publish(f);
    const outsider = await fixture();
    expect((await history(outsider, f.patient)).status).toBe(404);
    const finance = await fixture("FINANCE");
    expect((await history(finance)).status).toBe(403);
    expect((await history(f, f.patient, "&unitId=" + f.otherUnit)).status).toBe(403);
    await f.db.query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    expect((await history(f)).status).toBe(404);
    await f.db.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
      f.membership,
      f.otherUnit,
    ]);
    expect((await data(await history(f))).rows).toHaveLength(1);
    expect((await data(await history(f, f.patient, "&unitId=" + f.unit))).rows).toHaveLength(1);
    expect((await data(await history(f, f.patient, "&unitId=" + f.otherUnit))).rows).toEqual([]);
    await f.db.query("DELETE FROM inventory_unit_access WHERE membership_id=$1 AND unit_id=$2", [
      f.membership,
      f.unit,
    ]);
    expect((await data(await history(f))).rows).toEqual([]);
  });

  it("rejects ambiguous filters and fails closed when access audit cannot be recorded", async () => {
    const f = await fixture();
    expect((await history(f, f.patient, "&unexpected=true")).status).toBe(400);
    expect((await history(f, f.patient, "&patientId=" + f.patient)).status).toBe(400);
    expect((await history(f, "invalid")).status).toBe(400);
    expect((await history(f, f.patient, "&offset=-1")).status).toBe(400);
    expect((await history(f, f.patient, "&offset=10001")).status).toBe(400);
    expect((await history(f, f.patient, "&dateFrom=2026-02-30")).status).toBe(400);
    expect((await history(f, f.patient, "&dateFrom=2026-02-01&dateTo=2026-01-01")).status).toBe(
      400,
    );
    await data(await f.post({ action: "OPEN" }));
    await publish(f);
    const audit = vi
      .spyOn(accessAudit, "recordClinicalAccess")
      .mockRejectedValueOnce(new Error("Synthetic audit failure"));
    const response = await history(f);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("<0,1");
    audit.mockRestore();
    const ok = await history(f);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    const events = await f.db.query(
      "SELECT resource_ids FROM inventory_clinical_access_events WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1",
      [f.patient],
    );
    expect(events.rows[0].resource_ids).toHaveLength(1);
  });

  it("filters dates before limiting and retains undated observations only without period filters", async () => {
    const f = await fixture();
    await data(await f.post({ action: "OPEN" }));
    const base = confirmed();
    const draft = {
      ...base,
      rows: [
        base.rows[0]!,
        {
          ...base.rows[0]!,
          name: "Reported date only",
          collectedOn: null,
          reportedOn: "2026-02-03",
        },
        { ...base.rows[0]!, name: "Undated", collectedOn: null, reportedOn: null },
      ],
    };
    const saved = await data(await f.post({ action: "SAVE", version: 0, draft }));
    await data(
      await f.post({
        action: "VALIDATE",
        version: saved.import.version,
        operationId: randomUUID(),
      }),
    );
    expect((await data(await history(f))).rows).toHaveLength(3);
    const january = await data(
      await history(f, f.patient, "&dateFrom=2026-01-02&dateTo=2026-01-02"),
    );
    expect(january.rows).toHaveLength(1);
    expect(january.rows[0].payload.name).toBe("TSH");
    const february = await data(await history(f, f.patient, "&dateFrom=2026-02-01"));
    expect(february.rows).toHaveLength(1);
    expect(february.rows[0].payload.name).toBe("Reported date only");
    expect((await data(await history(f, f.patient, "&dateTo=2025-12-31"))).rows).toEqual([]);
  });
});
