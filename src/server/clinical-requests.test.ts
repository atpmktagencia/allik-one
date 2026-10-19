import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken, previewLogin } from "./auth";
import { clinicalRequestsResponse } from "./clinical-requests";
import { encounterDocumentsResponse } from "./encounter-documents";
import { patientTreatmentPlansResponse } from "./patient-treatment-plans";

const origin = "https://clinical-requests.example.test";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Disposable database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await getPool().end();
});

async function fixture() {
  const pool = getPool(),
    org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Synthetic request organization ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Synthetic unit'),($2,$3,'Other unit')",
    [unit, otherUnit, org],
  );
  const actor = async (registered = true) => {
    const id = randomUUID(),
      membership = randomUUID(),
      token = randomUUID();
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region,prescribing_address,prescribing_city,prescribing_state,prescribing_phone) VALUES($1,'Synthetic clinician',$2,$3,$4,$5,'Synthetic street','Fortaleza','CE','00000000000')",
      [
        id,
        `${id}@example.test`,
        registered ? "CRM" : null,
        registered ? parseInt(id.slice(0, 7), 16).toString() : null,
        registered ? "CE" : null,
      ],
    );
    await pool.query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
      [membership, id, org],
    );
    await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
      membership,
      unit,
    ]);
    await pool.query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [id, hashToken(token)],
    );
    return { id, membership, cookie: `allik_inventory_session=${token}` };
  };
  const owner = await actor();
  await pool.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'REQUEST-TEST','Synthetic request patient')",
    [patient, org, unit],
  );
  const addAppointment = async () => {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room,status) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Synthetic room','IN_PROGRESS')",
      [id, org, unit, patient, owner.id],
    );
    return id;
  };
  // Keep the stable fixture ID while using the same real scope as later encounters.
  await pool.query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room,status) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Synthetic room','IN_PROGRESS')",
    [appointment, org, unit, patient, owner.id],
  );
  const request = (
    resource: string,
    data?: unknown,
    cookie = owner.cookie,
    requestOrigin = origin,
  ) =>
    new Request(`${origin}/api/v1/inventory/${resource}`, {
      method: data ? "POST" : "GET",
      headers: { cookie, origin: requestOrigin, "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const read = (appointmentId = appointment, cookie = owner.cookie) =>
    clinicalRequestsResponse(
      request(`clinical-requests?appointmentId=${appointmentId}`, undefined, cookie),
    );
  const post = (data: unknown, cookie = owner.cookie, requestOrigin = origin) =>
    clinicalRequestsResponse(request("clinical-requests", data, cookie, requestOrigin));
  const document = async (
    status: "DRAFT" | "FINAL" = "FINAL",
    appointmentId = appointment,
    type = "EXAM_REQUEST",
  ) => {
    const response = await encounterDocumentsResponse(
      request("encounter-documents", {
        action: status === "FINAL" ? "FINALIZE" : "SAVE_DRAFT",
        creationId: randomUUID(),
        appointmentId,
        type,
        title: "Synthetic laboratory request",
        content: "Synthetic request content for test only",
      }),
    );
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()).data as { id: string; version: number; status: string };
  };
  const command = (
    sourceId: string,
    action: string,
    version: number,
    sourceKind = "DOCUMENT",
    values = {},
  ) => ({
    appointmentId: appointment,
    sourceKind,
    sourceId,
    action,
    version,
    operationId: randomUUID(),
    note: "Synthetic workflow test",
    ...values,
  });
  const plan = (status = "ACTIVE") => ({
    action: "SAVE_PLAN",
    id: randomUUID(),
    operationId: randomUUID(),
    version: null as number | null,
    patientId: patient,
    appointmentId: appointment,
    title: "Synthetic procedure plan",
    status,
    plan: {
      startDate: "2030-01-01",
      previewDays: 30,
      items: [
        {
          id: randomUUID(),
          kind: "PROCEDURE",
          title: "Synthetic procedure",
          productId: null,
          catalogItemId: null,
          appointmentId: appointment,
          administrationUnit: "SESSION",
          stages: [
            {
              doseUnits: "1",
              frequencyPerDay: 1,
              everyDays: 1,
              durationDays: 1,
              weekdays: null,
              times: null,
            },
          ],
          dispense: null,
          package: null,
        },
      ],
    },
  });
  const savePlan = (payload: ReturnType<typeof plan>) =>
    patientTreatmentPlansResponse(request("patient-treatment-plans", payload));
  const rawEvent = (
    sourceId: string,
    status = "ISSUED",
    values: {
      version?: number;
      sourceVersion?: number;
      sourceKind?: string;
      actorId?: string;
      appointmentId?: string;
    } = {},
  ) =>
    pool.query(
      "INSERT INTO inventory_clinical_request_events(organization_id,unit_id,patient_id,appointment_id,source_kind,source_id,source_version,version,status,actor_user_id,operation_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        org,
        unit,
        patient,
        values.appointmentId ?? appointment,
        values.sourceKind ?? "DOCUMENT",
        sourceId,
        values.sourceVersion ?? 0,
        values.version ?? 1,
        status,
        values.actorId ?? owner.id,
        randomUUID(),
        "a".repeat(64),
      ],
    );
  return {
    org,
    unit,
    otherUnit,
    patient,
    appointment,
    owner,
    actor,
    addAppointment,
    request,
    read,
    post,
    document,
    command,
    plan,
    savePlan,
    rawEvent,
  };
}

