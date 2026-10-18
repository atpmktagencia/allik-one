import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { patientTreatmentPlansResponse } from "./patient-treatment-plans";
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
describe("General clinical plan aggregate", () => {
  it("persists clinical intent and deterministic schedule preview without creating execution, quote or stock records", async () => {
    const f = await fixture(),
      d = f.draft();
    const before = (
      await getPool().query(
        "SELECT (SELECT count(*) FROM inventory_movements)::text movements,(SELECT count(*) FROM inventory_encounter_quotes)::text quotes,(SELECT count(*) FROM inventory_patient_treatment_schedule)::text schedules,(SELECT count(*) FROM inventory_patient_treatments)::text treatments",
      )
    ).rows;
    expect((await f.post(d)).status).toBe(201);
    const detail = await f.read("owner", d.id);
    expect(detail.status).toBe(200);
    const data = (await detail.json()).data;
    expect(data.plan).toMatchObject(d.plan);
    expect(data.preview.items[0].administrationQuantity).toBe("7");
    expect(data.canEdit).toBe(true);
    const after = (
      await getPool().query(
        "SELECT (SELECT count(*) FROM inventory_movements)::text movements,(SELECT count(*) FROM inventory_encounter_quotes)::text quotes,(SELECT count(*) FROM inventory_patient_treatment_schedule)::text schedules,(SELECT count(*) FROM inventory_patient_treatments)::text treatments",
      )
    ).rows;
    expect(after).toEqual(before);
    expect((await (await f.read("colleague")).json()).data.plans[0]).toMatchObject({
      id: d.id,
      canEdit: false,
    });
    expect(
      (await f.post({ ...d, operationId: randomUUID(), version: 1 }, "colleague")).status,
    ).toBe(403);
    expect((await f.post({ ...d, operationId: randomUUID(), version: 1 }, "reviewer")).status).toBe(
      403,
    );
  });
  it("makes operation replay idempotent and rejects changed payloads or concurrent stale edits", async () => {
    const f = await fixture(),
      d = f.draft();
    expect((await f.post(d)).status).toBe(201);
    expect((await f.post(d)).status).toBe(200);
    expect((await f.post({ ...d, title: "Changed retry" })).status).toBe(409);
    const versions = await getPool().query(
      "SELECT count(*)::int n FROM inventory_clinical_plan_versions WHERE plan_id=$1",
      [d.id],
    );
    expect(versions.rows[0].n).toBe(1);
    const results = await Promise.all([
      f.post({ ...d, operationId: randomUUID(), version: 1, title: "Revision one" }),
      f.post({ ...d, operationId: randomUUID(), version: 1, title: "Revision two" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("soft removes items while preserving immutable aggregate snapshots and terminal archive", async () => {
    const f = await fixture(),
      d = f.draft(),
      second = { ...f.plan().items[0]!, title: "Second clinical action" };
    d.plan.items.push(second);
    expect((await f.post(d)).status).toBe(201);
    const update = {
      ...d,
      operationId: randomUUID(),
      version: 1,
      plan: { ...d.plan, items: [d.plan.items[0]!] },
    };
    expect((await f.post(update)).status).toBe(200);
    const headItems = await getPool().query(
      "SELECT active FROM inventory_clinical_plan_items WHERE id=$1",
      [second.id],
    );
    expect(headItems.rows).toEqual([{ active: false }]);
    const original = await getPool().query(
      "SELECT snapshot->'plan'->'items' items FROM inventory_clinical_plan_versions WHERE plan_id=$1 AND version=1",
      [d.id],
    );
    expect(original.rows[0].items).toHaveLength(2);
    const transaction = await getPool().connect();
    try {
      await transaction.query("BEGIN");
      await transaction.query("UPDATE inventory_clinical_plans SET version=version+1 WHERE id=$1", [
        d.id,
      ]);
      const forged = (
        await transaction.query(
          `SELECT jsonb_build_object('head',to_jsonb(p),'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY position,id) FROM inventory_clinical_plan_items i WHERE i.plan_id=p.id AND i.active),'plan',jsonb_build_object('startDate','2099-01-01','previewDays',p.preview_days,'items',(SELECT jsonb_agg(i.definition ORDER BY position,id) FROM inventory_clinical_plan_items i WHERE i.plan_id=p.id AND i.active)),'preview','{}'::jsonb) snapshot FROM inventory_clinical_plans p WHERE p.id=$1`,
          [d.id],
        )
      ).rows[0].snapshot;
      await expect(
        transaction.query(
          "INSERT INTO inventory_clinical_plan_versions(plan_id,organization_id,unit_id,version,snapshot) VALUES($1,$2,$3,3,$4)",
          [d.id, f.org, f.unit, JSON.stringify(forged)],
        ),
      ).rejects.toThrow("Invalid clinical plan revision snapshot");
    } finally {
      await transaction.query("ROLLBACK");
      transaction.release();
    }
    await expect(
      getPool().query("UPDATE inventory_clinical_plan_items SET active=false WHERE plan_id=$1", [
        d.id,
      ]),
    ).rejects.toThrow();
    for (const table of ["inventory_clinical_plan_versions", "inventory_clinical_plan_events"]) {
      await expect(
        getPool().query(`DELETE FROM ${table} WHERE plan_id=$1`, [d.id]),
      ).rejects.toThrow();
      await expect(
        getPool().query(
          `UPDATE ${table} SET ${table.endsWith("versions") ? "snapshot" : "after_data"}='{}' WHERE plan_id=$1`,
          [d.id],
        ),
      ).rejects.toThrow();
      await expect(getPool().query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow();
    }
    expect(
      (await f.post({ ...update, operationId: randomUUID(), version: 2, status: "ARCHIVED" }))
        .status,
    ).toBe(200);
    expect((await f.post({ ...update, operationId: randomUUID(), version: 3 })).status).toBe(409);
  });
  it("isolates organizations, current patient unit and original plan unit after transfer", async () => {
    const f = await fixture(),
      foreign = await fixture(),
      d = f.draft();
    expect((await f.post(d)).status).toBe(201);
    expect((await foreign.read("owner", d.id, d.patientId)).status).toBe(404);
    expect((await foreign.post(d)).status).toBe(404);
    const scopedRequest = (unitId: string) =>
      patientTreatmentPlansResponse(
        new Request(
          `${origin}/api/v1/inventory/patient-treatment-plans?patientId=${d.patientId}&unitId=${unitId}`,
          { headers: { cookie: f.users["owner"]!.cookie } },
        ),
      );
    expect((await scopedRequest(f.unit)).status).toBe(200);
    expect((await scopedRequest(foreign.unit)).status).toBe(403);
    expect((await f.read("outside", d.id)).status).toBe(404);
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      d.patientId,
      f.otherUnit,
    ]);
    expect((await f.read("owner", d.id)).status).toBe(404);
    expect((await f.post({ ...d, operationId: randomUUID(), version: 1 })).status).toBe(404);
    expect((await f.read("outside", d.id)).status).toBe(404);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.users["owner"]!.membership, f.otherUnit],
    );
    expect((await f.read("owner", d.id)).status).toBe(200);
    expect((await f.post({ ...d, operationId: randomUUID(), version: 1 })).status).toBe(200);
  });
  it("rejects cross-patient and cross-tenant references plus reuse of stable item IDs across plans", async () => {
    const f = await fixture(),
      foreign = await fixture(),
      d = f.draft();
    d.plan.items[0] = {
      ...d.plan.items[0]!,
      appointmentId: f.users["colleague"]!.appointment,
    } as (typeof d.plan.items)[number];
    expect((await f.post(d)).status).toBe(404);
    d.plan.items[0] = {
      ...d.plan.items[0]!,
      appointmentId: foreign.users["owner"]!.appointment,
    } as (typeof d.plan.items)[number];
    expect((await f.post(d)).status).toBe(404);
    delete (d.plan.items[0] as Record<string, unknown>)["appointmentId"];
    expect((await f.post(d)).status).toBe(201);
    expect((await f.post({ ...d, id: randomUUID(), operationId: randomUUID() })).status).toBe(409);
    const other = f.draft();
    other.plan.items[0]!.productId = randomUUID() as never;
    expect((await f.post(other)).status).toBe(404);
  });
  it("audits clinical disclosure before returning data and fails closed on audit outage", async () => {
    const f = await fixture(),
      d = f.draft();
    expect((await f.post(d)).status).toBe(201);
    const before = await getPool().query(
      "SELECT count(*)::int n FROM inventory_clinical_access_events WHERE patient_id=$1",
      [d.patientId],
    );
    expect((await f.read("owner", d.id)).status).toBe(200);
    const after = await getPool().query(
      "SELECT count(*)::int n FROM inventory_clinical_access_events WHERE patient_id=$1",
      [d.patientId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
    const failure = vi
      .spyOn(accessAudit, "recordClinicalAccess")
      .mockRejectedValueOnce(new Error("Synthetic audit outage"));
    try {
      expect((await f.read("owner", d.id)).status).toBe(503);
    } finally {
      failure.mockRestore();
    }
  });
  it("rejects shared access and unauthorized roles, invalid registration or recipe scope", async () => {
    const f = await fixture(),
      d = f.draft();
    await getPool().query("UPDATE inventory_memberships SET role='FINANCE' WHERE id=$1", [
      f.users["owner"]!.membership,
    ]);
    expect((await f.read()).status).toBe(403);
    expect((await f.post(d)).status).toBe(403);
    await getPool().query("UPDATE inventory_memberships SET role='CLINICIAN' WHERE id=$1", [
      f.users["owner"]!.membership,
    ]);
    await getPool().query("UPDATE inventory_users SET professional_council='COREN' WHERE id=$1", [
      f.users["owner"]!.id,
    ]);
    d.plan.items[0]!.kind = "PRESCRIPTION";
    expect((await f.post(d)).status).toBe(403);
    d.plan.items[0]!.kind = "SERVICE";
    expect((await f.post(d)).status).toBe(201);
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    try {
      expect(
        (
          await patientTreatmentPlansResponse(
            new Request(
              `${origin}/api/v1/inventory/patient-treatment-plans?patientId=${d.patientId}`,
            ),
          )
        ).status,
      ).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
