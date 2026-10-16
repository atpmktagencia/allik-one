import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { patientsResponse } from "./patients";
import { careAppointmentsResponse } from "./care-appointments";
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
  return { org, unit, otherUnit, user, patient, appointment, membership, token, read };
}

function request(f: Awaited<ReturnType<typeof fixture>>, path: string) {
  return new Request(`${origin}${path}`, {
    headers: { cookie: `allik_inventory_session=${f.token}` },
  });
}
async function events(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await getPool().query(
      "SELECT patient_id,unit_id,appointment_id,actor_user_id,action,resource_ids FROM inventory_clinical_access_events WHERE organization_id=$1",
      [f.org],
    )
  ).rows;
}
describe("Audited patient and schedule lists", () => {
  it("records only the patients disclosed in the authorized unit", async () => {
    const f = await fixture();
    await getPool().query(
      "INSERT INTO inventory_patients(organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,'FOREIGN','Synthetic foreign patient')",
      [f.org, f.otherUnit],
    );
    const response = await patientsResponse(request(f, "/api/v1/inventory/patients"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.patients.map((p: { id: string }) => p.id)).toEqual([
      f.patient,
    ]);
    expect(await events(f)).toEqual([
      {
        patient_id: f.patient,
        unit_id: f.unit,
        appointment_id: null,
        actor_user_id: f.user,
        action: "READ",
        resource_ids: [],
      },
    ]);
    expect(
      (await patientsResponse(request(f, `/api/v1/inventory/patients?unitId=${f.otherUnit}`)))
        .status,
    ).toBe(403);
    expect(await events(f)).toHaveLength(1);
  });
  it("audits appointments and patient search disclosures before responding", async () => {
    const f = await fixture();
    const response = await careAppointmentsResponse(
      request(
        f,
        `/api/v1/inventory/care-appointments?from=2020-01-01&to=2040-01-01&patientSearch=Synthetic`,
      ),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.appointments.map((a: { id: string }) => a.id)).toEqual([f.appointment]);
    expect(data.patients.map((p: { id: string }) => p.id)).toEqual([f.patient]);
    const audit = await events(f);
    expect(audit).toHaveLength(2);
    expect(audit.map((e) => e.appointment_id)).toEqual(
      expect.arrayContaining([null, f.appointment]),
    );
    expect(
      audit.every(
        (e) => e.actor_user_id === f.user && e.patient_id === f.patient && e.unit_id === f.unit,
      ),
    ).toBe(true);
  });
  it("does not return either list if audit persistence fails", async () => {
    const f = await fixture();
    const pool = getPool();
    const original = pool.query.bind(pool);
    const spy = vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
      if (String(args[0]).includes("INSERT INTO inventory_clinical_access_events"))
        return Promise.reject(new Error("Synthetic audit failure"));
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as typeof pool.query);
    try {
      await expect(patientsResponse(request(f, "/api/v1/inventory/patients"))).rejects.toThrow(
        "Synthetic audit failure",
      );
      await expect(
        careAppointmentsResponse(
          request(f, "/api/v1/inventory/care-appointments?from=2020-01-01&to=2040-01-01"),
        ),
      ).rejects.toThrow("Synthetic audit failure");
    } finally {
      spy.mockRestore();
    }
    expect(await events(f)).toHaveLength(0);
  });
  it("returns empty results without manufacturing patient access events", async () => {
    const f = await fixture();
    const response = await patientsResponse(
      request(f, "/api/v1/inventory/patients?search=no-matching-synthetic-patient"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.patients).toEqual([]);
    expect(await events(f)).toHaveLength(0);
  });
});
