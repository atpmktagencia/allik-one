import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashToken } from "./auth";
import { getDb, getPool } from "./db";
import { patientDocumentsResponse, patientDocumentFileResponse } from "./patient-document-center";
import { preconsultationResponse, preconsultationPublicResponse } from "./preconsultation";

import PDFDocument from "pdfkit";
import { documentClassificationResponse } from "./document-classification-store";
const model = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: model.generateText,
}));
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
  const insert = async (
    patientId = patient,
    at = new Date().toISOString(),
    documentUnit = unit,
  ) => {
    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO inventory_patient_documents(id,organization_id,unit_id,patient_id,title,categories,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'Private imported document',ARRAY['OTHER'],'patient-documents/'||$2::uuid::text||'/'||$4::uuid::text||'/'||$1::uuid::text||'.pdf','synthetic.pdf','application/pdf',20,$5,$6::uuid,$7::timestamptz)",
        [id, org, documentUnit, patientId, "a".repeat(64), user, at],
      );
      await client.query(
        "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
        [org, documentUnit, id, user],
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
  it("opens submitted questionnaires in the patient-scoped preconsultation workspace", async () => {
    const f = await fixture("SUPER_ADMIN");
    const formId = randomUUID();
    const post = (body: Record<string, unknown>) =>
      preconsultationResponse(
        new Request(origin + "/api/v1/inventory/preconsultation", {
          method: "POST",
          headers: { ...f.headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect(
      (
        await post({
          action: "SAVE_FORM",
          id: formId,
          unitId: f.unit,
          title: "Questionário sintético",
          questions: [{ id: "concern", type: "TEXT", label: "Relato" }],
        })
      ).status,
    ).toBe(200);
    expect((await post({ action: "PUBLISH_FORM", id: formId, version: 0 })).status).toBe(200);
    const invitation = await post({
      action: "INVITE",
      id: randomUUID(),
      patientId: f.patient,
      formId,
    });
    expect(invitation.status).toBe(201);
    const link = new URL((await invitation.json()).data.link);
    const token = new URLSearchParams(link.hash.slice(1)).get("token");
    const submitted = await preconsultationPublicResponse(
      new Request(origin + "/api/v1/preconsultation", {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT", token, answers: { concern: "Relato sintético" } }),
      }),
    );
    expect(submitted.status).toBe(200);
    const response = await f.read("&sourceKind=PRECONSULTATION_RESPONSE");
    expect(response.status).toBe(200);
    const documents = (await response.json()).data.documents;
    expect(documents).toHaveLength(1);
    expect(documents[0].originUrl).toBe(`/pre-consultas?patientId=${f.patient}`);
    expect(documents[0].previewUrl).toBeNull();
    expect(documents[0].downloadUrl).toBeNull();
  });

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
  it("accepts 4 MiB originals and rejects larger files before private storage", async () => {
    const f = await fixture();
    const send = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set(new TextEncoder().encode("%PDF-1.7"));
      const form = new FormData();
      form.set("id", randomUUID());
      form.set("patientId", f.patient);
      form.set("title", "Synthetic size boundary");
      form.set("categories", JSON.stringify(["OTHER"]));
      form.set("file", new File([bytes], "boundary.pdf", { type: "application/pdf" }));
      return patientDocumentsResponse(
        new Request(`${origin}/api/v1/inventory/patient-documents`, {
          method: "POST",
          headers: f.headers,
          body: form,
        }),
      );
    };
    storage.put.mockReset();
    expect((await send(4 * 1024 * 1024 + 1)).status).toBe(400);
    expect(storage.put).not.toHaveBeenCalled();
    storage.put.mockImplementation(async (pathname: string) => ({ pathname }));
    expect((await send(4 * 1024 * 1024)).status).toBe(201);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });
  it("bounds chunked multipart bytes even without a Content-Length header", async () => {
    const f = await fixture();
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted++ < 5) controller.enqueue(new Uint8Array(1024 * 1024));
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

function uploadForm(
  patientId: string,
  bytes = "%PDF-1.4 synthetic unique original",
  overrides: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    id: randomUUID(),
    patientId,
    title: "Exame sintético",
    categories: JSON.stringify(["LAB_RESULT"]),
    ...overrides,
  }))
    form.set(key, value);
  form.set("file", new File([bytes], "synthetic.pdf", { type: "application/pdf" }));
  return form;
}
function postUpload(f: Awaited<ReturnType<typeof fixture>>, form: FormData) {
  return patientDocumentsResponse(
    new Request(origin + "/api/v1/inventory/patient-documents", {
      method: "POST",
      headers: f.headers,
      body: form,
    }),
  );
}
describe("Laboratory document remediation", () => {
  it("requires an exam-compatible category for the explicit exam import intent", async () => {
    const f = await fixture();
    storage.put.mockImplementation(async (pathname: string) => ({ pathname }));
    const incompatible = uploadForm(f.patient, undefined, {
      intent: "EXAM",
      categories: JSON.stringify(["OTHER"]),
    });
    expect((await postUpload(f, incompatible)).status).toBe(400);
    const compatible = uploadForm(f.patient, undefined, { intent: "EXAM" });
    expect((await postUpload(f, compatible)).status).toBe(201);
  });
  it("serializes identical bytes across UUIDs and requires an audited intentional repetition", async () => {
    const f = await fixture();
    storage.put.mockImplementation(async (pathname: string) => ({ pathname }));
    const forms = [uploadForm(f.patient), uploadForm(f.patient)];
    const results = await Promise.all(forms.map((form) => postUpload(f, form)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const duplicate = await results.find((r) => r.status === 409)!.json();
    expect(duplicate.code).toBe("DUPLICATE_DOCUMENT");
    expect(typeof duplicate.duplicateId).toBe("string");
    const explicit = uploadForm(f.patient, undefined, {
      duplicateOf: duplicate.duplicateId,
      duplicateReason: "Repetição intencional para comparação de fluxo",
    });
    expect((await postUpload(f, explicit)).status).toBe(201);
    expect((await postUpload(f, explicit)).status).toBe(200);
    const event = (
      await getPool().query(
        "SELECT metadata FROM inventory_patient_document_events WHERE document_id=$1",
        [explicit.get("id")],
      )
    ).rows[0];
    expect(event.metadata).toEqual({
      duplicateOf: duplicate.duplicateId,
      duplicateReason: "Repetição intencional para comparação de fluxo",
    });
    explicit.set("duplicateReason", "Outra justificativa não deve substituir o registro");
    expect((await postUpload(f, explicit)).status).toBe(409);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int count FROM inventory_patient_documents WHERE patient_id=$1",
          [f.patient],
        )
      ).rows[0].count,
    ).toBe(2);
  });
  it("fails closed on altered or oversized originals, then identifies open and download separately", async () => {
    const f = await fixture();
    storage.put.mockImplementation(async (pathname: string) => ({ pathname }));
    const bytes = "%PDF-1.4 synthetic integrity test";
    const form = uploadForm(f.patient, bytes);
    expect((await postUpload(f, form)).status).toBe(201);
    const id = String(form.get("id"));
    const stored = (content: Uint8Array) => ({
      statusCode: 200,
      stream: new ReadableStream({
        start(c) {
          c.enqueue(content);
          c.close();
        },
      }),
    });
    storage.get.mockResolvedValueOnce(
      stored(new TextEncoder().encode(bytes.replace("test", "xxxx"))),
    );
    expect((await f.file(id)).status).toBe(503);
    storage.get.mockResolvedValueOnce(stored(new Uint8Array(4 * 1024 * 1024 + 1)));
    expect((await f.file(id)).status).toBe(503);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_clinical_access_events WHERE source_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    storage.get.mockImplementation(async () => stored(new TextEncoder().encode(bytes)));
    expect(await (await f.file(id)).text()).toBe(bytes);
    const download = await patientDocumentFileResponse(
      new Request(
        `${origin}/api/v1/inventory/patient-document-file?patientId=${f.patient}&sourceKind=GENERAL_DOCUMENT&sourceId=${id}&download=true`,
        { headers: f.headers },
      ),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Disposition")).toContain("attachment");
    const audit = await getPool().query(
      "SELECT action,source_kind,source_id,document_id FROM inventory_clinical_access_events WHERE source_id=$1 ORDER BY created_at",
      [id],
    );
    expect(audit.rows).toEqual([
      {
        action: "DOCUMENT_OPEN",
        source_kind: "GENERAL_DOCUMENT",
        source_id: id,
        document_id: null,
      },
      {
        action: "DOCUMENT_DOWNLOAD",
        source_kind: "GENERAL_DOCUMENT",
        source_id: id,
        document_id: null,
      },
    ]);
  });
  it("filters authorized historic/current documents by the explicitly requested unit", async () => {
    const f = await fixture("SUPER_ADMIN");
    const historical = await f.insert();
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    const current = await f.insert(f.patient, undefined, f.otherUnit);
    const ids = async (unit: string) =>
      (await (await f.read("&unitId=" + unit)).json()).data.documents.map(
        (d: { sourceId: string }) => d.sourceId,
      );
    expect(await ids(f.unit)).toEqual([historical]);
    expect(await ids(f.otherUnit)).toEqual([current]);
    expect(
      (
        await patientDocumentFileResponse(
          new Request(
            `${origin}/api/v1/inventory/patient-document-file?patientId=${f.patient}&sourceKind=GENERAL_DOCUMENT&sourceId=${historical}&unitId=${f.otherUnit}`,
            { headers: f.headers },
          ),
        )
      ).status,
    ).toBe(404);
  });
});

it("keeps uploaded-prescription hashes immutable and leaves legacy identity explicitly unverified", async () => {
  const f = await fixture();
  for (const sha of [null, "a".repeat(64)]) {
    const id = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_patient_prescriptions(id,organization_id,patient_id,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id) VALUES($1,$2,$3,$4,'synthetic.pdf','application/pdf',20,$5,$6)",
      [id, f.org, f.patient, "synthetic-prescription/" + id, sha, f.user],
    );
    await expect(
      getPool().query("UPDATE inventory_patient_prescriptions SET sha256=$2 WHERE id=$1", [
        id,
        "b".repeat(64),
      ]),
    ).rejects.toThrow(/hash is immutable/);
    await expect(
      getPool().query(
        "UPDATE inventory_patient_prescriptions SET document_status='REVOKED' WHERE id=$1",
        [id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  }
});

it("receives neutral originals without creating laboratory imports and reopens the same scoped identity", async () => {
  storage.put.mockImplementation(async (pathname: string) => ({ pathname }));
  const f = await fixture();
  const form = uploadForm(f.patient, undefined, {
    intent: "RECEIPT",
    categories: JSON.stringify(["OTHER"]),
  });
  const response = await postUpload(f, form);
  expect(response.status).toBe(201);
  const { data } = await response.json();
  const reopened = await f.read("&documentId=" + data.id);
  expect(reopened.status).toBe(200);
  const documents = (await reopened.json()).data.documents;
  expect(documents).toHaveLength(1);
  expect(documents[0]).toMatchObject({
    sourceId: data.id,
    classificationPending: true,
    categories: ["OTHER"],
    laboratoryStatus: null,
  });
  expect(documents[0].receivedAt).toBeTruthy();
  const exams = await f.read("&categoryGroup=EXAMS&documentId=" + data.id);
  expect((await exams.json()).data.documents).toHaveLength(0);
  expect((await f.read("&documentId=" + randomUUID())).status).toBe(200);
  const repeated = await postUpload(f, form);
  expect(repeated.status).toBe(200);
  expect((await repeated.json()).data.id).toBe(data.id);
});

async function classificationPdf(patientName: string, mixed = false) {
  const pdf = new PDFDocument();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    pdf.on("data", (b: Buffer) => chunks.push(b));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
  });
  pdf
    .fontSize(12)
    .text(`Paciente: ${patientName}`)
    .text("Pedido de exames")
    .text("Solicito hemograma");
  if (mixed) pdf.addPage().text("Laudo de imagem").text("Ultrassonografia abdominal");
  pdf.end();
  return done;
}
function controlledClassification(mixed = false) {
  return {
    output: {
      categories: [
        { category: "EXAM_REQUEST", evidence: [{ page: 1, quote: "Solicito hemograma" }] },
        ...(mixed
          ? [
              {
                category: "IMAGE_REPORT",
                evidence: [{ page: 2, quote: "Ultrassonografia abdominal" }],
              },
            ]
          : []),
      ],
      abstention: "NONE",
    },
    usage: { inputTokens: 100, outputTokens: 30 },
    response: { modelId: "gpt-6-luna" },
  };
}
describe("F2 upload-to-classification with controlled provider (no paid inference)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    model.generateText.mockReset();
  });
  async function prepare(patientName = "Synthetic document patient", mixed = false) {
    const f = await fixture();
    const bytes = await classificationPdf(patientName, mixed);
    vi.stubEnv("DOCUMENT_CLASSIFICATION_ENABLED", "true");
    vi.stubEnv("LAB_EXTRACTION_PROVIDER", "openai");
    vi.stubEnv("LAB_EXTRACTION_MODEL", "openai/gpt-6-luna");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-never-sent");
    storage.put.mockImplementation(async (path: string) => ({ pathname: path }));
    storage.get.mockImplementation(async () => ({
      statusCode: 200,
      stream: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(bytes));
          c.close();
        },
      }),
    }));
    const id = randomUUID();
    const send = () => {
      const form = uploadForm(f.patient, "", {
        id,
        categories: JSON.stringify(["OTHER"]),
        intent: "RECEIPT",
      });
      form.set(
        "file",
        new File([new Uint8Array(bytes)], "neutral.pdf", { type: "application/pdf" }),
      );
      return postUpload(f, form);
    };
    const events = async () =>
      (
        await getPool().query(
          "SELECT * FROM inventory_patient_document_classification_events WHERE document_id=$1 ORDER BY revision",
          [id],
        )
      ).rows;
    const change = (action: string, revision: number, payload: unknown) =>
      documentClassificationResponse(
        new Request(origin + "/api/v1/inventory/document-classifications", {
          method: "POST",
          headers: { ...f.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: id,
            patientId: f.patient,
            unitId: f.unit,
            operationId: randomUUID(),
            attemptId: null,
            expectedRevision: revision,
            command: { action, payload },
          }),
        }),
      );
    return { ...f, id, bytes, send, events, change };
  }
  it("classifies after commit; replay and GET cannot initiate another request", async () => {
    const f = await prepare();
    model.generateText.mockResolvedValue(controlledClassification());
    expect((await f.send()).status).toBe(201);
    expect((await f.events()).map((e) => e.action)).toEqual(["RECEIVED", "STARTED", "SUGGESTED"]);
    expect((await f.send()).status).toBe(200);
    await f.read();
    await f.read();
    expect(model.generateText).toHaveBeenCalledTimes(1);
    const doc = (
      await getPool().query(
        "SELECT categories,sha256 FROM inventory_patient_documents WHERE id=$1",
        [f.id],
      )
    ).rows[0];
    expect(doc.categories).toEqual(["OTHER"]);
    expect(doc.sha256).toBe(createHash("sha256").update(f.bytes).digest("hex"));
    const list = await f.read("&category=EXAM_REQUEST");
    expect((await list.json()).data.documents[0].sourceId).toBe(f.id);
  });
  it("preserves mixed pages in one original and one provider request", async () => {
    const f = await prepare("Synthetic document patient", true);
    model.generateText.mockResolvedValue(controlledClassification(true));
    await f.send();
    const e = (await f.events()).at(-1);
    expect(e.action).toBe("SUGGESTED");
    expect(e.payload.result.categories.map((c: { category: string }) => c.category)).toEqual([
      "EXAM_REQUEST",
      "IMAGE_REPORT",
    ]);
    expect(e.payload.result.categories[1].evidence[0].page).toBe(2);
    expect(model.generateText).toHaveBeenCalledTimes(1);
  });
  it("flags identity divergence, and correction is human and immutable", async () => {
    const f = await prepare("Another synthetic patient");
    model.generateText.mockResolvedValue(controlledClassification());
    await f.send();
    expect((await f.events()).at(-1).payload.evidenceStatus).toBe("IDENTITY_MISMATCH");
    expect(
      (
        await f.change("CORRECTED", 3, {
          schemaVersion: 1,
          categories: ["EXAM_REQUEST"],
          reason: "Original sintético conferido pelo profissional",
          originalReviewed: true,
          identityConfirmed: true,
        })
      ).status,
    ).toBe(200);
    const e = await f.events();
    expect(e.at(-1).actor_kind).toBe("HUMAN");
    expect(e[2].action).toBe("NEEDS_REVIEW");
  });
  it("provider failure preserves source, explicit retry is limited and audited", async () => {
    const f = await prepare();
    model.generateText
      .mockRejectedValueOnce(Error("TIMEOUT"))
      .mockResolvedValue(controlledClassification());
    expect((await f.send()).status).toBe(201);
    expect((await f.events()).at(-1).payload.failureCode).toBe("TIMEOUT");
    expect(
      (
        await f.change("RETRY_REQUESTED", 3, {
          schemaVersion: 1,
          reason: "Nova tentativa autorizada pelo profissional",
        })
      ).status,
    ).toBe(200);
    expect((await f.events()).map((e) => e.action)).toEqual([
      "RECEIVED",
      "STARTED",
      "FAILED",
      "RETRY_REQUESTED",
      "STARTED",
      "SUGGESTED",
    ]);
    expect(model.generateText).toHaveBeenCalledTimes(2);
    expect((await f.file(f.id)).status).toBe(200);
  });
  it("late result cannot replace manual decision during a provider request", async () => {
    const f = await prepare();
    let resolve: (r: ReturnType<typeof controlledClassification>) => void = () => {};
    model.generateText.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const request = f.send();
    for (let i = 0; i < 150 && (await f.events()).at(-1)?.action !== "STARTED"; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(
      (
        await f.change("MANUAL_CLASSIFIED", 2, {
          schemaVersion: 1,
          categories: ["EXAM_REQUEST"],
          reason: "Classificação manual antes da resposta do modelo",
          originalReviewed: true,
          identityConfirmed: true,
        })
      ).status,
    ).toBe(200);
    resolve(controlledClassification());
    expect((await request).status).toBe(201);
    expect((await f.events()).at(-1).action).toBe("MANUAL_CLASSIFIED");
  });
  it("bounds provider concurrency to two across organizations", async () => {
    const a = await prepare(),
      b = await prepare(),
      c = await prepare();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let active = 0,
      max = 0;
    model.generateText.mockImplementation(async () => {
      active++;
      max = Math.max(max, active);
      await gate;
      active--;
      return controlledClassification();
    });
    const uploads = [a.send(), b.send(), c.send()];
    for (let i = 0; i < 150 && model.generateText.mock.calls.length < 2; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(model.generateText.mock.calls.length).toBe(2);
    release();
    expect((await Promise.all(uploads)).map((r) => r.status)).toEqual([201, 201, 201]);
    expect(max).toBe(2);
    expect(model.generateText).toHaveBeenCalledTimes(3);
  });
});
