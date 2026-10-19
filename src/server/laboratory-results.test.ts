import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import * as accessAudit from "./clinical-access-audit";
import { laboratoryResultsResponse } from "./laboratory-results";
import { emptyLaboratoryRow } from "../lib/laboratory-results";
const ai = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock("./laboratory-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./laboratory-extraction")>()),
  laboratoryExtractionConfiguration: () => ({ enabled: true, model: "synthetic/model" }),
  extractLaboratoryPdf: ai.extract,
  laboratoryModels: vi.fn(async () => []),
}));
const storage = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => storage);
const origin = "http://localhost:4317";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterEach(() => {
  vi.restoreAllMocks();
  ai.extract.mockReset();
  storage.get.mockReset();
});
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
describe("laboratory import, review and isolation", () => {
  it("publishes only confirmed rows, preserves revisions, and replays validation idempotently", async () => {
    const f = await fixture();
    let d = await data(await f.post({ action: "OPEN" }));
    const firstId = d.import.id;
    expect((await data(await f.post({ action: "OPEN" }))).import.id).toBe(firstId);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM inventory_laboratory_results WHERE patient_id=$1",
          [f.patient],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await f.post({ action: "VALIDATE", version: 0, operationId: randomUUID() })).status,
    ).toBe(409);
    d = await data(await f.post({ action: "SAVE", version: 0, draft: confirmed() }));
    expect(d.import.status).toBe("READY_REVIEW");
    const operationId = randomUUID(),
      version = d.import.version;
    d = await data(await f.post({ action: "VALIDATE", version, operationId }));
    expect(d.import.status).toBe("VALIDATED");
    expect((await f.post({ action: "VALIDATE", version, operationId })).status).toBe(200);
    expect(
      (
        await f.db.query("SELECT payload FROM inventory_laboratory_results WHERE patient_id=$1", [
          f.patient,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await f.db.query("SELECT payload FROM inventory_laboratory_results WHERE patient_id=$1", [
          f.patient,
        ])
      ).rows[0].payload.result,
    ).toBe("<0,1");
    const oldReview = d.import.latest_review_id;
    d = await data(await f.post({ action: "REOPEN", version: d.import.version }));
    expect(d.import.draft.patientConfirmed).toBe(false);
    expect(d.import.draft.rows[0].verified).toBe(false);
    const corrected = confirmed();
    corrected.rows[0]!.result = "0,2";
    d = await data(await f.post({ action: "SAVE", version: d.import.version, draft: corrected }));
    d = await data(
      await f.post({ action: "VALIDATE", version: d.import.version, operationId: randomUUID() }),
    );
    expect(d.versions).toHaveLength(2);
    const historical = await data(
      await laboratoryResultsResponse(
        new Request(
          origin +
            "/api/v1/inventory/laboratory-results?patientId=" +
            f.patient +
            "&documentId=" +
            f.document +
            "&reviewId=" +
            oldReview,
          { headers: f.headers },
        ),
      ),
    );
    expect(historical.historicalReview.snapshot.rows[0].result).toBe("<0,1");
    expect(
      (
        await f.db.query("SELECT snapshot FROM inventory_laboratory_review_versions WHERE id=$1", [
          oldReview,
        ])
      ).rows[0].snapshot.rows[0].result,
    ).toBe("<0,1");
    await expect(
      f.db.query("UPDATE inventory_laboratory_results SET payload='{}' WHERE patient_id=$1", [
        f.patient,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      f.db.query("TRUNCATE inventory_laboratory_review_versions CASCADE"),
    ).rejects.toThrow();
    expect((await f.read(randomUUID())).status).toBe(404);
  });
  it("enforces tenant, finance and both original/current unit scopes; blocks stale writes", async () => {
    const f = await fixture(),
      foreign = await fixture("FINANCE");
    expect((await foreign.read(f.patient)).status).toBe(403);
    const d = await data(await f.post({ action: "OPEN" }));
    await data(await f.post({ action: "SAVE", version: d.import.version, draft: confirmed() }));
    expect(
      (await f.post({ action: "SAVE", version: d.import.version, draft: confirmed() })).status,
    ).toBe(409);
    await f.db.query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    expect((await f.read()).status).toBe(404);
    await f.db.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
      f.membership,
      f.otherUnit,
    ]);
    expect((await f.read()).status).toBe(200);
    await f.db.query("DELETE FROM inventory_unit_access WHERE membership_id=$1 AND unit_id=$2", [
      f.membership,
      f.unit,
    ]);
    expect((await f.read()).status).toBe(404);
    const outsider = await fixture();
    expect(
      (await outsider.post({ action: "OPEN", patientId: f.patient, documentId: f.document }))
        .status,
    ).toBe(404);
  });
  it("extracts only a verified original, never trusts model confirmation, and retains the raw draft", async () => {
    const f = await fixture();
    let d = await data(await f.post({ action: "OPEN" }));
    storage.get.mockImplementation(async () => ({
      statusCode: 200,
      stream: new Blob([f.bytes]).stream(),
    }));
    ai.extract.mockResolvedValue(confirmed());
    const attempt = randomUUID();
    d = await data(
      await f.post({ action: "EXTRACT", version: d.import.version, operationId: attempt }),
    );
    expect(d.import.status).toBe("READY_REVIEW");
    expect(d.import.draft.patientConfirmed).toBe(false);
    expect(d.import.draft.rows[0].verified).toBe(false);
    expect(d.import.extracted_payload.rows[0].result).toBe("<0,1");
    await f.post({ action: "EXTRACT", version: 0, operationId: attempt });
    expect(ai.extract).toHaveBeenCalledTimes(1);
    const next = confirmed();
    next.rows[0]!.result = "0,3";
    d = await data(await f.post({ action: "SAVE", version: d.import.version, draft: next }));
    expect(d.import.extracted_payload.rows[0].result).toBe("<0,1");
    await expect(
      f.db.query(
        "UPDATE inventory_laboratory_imports SET draft='{}',version=version+1 WHERE id=$1",
        [d.import.id],
      ),
    ).rejects.toThrow(/audit/);
    const source = await fixture();
    const opened = await data(await source.post({ action: "OPEN" }));
    storage.get.mockImplementation(async () => ({
      statusCode: 200,
      stream: new Blob(["%PDF-1.7 tampered"]).stream(),
    }));
    const failed = await data(
      await source.post({
        action: "EXTRACT",
        version: opened.import.version,
        operationId: randomUUID(),
      }),
    );
    expect(failed.import.status).toBe("FAILED");
    expect(failed.import.failure_code).toBe("SOURCE_INTEGRITY");
    expect(ai.extract).toHaveBeenCalledTimes(1);
  });
  it("fails closed when read auditing fails and enforces the extraction quota before a provider call", async () => {
    const f = await fixture();
    const opened = await data(await f.post({ action: "OPEN" }));
    const spy = vi
      .spyOn(accessAudit, "recordClinicalAccess")
      .mockRejectedValueOnce(new Error("Synthetic audit failure"));
    const response = await f.read();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Paciente fictício");
    spy.mockRestore();
    const key = createHash("sha256")
      .update("lab-extraction-hour:" + f.org)
      .digest("hex");
    await f.db.query(
      "INSERT INTO inventory_auth_rate_limits(key,bucket,attempts) VALUES($1,date_trunc('hour',now()),6)",
      [key],
    );
    expect(
      (
        await f.post({
          action: "EXTRACT",
          version: opened.import.version,
          operationId: randomUUID(),
        })
      ).status,
    ).toBe(429);
    expect(ai.extract).not.toHaveBeenCalled();
    expect((await data(await f.read())).import.status).toBe("WAITING");
  });
});
