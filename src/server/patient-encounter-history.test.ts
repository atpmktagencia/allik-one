import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { patientDetailResponse } from "./patient-treatments";
const origin = "https://allergy-test.example";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Disposable test database required");
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
    otherUnit = randomUUID(),
    user = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID(),
    membership = randomUUID(),
    token = randomUUID();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    "Allergy test " + org,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Fortaleza'),($2,$3,'Juazeiro')",
    [unit, otherUnit, org],
  );
  await pool.query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic clinician',$2,'CRM','123','CE')",
    [user, user + "@example.test"],
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
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'ALLERGY-TEST','Synthetic patient')",
    [patient, org, unit],
  );
  await pool.query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Test room')",
    [appointment, org, unit, patient, user],
  );
  const read = () =>
    patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patient}`, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  return { org, unit, otherUnit, user, patient, appointment, membership, read };
}
async function note(f: Awaited<ReturnType<typeof fixture>>, status: string) {
  await getPool().query(
    `INSERT INTO inventory_clinical_notes(organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,evolution,conduct,status,finalized_at)
    VALUES($1,$2,$3,$4,$5,'Synthetic clinician','CRM','123','CE','Synthetic evolution content','Synthetic conduct',$6,CASE WHEN $6='FINAL' THEN now() END)`,
    [f.org, f.unit, f.patient, f.appointment, f.user, status],
  );
}
describe("Patient consultation summaries", () => {
  it("shows finalized prescriptions and documents even without a final evolution", async () => {
    const f = await fixture();
    const rx = randomUUID(),
      document = randomUUID();
    await getPool().query(
      `INSERT INTO inventory_encounter_prescriptions(id,organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,items,status,finalized_at)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic clinician','CRM','123','CE',$7,'FINAL',now())`,
      [
        rx,
        f.org,
        f.unit,
        f.patient,
        f.appointment,
        f.user,
        JSON.stringify([
          {
            id: randomUUID(),
            medicationName: "Synthetic medication",
            doseQuantity: 1,
            doseUnit: "mg",
            route: "IM",
          },
        ]),
      ],
    );
    await getPool().query(
      `INSERT INTO inventory_encounter_documents(id,organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status,finalized_at)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic clinician','CRM','123','CE','EXAM_REQUEST','SOLICITAÇÃO DE EXAMES','Synthetic examination request','FINAL',now())`,
      [document, f.org, f.unit, f.patient, f.appointment, f.user],
    );
    const response = await f.read();
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.clinicalHistory).toEqual([]);
    expect(data.encounterHistory).toHaveLength(1);
    expect(data.encounterHistory[0]).toMatchObject({
      id: f.appointment,
      note: null,
      prescription: { id: rx },
      documents: [{ id: document }],
    });
    const audit = await getPool().query(
      "SELECT actor_user_id,resource_ids FROM inventory_clinical_access_events WHERE patient_id=$1",
      [f.patient],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        actor_user_id: f.user,
        resource_ids: expect.arrayContaining([f.appointment, rx, document]),
      }),
    ]);
  });
  it("includes final evolution and conduct, but never discloses draft text", async () => {
    const f = await fixture();
    await note(f, "DRAFT");
    let data = (await (await f.read()).json()).data;
    expect(data.encounterHistory[0]).toMatchObject({ note: null, hasOwnDraft: true });
    expect(JSON.stringify(data)).not.toContain("Synthetic evolution content");
    await getPool().query(`UPDATE inventory_unit_access SET unit_id=$2 WHERE membership_id=$1`, [
      f.membership,
      f.otherUnit,
    ]);
    expect((await f.read()).status).toBe(404);
    const g = await fixture();
    await note(g, "FINAL");
    data = (await (await g.read()).json()).data;
    expect(data.encounterHistory[0].note).toMatchObject({
      evolution: "Synthetic evolution content",
      conduct: "Synthetic conduct",
    });
  });
  it("filters other units and does not expose another author's draft status", async () => {
    const f = await fixture();
    await note(f, "DRAFT");
    const second = randomUUID(),
      token = randomUUID(),
      member = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_users(id,name,email) VALUES($1,'Other clinician',$2)",
      [second, second + "@example.test"],
    );
    await getPool().query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
      [member, second, f.org],
    );
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [member, f.unit],
    );
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [second, hashToken(token)],
    );
    await getPool().query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($5,$1,$2,$3,$4,'CONSULTATION',now()+interval '1 day',now()+interval '25 hours','Foreign room')",
      [f.org, f.otherUnit, f.patient, f.user, randomUUID()],
    );
    const response = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${f.patient}`, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.encounterHistory).toHaveLength(1);
    expect(data.encounterHistory[0]).toMatchObject({
      id: f.appointment,
      note: null,
      hasOwnDraft: false,
    });
    expect(JSON.stringify(data)).not.toContain("Synthetic evolution content");
  });
});
