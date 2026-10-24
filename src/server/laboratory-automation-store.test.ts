import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PoolClient } from "pg";
import { getDb, getPool } from "./db";
import { hashToken, type AuthContext } from "./auth";
import { laboratoryResultsResponse } from "./laboratory-results";
import {
  appendClassificationEvent,
  appendSystemClassification,
} from "./document-classification-store";
import {
  enrollLaboratoryAutomation,
  appendLaboratoryAutomationEvent,
  readLaboratoryAutomation,
} from "./laboratory-automation-store";
import { emptyLaboratoryDraft, emptyLaboratoryRow } from "../lib/laboratory-results";
import { LABORATORY_AUTOMATION_VERSION } from "../lib/laboratory-automation";

beforeAll(async () => {
  const url = new URL(process.env["DATABASE_URL"] ?? "postgres://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_test"))
    throw Error("Disposable local PostgreSQL required");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
const reason = "Conferido no documento original sintético";
const system = { kind: "SYSTEM" as const, userId: null };
const startPayload = {
  schemaVersion: 1,
  model: "openai/offline-fixture",
  pages: [1],
  independentTotalPages: 1,
};
async function tx<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function fixture() {
  const org = randomUUID(),
    unit = randomUUID(),
    patient = randomUUID(),
    user = randomUUID(),
    membership = randomUUID();
  const p = getPool();
  await p.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Synthetic F3 ${org}`,
  ]);
  await p.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Synthetic unit')",
    [unit, org],
  );
  await p.query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic F3 clinician',$2,'CRM','123','CE')",
    [user, `${user}@example.test`],
  );
  await p.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
    [membership, user, org],
  );
  await p.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
    membership,
    unit,
  ]);
  await p.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'DOC-F3','Synthetic patient')",
    [patient, org, unit],
  );
  const auth: AuthContext = {
    user: {
      id: user,
      name: "Synthetic F3 clinician",
      email: `${user}@example.test`,
      professionalRegistryState: "OK",
    },
    organizationId: org,
    membershipId: membership,
    role: "CLINICIAN",
    unitIds: [unit],
    preview: false,
    integration: null,
  };
  return { org, unit, patient, user, membership, auth };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function receipt(c: PoolClient, f: Fixture) {
  const doc = randomUUID(),
    bytes = Buffer.from("%PDF-1.7 synthetic F3 original"),
    hash = createHash("sha256").update(bytes).digest("hex");
  await c.query(
    "INSERT INTO inventory_patient_documents(id,organization_id,unit_id,patient_id,title,categories,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id) VALUES($1,$2,$3,$4,'Synthetic F3',ARRAY['OTHER'],$5,'synthetic.pdf','application/pdf',$6,$7,$8)",
    [
      doc,
      f.org,
      f.unit,
      f.patient,
      `patient-documents/${f.org}/${f.patient}/${doc}.pdf`,
      bytes.length,
      hash,
      f.user,
    ],
  );
  await c.query(
    "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
    [f.org, f.unit, doc, f.user],
  );
  const e = await appendClassificationEvent(
    c,
    {
      documentId: doc,
      patientId: f.patient,
      unitId: f.unit,
      operationId: randomUUID(),
      attemptId: null,
      expectedRevision: 0,
      command: { action: "RECEIVED", payload: { schemaVersion: 1 } },
    },
    f.org,
    hash,
    system,
  );
  const enrollment = {
    operationId: randomUUID(),
    documentId: doc,
    organizationId: f.org,
    patientId: f.patient,
    unitId: f.unit,
    sourceSha256: hash,
    receiptEventId: e.id,
    initiatedByUserId: f.user,
    pipelineVersion: LABORATORY_AUTOMATION_VERSION,
  };
  return { doc, bytes, hash, enrollment };
}
async function enrolled(base?: Fixture) {
  const f = base ?? (await fixture());
  return await tx(async (c) => {
    const r = await receipt(c, f),
      request = await enrollLaboratoryAutomation(c, f.auth, r.enrollment);
    return { ...f, ...r, request };
  });
}
type Enrolled = Awaited<ReturnType<typeof enrolled>>;
const context = (f: Enrolled) => ({
  organizationId: f.org,
  patientId: f.patient,
  unitId: f.unit,
  documentId: f.doc,
});
async function classified(f: Enrolled) {
  const base = { documentId: f.doc, patientId: f.patient, unitId: f.unit, attemptId: randomUUID() };
  await appendSystemClassification(f.org, {
    ...base,
    operationId: randomUUID(),
    expectedRevision: 1,
    command: { action: "STARTED", payload: { schemaVersion: 1, model: "openai/offline-fixture" } },
  });
  return await appendSystemClassification(f.org, {
    ...base,
    operationId: randomUUID(),
    expectedRevision: 2,
    command: {
      action: "SUGGESTED",
      payload: {
        schemaVersion: 1,
        evidenceStatus: "SUPPORTED",
        result: {
          abstention: "NONE",
          categories: [
            { category: "LAB_RESULT", evidence: [{ page: 1, quote: "Glicose 90 mg/dL" }] },
          ],
        },
      },
    },
  });
}
function startInput(
  f: Enrolled,
  classificationId: string,
  operationId = randomUUID(),
  attemptId = randomUUID(),
) {
  return {
    requestId: f.request.id,
    operationId,
    expectedRevision: 0,
    classificationEventId: classificationId,
    attemptId,
    command: { action: "STARTED", payload: startPayload },
  };
}
async function start(base?: Enrolled) {
  const f = base ?? (await enrolled());
  const classification = await classified(f),
    input = startInput(f, classification.id);
  const event = await tx((c) => appendLaboratoryAutomationEvent(c, context(f), input, system));
  return { ...f, classification, input, event };
}
async function directEvent(f: Enrolled, changes: Record<string, unknown> = {}) {
  const value = {
    request_id: f.request.id,
    operation_id: randomUUID(),
    revision: 1,
    action: "STARTED",
    classification_event_id: null,
    attempt_id: randomUUID(),
    actor_kind: "SYSTEM",
    actor_user_id: null,
    payload: startPayload,
    ...changes,
  };
  const keys = Object.keys(value);
  return getPool().query(
    `INSERT INTO inventory_laboratory_automation_events(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    keys.map((k) =>
      k === "payload"
        ? JSON.stringify(value[k as keyof typeof value])
        : value[k as keyof typeof value],
    ),
  );
}
async function importReady(c: PoolClient, f: Awaited<ReturnType<typeof start>>) {
  const id = randomUUID(),
    draft = {
      ...emptyLaboratoryDraft(),
      rows: [
        {
          ...emptyLaboratoryRow(),
          name: "Glicose",
          result: "90",
          unit: "mg/dL",
          collectedOn: "2026-01-01",
        },
      ],
    };
  await c.query(
    "INSERT INTO inventory_laboratory_imports(id,organization_id,unit_id,patient_id,document_id,source_sha256,draft,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
    [id, f.org, f.unit, f.patient, f.doc, f.hash, emptyLaboratoryDraft(), f.user],
  );
  const audit = async (action: string, version: number) =>
    c.query(
      "INSERT INTO inventory_laboratory_import_events(import_id,organization_id,unit_id,patient_id,actor_user_id,action,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        f.org,
        f.unit,
        f.patient,
        f.user,
        action,
        { importVersion: version, executorKind: "SYSTEM", automationRequestId: f.request.id },
      ],
    );
  await audit("OPENED", 0);
  await c.query(
    "UPDATE inventory_laboratory_imports SET status='PROCESSING',version=1,attempt_id=$2,processing_started_at=now() WHERE id=$1",
    [id, f.input.attemptId],
  );
  await audit("PROCESSING_STARTED", 1);
  await c.query(
    "UPDATE inventory_laboratory_imports SET status='READY_REVIEW',version=2,draft=$2,extracted_payload=$2 WHERE id=$1",
    [id, draft],
  );
  await audit("EXTRACTION_READY", 2);
  return id;
}
const rows = async (f: Enrolled) =>
  (
    await getPool().query(
      "SELECT * FROM inventory_laboratory_automation_events WHERE request_id=$1 ORDER BY revision",
      [f.request.id],
    )
  ).rows;

