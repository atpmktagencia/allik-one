import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { clinicalAlertsResponse } from "./clinical-alerts";
import { careEncounterResponse } from "./care-encounter";
import { encounterDocumentsResponse } from "./encounter-documents";
import { patientDetailResponse } from "./patient-treatments";
import { patientTimelineResponse } from "./patient-timeline";
import { encounterQuotesResponse } from "./encounter-quotes";
import { clinicalProblemsResponse } from "./clinical-problems";
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
  const cookie = `allik_inventory_session=${token}`;
  const request = (path: string, body?: unknown) =>
    new Request(origin + path, {
      method: body ? "POST" : "GET",
      headers: { origin, cookie, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const post = (body: Record<string, unknown>) =>
    clinicalAlertsResponse(
      request("/api/v1/inventory/clinical-alerts", { patientId: patient, ...body }),
    );
  const assess = (status: string, version: number) =>
    post({
      action: "ASSESS_ALLERGIES",
      status,
      version,
      reason: "Conferência profissional sintética registrada.",
    });
  const alert = (extra: Record<string, unknown> = {}) =>
    post({
      action: "CREATE",
      id: randomUUID(),
      type: "ALLERGY",
      title: "Dipirona",
      reaction: null,
      severity: "UNKNOWN",
      status: "ACTIVE",
      notes: "",
      reason: "Registro profissional sintético para validação.",
      version: 0,
      ...extra,
    });
  const summaries = async () => {
    const [a, b, c, d] = await Promise.all([
      careEncounterResponse(
        request(`/api/v1/inventory/care-encounter?appointmentId=${appointment}`),
      ),
      encounterDocumentsResponse(
        request(`/api/v1/inventory/encounter-documents?appointmentId=${appointment}`),
      ),
      patientDetailResponse(request(`/api/v1/inventory/patient-detail?patientId=${patient}`)),
      patientTimelineResponse(request(`/api/v1/inventory/patient-timeline?patientId=${patient}`)),
    ]);
    for (const response of [a, b, c, d]) expect(response.status).toBe(200);
    return [
      (await a.json()).data.allergySummary,
      (await b.json()).data.context.allergySummary,
      (await c.json()).data.allergySummary,
      (await d.json()).data.allergySummary,
    ];
  };
  return {
    cookie,
    org,
    unit,
    otherUnit,
    user,
    patient,
    appointment,
    membership,
    assess,
    alert,
    post,
    summaries,
  };
}
describe("allergy assessment and consistency", () => {
  it("distinguishes unknown from an audited denial consistently across clinical screens", async () => {
    const f = await fixture();
    for (const summary of await f.summaries()) expect(summary.status).toBe("UNKNOWN");
    expect((await f.assess("DENIED", 0)).status).toBe(200);
    for (const summary of await f.summaries()) {
      expect(summary.status).toBe("DENIED");
      expect(summary.allergies).toEqual([]);
      expect(summary.reviewedBy).toBe("Synthetic clinician");
      expect(summary.reviewedAt).toBeTruthy();
    }
    const audit = (
      await getPool().query(
        "SELECT actor_user_id,after_data FROM inventory_patient_changes WHERE patient_id=$1",
        [f.patient],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(f.user);
    expect(audit[0].after_data.allergy_status).toBe("DENIED");
    expect((await f.assess("REPORTED", 0)).status).toBe(409);
  });
  it("withdraws a denial atomically when a new allergy is reported, and never restores it automatically", async () => {
    const f = await fixture();
    await f.assess("DENIED", 0);
    const response = await f.alert({ reason: "R".repeat(500) });
    expect(response.status).toBe(201);
    const alert = (await response.json()).data;
    for (const summary of await f.summaries()) {
      expect(summary.status).toBe("REPORTED");
      expect(summary.allergies).toEqual(["Dipirona"]);
    }
    expect((await f.assess("DENIED", 2)).status).toBe(409);
    expect(
      (
        await f.alert({
          action: "UPDATE",
          id: alert.id,
          status: "INACTIVE",
          version: alert.version,
        })
      ).status,
    ).toBe(200);
    for (const summary of await f.summaries()) expect(summary.status).toBe("UNKNOWN");
    expect((await f.assess("DENIED", 2)).status).toBe(200);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int AS count FROM inventory_patient_changes WHERE patient_id=$1",
          [f.patient],
        )
      ).rows[0].count,
    ).toBe(3);
  });
  it("invalidates a prior denial when intake allergies change and prevents direct contradictory writes", async () => {
    const f = await fixture();
    await f.assess("DENIED", 0);
    await getPool().query("UPDATE inventory_patients SET private_data=$2 WHERE id=$1", [
      f.patient,
      { allergies: ["Penicilina"] },
    ]);
    const saved = (
      await getPool().query(
        "SELECT allergy_status,allergy_reviewed_at FROM inventory_patients WHERE id=$1",
        [f.patient],
      )
    ).rows[0];
    expect(saved.allergy_status).toBe("UNKNOWN");
    expect(saved.allergy_reviewed_at).toBeNull();
    for (const summary of await f.summaries()) {
      expect(summary.status).toBe("REPORTED");
      expect(summary.allergies).toEqual(["Penicilina"]);
    }
    expect((await f.assess("DENIED", 1)).status).toBe(409);
  });
  it("rejects foreign-unit and unauthorized assessment requests without changing the patient", async () => {
    const f = await fixture(),
      other = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'OTHER-UNIT','Other unit patient')",
      [other, f.org, f.otherUnit],
    );
    expect(
      (
        await f.post({
          action: "ASSESS_ALLERGIES",
          patientId: other,
          status: "DENIED",
          version: 0,
          reason: "Conferência indevida de outra unidade.",
        })
      ).status,
    ).toBe(404);
    await getPool().query("UPDATE inventory_memberships SET role='VIEWER' WHERE id=$1", [
      f.membership,
    ]);
    expect((await f.assess("DENIED", 0)).status).toBe(403);
    expect(
      (
        await getPool().query("SELECT allergy_status,version FROM inventory_patients WHERE id=$1", [
          other,
        ])
      ).rows[0],
    ).toEqual({ allergy_status: "UNKNOWN", version: 0 });
  });
  it("does not let a new-unit operator edit an old-unit alert by guessing its ID", async () => {
    const f = await fixture();
    const created = await f.alert();
    const alert = (await created.json()).data;
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    await getPool().query("UPDATE inventory_unit_access SET unit_id=$2 WHERE membership_id=$1", [
      f.membership,
      f.otherUnit,
    ]);
    expect(
      (await f.alert({ action: "UPDATE", id: alert.id, status: "INACTIVE", version: 0 })).status,
    ).toBe(404);
    expect(
      (
        await getPool().query(
          "SELECT status,version FROM inventory_patient_clinical_alerts WHERE id=$1",
          [alert.id],
        )
      ).rows[0],
    ).toEqual({ status: "ACTIVE", version: 0 });
  });
  it("serializes simultaneous assessments and conflicting positive evidence", async () => {
    const f = await fixture();
    const statuses = await Promise.all([f.assess("DENIED", 0), f.assess("REPORTED", 0)]);
    expect(statuses.map((r) => r.status).sort()).toEqual([200, 409]);
    const g = await fixture();
    const [denial, positive] = await Promise.all([g.assess("DENIED", 0), g.alert()]);
    expect([200, 409]).toContain(denial.status);
    expect(positive.status).toBe(201);
    for (const summary of await g.summaries()) {
      expect(summary.status).toBe("REPORTED");
      expect(summary.allergies).toEqual(["Dipirona"]);
    }
  });
});

