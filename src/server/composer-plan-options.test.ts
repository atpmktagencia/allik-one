import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { patientTreatmentPlansResponse } from "./patient-treatment-plans";
import { prescriptionComposerResponse } from "./prescription-composer";
import { encounterDocumentsResponse } from "./encounter-documents";
import { composerPlanOptionsResponse } from "./composer-plan-options";
import * as accessAudit from "./clinical-access-audit";
const origin = "https://shared-models.example.test";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
async function fixture() {
  const pool = getPool(),
    org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Shared models ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Unit one'),($2,$3,'Unit two')",
    [unit, otherUnit, org],
  );
  const users: Record<
    string,
    { id: string; membership: string; patient: string; appointment: string; cookie: string }
  > = {};
  for (const [key, role, scope] of [
    ["owner", "CLINICIAN", unit],
    ["colleague", "CLINICIAN", unit],
    ["reviewer", "SUPER_ADMIN", unit],
    ["partner", "PARTNER_ADMIN", unit],
    ["outside", "CLINICIAN", otherUnit],
  ]) {
    const id = randomUUID(),
      membership = randomUUID(),
      patient = randomUUID(),
      appointment = randomUUID(),
      token = randomUUID();
    users[key!] = {
      id,
      membership,
      patient,
      appointment,
      cookie: `allik_inventory_session=${token}`,
    };
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic model clinician',$2,'CRM',$3,'CE')",
      [id, `${id}@example.test`, String(BigInt("0x" + id.replaceAll("-", "").slice(0, 12)))],
    );
    await pool.query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
      [membership, id, org, role],
    );
    await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
      membership,
      scope,
    ]);
    await pool.query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [id, hashToken(token)],
    );
    await pool.query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,$4,'Synthetic model patient')",
      [patient, org, scope, randomUUID()],
    );
    await pool.query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour',$6)",
      [appointment, org, scope, patient, id, `Shared room ${appointment}`],
    );
  }
  const plan = () => ({
    startDate: "2030-01-01",
    previewDays: 30,
    items: [
      {
        id: randomUUID(),
        kind: "SERVICE",
        title: "Synthetic clinical service",
        productId: null,
        catalogItemId: null,
        administrationUnit: "SESSION",
        stages: [
          {
            doseUnits: "1",
            frequencyPerDay: 1,
            everyDays: 1,
            durationDays: 7,
            weekdays: null,
            times: null,
          },
        ],
        dispense: null,
        package: null,
      },
    ],
  });
  const draft = () => ({
    action: "SAVE_PLAN",
    id: randomUUID(),
    operationId: randomUUID(),
    version: null,
    patientId: users["owner"]!.patient,
    title: "Synthetic general plan",
    status: "DRAFT",
    plan: plan(),
  });
  const read = (role = "owner", planId?: string, patientId = users["owner"]!.patient) =>
    patientTreatmentPlansResponse(
      new Request(
        `${origin}/api/v1/inventory/patient-treatment-plans?patientId=${patientId}${planId ? `&planId=${planId}` : ""}`,
        { headers: { cookie: users[role]!.cookie } },
      ),
    );
  const post = (body: unknown, role = "owner") =>
    patientTreatmentPlansResponse(
      new Request(`${origin}/api/v1/inventory/patient-treatment-plans`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", cookie: users[role]!.cookie },
        body: JSON.stringify(body),
      }),
    );
  return { org, unit, otherUnit, users, plan, draft, read, post };
}
async function contextFixture() {
  const f = await fixture(),
    owner = f.users["owner"]!,
    documentId = randomUUID(),
    draft = f.draft();
  expect((await f.post(draft)).status).toBe(201);
  await getPool().query(
    `INSERT INTO inventory_encounter_documents(id,organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status) SELECT $1,$2,$3,$4,$5,u.id,u.name,u.professional_council,u.council_number,u.council_region,'PRESCRIPTION','Synthetic draft','Original draft remains unchanged','DRAFT' FROM inventory_users u WHERE u.id=$6`,
    [documentId, f.org, f.unit, owner.appointment, owner.patient, owner.id],
  );
  const bridge = (
    role = "owner",
    appointmentId = owner.appointment,
    doc = documentId,
    extra = "",
  ) =>
    composerPlanOptionsResponse(
      new Request(
        `${origin}/api/v1/inventory/composer-plan-options?appointmentId=${appointmentId}&documentId=${doc}${extra}`,
        { headers: { cookie: f.users[role]!.cookie } },
      ),
    );
  return { ...f, documentId, draft, bridge };
}
describe("Composer explicit saved-plan bridge", () => {
  it("marks only an explicitly persisted prescription instance reference as linked", async () => {
    const f = await contextFixture(),
      id = randomUUID(),
      owner = f.users["owner"]!;
    const response = await prescriptionComposerResponse(
      new Request(`${origin}/api/v1/inventory/prescription-composer`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          action: "INSTANTIATE",
          id,
          documentId: f.documentId,
          appointmentId: owner.appointment,
          formula: {
            ingredients: [
              {
                medicationName: "Synthetic ingredient",
                dose: "1",
                doseUnit: "mg",
                individualCapsule: false,
              },
            ],
            route: "Oral",
            presentation: "Cápsula",
            instructions: "Synthetic instructions",
            phases: [{ doseUnits: 1, frequencyPerDay: 1, durationDays: 7, maintenance: false }],
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const edited = {
      ...f.draft,
      operationId: randomUUID(),
      version: 1,
      plan: {
        ...f.draft.plan,
        items: f.draft.plan.items.map((item) => ({ ...item, prescriptionInstanceId: id })),
      },
    };
    expect((await f.post(edited)).status).toBe(200);
    expect((await (await f.bridge()).json()).data.plans[0].linkedToDocument).toBe(true);
    const untouched = await getPool().query(
      "SELECT content,status FROM inventory_encounter_documents WHERE id=$1",
      [f.documentId],
    );
    expect(untouched.rows[0]).toMatchObject({
      content: "Original draft remains unchanged",
      status: "DRAFT",
    });
  });
  it("rejects documents in another organization and a finalized prescription", async () => {
    const f = await contextFixture(),
      foreign = await contextFixture();
    expect((await f.bridge("owner", undefined, foreign.documentId)).status).toBe(404);
    await getPool().query(
      "UPDATE inventory_users SET prescribing_address='Synthetic street 123',prescribing_city='Fortaleza',prescribing_state='CE',prescribing_phone='85999999999' WHERE id=$1",
      [f.users["owner"]!.id],
    );
    const finalized = await encounterDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/encounter-documents`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", cookie: f.users["owner"]!.cookie },
        body: JSON.stringify({
          action: "FINALIZE",
          appointmentId: f.users["owner"]!.appointment,
          documentId: f.documentId,
          type: "PRESCRIPTION",
          title: "Synthetic final prescription",
          content: "Synthetic instructions",
          version: 0,
        }),
      }),
    );
    expect(finalized.status).toBe(200);
    expect((await f.bridge()).status).toBe(404);
  });
  it("returns bounded metadata only and does not infer a document association", async () => {
    const f = await contextFixture(),
      response = await f.bridge();
    expect(response.status).toBe(200);
    const text = await response.text(),
      data = JSON.parse(text).data;
    expect(data.plans).toEqual([
      expect.objectContaining({
        id: f.draft.id,
        version: 1,
        linkedToDocument: false,
        canEstimate: true,
      }),
    ]);
    expect(text).not.toContain("Synthetic clinical service");
    expect(text).not.toContain("doseUnits");
    expect(text).not.toContain("Original draft remains unchanged");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("rejects another author, mismatched appointment, unauthorized context and transferred patient", async () => {
    const f = await contextFixture();
    expect((await f.bridge("colleague")).status).toBe(404);
    expect((await f.bridge("owner", f.users["colleague"]!.appointment)).status).toBe(404);
    expect((await f.bridge("owner", undefined, undefined, `&unitId=${f.otherUnit}`)).status).toBe(
      403,
    );
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$1 WHERE id=$2", [
      f.otherUnit,
      f.users["owner"]!.patient,
    ]);
    expect((await f.bridge()).status).toBe(404);
  });
  it("fails closed when clinical access auditing fails", async () => {
    const f = await contextFixture(),
      spy = vi
        .spyOn(accessAudit, "recordClinicalAccess")
        .mockRejectedValueOnce(new Error("Synthetic audit outage"));
    try {
      expect((await f.bridge()).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });
  it("requires a prescription draft and a recognized assigned physician", async () => {
    const f = await contextFixture();
    await getPool().query("UPDATE inventory_users SET professional_council='CRO' WHERE id=$1", [
      f.users["owner"]!.id,
    ]);
    expect((await f.bridge()).status).toBe(403);
    expect((await f.bridge("owner", undefined, randomUUID())).status).toBe(404);
  });
});