describe("F3 persistent handoff — local PostgreSQL, no provider", () => {
  it("enrolls only a fresh original and records the uploader as initiator", async () => {
    const f = await enrolled();
    expect(f.request.document_id).toBe(f.doc);
    expect(f.request.source_sha256).toBe(f.hash);
    expect(f.request.initiated_by_user_id).toBe(f.user);
    const read = await tx((c) =>
      readLaboratoryAutomation(c, f.auth, {
        documentId: f.doc,
        patientId: f.patient,
        unitId: f.unit,
      }),
    );
    expect(read.request.id).toBe(f.request.id);
    expect(read.events).toHaveLength(0);
  });
  it("replays exact enrollment without reenrolling or touching the original", async () => {
    const f = await enrolled(),
      replay = await tx((c) => enrollLaboratoryAutomation(c, f.auth, f.enrollment));
    expect(replay.id).toBe(f.request.id);
    expect(
      (
        await getPool().query(
          "SELECT count(*) FROM inventory_laboratory_automation_requests WHERE document_id=$1",
          [f.doc],
        )
      ).rows[0].count,
    ).toBe("1");
    await expect(
      tx((c) =>
        enrollLaboratoryAutomation(c, f.auth, { ...f.enrollment, sourceSha256: "f".repeat(64) }),
      ),
    ).rejects.toThrow();
  });
  it("blocks automatic enrollment of a historical upload", async () => {
    const f = await fixture(),
      r = await tx((c) => receipt(c, f));
    await expect(tx((c) => enrollLaboratoryAutomation(c, f.auth, r.enrollment))).rejects.toThrow();
  });
  it("rejects forged roles, organizations, patients, units and initiators", async () => {
    const f = await enrolled(),
      other = await fixture();
    for (const auth of [
      { ...f.auth, role: "SUPER_ADMIN" as const },
      { ...f.auth, organizationId: other.org },
      other.auth,
      { ...f.auth, unitIds: [] },
    ])
      await expect(
        tx((c) =>
          readLaboratoryAutomation(c, auth, {
            documentId: f.doc,
            patientId: f.patient,
            unitId: f.unit,
          }),
        ),
      ).rejects.toThrow();
    for (const input of [
      { documentId: f.doc, patientId: other.patient, unitId: f.unit },
      { documentId: f.doc, patientId: f.patient, unitId: other.unit },
    ])
      await expect(tx((c) => readLaboratoryAutomation(c, f.auth, input))).rejects.toThrow();
    await expect(
      tx(async (c) => {
        const r = await receipt(c, f);
        return enrollLaboratoryAutomation(c, f.auth, {
          ...r.enrollment,
          initiatedByUserId: other.user,
        });
      }),
    ).rejects.toThrow();
  });
  it("records SYSTEM start without attributing the extraction decision to the uploader", async () => {
    const f = await start();
    expect(f.event.actor_kind).toBe("SYSTEM");
    expect(f.event.actor_user_id).toBeNull();
    expect(f.event.classification_event_id).toBe(f.classification.id);
  });
  it("replays duplicate start operations and rejects conflicting idempotency payloads", async () => {
    const f = await start(),
      same = await tx((c) => appendLaboratoryAutomationEvent(c, context(f), f.input, system));
    expect(same.id).toBe(f.event.id);
    await expect(
      tx((c) =>
        appendLaboratoryAutomationEvent(
          c,
          context(f),
          {
            ...f.input,
            command: { ...f.input.command, payload: { ...startPayload, model: "other/model" } },
          },
          system,
        ),
      ),
    ).rejects.toThrow();
    expect(await rows(f)).toHaveLength(1);
  });
  it("serializes concurrent duplicate operations into one event", async () => {
    const f = await enrolled(),
      classification = await classified(f),
      input = startInput(f, classification.id);
    const results = await Promise.all([
      tx((c) => appendLaboratoryAutomationEvent(c, context(f), input, system)),
      tx((c) => appendLaboratoryAutomationEvent(c, context(f), input, system)),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await rows(f)).toHaveLength(1);
  });
  it("allows only one winner for different simultaneous claims of the same revision", async () => {
    const f = await enrolled(),
      classification = await classified(f);
    const outcome = await Promise.allSettled([
      tx((c) =>
        appendLaboratoryAutomationEvent(c, context(f), startInput(f, classification.id), system),
      ),
      tx((c) =>
        appendLaboratoryAutomationEvent(c, context(f), startInput(f, classification.id), system),
      ),
    ]);
    expect(outcome.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outcome.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(await rows(f)).toHaveLength(1);
  });
  it("rejects changed F2 classification and preserves the correction while extraction is in flight", async () => {
    const f = await start();
    await tx((c) =>
      appendClassificationEvent(
        c,
        {
          documentId: f.doc,
          patientId: f.patient,
          unitId: f.unit,
          operationId: randomUUID(),
          expectedRevision: 3,
          attemptId: null,
          command: {
            action: "CORRECTED",
            payload: {
              schemaVersion: 1,
              categories: ["EXAM_REQUEST"],
              reason,
              originalReviewed: true,
              identityConfirmed: true,
            },
          },
        },
        f.org,
        f.hash,
        { kind: "HUMAN", userId: f.user },
      ),
    );
    await expect(
      tx((c) =>
        appendLaboratoryAutomationEvent(
          c,
          context(f),
          {
            requestId: f.request.id,
            operationId: randomUUID(),
            expectedRevision: 1,
            classificationEventId: f.classification.id,
            attemptId: f.input.attemptId,
            command: { action: "FAILED", payload: { schemaVersion: 1, failureCode: "TIMEOUT" } },
          },
          system,
        ),
      ),
    ).rejects.toThrow();
    const cancel = await tx((c) =>
      appendLaboratoryAutomationEvent(
        c,
        context(f),
        {
          requestId: f.request.id,
          operationId: randomUUID(),
          expectedRevision: 1,
          classificationEventId: null,
          attemptId: null,
          command: { action: "CANCELLED", payload: { schemaVersion: 1, reason } },
        },
        system,
      ),
    );
    expect(cancel.action).toBe("CANCELLED");
    expect(
      (
        await getPool().query(
          "SELECT action FROM inventory_patient_document_classification_events WHERE document_id=$1 ORDER BY revision DESC LIMIT 1",
          [f.doc],
        )
      ).rows[0].action,
    ).toBe("CORRECTED");
  });
  it("rejects revoked membership and a changed primary unit before completion", async () => {
    const f = await start(),
      command = {
        requestId: f.request.id,
        operationId: randomUUID(),
        expectedRevision: 1,
        classificationEventId: f.classification.id,
        attemptId: f.input.attemptId,
        command: { action: "FAILED", payload: { schemaVersion: 1, failureCode: "TIMEOUT" } },
      };
    await getPool().query("UPDATE inventory_memberships SET active=false WHERE id=$1", [
      f.membership,
    ]);
    await expect(
      tx((c) => appendLaboratoryAutomationEvent(c, context(f), command, system)),
    ).rejects.toThrow();
    await getPool().query("UPDATE inventory_memberships SET active=true WHERE id=$1", [
      f.membership,
    ]);
    const other = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Moved')",
      [other, f.org],
    );
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      other,
    ]);
    await expect(
      tx((c) => appendLaboratoryAutomationEvent(c, context(f), command, system)),
    ).rejects.toThrow();
  });
  it("requires matching attempt and atomically commits only an unconfirmed existing-pipeline draft", async () => {
    const f = await start();
    await expect(
      tx((c) =>
        appendLaboratoryAutomationEvent(
          c,
          context(f),
          {
            requestId: f.request.id,
            operationId: randomUUID(),
            expectedRevision: 1,
            classificationEventId: f.classification.id,
            attemptId: randomUUID(),
            command: { action: "FAILED", payload: { schemaVersion: 1, failureCode: "TIMEOUT" } },
          },
          system,
        ),
      ),
    ).rejects.toThrow();
    await tx(async (c) => {
      const importId = await importReady(c, f);
      await appendLaboratoryAutomationEvent(
        c,
        context(f),
        {
          requestId: f.request.id,
          operationId: randomUUID(),
          expectedRevision: 1,
          classificationEventId: f.classification.id,
          attemptId: f.input.attemptId,
          command: { action: "READY", payload: { schemaVersion: 1, importId } },
        },
        system,
      );
    });
    const imported = (
      await getPool().query(
        "SELECT status,draft FROM inventory_laboratory_imports WHERE document_id=$1",
        [f.doc],
      )
    ).rows[0];
    expect(imported.status).toBe("READY_REVIEW");
    expect(imported.draft.patientConfirmed).toBe(false);
    expect(imported.draft.rows.every((r: { verified: boolean }) => !r.verified)).toBe(true);
    expect(
      (
        await getPool().query(
          "SELECT count(*) FROM inventory_laboratory_results WHERE patient_id=$1",
          [f.patient],
        )
      ).rows[0].count,
    ).toBe("0");
    expect(
      (
        await getPool().query(
          "SELECT count(*) FROM inventory_laboratory_review_versions WHERE patient_id=$1",
          [f.patient],
        )
      ).rows[0].count,
    ).toBe("0");
  });
  it("rolls back import updates when a stale completion fails", async () => {
    const f = await start();
    await expect(
      tx(async (c) => {
        const importId = await importReady(c, f);
        await appendLaboratoryAutomationEvent(
          c,
          context(f),
          {
            requestId: f.request.id,
            operationId: randomUUID(),
            expectedRevision: 0,
            classificationEventId: f.classification.id,
            attemptId: f.input.attemptId,
            command: { action: "READY", payload: { schemaVersion: 1, importId } },
          },
          system,
        );
      }),
    ).rejects.toThrow();
    expect(
      (
        await getPool().query(
          "SELECT count(*) FROM inventory_laboratory_imports WHERE document_id=$1",
          [f.doc],
        )
      ).rows[0].count,
    ).toBe("0");
    expect(await rows(f)).toHaveLength(1);
  });
  it.each([
    {},
    { schemaVersion: 2 },
    { schemaVersion: 1, model: 123, pages: [1], independentTotalPages: 1 },
    { schemaVersion: 1, model: "x", pages: ["1"], independentTotalPages: 1 },
    { schemaVersion: 1, model: "x", pages: [1], independentTotalPages: "1" },
  ])("rejects malformed payload directly at SQL boundary %#", async (payload) => {
    const f = await enrolled(),
      classification = await classified(f);
    await expect(
      directEvent(f, { classification_event_id: classification.id, payload }),
    ).rejects.toThrow();
  });
  it("keeps requests/events append-only and preserves source bytes/hash", async () => {
    const f = await start(),
      before = (
        await getPool().query(
          "SELECT to_jsonb(d) row FROM inventory_patient_documents d WHERE id=$1",
          [f.doc],
        )
      ).rows[0].row;
    for (const table of [
      "inventory_laboratory_automation_requests",
      "inventory_laboratory_automation_events",
    ]) {
      await expect(
        getPool().query(`UPDATE ${table} SET operation_id=gen_random_uuid()`),
      ).rejects.toThrow();
      await expect(getPool().query(`DELETE FROM ${table}`)).rejects.toThrow();
      await expect(getPool().query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow();
    }
    const after = (
      await getPool().query(
        "SELECT to_jsonb(d) row FROM inventory_patient_documents d WHERE id=$1",
        [f.doc],
      )
    ).rows[0].row;
    expect(after).toEqual(before);
    expect(createHash("sha256").update(f.bytes).digest("hex")).toBe(after.sha256);
  });
});

