import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashToken } from "./auth";
import { clinicalRequestsResponse } from "./clinical-requests";
import { hasClinicalRecords, hasFinalClinicalRecords } from "./clinical-record-guard";
import { encounterDocumentsResponse } from "./encounter-documents";
import { getDb, getPool } from "./db";

const origin = "https://clinical-document-discard.example.test";

type Actor = { id: string; membership: string; cookie: string };
type CreatedDocument = { id: string; version: number; status: string };

beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Disposable database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await getPool().end();
});

afterAll(() => vi.unstubAllEnvs());

async function fixture() {
  const pool = getPool();
  const org = randomUUID();
  const unit = randomUUID();
  const otherUnit = randomUUID();
  const patient = randomUUID();
  const appointment = randomUUID();

  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Synthetic discard organization ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Discard unit'),($2,$3,'Other unit')",
    [unit, otherUnit, org],
  );

  const actor = async (name: string, accessibleUnits: string[] = [unit]): Promise<Actor> => {
    const id = randomUUID();
    const membership = randomUUID();
    const token = randomUUID();
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,$2,$3,'CRM',$4,'CE')",
      [id, `Synthetic ${name}`, `${id}@example.test`, parseInt(id.slice(0, 8), 16).toString()],
    );
    await pool.query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
      [membership, id, org],
    );
    for (const accessibleUnit of accessibleUnits)
      await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
        membership,
        accessibleUnit,
      ]);
    await pool.query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [id, hashToken(token)],
    );
    return { id, membership, cookie: `allik_inventory_session=${token}` };
  };

  const owner = await actor("discard owner");
  const colleague = await actor("different author");
  await pool.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'DISCARD-TEST','Synthetic discard patient')",
    [patient, org, unit],
  );
  await pool.query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room,status) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Discard room','IN_PROGRESS')",
    [appointment, org, unit, patient, owner.id],
  );

  const request = (
    resource: string,
    data?: unknown,
    cookie = owner.cookie,
    requestOrigin = origin,
  ) => {
    const hasBody = data !== undefined;
    return new Request(`${origin}/api/v1/inventory/${resource}`, {
      method: hasBody ? "POST" : "GET",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(hasBody ? { origin: requestOrigin, "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(data) } : {}),
    });
  };
  const postDocument = (data: unknown, cookie = owner.cookie, requestOrigin = origin) =>
    encounterDocumentsResponse(request("encounter-documents", data, cookie, requestOrigin));
  const readDocuments = (cookie = owner.cookie) =>
    encounterDocumentsResponse(
      request(`encounter-documents?appointmentId=${appointment}`, undefined, cookie),
    );
  const postClinicalRequest = (data: unknown, cookie = owner.cookie) =>
    clinicalRequestsResponse(request("clinical-requests", data, cookie, origin));
  const readClinicalRequests = (cookie = owner.cookie) =>
    clinicalRequestsResponse(
      request(`clinical-requests?appointmentId=${appointment}`, undefined, cookie),
    );
  const createDocument = async (status: "DRAFT" | "FINAL" = "DRAFT") => {
    const response = await postDocument({
      action: status === "FINAL" ? "FINALIZE" : "SAVE_DRAFT",
      appointmentId: appointment,
      creationId: randomUUID(),
      type: "EXAM_REQUEST",
      title: "Solicitação sintética para descarte",
      content: "Conteúdo clínico sintético preservado",
      version: null,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()).data as CreatedDocument;
  };

  return {
    pool,
    org,
    unit,
    otherUnit,
    patient,
    appointment,
    owner,
    colleague,
    request,
    postDocument,
    readDocuments,
    postClinicalRequest,
    readClinicalRequests,
    createDocument,
  };
}

function discardPayload(
  fixture: { appointment: string },
  document: CreatedDocument,
  values: Record<string, unknown> = {},
) {
  return {
    action: "DISCARD",
    appointmentId: fixture.appointment,
    documentId: document.id,
    type: "EXAM_REQUEST",
    version: document.version,
    reason: "Motivo sintético revisado pelo autor",
    ...values,
  };
}

describe("Clinical document discard lifecycle", () => {
  it("requires a reason, discards only DRAFT atomically, preserves the ledger/content, and removes active sources", async () => {
    const f = await fixture();
    const draft = await f.createDocument();

    const missingReason = await f.postDocument(discardPayload(f, draft, { reason: "não" }));
    expect(missingReason.status, await missingReason.clone().text()).toBe(400);
    expect(
      (
        await f.pool.query("SELECT status,version FROM inventory_encounter_documents WHERE id=$1", [
          draft.id,
        ])
      ).rows[0],
    ).toEqual({ status: "DRAFT", version: draft.version });

    const discarded = await f.postDocument(discardPayload(f, draft));
    expect(discarded.status, await discarded.clone().text()).toBe(200);
    expect(await discarded.json()).toMatchObject({
      data: { id: draft.id, status: "DISCARDED", version: draft.version + 1 },
    });

    const row = (
      await f.pool.query(
        "SELECT id,type,title,content,status,version,discarded_at,discarded_reason,discarded_by_user_id FROM inventory_encounter_documents WHERE id=$1",
        [draft.id],
      )
    ).rows[0];
    expect(row).toMatchObject({
      id: draft.id,
      type: "EXAM_REQUEST",
      title: "Solicitação sintética para descarte",
      content: "Conteúdo clínico sintético preservado",
      status: "DISCARDED",
      version: draft.version + 1,
      discarded_reason: "Motivo sintético revisado pelo autor",
      discarded_by_user_id: f.owner.id,
    });
    expect(row.discarded_at).toBeTruthy();

    const changes = (
      await f.pool.query(
        "SELECT action,before_data,after_data FROM inventory_encounter_document_changes WHERE document_id=$1 ORDER BY created_at,id",
        [draft.id],
      )
    ).rows;
    const discardChange = changes.find((change) => change.action === "DISCARD");
    expect(discardChange).toBeDefined();
    expect(discardChange.before_data).toMatchObject({
      id: draft.id,
      status: "DRAFT",
      content: "Conteúdo clínico sintético preservado",
      version: draft.version,
    });
    expect(discardChange.after_data).toMatchObject({
      id: draft.id,
      status: "DISCARDED",
      content: "Conteúdo clínico sintético preservado",
      version: draft.version + 1,
      discarded_reason: "Motivo sintético revisado pelo autor",
    });

    const documents = (await (await f.readDocuments()).json()).data.documents;
    expect(documents.some((document: { id: string }) => document.id === draft.id)).toBe(false);
    const requests = (await (await f.readClinicalRequests()).json()).data.requests;
    expect(requests.some((request: { sourceId: string }) => request.sourceId === draft.id)).toBe(
      false,
    );

    const directSourceMutation = await f.postClinicalRequest({
      appointmentId: f.appointment,
      sourceKind: "DOCUMENT",
      sourceId: draft.id,
      action: "ISSUED",
      version: 0,
      operationId: randomUUID(),
      note: "Tentativa sintética contra fonte descartada",
    });
    expect(directSourceMutation.status, await directSourceMutation.clone().text()).toBe(404);

    const replay = await f.postDocument({
      action: "SAVE_DRAFT",
      appointmentId: f.appointment,
      documentId: draft.id,
      type: "EXAM_REQUEST",
      title: "Tentativa de reativação",
      content: "Conteúdo que não pode reativar o descarte",
      version: draft.version + 1,
    });
    expect(replay.status, await replay.clone().text()).toBe(409);
    const afterReplay = (
      await f.pool.query(
        "SELECT status,version,content,discarded_reason FROM inventory_encounter_documents WHERE id=$1",
        [draft.id],
      )
    ).rows[0];
    expect(afterReplay).toMatchObject({
      status: "DISCARDED",
      version: draft.version + 1,
      content: "Conteúdo clínico sintético preservado",
      discarded_reason: "Motivo sintético revisado pelo autor",
    });
    const locked = await f.pool.connect();
    try {
      await locked.query("BEGIN");
      await locked.query("SELECT id FROM inventory_care_appointments WHERE id=$1 FOR UPDATE", [
        f.appointment,
      ]);
      expect(await hasClinicalRecords(locked, f.appointment)).toBe(false);
      await locked.query("ROLLBACK");
    } finally {
      locked.release();
    }
  });

  it("rejects stale versions before changing a draft", async () => {
    const f = await fixture();
    const draft = await f.createDocument();
    const stale = await f.postDocument(discardPayload(f, draft, { version: draft.version + 1 }));
    expect(stale.status, await stale.clone().text()).toBe(409);
    expect(
      (
        await f.pool.query("SELECT status,version FROM inventory_encounter_documents WHERE id=$1", [
          draft.id,
        ])
      ).rows[0],
    ).toEqual({ status: "DRAFT", version: draft.version });
  });

  it("keeps FINAL immutable and enforces author and unit authorization", async () => {
    const f = await fixture();
    const final = await f.createDocument("FINAL");
    const before = (
      await f.pool.query(
        "SELECT to_jsonb(d) AS value FROM inventory_encounter_documents d WHERE id=$1",
        [final.id],
      )
    ).rows[0].value;

    const discardFinal = await f.postDocument(discardPayload(f, final));
    expect(discardFinal.status, await discardFinal.clone().text()).toBe(409);
    const editFinal = await f.postDocument({
      action: "SAVE_DRAFT",
      appointmentId: f.appointment,
      documentId: final.id,
      type: "EXAM_REQUEST",
      title: "Tentativa de alteração final",
      content: "Tentativa de alteração final",
      version: final.version,
    });
    expect(editFinal.status, await editFinal.clone().text()).toBe(409);

    const afterFinalAttempt = (
      await f.pool.query(
        "SELECT to_jsonb(d) AS value FROM inventory_encounter_documents d WHERE id=$1",
        [final.id],
      )
    ).rows[0].value;
    expect(afterFinalAttempt).toEqual(before);
    const locked = await f.pool.connect();
    try {
      await locked.query("BEGIN");
      await locked.query("SELECT id FROM inventory_care_appointments WHERE id=$1 FOR UPDATE", [
        f.appointment,
      ]);
      expect(await hasClinicalRecords(locked, f.appointment)).toBe(true);
      expect(await hasFinalClinicalRecords(locked, f.appointment)).toBe(true);
      await locked.query("ROLLBACK");
    } finally {
      locked.release();
    }

    const draft = await f.createDocument();
    const colleagueAttempt = await f.postDocument(discardPayload(f, draft), f.colleague.cookie);
    expect(colleagueAttempt.status, await colleagueAttempt.clone().text()).toBe(403);

    await f.pool.query("DELETE FROM inventory_unit_access WHERE membership_id=$1 AND unit_id=$2", [
      f.owner.membership,
      f.unit,
    ]);
    const unitDenied = await f.postDocument(discardPayload(f, draft));
    expect(unitDenied.status, await unitDenied.clone().text()).toBe(404);
    await f.pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
      f.owner.membership,
      f.unit,
    ]);
  });
});