describe("clinical scope across authors and units", () => {
  async function moveToOtherUnit(f: Awaited<ReturnType<typeof fixture>>) {
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    await getPool().query("UPDATE inventory_unit_access SET unit_id=$2 WHERE membership_id=$1", [
      f.membership,
      f.otherUnit,
    ]);
  }
  it("keeps an active allergy visible after the patient moves to another unit", async () => {
    const f = await fixture();
    expect((await f.alert()).status).toBe(201);
    await moveToOtherUnit(f);
    const response = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${f.patient}`, {
        headers: { cookie: f.cookie },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.allergySummary.status).toBe("REPORTED");
    expect(data.allergySummary.allergies).toEqual(["Dipirona"]);
    expect(
      data.clinicalAlerts.map((alert: { title: string; type: string }) => [
        alert.type,
        alert.title,
      ]),
    ).toContainEqual(["ALLERGY", "Dipirona"]);
  });
  it("does not let a new-unit clinician edit a problem recorded in the old unit", async () => {
    const f = await fixture();
    const id = randomUUID();
    const problem = (extra: Record<string, unknown>) =>
      clinicalProblemsResponse(
        new Request(`${origin}/api/v1/inventory/clinical-problems`, {
          method: "POST",
          headers: { origin, cookie: f.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "CREATE",
            id,
            patientId: f.patient,
            description: "Hipertensão arterial sintética",
            icd10Code: null,
            onsetOn: null,
            resolvedOn: null,
            status: "ACTIVE",
            notes: "",
            reason: "Registro profissional sintético para validação.",
            version: 0,
            ...extra,
          }),
        }),
      );
    expect((await problem({})).status).toBe(201);
    await moveToOtherUnit(f);
    expect(
      (await problem({ action: "UPDATE", description: "Descrição alterada", status: "INACTIVE" }))
        .status,
    ).toBe(404);
    expect(
      (
        await getPool().query(
          "SELECT description,status,version FROM inventory_patient_clinical_problems WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ description: "Hipertensão arterial sintética", status: "ACTIVE", version: 0 });
  });
  it("hides another author's draft prescription from the quote and audits final reads", async () => {
    const f = await fixture();
    const reader = randomUUID(),
      readerMembership = randomUUID(),
      readerToken = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Other clinician',$2,'CRM','998','CE')",
      [reader, `${reader}@example.test`],
    );
    await getPool().query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
      [readerMembership, reader, f.org],
    );
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [readerMembership, f.unit],
    );
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [reader, hashToken(readerToken)],
    );
    const items = [{ id: randomUUID(), name: "Item sintético confidencial" }];
    await getPool().query(
      `INSERT INTO inventory_encounter_prescriptions(organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,items)
       VALUES($1,$2,$3,$4,$5,'Synthetic clinician','CRM','123','CE',$6)`,
      [f.org, f.unit, f.appointment, f.patient, f.user, JSON.stringify(items)],
    );
    const read = async () => {
      const response = await encounterQuotesResponse(
        new Request(`${origin}/api/v1/inventory/encounter-quotes?appointmentId=${f.appointment}`, {
          headers: { cookie: `allik_inventory_session=${readerToken}` },
        }),
      );
      expect(response.status).toBe(200);
      return (await response.json()).data.prescription;
    };
    const events = async () =>
      Number(
        (
          await getPool().query(
            "SELECT count(*) FROM inventory_clinical_access_events WHERE appointment_id=$1 AND action='READ'",
            [f.appointment],
          )
        ).rows[0].count,
      );
    expect(await read()).toBeNull();
    expect(await events()).toBe(0);
    await getPool().query(
      "UPDATE inventory_encounter_prescriptions SET status='FINAL',finalized_at=now() WHERE appointment_id=$1",
      [f.appointment],
    );
    expect((await read()).items[0].name).toBe("Item sintético confidencial");
    expect(await events()).toBe(1);
  });
});