it("requires a human retry, bounds attempts and rejects the earlier attempt's late response", async () => {
  const f = await start();
  const failure = (revision: number, attemptId: string) => ({
    requestId: f.request.id,
    operationId: randomUUID(),
    expectedRevision: revision,
    classificationEventId: f.classification.id,
    attemptId,
    command: { action: "FAILED", payload: { schemaVersion: 1, failureCode: "TIMEOUT" } },
  });
  await tx((c) =>
    appendLaboratoryAutomationEvent(c, context(f), failure(1, f.input.attemptId), system),
  );
  const retry = {
    requestId: f.request.id,
    operationId: randomUUID(),
    expectedRevision: 2,
    classificationEventId: null,
    attemptId: null,
    command: { action: "RETRY_REQUESTED", payload: { schemaVersion: 1, reason } },
  };
  await expect(
    tx((c) => appendLaboratoryAutomationEvent(c, context(f), retry, system)),
  ).rejects.toThrow();
  const human = { kind: "HUMAN" as const, auth: f.auth };
  const retried = await tx((c) => appendLaboratoryAutomationEvent(c, context(f), retry, human));
  expect(retried.actor_kind).toBe("HUMAN");
  expect(retried.actor_user_id).toBe(f.user);
  const second = { ...startInput(f, f.classification.id), expectedRevision: 3 };
  await tx((c) => appendLaboratoryAutomationEvent(c, context(f), second, system));
  await expect(
    tx((c) =>
      appendLaboratoryAutomationEvent(c, context(f), failure(4, f.input.attemptId), system),
    ),
  ).rejects.toThrow();
  await tx((c) =>
    appendLaboratoryAutomationEvent(c, context(f), failure(4, second.attemptId), system),
  );
  await expect(
    tx((c) =>
      appendLaboratoryAutomationEvent(
        c,
        context(f),
        { ...retry, operationId: randomUUID(), expectedRevision: 5 },
        human,
      ),
    ),
  ).rejects.toThrow();
  const before = (await rows(f)).length;
  await tx((c) =>
    readLaboratoryAutomation(c, f.auth, {
      documentId: f.doc,
      patientId: f.patient,
      unitId: f.unit,
    }),
  );
  expect(await rows(f)).toHaveLength(before); // Reading never retries a failed/uncertain provider call.
});

