import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { encounterPrescriptionsResponse } from "./encounter-prescriptions";
const origin = "https://tasks.example.test";
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
  const p = getPool(),
    org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID(),
    token = randomUUID();
  await p.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    "Tasks " + org,
  ]);
  await p.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Unit one'),($2,$3,'Unit two')",
    [unit, otherUnit, org],
  );
  await p.query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic operator',$2,'CRM',$3,'CE')",
    [user, user + "@example.test", parseInt(user.slice(0, 8), 16).toString()],
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
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [user, hashToken(token)],
  );
  await p.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'TASKS','Synthetic patient')",
    [patient, org, unit],
  );
  await p.query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Room')",
    [appointment, org, unit, patient, user],
  );
  const post = (data: unknown, requestOrigin = origin) =>
    encounterPrescriptionsResponse(
      new Request(origin + "/api/v1/inventory/encounter-prescriptions", {
        method: "POST",
        headers: {
          cookie: `allik_inventory_session=${token}`,
          origin: requestOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }),
    );
  const read = (params = "") =>
    encounterPrescriptionsResponse(
      new Request(origin + "/api/v1/inventory/encounter-prescriptions" + params, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  return {
    org,
    unit,
    otherUnit,
    user,
    membership,
    patient,
    appointment,
    sessionCookie: `allik_inventory_session=${token}`,
    post,
    read,
  };
}

function prescription(
  f: Awaited<ReturnType<typeof fixture>>,
  values: Record<string, unknown> = {},
) {
  return {
    action: "SAVE_DRAFT",
    appointmentId: f.appointment,
    version: null,
    generalInstructions: "",
    items: [
      {
        id: randomUUID(),
        productId: null,
        medicationName: "Medicamento sintético",
        doseQuantity: 2.5,
        doseUnit: "MG",
        doseUnitOther: "",
        route: "Oral",
        frequencyEvery: 1,
        frequencyUnit: "WEEK",
        durationAmount: 4,
        durationUnit: "WEEK",
        continuousUse: false,
        plannedAdministrations: 4,
        plannedAdministrationsReason: "",
        instructions: "Orientação sintética",
        ...values,
      },
    ],
  };
}
describe("Therapeutic prescription remediation", () => {
  it("rejects missing material choices rather than accepting a clinical default", async () => {
    const f = await fixture();
    expect(
      (await f.post(prescription(f, { doseQuantity: null, doseUnit: "", frequencyEvery: null })))
        .status,
    ).toBe(400);
    const records = await getPool().query(
      "SELECT id FROM inventory_encounter_prescriptions WHERE appointment_id=$1",
      [f.appointment],
    );
    expect(records.rowCount).toBe(0);
  });
  it("requires and audits the prescriber's justification for inconsistent administration counts", async () => {
    const f = await fixture();
    const draft = prescription(f, { plannedAdministrations: 8 });
    expect((await f.post(draft)).status).toBe(400);
    draft.items[0]!.plannedAdministrationsReason =
      "Exceção de calendário revisada pelo prescritor sintético.";
    expect((await f.post(draft)).status).toBe(201);
    const record = (
      await getPool().query(
        "SELECT items FROM inventory_encounter_prescriptions WHERE appointment_id=$1",
        [f.appointment],
      )
    ).rows[0];
    expect(record.items[0].plannedAdministrationsReason).toContain("Exceção de calendário");
    const events = (
      await getPool().query(
        "SELECT after_data FROM inventory_encounter_prescription_changes WHERE prescription_id=(SELECT id FROM inventory_encounter_prescriptions WHERE appointment_id=$1)",
        [f.appointment],
      )
    ).rows;
    expect(events[0].after_data.items[0].plannedAdministrationsReason).toContain(
      "Exceção de calendário",
    );
  });
  it("does not convert calendar months to weeks and requires explicit review of an indeterminate count", async () => {
    const f = await fixture();
    expect((await f.post(prescription(f, { durationUnit: "MONTH" }))).status).toBe(400);
    expect(
      (
        await f.post(
          prescription(f, {
            durationUnit: "MONTH",
            plannedAdministrationsReason:
              "Calendário mensal conferido individualmente pelo prescritor.",
          }),
        )
      ).status,
    ).toBe(201);
  });
  it("rejects writes and exposes readonly state after completion", async () => {
    const f = await fixture();
    await getPool().query("UPDATE inventory_care_appointments SET status='COMPLETED' WHERE id=$1", [
      f.appointment,
    ]);
    expect((await f.post(prescription(f))).status).toBe(409);
    const read = await f.read(`?appointmentId=${f.appointment}`);
    expect(read.status).toBe(200);
    expect((await read.json()).data.canAuthor).toBe(false);
    expect(
      (
        await getPool().query(
          "SELECT id FROM inventory_encounter_prescriptions WHERE appointment_id=$1",
          [f.appointment],
        )
      ).rowCount,
    ).toBe(0);
  });
});

it("clears a draft by an audited update while preserving its previous clinical content in history", async () => {
  const f = await fixture();
  const draft = prescription(f);
  expect((await f.post(draft)).status).toBe(201);
  expect((await f.post({ ...draft, version: 0, items: [], generalInstructions: "" })).status).toBe(
    200,
  );
  const record = (
    await getPool().query(
      "SELECT id,items,status,general_instructions FROM inventory_encounter_prescriptions WHERE appointment_id=$1",
      [f.appointment],
    )
  ).rows[0];
  expect(record).toMatchObject({ items: [], status: "DRAFT", general_instructions: "" });
  const events = (
    await getPool().query(
      "SELECT action,before_data,after_data FROM inventory_encounter_prescription_changes WHERE prescription_id=$1 ORDER BY created_at",
      [record.id],
    )
  ).rows;
  expect(events).toHaveLength(2);
  expect(events[1].action).toBe("UPDATE");
  expect(events[1].before_data.items).toHaveLength(1);
  expect(events[1].after_data.items).toEqual([]);
  expect((await f.post({ ...draft, action: "FINALIZE", version: 1, items: [] })).status).toBe(400);
});
