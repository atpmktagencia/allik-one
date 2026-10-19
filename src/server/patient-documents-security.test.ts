import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashToken } from "./auth";
import { getDb, getPool } from "./db";
import { patientDocumentsResponse, patientDocumentFileResponse } from "./patient-document-center";

const storage = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => storage);
const origin = "http://localhost:4317";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable test database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
async function fixture(role = "CLINICIAN") {
  const org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    token = randomUUID(),
    patient = randomUUID(),
    otherPatient = randomUUID();
  const pool = getPool();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Document security ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Original'),($2,$3,'Transferred')",
    [unit, otherUnit, org],
  );
  await pool.query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Document clinician',$2,'CRM','123','CE')",
    [user, `${user}@example.test`],
  );
  await pool.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
    [membership, user, org, role],
  );
  await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
    membership,
    unit,
  ]);
  await pool.query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [user, hashToken(token)],
  );
  await pool.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$3,$4,'DOC-A','Synthetic document patient'),($2,$3,$4,'DOC-B','Other synthetic patient')",
    [patient, otherPatient, org, unit],
  );
  const headers = { cookie: `allik_inventory_session=${token}`, Origin: origin };
  const read = (query = "") =>
    patientDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/patient-documents?patientId=${patient}${query}`, {
        headers,
      }),
    );
  const file = (id: string, patientId = patient) =>
    patientDocumentFileResponse(
      new Request(
        `${origin}/api/v1/inventory/patient-document-file?patientId=${patientId}&sourceKind=GENERAL_DOCUMENT&sourceId=${id}`,
        { headers },
      ),
    );
  const insert = async (patientId = patient, at = new Date().toISOString()) => {
    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO inventory_patient_documents(id,organization_id,unit_id,patient_id,title,categories,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'Private imported document',ARRAY['OTHER'],'patient-documents/'||$2::uuid::text||'/'||$4::uuid::text||'/'||$1::uuid::text||'.pdf','synthetic.pdf','application/pdf',20,$5,$6::uuid,$7::timestamptz)",
        [id, org, unit, patientId, "a".repeat(64), user, at],
      );
      await client.query(
        "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
        [org, unit, id, user],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return id;
  };
  return {
    org,
    unit,
    otherUnit,
    user,
    membership,
    patient,
    otherPatient,
    headers,
    read,
    file,
    insert,
  };
}
describe("Patient document center independent security", () => {
  it("isolates patient metadata and refuses mismatched patient file requests before storage", async () => {
    const f = await fixture(),
      own = await f.insert(),
      other = await f.insert(f.otherPatient);
    const response = await f.read();
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toContain(own);
    expect(raw).not.toContain(other);
    storage.get.mockClear();
    expect((await f.file(own, f.otherPatient)).status).toBe(404);
    expect(storage.get).not.toHaveBeenCalled();
    expect(raw).not.toContain("private/");
  });
  it("requires both original and current patient units for metadata and file access", async () => {
    const f = await fixture(),
      id = await f.insert();
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    expect([403, 404]).toContain((await f.read()).status);
    expect([403, 404]).toContain((await f.file(id)).status);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.membership, f.otherUnit],
    );
    expect((await f.read()).status).toBe(200);
    await getPool().query(
      "DELETE FROM inventory_unit_access WHERE membership_id=$1 AND unit_id=$2",
      [f.membership, f.unit],
    );
    const response = await f.read();
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(id);
    expect([403, 404]).toContain((await f.file(id)).status);
  });
  it("denies finance clinical document metadata and file bytes", async () => {
    const f = await fixture(),
      id = await f.insert();
    await getPool().query("UPDATE inventory_memberships SET role='FINANCE' WHERE id=$1", [
      f.membership,
    ]);
    storage.get.mockClear();
    const response = await f.read();
    expect(response.status).toBe(200);
    expect((await response.json()).data.documents).toEqual([]);
    expect((await f.file(id)).status).toBe(404);
    expect(storage.get).not.toHaveBeenCalled();
  });
  it("rejects invalid filters rather than silently broadening the patient list", async () => {
    const f = await fixture();
    for (const query of [
      "&limit=5000",
      "&offset=-1",
      "&sort=arbitrary",
      "&dateFrom=not-a-date",
      "&professionalId=invalid",
      "&sourceKind=arbitrary",
    ])
      expect((await f.read(query)).status, query).toBe(400);
  });
  it("returns private no-store metadata and bounded pages without exposing object paths", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await f.insert(f.patient, `2026-10-${19 + i}T12:00:00Z`);
    const first = await f.read("&limit=2&offset=0"),
      second = await f.read("&limit=2&offset=2");
    expect(first.headers.get("Cache-Control")).toContain("no-store");
    const a = (await first.json()).data,
      b = (await second.json()).data;
    expect(a.documents).toHaveLength(2);
    expect(b.documents).toHaveLength(1);
    const keys = [...a.documents, ...b.documents].map((d: { sourceId: string }) => d.sourceId);
    expect(new Set(keys).size).toBe(3);
  });
  it("validates actual bytes and categories before contacting private storage", async () => {
    const f = await fixture();
    const send = (bytes: string, type: string, category = "OTHER") => {
      const form = new FormData();
      form.set("id", randomUUID());
      form.set("patientId", f.patient);
      form.set("title", "Synthetic original");
      form.set("categories", JSON.stringify([category]));
      form.set("file", new File([bytes], "synthetic.pdf", { type }));
      return patientDocumentsResponse(
        new Request(`${origin}/api/v1/inventory/patient-documents`, {
          method: "POST",
          headers: f.headers,
          body: form,
        }),
      );
    };
    storage.put.mockClear();
    expect((await send("<html>not a PDF</html>", "application/pdf")).status).toBe(400);
    expect((await send("%PDF-1.4 synthetic", "image/png")).status).toBe(400);
    expect((await send("%PDF-1.4 synthetic", "application/pdf", randomUUID())).status).toBe(400);
    expect(storage.put).not.toHaveBeenCalled();
  });
  it("stores exact original hash privately, then streams only through audited authenticated access", async () => {
    const f = await fixture(),
      id = randomUUID(),
      bytes = "%PDF-1.4\nsynthetic original\n%%EOF";
    storage.put.mockImplementation(async (pathname: string) => ({ pathname }));
    const form = new FormData();
    form.set("id", id);
    form.set("patientId", f.patient);
    form.set("title", "Imported original");
    form.set("categories", JSON.stringify(["LAB_RESULT", "OTHER"]));
    form.set("file", new File([bytes], "synthetic.pdf", { type: "application/pdf" }));
    const response = await patientDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/patient-documents`, {
        method: "POST",
        headers: f.headers,
        body: form,
      }),
    );
    expect(response.status).toBe(201);
    const storedCalls = storage.put.mock.calls.length;
    const retry = await patientDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/patient-documents`, {
        method: "POST",
        headers: f.headers,
        body: form,
      }),
    );
    expect(retry.status).toBe(200);
    expect(storage.put.mock.calls).toHaveLength(storedCalls);
    form.set(
      "file",
      new File(["%PDF-1.4 changed bytes"], "synthetic.pdf", { type: "application/pdf" }),
    );
    const conflict = await patientDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/patient-documents`, {
        method: "POST",
        headers: f.headers,
        body: form,
      }),
    );
    expect(conflict.status).toBe(409);
    expect(storage.put.mock.calls).toHaveLength(storedCalls);
    const doc = (
      await getPool().query(
        "SELECT sha256,size_bytes FROM inventory_patient_documents WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(doc).toEqual({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size_bytes: Buffer.byteLength(bytes),
    });
    expect(storage.put.mock.calls.at(-1)?.[2]).toMatchObject({ access: "private" });
    storage.get.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(bytes));
          controller.close();
        },
      }),
    });
    const file = await f.file(id);
    expect(file.status).toBe(200);
    expect(file.headers.get("Cache-Control")).toContain("no-store");
    expect(file.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await file.text()).toBe(bytes);
    const exams = await f.read("&categoryGroup=EXAMS");
    expect(
      (await exams.json()).data.documents.map((d: { sourceId: string }) => d.sourceId),
    ).toContain(id);
  });
  it("never substitutes another source when UUIDs collide and storage is unavailable", async () => {
    const f = await fixture(),
      id = await f.insert();
    storage.get.mockClear();
    const wrongSource = await patientDocumentFileResponse(
      new Request(
        `${origin}/api/v1/inventory/patient-document-file?patientId=${f.patient}&sourceKind=CLINICAL_DOCUMENT&sourceId=${id}`,
        { headers: f.headers },
      ),
    );
    expect(wrongSource.status).toBe(404);
    expect(storage.get).not.toHaveBeenCalled();
    storage.get.mockResolvedValue(null);
    expect((await f.file(id)).status).toBe(404);
    const unauthenticated = await patientDocumentFileResponse(
      new Request(
        `${origin}/api/v1/inventory/patient-document-file?patientId=${f.patient}&sourceKind=GENERAL_DOCUMENT&sourceId=${id}`,
      ),
    );
    expect(unauthenticated.status).toBe(401);
  });
  it("isolates custom category UUIDs and document identifiers between organizations", async () => {
    const own = await fixture(),
      foreign = await fixture("PARTNER_ADMIN"),
      id = await foreign.insert();
    const category = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_patient_document_categories(id,organization_id,name,created_by_user_id) VALUES($1,$2,'Foreign custom category',$3)",
      [category, foreign.org, foreign.user],
    );
    storage.put.mockClear();
    storage.get.mockClear();
    const form = new FormData();
    form.set("id", randomUUID());
    form.set("patientId", own.patient);
    form.set("title", "Synthetic original");
    form.set("categories", JSON.stringify([category]));
    form.set(
      "file",
      new File(["%PDF-1.4 synthetic"], "synthetic.pdf", { type: "application/pdf" }),
    );
    const response = await patientDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/patient-documents`, {
        method: "POST",
        headers: own.headers,
        body: form,
      }),
    );
    expect(response.status).toBe(400);
    expect((await own.file(id)).status).toBe(404);
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
    expect(await (await own.read()).text()).not.toContain(category);
  });
  it("bounds chunked multipart bytes even without a Content-Length header", async () => {
    const f = await fixture();
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted++ < 11) controller.enqueue(new Uint8Array(1024 * 1024));
        else controller.close();
      },
    });
    storage.put.mockClear();
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { ...f.headers, "Content-Type": "multipart/form-data; boundary=synthetic" },
      body: stream,
      duplex: "half",
    };
    const response = await patientDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/patient-documents`, init),
    );
    expect(response.status).toBe(400);
    expect(storage.put).not.toHaveBeenCalled();
  });
});