it("rejects SYSTEM actions forged as a human and cross-organization internal contexts", async () => {
  const f = await enrolled(),
    classification = await classified(f),
    input = startInput(f, classification.id),
    other = await fixture();
  await expect(
    tx((c) =>
      appendLaboratoryAutomationEvent(c, context(f), input, { kind: "HUMAN", auth: f.auth }),
    ),
  ).rejects.toThrow();
  await expect(
    tx((c) =>
      appendLaboratoryAutomationEvent(
        c,
        { ...context(f), organizationId: other.org },
        input,
        system,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    tx((c) =>
      appendLaboratoryAutomationEvent(
        c,
        { ...context(f), patientId: other.patient },
        input,
        system,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    tx((c) =>
      appendLaboratoryAutomationEvent(c, { ...context(f), unitId: other.unit }, input, system),
    ),
  ).rejects.toThrow();
  expect(await rows(f)).toHaveLength(0);
});

it("rejects reusing a started attempt on a different document", async () => {
  const first = await start(),
    second = await enrolled(),
    classification = await classified(second);
  await expect(
    tx((c) =>
      appendLaboratoryAutomationEvent(
        c,
        context(second),
        startInput(second, classification.id, randomUUID(), first.input.attemptId),
        system,
      ),
    ),
  ).rejects.toThrow();
});

it("permits SELECT/INSERT but denies UPDATE/DELETE/TRUNCATE for a restricted local role", async () => {
  const f = await enrolled(),
    classification = await classified(f),
    role = `allik_f3_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const pool = getPool();
  await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
  // Existing imports are mutable under the real runtime contract; SELECT FOR UPDATE needs UPDATE.
  await pool.query(`GRANT UPDATE ON inventory_laboratory_imports TO ${role}`);
  await pool.query(
    `GRANT INSERT ON inventory_laboratory_automation_requests,inventory_laboratory_automation_events TO ${role}`,
  );
  for (const table of [
    "inventory_laboratory_automation_requests",
    "inventory_laboratory_automation_events",
  ]) {
    const privileges = (
      await pool.query(
        "SELECT has_table_privilege($1,$2,'SELECT') s,has_table_privilege($1,$2,'INSERT') i,has_table_privilege($1,$2,'UPDATE') u,has_table_privilege($1,$2,'DELETE') d,has_table_privilege($1,$2,'TRUNCATE') t",
        [role, table],
      )
    ).rows[0];
    expect(privileges).toEqual({ s: true, i: true, u: false, d: false, t: false });
  }
  await tx(async (c) => {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(
      "INSERT INTO inventory_laboratory_automation_events(request_id,operation_id,revision,action,classification_event_id,attempt_id,actor_kind,actor_user_id,payload) VALUES($1,$2,1,'STARTED',$3,$4,'SYSTEM',NULL,$5)",
      [f.request.id, randomUUID(), classification.id, randomUUID(), startPayload],
    );
  });
  for (const sql of [
    "UPDATE inventory_laboratory_automation_events SET payload='{}'",
    "DELETE FROM inventory_laboratory_automation_events",
    "TRUNCATE inventory_laboratory_automation_events",
  ])
    await expect(
      tx(async (c) => {
        await c.query(`SET LOCAL ROLE ${role}`);
        await c.query(sql);
      }),
    ).rejects.toThrow(/permission denied/);
});

it("preserves an already sealed clinical version while handling a different new document", async () => {
  const base = await fixture(),
    legacy = await tx((c) => receipt(c, base)),
    token = randomUUID();
  await getPool().query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [base.user, hashToken(token)],
  );
  const post = async (body: Record<string, unknown>) => {
    const response = await laboratoryResultsResponse(
      new Request("http://localhost:4317/api/v1/inventory/laboratory-results", {
        method: "POST",
        headers: {
          Origin: "http://localhost:4317",
          cookie: `allik_inventory_session=${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ patientId: base.patient, documentId: legacy.doc, ...body }),
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()).data;
  };
  let old = await post({ action: "OPEN" });
  old = await post({
    action: "SAVE",
    version: old.import.version,
    draft: {
      patientConfirmed: true,
      notes: "Revisado no original sintético",
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
    },
  });
  await post({ action: "VALIDATE", version: old.import.version, operationId: randomUUID() });
  const f = await enrolled(base);
  const fingerprint = async () =>
    (
      await getPool().query(
        `SELECT
    (SELECT count(*) FROM inventory_patient_documents d WHERE d.organization_id=$1 AND d.patient_id=$2) originals_count,
    (SELECT count(*) FROM inventory_laboratory_results r WHERE r.organization_id=$1 AND r.patient_id=$2) results_count,
    (SELECT count(*) FROM inventory_laboratory_review_versions v WHERE v.organization_id=$1 AND v.patient_id=$2) versions_count,
    (SELECT md5(string_agg(to_jsonb(d)::text,',' ORDER BY d.id)) FROM inventory_patient_documents d WHERE d.organization_id=$1 AND d.patient_id=$2) originals,
    (SELECT md5(string_agg(to_jsonb(r)::text,',' ORDER BY r.id)) FROM inventory_laboratory_results r WHERE r.organization_id=$1 AND r.patient_id=$2) results,
    (SELECT md5(string_agg(to_jsonb(v)::text,',' ORDER BY v.id)) FROM inventory_laboratory_review_versions v WHERE v.organization_id=$1 AND v.patient_id=$2) versions`,
        [base.org, base.patient],
      )
    ).rows[0];
  const before = await fingerprint();
  expect(before.results).not.toBeNull();
  expect(before.versions).not.toBeNull();
  const running = await start(f);
  await tx((c) =>
    appendLaboratoryAutomationEvent(
      c,
      context(f),
      {
        requestId: f.request.id,
        operationId: randomUUID(),
        expectedRevision: 1,
        classificationEventId: running.classification.id,
        attemptId: running.input.attemptId,
        command: { action: "FAILED", payload: { schemaVersion: 1, failureCode: "TIMEOUT" } },
      },
      system,
    ),
  );
  const after = await fingerprint();
  expect(after).toEqual(before);
  await mkdir("work", { recursive: true });
  await writeFile(
    "work/f3-local-preservation.json",
    JSON.stringify(
      {
        environment: "disposable-local-postgresql",
        providerCalls: 0,
        before,
        after,
        unchanged: JSON.stringify(before) === JSON.stringify(after),
        preservedLiteral: "<0,1",
      },
      null,
      2,
    ),
  );
  expect(
    (
      await getPool().query(
        "SELECT payload->>'result' result FROM inventory_laboratory_results WHERE organization_id=$1 AND patient_id=$2",
        [base.org, base.patient],
      )
    ).rows,
  ).toEqual([{ result: "<0,1" }]);
});

it.each(["verified", "patientConfirmed"])(
  "rejects an automatic READY carrying human confirmation %s",
  async (field) => {
    const f = await start();
    await expect(
      tx(async (c) => {
        const importId = await importReady(c, f),
          path = field === "verified" ? "{rows,0,verified}" : "{patientConfirmed}";
        await c.query(
          "UPDATE inventory_laboratory_imports SET version=3,draft=jsonb_set(draft,$2::text[],'true'::jsonb),updated_at=now() WHERE id=$1",
          [importId, path],
        );
        await c.query(
          "INSERT INTO inventory_laboratory_import_events(import_id,organization_id,unit_id,patient_id,actor_user_id,action,metadata) VALUES($1,$2,$3,$4,$5,'DRAFT_SAVED',$6)",
          [importId, f.org, f.unit, f.patient, f.user, { importVersion: 3 }],
        );
        await appendLaboratoryAutomationEvent(
          c,
          context(f),
          {
            requestId: f.request.id,
            operationId: randomUUID(),
            expectedRevision: 1,
            classificationEventId: f.classification.id,
            attemptId: f.input.attemptId,
            command: { action: "READY", payload: { schemaVersion: 1, importId } },
          },
          system,
        );
      }),
    ).rejects.toThrow();
    expect(
      (
        await getPool().query(
          "SELECT count(*) FROM inventory_laboratory_imports WHERE document_id=$1",
          [f.doc],
        )
      ).rows[0].count,
    ).toBe("0");
  },
);

it("gives a concurrent manual OPEN priority without a duplicate automated claim", async () => {
  const f = await enrolled(),
    classification = await classified(f),
    manual = await getPool().connect(),
    tag = `f3-manual-${randomUUID()}`;
  let automatic: Promise<{ ok: boolean }> | undefined;
  try {
    await manual.query("BEGIN");
    await manual.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `lab:${f.org}:${f.doc}`,
    ]);
    const importId = randomUUID();
    await manual.query(
      "INSERT INTO inventory_laboratory_imports(id,organization_id,unit_id,patient_id,document_id,source_sha256,draft,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
      [importId, f.org, f.unit, f.patient, f.doc, f.hash, emptyLaboratoryDraft(), f.user],
    );
    await manual.query(
      "INSERT INTO inventory_laboratory_import_events(import_id,organization_id,unit_id,patient_id,actor_user_id,action,metadata) VALUES($1,$2,$3,$4,$5,'OPENED',$6)",
      [importId, f.org, f.unit, f.patient, f.user, { importVersion: 0 }],
    );
    automatic = tx(async (c) => {
      await c.query("SELECT set_config('application_name',$1,true)", [tag]);
      return appendLaboratoryAutomationEvent(
        c,
        context(f),
        startInput(f, classification.id),
        system,
      );
    }).then(
      () => ({ ok: true }),
      () => ({ ok: false }),
    );
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      waiting =
        (
          await getPool().query(
            "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'",
            [tag],
          )
        ).rowCount === 1;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await manual.query("COMMIT");
    expect(await automatic).toEqual({ ok: false });
    expect(await rows(f)).toHaveLength(0);
    expect(
      (
        await getPool().query(
          "SELECT status FROM inventory_laboratory_imports WHERE document_id=$1",
          [f.doc],
        )
      ).rows[0].status,
    ).toBe("WAITING");
  } finally {
    await manual.query("ROLLBACK");
    manual.release();
    await automatic;
  }
});

