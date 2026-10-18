import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { prescriptionComposerResponse } from "./prescription-composer";
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
    prescriptionComposerResponse(
      new Request(origin + "/api/v1/inventory/prescription-composer", {
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
    prescriptionComposerResponse(
      new Request(origin + "/api/v1/inventory/prescription-composer" + params, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  const formula = () => ({
    ingredients: [
      {
        medicationName: "Componente sintético",
        dose: "1",
        doseUnit: "mg",
        individualCapsule: false,
      },
    ],
    route: "Oral",
    presentation: "Cápsula",
    instructions: "Conferir antes de usar",
    phases: [{ doseUnits: 1, frequencyPerDay: 2, durationDays: 7, maintenance: false }],
  });
  const save = (overrides = {}) =>
    post({
      action: "SAVE",
      confirmedNoPatientData: true,
      appointmentId: appointment,
      title: "Protocolo privado sintético",
      formula: formula(),
      ...overrides,
    });
  const preview = (overrides = {}) =>
    post({ action: "PREVIEW", appointmentId: appointment, formula: formula(), ...overrides });
  const list = () => read(`?appointmentId=${appointment}`);
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
    formula,
    save,
    preview,
    list,
  };
}
describe("Private prescription composer protocols", () => {
  it("composes deterministically and saves a private template without creating or finalizing a clinical document", async () => {
    const f = await fixture();
    const before = await getPool().query(
      "SELECT count(*)::int n FROM inventory_encounter_documents WHERE appointment_id=$1",
      [f.appointment],
    );
    const preview = await f.preview();
    expect(preview.status).toBe(200);
    const composition = (await preview.json()).data;
    expect(composition.quantity).toBe(14);
    expect((await (await f.preview()).json()).data).toEqual(composition);
    const saved = await f.save();
    expect(saved.status).toBe(200);
    const { data } = await saved.json();
    expect(data.version).toBe(1);
    const templates = (await (await f.list()).json()).data.templates;
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      id: data.id,
      version: 1,
      title: "Protocolo privado sintético",
    });
    const after = await getPool().query(
      "SELECT count(*)::int n FROM inventory_encounter_documents WHERE appointment_id=$1",
      [f.appointment],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
  it("keeps templates private from another author even within the same organization", async () => {
    const f = await fixture(),
      other = await fixture();
    const { data } = await (await f.save()).json();
    await getPool().query(
      "UPDATE inventory_memberships SET organization_id=$2,role='SUPER_ADMIN' WHERE id=$1",
      [other.membership, f.org],
    );
    const appointment = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Room')",
      [appointment, f.org, f.unit, f.patient, other.user],
    );
    const read = await other.read(`?appointmentId=${appointment}`);
    expect(read.status).toBe(200);
    expect((await read.json()).data.templates).toEqual([]);
    expect((await other.save({ appointmentId: appointment, id: data.id, version: 1 })).status).toBe(
      404,
    );
    expect(
      (
        await other.post({
          action: "ARCHIVE",
          appointmentId: appointment,
          id: data.id,
          version: 1,
        })
      ).status,
    ).toBe(404);
  });
  it("isolates organization, appointment author and both units after a patient transfer", async () => {
    const f = await fixture(),
      other = await fixture();
    expect((await f.preview({ appointmentId: other.appointment })).status).toBe(404);
    await getPool().query(
      "UPDATE inventory_memberships SET organization_id=$2,role='SUPER_ADMIN' WHERE id=$1",
      [other.membership, f.org],
    );
    expect((await other.preview({ appointmentId: f.appointment })).status).toBe(403);
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    expect((await f.preview()).status).toBe(404);
    expect((await f.list()).status).toBe(404);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.membership, f.otherUnit],
    );
    expect((await f.preview()).status).toBe(200);
  });
  it("serializes conflicting revisions, preserves snapshots and archives without deleting history", async () => {
    const f = await fixture(),
      { data } = await (await f.save()).json();
    const responses = await Promise.all([
      f.save({ id: data.id, version: 1, title: "Revisão um" }),
      f.save({ id: data.id, version: 1, title: "Revisão dois" }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const versions = await getPool().query(
      "SELECT version,title FROM inventory_prescription_protocol_versions WHERE protocol_id=$1 ORDER BY version",
      [data.id],
    );
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0]).toMatchObject({ version: 1, title: "Protocolo privado sintético" });
    await expect(
      getPool().query(
        "UPDATE inventory_prescription_protocol_versions SET title='changed' WHERE protocol_id=$1",
        [data.id],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_prescription_protocol_versions WHERE protocol_id=$1", [
        data.id,
      ]),
    ).rejects.toThrow();
    expect(
      (await f.post({ action: "ARCHIVE", appointmentId: f.appointment, id: data.id, version: 2 }))
        .status,
    ).toBe(200);
    expect((await (await f.list()).json()).data.templates).toEqual([]);
    expect((await f.save({ id: data.id, version: 3 })).status).toBe(409);
    const count = await getPool().query(
      "SELECT count(*)::int n FROM inventory_prescription_protocol_versions WHERE protocol_id=$1",
      [data.id],
    );
    expect(count.rows[0].n).toBe(3);
  });
  it("rejects unsafe input, unauthorized origins and non-clinical individual identities", async () => {
    const f = await fixture();
    expect(
      (
        await f.post(
          { action: "PREVIEW", appointmentId: f.appointment, formula: f.formula() },
          "https://foreign.test",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await prescriptionComposerResponse(
          new Request(origin + "/api/v1/inventory/prescription-composer", {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: f.sessionCookie },
            body: JSON.stringify({
              action: "PREVIEW",
              appointmentId: f.appointment,
              formula: f.formula(),
            }),
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.preview({
          formula: {
            ...f.formula(),
            phases: [{ doseUnits: 0, frequencyPerDay: 1, durationDays: 1 }],
          },
        })
      ).status,
    ).toBe(400);
    expect((await f.preview({ formula: { ...f.formula(), unsafeExtra: "yes" } })).status).toBe(400);
    expect(
      (
        await prescriptionComposerResponse(
          new Request(origin + "/api/v1/inventory/prescription-composer"),
        )
      ).status,
    ).toBe(401);
    await getPool().query("UPDATE inventory_memberships SET role='UNIT_MANAGER' WHERE id=$1", [
      f.membership,
    ]);
    expect((await f.preview()).status).toBe(403);
  });
  it("never allows the shared Preview operator to compose or read private templates", async () => {
    const f = await fixture();
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    try {
      expect(
        (
          await prescriptionComposerResponse(
            new Request(
              `${origin}/api/v1/inventory/prescription-composer?appointmentId=${f.appointment}`,
            ),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await prescriptionComposerResponse(
            new Request(`${origin}/api/v1/inventory/prescription-composer`, {
              method: "POST",
              headers: { origin, "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "PREVIEW",
                appointmentId: f.appointment,
                formula: f.formula(),
              }),
            }),
          )
        ).status,
      ).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("requires a permitted professional registry and a usable appointment", async () => {
    const f = await fixture();
    await getPool().query("UPDATE inventory_users SET professional_council='COREN' WHERE id=$1", [
      f.user,
    ]);
    expect((await f.preview()).status).toBe(403);
    await getPool().query("UPDATE inventory_users SET professional_council='CRM' WHERE id=$1", [
      f.user,
    ]);
    await getPool().query("UPDATE inventory_care_appointments SET status='CANCELED' WHERE id=$1", [
      f.appointment,
    ]);
    expect((await f.preview()).status).toBe(403);
  });
});
