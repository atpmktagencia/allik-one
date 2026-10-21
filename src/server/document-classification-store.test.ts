import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import {
  appendSystemClassification,
  documentClassificationResponse,
} from "./document-classification-store";
import type { ClassificationWrite } from "../lib/document-classification-events";

beforeAll(async () => {
  const url = new URL(process.env["DATABASE_URL"] ?? "postgres://invalid");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.endsWith("_test"))
    throw Error("Disposable local PostgreSQL required");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  await getPool().query(await readFile("docs/proposals/patient-f2/persistence.sql", "utf8"));
});
afterAll(async () => {
  await getPool().end();
});
const origin = "http://localhost:4317";
const reason = "Conferido no documento original sintético";
const decision = {
  schemaVersion: 1 as const,
  categories: ["EXAM_REQUEST" as const],
  reason,
  originalReviewed: true as const,
  identityConfirmed: true as const,
};
const suggestion = {
  schemaVersion: 1 as const,
  result: {
    categories: [
      { category: "EXAM_REQUEST" as const, evidence: [{ page: 1, quote: "Solicito hemograma" }] },
    ],
    abstention: "NONE" as const,
  },
  evidenceStatus: "SUPPORTED" as const,
};
async function fixture() {
  const org = randomUUID(),
    unit = randomUUID(),
    patient = randomUUID(),
    doc = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    token = randomUUID();
  const pool = getPool();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Synthetic F2 ${org}`,
  ]);
  await pool.query("INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Unit')", [
    unit,
    org,
  ]);
  await pool.query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic clinician',$2,'CRM','123','CE')",
    [user, `${user}@example.test`],
  );
  await pool.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
    [membership, user, org],
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
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'DOC-F2','Synthetic patient')",
    [patient, org, unit],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO inventory_patient_documents(id,organization_id,unit_id,patient_id,title,categories,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id) VALUES($1,$2,$3,$4,'Synthetic F2',ARRAY['OTHER'],'patient-documents/'||$2::uuid::text||'/'||$4::uuid::text||'/'||$1::uuid::text||'.pdf','synthetic.pdf','application/pdf',20,$5,$6)",
      [doc, org, unit, patient, "a".repeat(64), user],
    );
    await client.query(
      "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
      [org, unit, doc, user],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  const base = { documentId: doc, patientId: patient, unitId: unit };
  const sys = (
    action: ClassificationWrite["command"]["action"],
    payload: unknown,
    expectedRevision: number,
    attemptId: string | null = null,
    operationId = randomUUID(),
  ) =>
    appendSystemClassification(org, {
      ...base,
      operationId,
      attemptId,
      expectedRevision,
      command: { action, payload },
    });
  const post = (
    action: string,
    payload: unknown,
    expectedRevision: number,
    options: Record<string, unknown> = {},
  ) =>
    documentClassificationResponse(
      new Request(`${origin}/classification`, {
        method: "POST",
        headers: {
          Origin: origin,
          cookie: `allik_inventory_session=${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...base,
          operationId: randomUUID(),
          attemptId: null,
          expectedRevision,
          command: { action, payload },
          ...options,
        }),
      }),
    );
  const read = (overrides: Record<string, string> = {}) =>
    documentClassificationResponse(
      new Request(`${origin}/classification?${new URLSearchParams({ ...base, ...overrides })}`, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  const events = async () =>
    (
      await pool.query(
        "SELECT * FROM inventory_patient_document_classification_events WHERE document_id=$1 ORDER BY revision",
        [doc],
      )
    ).rows;
  await sys("RECEIVED", { schemaVersion: 1 }, 0);
  return { org, unit, patient, doc, user, membership, token, base, sys, post, read, events };
}
async function started() {
  const f = await fixture();
  const attempt = randomUUID();
  await f.sys("STARTED", { schemaVersion: 1, model: "openai/test-offline" }, 1, attempt);
  return { ...f, attempt };
}
async function suggested() {
  const f = await started();
  const result = await f.sys("SUGGESTED", suggestion, 2, f.attempt);
  return { ...f, result };
}
async function direct(f: Awaited<ReturnType<typeof fixture>>, changes: Record<string, unknown>) {
  const prev = (await f.events()).at(-1);
  const value = {
    ...prev,
    id: randomUUID(),
    operation_id: randomUUID(),
    revision: prev.revision + 1,
    ...changes,
  };
  const keys = [
    "id",
    "document_id",
    "organization_id",
    "unit_id",
    "patient_id",
    "source_sha256",
    "classifier_version",
    "revision",
    "operation_id",
    "actor_kind",
    "actor_user_id",
    "system_identity",
    "action",
    "attempt_id",
    "payload",
  ];
  return getPool().query(
    `INSERT INTO inventory_patient_document_classification_events(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    keys.map((k) => (k === "payload" ? JSON.stringify(value[k]) : value[k])),
  );
}
describe("F2 revised SQL, backend authorization and concurrency (no provider)", () => {
  it("records automatic system identity without assigning the uploader", async () => {
    const f = await fixture();
    const [e] = await f.events();
    expect(e.actor_kind).toBe("SYSTEM");
    expect(e.actor_user_id).toBeNull();
    expect(e.system_identity).toBe("document-classifier");
    expect(e.action).toBe("RECEIVED");
  });
  it.each(["STARTED", "FAILED"])(
    "forbids AI confirmation from %s; allows separately attributed manual classification",
    async (state) => {
      const f = await started();
      let revision = 2;
      if (state === "FAILED") {
        await f.sys("FAILED", { schemaVersion: 1, failureCode: "TIMEOUT" }, 2, f.attempt);
        revision = 3;
      }
      expect(
        (await f.post("CONFIRMED", { ...decision, resultEventId: randomUUID() }, revision)).status,
      ).toBe(409);
      expect((await f.post("MANUAL_CLASSIFIED", decision, revision)).status).toBe(200);
      const last = (await f.events()).at(-1);
      expect(last.actor_user_id).toBe(f.user);
      expect(last.actor_kind).toBe("HUMAN");
      expect(last.system_identity).toBeNull();
      expect(last.action).toBe("MANUAL_CLASSIFIED");
    },
  );
  it("confirms only the exact verifiable result and categories", async () => {
    const f = await suggested();
    expect(
      (await f.post("CONFIRMED", { ...decision, resultEventId: randomUUID() }, 3)).status,
    ).toBe(409);
    expect(
      (
        await f.post(
          "CONFIRMED",
          { ...decision, resultEventId: f.result.id, categories: ["LAB_RESULT"] },
          3,
        )
      ).status,
    ).toBe(409);
    expect((await f.post("CONFIRMED", { ...decision, resultEventId: f.result.id }, 3)).status).toBe(
      200,
    );
  });
  it("cannot confirm uncertain output", async () => {
    const f = await started();
    await f.sys(
      "NEEDS_REVIEW",
      { ...suggestion, evidenceStatus: "IDENTITY_MISMATCH" },
      2,
      f.attempt,
    );
    expect(
      (await f.post("CONFIRMED", { ...decision, resultEventId: (await f.events()).at(-1).id }, 3))
        .status,
    ).toBe(409);
  });
  it("rejects automatic event injection through the human handler", async () => {
    const f = await started();
    expect((await f.post("SUGGESTED", suggestion, 2, { attemptId: f.attempt })).status).toBe(400);
    expect((await f.events()).length).toBe(2);
  });
  it("rejects client supplied author, tenant and version fields", async () => {
    const f = await fixture();
    for (const extra of [
      { actor_user_id: f.user },
      { organizationId: f.org },
      { classifierVersion: "forged" },
    ])
      expect((await f.post("MANUAL_CLASSIFIED", decision, 1, extra)).status).toBe(400);
  });
  it("isolates organizations in backend reads and writes", async () => {
    const f = await fixture(),
      other = await fixture();
    expect((await f.read(other.base)).status).toBe(404);
    expect((await f.post("MANUAL_CLASSIFIED", decision, 1, other.base)).status).toBe(404);
    await expect(
      appendSystemClassification(other.org, {
        ...f.base,
        operationId: randomUUID(),
        expectedRevision: 1,
        attemptId: randomUUID(),
        command: { action: "STARTED", payload: { schemaVersion: 1, model: "test" } },
      }),
    ).rejects.toThrow();
  });
  it.each(["patientId", "unitId"])("isolates supplied %s in reads and writes", async (key) => {
    const f = await fixture();
    expect((await f.read({ [key]: randomUUID() })).status).toBe(404);
    expect((await f.post("MANUAL_CLASSIFIED", decision, 1, { [key]: randomUUID() })).status).toBe(
      404,
    );
  });
  it.each(["VIEWER", "FINANCE", "UNIT_MANAGER", "INVENTORY_MANAGER"])(
    "denies clinical classification to %s",
    async (role) => {
      const f = await fixture();
      await getPool().query("UPDATE inventory_memberships SET role=$1 WHERE id=$2", [
        role,
        f.membership,
      ]);
      expect((await f.read()).status).toBe(403);
      expect((await f.post("MANUAL_CLASSIFIED", decision, 1)).status).toBe(403);
    },
  );
  it("denies inactive user and missing historical unit access", async () => {
    const f = await fixture();
    await getPool().query("DELETE FROM inventory_unit_access WHERE membership_id=$1", [
      f.membership,
    ]);
    expect((await f.read()).status).toBe(403);
    expect((await f.post("MANUAL_CLASSIFIED", decision, 1)).status).toBe(403);
    await getPool().query("UPDATE inventory_users SET active=false WHERE id=$1", [f.user]);
    expect((await f.read()).status).toBe(401);
  });
  it("denies cross-origin human writes and unauthenticated reads", async () => {
    const f = await fixture();
    expect(
      (await documentClassificationResponse(new Request(`${origin}/classification`))).status,
    ).toBe(401);
    expect(
      (
        await documentClassificationResponse(
          new Request(`${origin}/classification`, {
            method: "POST",
            headers: { Origin: "https://evil.test", cookie: `allik_inventory_session=${f.token}` },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it.each([
    { reason: "" },
    { categories: ["DIAGNOSIS"] },
    { categories: ["LAB_RESULT", "LAB_RESULT"] },
    { schemaVersion: 2 },
    { originalReviewed: false },
    { identityConfirmed: false },
    { categories: [] },
    { extra: "forged" },
  ])("rejects invalid human payload %j before insertion", async (change) => {
    const f = await fixture();
    expect((await f.post("MANUAL_CLASSIFIED", { ...decision, ...change }, 1)).status).toBe(400);
    expect((await f.events()).length).toBe(1);
  });
  it("serializes simultaneous claims; only one wins", async () => {
    const f = await fixture();
    const result = await Promise.allSettled([
      f.sys("STARTED", { schemaVersion: 1, model: "test" }, 1, randomUUID()),
      f.sys("STARTED", { schemaVersion: 1, model: "test" }, 1, randomUUID()),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await f.events()).length).toBe(2);
  });
  it("reconciles duplicate concurrent operations without a second event", async () => {
    const f = await fixture(),
      attempt = randomUUID(),
      operation = randomUUID();
    const results = await Promise.all([
      f.sys("STARTED", { schemaVersion: 1, model: "test" }, 1, attempt, operation),
      f.sys("STARTED", { schemaVersion: 1, model: "test" }, 1, attempt, operation),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect((await f.events()).length).toBe(2);
  });
  it("does not overwrite manual decision with late provider output", async () => {
    const f = await started();
    expect((await f.post("MANUAL_CLASSIFIED", decision, 2)).status).toBe(200);
    await expect(f.sys("SUGGESTED", suggestion, 2, f.attempt)).rejects.toThrow();
    await expect(f.sys("SUGGESTED", suggestion, 3, f.attempt)).rejects.toThrow();
    expect((await f.events()).at(-1).action).toBe("MANUAL_CLASSIFIED");
  });
  it("races manual action against result and preserves all committed revisions", async () => {
    const f = await started();
    const outcomes = await Promise.allSettled([
      f.sys("SUGGESTED", suggestion, 2, f.attempt),
      f.post("MANUAL_CLASSIFIED", decision, 2),
    ]);
    const events = await f.events();
    expect(events.map((e) => e.revision)).toEqual([1, 2, 3]);
    expect(outcomes.some((x) => x.status === "fulfilled")).toBe(true);
    if (events.at(-1).action === "SUGGESTED")
      expect((await f.post("CORRECTED", decision, 3)).status).toBe(200);
  });
  it("supports human retry idempotency and rejects changed payload for same operation", async () => {
    const f = await fixture(),
      operationId = randomUUID();
    const a = await f.post("MANUAL_CLASSIFIED", decision, 1, { operationId });
    const b = await f.post("MANUAL_CLASSIFIED", decision, 1, { operationId });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(
      (
        await f.post(
          "MANUAL_CLASSIFIED",
          { ...decision, reason: "Outra justificativa diferente" },
          1,
          { operationId },
        )
      ).status,
    ).toBe(409);
    expect((await f.events()).length).toBe(2);
  });
  it("limits explicit retries without hourly or daily quotas", async () => {
    const f = await started();
    await f.sys("FAILED", { schemaVersion: 1, failureCode: "TIMEOUT" }, 2, f.attempt);
    expect((await f.post("RETRY_REQUESTED", { schemaVersion: 1, reason }, 3)).status).toBe(200);
    const attempt = randomUUID();
    await f.sys("STARTED", { schemaVersion: 1, model: "test" }, 4, attempt);
    await f.sys("FAILED", { schemaVersion: 1, failureCode: "TIMEOUT" }, 5, attempt);
    expect((await f.post("RETRY_REQUESTED", { schemaVersion: 1, reason }, 6)).status).toBe(200);
    await expect(
      f.sys("STARTED", { schemaVersion: 1, model: "test" }, 7, randomUUID()),
    ).rejects.toThrow();
  });
  it("database rejects invalid payload even bypassing backend", async () => {
    const f = await fixture();
    for (const payload of [
      { ...decision, reason: "x" },
      { ...decision, categories: ["DIAGNOSIS"] },
      { ...decision, identityConfirmed: false },
      { ...decision, unknown: true },
      { ...decision, schemaVersion: "1" },
    ])
      await expect(
        direct(f, {
          action: "MANUAL_CLASSIFIED",
          actor_kind: "HUMAN",
          actor_user_id: f.user,
          system_identity: null,
          payload,
        }),
      ).rejects.toThrow();
  });
  it("database rejects forged source, author and AI result evidence", async () => {
    const f = await started();
    for (const change of [
      { organization_id: randomUUID() },
      { patient_id: randomUUID() },
      { unit_id: randomUUID() },
      { source_sha256: "b".repeat(64) },
      { actor_user_id: f.user },
      { system_identity: null },
      { classifier_version: "unknown" },
      {
        payload: {
          ...suggestion,
          result: {
            ...suggestion.result,
            categories: [{ category: "LAB_RESULT", evidence: [{ page: 0, quote: "" }] }],
          },
        },
      },
    ])
      await expect(
        direct(f, { action: "SUGGESTED", payload: suggestion, ...change }),
      ).rejects.toThrow();
  });
  it("prevents update, delete, truncate and preserves corrections plus original metadata", async () => {
    const f = await fixture();
    const before = (
      await getPool().query(
        "SELECT to_jsonb(d) snapshot FROM inventory_patient_documents d WHERE id=$1",
        [f.doc],
      )
    ).rows[0].snapshot;
    await f.post("MANUAL_CLASSIFIED", decision, 1);
    await f.post("CORRECTED", { ...decision, categories: ["IMAGE_REPORT"] }, 2);
    for (const sql of [
      "UPDATE inventory_patient_document_classification_events SET payload='{}' WHERE document_id=$1",
      "DELETE FROM inventory_patient_document_classification_events WHERE document_id=$1",
    ])
      await expect(getPool().query(sql, [f.doc])).rejects.toThrow();
    await expect(
      getPool().query("TRUNCATE inventory_patient_document_classification_events"),
    ).rejects.toThrow();
    expect((await f.events()).map((e) => e.action)).toEqual([
      "RECEIVED",
      "MANUAL_CLASSIFIED",
      "CORRECTED",
    ]);
    expect(
      (
        await getPool().query(
          "SELECT to_jsonb(d) snapshot FROM inventory_patient_documents d WHERE id=$1",
          [f.doc],
        )
      ).rows[0].snapshot,
    ).toEqual(before);
  });
  it("checks both current and historical units after patient transfer", async () => {
    const f = await fixture(),
      next = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Transferred')",
      [next, f.org],
    );
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$1 WHERE id=$2", [
      next,
      f.patient,
    ]);
    expect((await f.read()).status).toBe(403);
    expect((await f.post("MANUAL_CLASSIFIED", decision, 1)).status).toBe(403);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.membership, next],
    );
    expect((await f.read()).status).toBe(200);
    expect((await f.post("MANUAL_CLASSIFIED", decision, 1)).status).toBe(200);
  });
  it("rejects output from a different attempt and duplicate attempt identity", async () => {
    const f = await started();
    await expect(f.sys("SUGGESTED", suggestion, 2, randomUUID())).rejects.toThrow();
    await expect(
      f.sys("STARTED", { schemaVersion: 1, model: "test" }, 2, f.attempt),
    ).rejects.toThrow();
    expect((await f.events()).length).toBe(2);
  });
  it("rejects malformed evidence, missing versions and unsupported automatic certainty at SQL level", async () => {
    const f = await started();
    const bad = [
      { ...suggestion, schemaVersion: 2 },
      { ...suggestion, evidenceStatus: "UNAVAILABLE" },
      { ...suggestion, result: { ...suggestion.result, abstention: "AMBIGUOUS" } },
      {
        ...suggestion,
        result: { ...suggestion.result, categories: [{ category: "EXAM_REQUEST", evidence: [] }] },
      },
      {
        ...suggestion,
        result: {
          ...suggestion.result,
          categories: [{ category: "EXAM_REQUEST", evidence: [{ page: 1, quote: "   " }] }],
        },
      },
      {
        ...suggestion,
        result: {
          ...suggestion.result,
          categories: [{ category: "EXAM_REQUEST", evidence: [{ page: 1.5, quote: "text" }] }],
        },
      },
      { ...suggestion, instruction: "bypass review" },
    ];
    for (const payload of bad)
      await expect(direct(f, { action: "SUGGESTED", payload })).rejects.toThrow();
  });
  it("works with SELECT/INSERT-only role, without UPDATE on original or events", async () => {
    const f = await fixture(),
      client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE ROLE f2_review_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS",
      );
      await client.query("GRANT USAGE ON SCHEMA public TO f2_review_runtime");
      await client.query("GRANT SELECT ON ALL TABLES IN SCHEMA public TO f2_review_runtime");
      await client.query(
        "GRANT INSERT ON inventory_patient_document_classification_events TO f2_review_runtime",
      );
      await client.query("SET LOCAL ROLE f2_review_runtime");
      const rights = (
        await client.query(
          "SELECT has_table_privilege(current_user,'inventory_patient_documents','UPDATE') original_update,has_table_privilege(current_user,'inventory_patient_document_classification_events','UPDATE') event_update",
        )
      ).rows[0];
      expect(rights).toEqual({ original_update: false, event_update: false });
      await client.query(
        `INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,system_identity,action,attempt_id,payload) VALUES($1,$2,$3,$4,$5,'document-classifier-1',2,$6,'SYSTEM','document-classifier','STARTED',$7,$8)`,
        [
          f.doc,
          f.org,
          f.unit,
          f.patient,
          "a".repeat(64),
          randomUUID(),
          randomUUID(),
          JSON.stringify({ schemaVersion: 1, model: "test-offline" }),
        ],
      );
      await client.query(
        `INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,action,payload) VALUES($1,$2,$3,$4,$5,'document-classifier-1',3,$6,'HUMAN',$7,'MANUAL_CLASSIFIED',$8)`,
        [
          f.doc,
          f.org,
          f.unit,
          f.patient,
          "a".repeat(64),
          randomUUID(),
          f.user,
          JSON.stringify(decision),
        ],
      );
      expect(
        (
          await client.query(
            "SELECT count(*)::int total FROM inventory_patient_document_classification_events WHERE document_id=$1",
            [f.doc],
          )
        ).rows[0].total,
      ).toBe(3);
      await client.query("ROLLBACK");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });
});