it("rejects autocommit for enrollment, append and read without writing events", async () => {
  const f = await enrolled(),
    classification = await classified(f),
    c = await getPool().connect();
  try {
    await expect(enrollLaboratoryAutomation(c, f.auth, f.enrollment)).rejects.toThrow();
    await expect(
      appendLaboratoryAutomationEvent(c, context(f), startInput(f, classification.id), system),
    ).rejects.toThrow();
    await expect(
      readLaboratoryAutomation(c, f.auth, {
        documentId: f.doc,
        patientId: f.patient,
        unitId: f.unit,
      }),
    ).rejects.toThrow();
  } finally {
    c.release();
  }
  expect(await rows(f)).toHaveLength(0);
});

it("retries only the existing failed import associated with the same automation request", async () => {
  const f = await start(),
    importId = randomUUID();
  await tx(async (c) => {
    await c.query(
      "INSERT INTO inventory_laboratory_imports(id,organization_id,unit_id,patient_id,document_id,source_sha256,draft,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
      [importId, f.org, f.unit, f.patient, f.doc, f.hash, emptyLaboratoryDraft(), f.user],
    );
    const audit = async (action: string, version: number) =>
      c.query(
        "INSERT INTO inventory_laboratory_import_events(import_id,organization_id,unit_id,patient_id,actor_user_id,action,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          importId,
          f.org,
          f.unit,
          f.patient,
          f.user,
          action,
          { importVersion: version, executorKind: "SYSTEM", automationRequestId: f.request.id },
        ],
      );
    await audit("OPENED", 0);
    await c.query(
      "UPDATE inventory_laboratory_imports SET status='PROCESSING',version=1,attempt_id=$2,processing_started_at=now() WHERE id=$1",
      [importId, f.input.attemptId],
    );
    await audit("PROCESSING_STARTED", 1);
    await c.query(
      "UPDATE inventory_laboratory_imports SET status='FAILED',version=2,failure_code='TIMEOUT' WHERE id=$1",
      [importId],
    );
    await audit("EXTRACTION_FAILED", 2);
    await appendLaboratoryAutomationEvent(
      c,
      context(f),
      {
        requestId: f.request.id,
        operationId: randomUUID(),
        expectedRevision: 1,
        classificationEventId: f.classification.id,
        attemptId: f.input.attemptId,
        command: { action: "FAILED", payload: { schemaVersion: 1, failureCode: "TIMEOUT" } },
      },
      system,
    );
  });
  await tx((c) =>
    appendLaboratoryAutomationEvent(
      c,
      context(f),
      {
        requestId: f.request.id,
        operationId: randomUUID(),
        expectedRevision: 2,
        classificationEventId: null,
        attemptId: null,
        command: { action: "RETRY_REQUESTED", payload: { schemaVersion: 1, reason } },
      },
      { kind: "HUMAN", auth: f.auth },
    ),
  );
  const second = { ...startInput(f, f.classification.id), expectedRevision: 3 };
  await tx((c) => appendLaboratoryAutomationEvent(c, context(f), second, system));
  expect(
    (
      await getPool().query(
        "SELECT id,status FROM inventory_laboratory_imports WHERE document_id=$1",
        [f.doc],
      )
    ).rows,
  ).toEqual([{ id: importId, status: "FAILED" }]);
  await expect(
    tx((c) =>
      appendLaboratoryAutomationEvent(
        c,
        context(f),
        {
          requestId: f.request.id,
          operationId: randomUUID(),
          expectedRevision: 4,
          classificationEventId: f.classification.id,
          attemptId: f.input.attemptId,
          command: { action: "FAILED", payload: { schemaVersion: 1, failureCode: "TIMEOUT" } },
        },
        system,
      ),
    ),
  ).rejects.toThrow();
});