describe("Clinical request lifecycle and isolation", () => {
  it("tracks issued, returned and reviewed with idempotent operation replay, leaving final document bytes and snapshot untouched", async () => {
    const f = await fixture(),
      doc = await f.document();
    const before = (
      await getPool().query(
        "SELECT to_jsonb(d) value FROM inventory_encounter_documents d WHERE id=$1",
        [doc.id],
      )
    ).rows[0].value;
    const first = f.command(doc.id, "ISSUED", 0);
    expect((await f.post(first)).status).toBe(200);
    expect((await f.post(first)).status).toBe(200);
    expect((await f.post({ ...first, note: "Different retry" })).status).toBe(409);
    expect((await f.post(f.command(doc.id, "REVIEWED", 1))).status).toBe(409);
    expect((await f.post(f.command(doc.id, "RETURNED", 0))).status).toBe(409);
    expect((await f.post(f.command(doc.id, "RETURNED", 1))).status).toBe(200);
    expect((await f.post(f.command(doc.id, "REVIEWED", 2))).status).toBe(200);
    expect((await f.post(f.command(doc.id, "ISSUED", 3))).status).toBe(409);
    const result = (await (await f.read()).json()).data;
    expect(result.requests).toEqual([
      expect.objectContaining({
        sourceId: doc.id,
        status: "REVIEWED",
        version: 3,
        sourceChanged: false,
        allowedActions: [],
      }),
    ]);
    expect(
      (
        await getPool().query(
          "SELECT to_jsonb(d) value FROM inventory_encounter_documents d WHERE id=$1",
          [doc.id],
        )
      ).rows[0].value,
    ).toEqual(before);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_clinical_request_events WHERE source_id=$1",
          [doc.id],
        )
      ).rows[0].n,
    ).toBe(3);
  });
  it("enforces organization, historic and current patient units, exact source appointment and same-origin mutations", async () => {
    const f = await fixture(),
      doc = await f.document(),
      other = await fixture(),
      foreign = await other.document();
    expect((await f.read(other.appointment)).status).toBe(404);
    expect((await f.post(f.command(foreign.id, "ISSUED", 0))).status).toBe(404);
    const anotherAppointment = await f.addAppointment(),
      another = await f.document("FINAL", anotherAppointment);
    expect((await f.post(f.command(another.id, "ISSUED", 0))).status).toBe(404);
    expect(
      (await f.post(f.command(doc.id, "ISSUED", 0), f.owner.cookie, "https://other.example.test"))
        .status,
    ).toBe(403);
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    expect((await f.read()).status).toBe(404);
    expect((await f.post(f.command(doc.id, "ISSUED", 0))).status).toBe(404);
    await expect(f.rawEvent(doc.id)).rejects.toThrow();
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.owner.membership, f.otherUnit],
    );
    expect((await f.read()).status).toBe(200);
    expect((await f.post(f.command(doc.id, "ISSUED", 0))).status).toBe(200);
    await getPool().query(
      "DELETE FROM inventory_unit_access WHERE membership_id=$1 AND unit_id=$2",
      [f.owner.membership, f.unit],
    );
    expect((await f.read()).status).toBe(404);
  });
  it("requires the current responsible registered professional, including at the database event boundary", async () => {
    const f = await fixture(),
      doc = await f.document(),
      colleague = await f.actor();
    const read = await f.read(f.appointment, colleague.cookie);
    expect(read.status).toBe(200);
    expect((await read.json()).data).toMatchObject({
      canManage: false,
      requests: [expect.objectContaining({ allowedActions: [] })],
    });
    expect((await f.post(f.command(doc.id, "ISSUED", 0), colleague.cookie)).status).toBe(403);
    await expect(
      f.rawEvent(doc.id, "ISSUED", { actorId: colleague.id, sourceVersion: doc.version }),
    ).rejects.toThrow();
    const unregistered = await f.actor(false);
    expect((await f.post(f.command(doc.id, "ISSUED", 0), unregistered.cookie)).status).toBe(403);
    await expect(
      f.rawEvent(doc.id, "ISSUED", { actorId: unregistered.id, sourceVersion: doc.version }),
    ).rejects.toThrow();
    await getPool().query(
      "UPDATE inventory_users SET professional_council=NULL,council_number=NULL,council_region=NULL WHERE id=$1",
      [f.owner.id],
    );
    expect((await f.post(f.command(doc.id, "ISSUED", 0))).status).toBe(403);
    await expect(f.rawEvent(doc.id, "ISSUED", { sourceVersion: doc.version })).rejects.toThrow();
  });
  it("denies anonymous, shared Preview and non-clinical identities rather than trusting the interface", async () => {
    const f = await fixture(),
      doc = await f.document();
    expect((await f.post(f.command(doc.id, "ISSUED", 0), "")).status).toBe(401);
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    vi.stubEnv("INVENTORY_PREVIEW_PASSWORD", "synthetic-request-password");
    vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-request-secret".repeat(3));
    const login = await previewLogin(
      new Request(`${origin}/api/inventory-session`, {
        method: "POST",
        headers: { origin },
        body: JSON.stringify({ password: "synthetic-request-password" }),
      }),
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect((await f.post(f.command(doc.id, "ISSUED", 0), cookie)).status).toBe(403);
    await getPool().query("UPDATE inventory_memberships SET role='UNIT_MANAGER' WHERE id=$1", [
      f.owner.membership,
    ]);
    expect((await f.post(f.command(doc.id, "ISSUED", 0))).status).toBe(403);
  });
  it("requires an active encounter-bound plan and re-issuance after a source version changes", async () => {
    const f = await fixture(),
      draft = f.plan("DRAFT");
    const standalone = { ...f.plan(), appointmentId: null };
    const standaloneResponse = await patientTreatmentPlansResponse(
      f.request("patient-treatment-plans", standalone),
    );
    expect(standaloneResponse.status, await standaloneResponse.clone().text()).toBe(201);
    expect((await f.post(f.command(standalone.id, "ISSUED", 0, "PLAN"))).status).toBe(404);
    await expect(
      f.rawEvent(standalone.id, "ISSUED", { sourceKind: "PLAN", sourceVersion: 1 }),
    ).rejects.toThrow();
    const created = await f.savePlan(draft);
    expect(created.status, await created.clone().text()).toBe(201);
    expect((await f.post(f.command(draft.id, "ISSUED", 0, "PLAN"))).status).toBe(409);
    const active = { ...draft, operationId: randomUUID(), version: 1, status: "ACTIVE" };
    expect((await f.savePlan(active)).status).toBe(200);
    expect((await f.post(f.command(draft.id, "ISSUED", 0, "PLAN"))).status).toBe(200);
    const updated = {
      ...active,
      operationId: randomUUID(),
      version: 2,
      title: "Revised synthetic procedure plan",
    };
    expect((await f.savePlan(updated)).status).toBe(200);
    let requests = (await (await f.read()).json()).data.requests;
    expect(requests).toEqual([
      expect.objectContaining({
        sourceId: draft.id,
        sourceChanged: true,
        sourceVersion: 3,
        version: 1,
        allowedActions: ["ISSUED"],
      }),
    ]);
    expect((await f.post(f.command(draft.id, "RETURNED", 1, "PLAN"))).status).toBe(409);
    const snapshot = (
      await getPool().query(
        "SELECT to_jsonb(p) value FROM inventory_clinical_plans p WHERE id=$1",
        [draft.id],
      )
    ).rows[0].value;
    expect((await f.post(f.command(draft.id, "ISSUED", 1, "PLAN"))).status).toBe(200);
    expect((await f.post(f.command(draft.id, "RETURNED", 2, "PLAN"))).status).toBe(200);
    requests = (await (await f.read()).json()).data.requests;
    expect(requests[0]).toMatchObject({ sourceChanged: false, status: "RETURNED", version: 3 });
    expect(
      (
        await getPool().query(
          "SELECT to_jsonb(p) value FROM inventory_clinical_plans p WHERE id=$1",
          [draft.id],
        )
      ).rows[0].value,
    ).toEqual(snapshot);
  });
  it("enforces polymorphic source scope, status, version, transition and immutable events in PostgreSQL", async () => {
    const f = await fixture(),
      doc = await f.document(),
      draft = await f.document("DRAFT");
    await expect(f.rawEvent(doc.id, "RETURNED", { sourceVersion: doc.version })).rejects.toThrow();
    await expect(
      f.rawEvent(draft.id, "ISSUED", { sourceVersion: draft.version }),
    ).rejects.toThrow();
    await expect(
      f.rawEvent(doc.id, "ISSUED", { sourceVersion: doc.version + 1 }),
    ).rejects.toThrow();
    await expect(
      f.rawEvent(doc.id, "ISSUED", { sourceKind: "PLAN", sourceVersion: doc.version }),
    ).rejects.toThrow();
    await expect(
      f.rawEvent(doc.id, "ISSUED", {
        appointmentId: await f.addAppointment(),
        sourceVersion: doc.version,
      }),
    ).rejects.toThrow();
    expect((await f.post(f.command(doc.id, "ISSUED", 0))).status).toBe(200);
    await expect(
      f.rawEvent(doc.id, "REVIEWED", { version: 2, sourceVersion: doc.version }),
    ).rejects.toThrow();
    await expect(
      getPool().query(
        "UPDATE inventory_clinical_request_events SET note='Changed history' WHERE source_id=$1",
        [doc.id],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_clinical_request_events WHERE source_id=$1", [doc.id]),
    ).rejects.toThrow();
    await expect(getPool().query("TRUNCATE inventory_clinical_request_events")).rejects.toThrow();
  });
  it("can follow returned documents after operational completion without reopening or modifying the finalized source", async () => {
    const f = await fixture(),
      doc = await f.document();
    const before = (
      await getPool().query(
        "SELECT to_jsonb(d) value FROM inventory_encounter_documents d WHERE id=$1",
        [doc.id],
      )
    ).rows[0].value;
    expect((await f.post(f.command(doc.id, "ISSUED", 0))).status).toBe(200);
    // Exercise the lifecycle boundary independently of the separate clinical closure workflow.
    await getPool().query("UPDATE inventory_care_appointments SET status='COMPLETED' WHERE id=$1", [
      f.appointment,
    ]);
    expect((await f.post(f.command(doc.id, "RETURNED", 1))).status).toBe(200);
    expect((await f.post(f.command(doc.id, "REVIEWED", 2))).status).toBe(200);
    expect(
      (
        await getPool().query(
          "SELECT to_jsonb(d) value FROM inventory_encounter_documents d WHERE id=$1",
          [doc.id],
        )
      ).rows[0].value,
    ).toEqual(before);
    await expect(
      getPool().query("UPDATE inventory_encounter_documents SET content='Late edit' WHERE id=$1", [
        doc.id,
      ]),
    ).rejects.toThrow();
  });
  it("refuses issuing a superseded final document and directs the workflow to its final rectification", async () => {
    const f = await fixture(),
      doc = await f.document();
    const amendment = await encounterDocumentsResponse(
      f.request("encounter-documents", {
        action: "CREATE_AMENDMENT",
        appointmentId: f.appointment,
        type: "EXAM_REQUEST",
        content: "",
        documentId: doc.id,
        version: doc.version,
        amendmentKind: "RECTIFICATION",
        amendmentReason: "Synthetic request correction",
        title: "Corrected synthetic request",
      }),
    );
    expect(amendment.status, await amendment.clone().text()).toBe(201);
    const child = (await amendment.json()).data;
    const finalized = await encounterDocumentsResponse(
      f.request("encounter-documents", {
        action: "FINALIZE",
        appointmentId: f.appointment,
        type: "EXAM_REQUEST",
        documentId: child.id,
        version: child.version,
        title: "Corrected synthetic request",
        content: "Corrected synthetic request content",
      }),
    );
    expect(finalized.status, await finalized.clone().text()).toBe(200);
    expect((await f.post(f.command(doc.id, "ISSUED", 0))).status).toBe(409);
    expect((await f.post(f.command(child.id, "ISSUED", 0))).status).toBe(200);
    const requests = (await (await f.read()).json()).data.requests;
    expect(
      requests.find((r: { sourceId: string }) => r.sourceId === doc.id).allowedActions,
    ).toEqual([]);
    await expect(f.rawEvent(doc.id, "ISSUED", { sourceVersion: doc.version })).rejects.toThrow();
  });
});
