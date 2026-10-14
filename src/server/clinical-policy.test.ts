import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { encounterDocumentsResponse } from "./encounter-documents";
import { patientsResponse } from "./patients";

beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});

async function fixture() {
  const pool = getPool();
  const org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    patient = randomUUID();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Clinical policy test ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Fortaleza'),($2,$3,'Juazeiro')",
    [unit, otherUnit, org],
  );
  await pool.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,$4,'Synthetic patient')",
    [patient, org, unit, randomUUID()],
  );
  const users: Record<string, { id: string; token: string; appointment: string }> = {};
  for (const [key, role, council, scope] of [
    ["doctor", "CLINICIAN", "CRM", unit],
    ["nurse", "CLINICIAN", "COREN", unit],
    ["other", "CLINICIAN", "CRM", otherUnit],
    ["colleague", "CLINICIAN", "CRM", unit],
    ["manager", "UNIT_MANAGER", "CRM", unit],
  ]) {
    const id = randomUUID(),
      membership = randomUUID(),
      token = randomUUID(),
      appointment = randomUUID();
    users[key!] = { id, token, appointment };
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic professional',$2,$3,'12345','CE')",
      [id, `${id}@example.test`, council],
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
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION','2031-02-12T10:00:00Z','2031-02-12T11:00:00Z',$6)",
      [appointment, org, unit, patient, id, `Test room ${id}`],
    );
  }
  const request = (user: string, appointment: string, body?: Record<string, unknown>) =>
    encounterDocumentsResponse(
      new Request(
        `https://allik-test.example/api/v1/inventory/encounter-documents?appointmentId=${appointment}`,
        {
          method: body ? "POST" : "GET",
          headers: {
            cookie: `allik_inventory_session=${users[user]!.token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body
            ? {
                body: JSON.stringify({
                  action: "SAVE_DRAFT",
                  appointmentId: appointment,
                  type: "PRESCRIPTION",
                  title: "RECEITA MÉDICA",
                  content: "Synthetic instructions",
                  ...body,
                }),
              }
            : {}),
        },
      ),
    );
  const patientRequest = (body: Record<string, unknown>) =>
    patientsResponse(
      new Request("https://allik-test.example/api/v1/inventory/patients", {
        method: "POST",
        headers: {
          cookie: `allik_inventory_session=${users["manager"]!.token}`,
          "Content-Type": "application/json",
          origin: "https://allik-test.example",
        },
        body: JSON.stringify({
          action: "UPDATE",
          id: patient,
          primaryUnitId: unit,
          internalCode: "",
          fullName: "Synthetic patient updated",
          active: true,
          consentStatus: "PENDING",
          version: 0,
          reason: "Synthetic administrative demographic update",
          ...body,
        }),
      }),
    );
  return { users, request, patientRequest, patient };
}

describe("clinical policy API boundaries", () => {
  it("preserves confidential patient information during administrative demographic updates", async () => {
    const f = await fixture();
    const privateData = {
      allergies: ["Synthetic allergy"],
      vegan: true,
      notes: "Synthetic private note",
    };
    await getPool().query("UPDATE inventory_patients SET private_data=$2 WHERE id=$1", [
      f.patient,
      privateData,
    ]);
    const response = await f.patientRequest({});
    expect(response.status).toBe(200);
    const result = await getPool().query(
      "SELECT full_name,private_data FROM inventory_patients WHERE id=$1",
      [f.patient],
    );
    expect(result.rows[0].full_name).toBe("Synthetic patient updated");
    expect(result.rows[0].private_data).toEqual(privateData);
  });
  it("rejects administrative attempts to replace confidential patient information", async () => {
    const f = await fixture();
    const privateData = { allergies: ["Synthetic allergy"], vegan: null, notes: "" };
    await getPool().query("UPDATE inventory_patients SET private_data=$2 WHERE id=$1", [
      f.patient,
      privateData,
    ]);
    const response = await f.patientRequest({
      privateData: {
        allergies: ["Unauthorized replacement"],
        vegan: false,
        notes: "Unauthorized private note",
      },
    });
    expect(response.status).toBe(403);
    const result = await getPool().query(
      "SELECT full_name,private_data,version FROM inventory_patients WHERE id=$1",
      [f.patient],
    );
    expect(result.rows[0].full_name).toBe("Synthetic patient");
    expect(result.rows[0].private_data).toEqual(privateData);
    expect(result.rows[0].version).toBe(0);
  });
  it("allows a physician clinician to create a draft in their unit", async () => {
    const f = await fixture();
    expect((await f.request("doctor", f.users["doctor"]!.appointment, {})).status).toBe(201);
  });
  it("denies a clinician an appointment outside their unit", async () => {
    const f = await fixture();
    expect((await f.request("other", f.users["doctor"]!.appointment)).status).toBe(404);
    expect((await f.request("other", f.users["doctor"]!.appointment, {})).status).toBe(404);
  });
  it("does not grant a unit manager clinical reading or writing even with CRM metadata", async () => {
    const f = await fixture();
    expect((await f.request("manager", f.users["manager"]!.appointment)).status).toBe(403);
    expect((await f.request("manager", f.users["manager"]!.appointment, {})).status).toBe(403);
  });
  it("allows nursing instructions but denies medical prescriptions", async () => {
    const f = await fixture();
    expect((await f.request("nurse", f.users["nurse"]!.appointment, {})).status).toBe(403);
    expect(
      (
        await f.request("nurse", f.users["nurse"]!.appointment, {
          type: "INSTRUCTIONS",
          title: "ORIENTAÇÕES",
        })
      ).status,
    ).toBe(201);
  });
  it("keeps another professional's draft out of appointment document responses", async () => {
    const f = await fixture();
    expect((await f.request("doctor", f.users["doctor"]!.appointment, {})).status).toBe(201);
    const response = await f.request("colleague", f.users["doctor"]!.appointment);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.documents).toEqual([]);
  });
});