it.each([
  "organization_id",
  "patient_id",
  "unit_id",
  "source_sha256",
  "initiated_by_user_id",
  "created_at",
])("rejects direct SQL enrollment with mismatched or backfilled %s", async (field) => {
  const f = await fixture(),
    foreign = await fixture();
  await expect(
    tx(async (c) => {
      const r = await receipt(c, f),
        value: Record<string, unknown> = {
          operation_id: r.enrollment.operationId,
          document_id: r.doc,
          organization_id: f.org,
          patient_id: f.patient,
          unit_id: f.unit,
          source_sha256: r.hash,
          receipt_event_id: r.enrollment.receiptEventId,
          initiated_by_user_id: f.user,
          pipeline_version: LABORATORY_AUTOMATION_VERSION,
        };
      const changes: Record<string, unknown> = {
        organization_id: foreign.org,
        patient_id: foreign.patient,
        unit_id: foreign.unit,
        source_sha256: "f".repeat(64),
        initiated_by_user_id: foreign.user,
        created_at: new Date(Date.now() - 86400000),
      };
      value[field] = changes[field];
      const keys = Object.keys(value);
      await c.query(
        `INSERT INTO inventory_laboratory_automation_requests(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        keys.map((k) => value[k]),
      );
    }),
  ).rejects.toThrow();
});

it("accepts the direct SQL control for a correctly scoped fresh receipt", async () => {
  const f = await fixture();
  await tx(async (c) => {
    const r = await receipt(c, f);
    const inserted = await c.query(
      "INSERT INTO inventory_laboratory_automation_requests(operation_id,document_id,organization_id,patient_id,unit_id,source_sha256,receipt_event_id,initiated_by_user_id,pipeline_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING document_id",
      [
        r.enrollment.operationId,
        r.doc,
        f.org,
        f.patient,
        f.unit,
        r.hash,
        r.enrollment.receiptEventId,
        f.user,
        LABORATORY_AUTOMATION_VERSION,
      ],
    );
    expect(inserted.rows[0].document_id).toBe(r.doc);
  });
});
