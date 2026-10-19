import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken, previewLogin } from "./auth";
import { integrationCredentialResponse } from "./integration-credentials";
import { prescriptionComposerResponse } from "./prescription-composer";
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
  const formula = () => ({
    ingredients: [
      {
        medicationName: "Synthetic model component",
        dose: "1",
        doseUnit: "mg",
        individualCapsule: false,
      },
    ],
    route: "oral",
    presentation: "cápsula",
    instructions: "Synthetic instructions",
    phases: [{ doseUnits: 1, frequencyPerDay: 1, durationDays: 7, maintenance: false }],
  });
  const read = (role = "owner", appointmentId = users[role]!.appointment) =>
    prescriptionComposerResponse(
      new Request(
        `${origin}/api/v1/inventory/prescription-composer?appointmentId=${appointmentId}`,
        { headers: { cookie: users[role]!.cookie } },
      ),
    );
  const post = (body: Record<string, unknown>, role = "owner") =>
    prescriptionComposerResponse(
      new Request(`${origin}/api/v1/inventory/prescription-composer`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", cookie: users[role]!.cookie },
        body: JSON.stringify({ appointmentId: users[role]!.appointment, ...body }),
      }),
    );
  const save = (overrides = {}) =>
    post({
      action: "SAVE",
      title: "Synthetic shared model",
      formula: formula(),
      category: "Synthetic category",
      description: "Reusable synthetic model",
      visibility: "PRIVATE",
      unitIds: [unit],
      confirmedNoPatientData: true,
      ...overrides,
    });
  return { org, unit, otherUnit, users, formula, read, post, save };
}
async function saved(f: Awaited<ReturnType<typeof fixture>>, overrides = {}) {
  const response = await f.save(overrides);
  expect(response.status).toBe(200);
  return (await response.json()).data as { id: string; version: number };
}
async function templates(f: Awaited<ReturnType<typeof fixture>>, role = "owner") {
  const response = await f.read(role);
  expect(response.status).toBe(200);
  return (await response.json()).data.templates as {
    id: string;
    version: number;
    formula: unknown;
    visibility: string;
    status: string;
    canEdit: boolean;
  }[];
}
async function anotherAppointment(
  f: Awaited<ReturnType<typeof fixture>>,
  role: string,
  unit: string,
) {
  const patient = randomUUID(),
    appointment = randomUUID();
  await getPool().query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,$4,'Synthetic alternate patient')",
    [patient, f.org, unit, randomUUID()],
  );
  await getPool().query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour',$6)",
    [appointment, f.org, unit, patient, f.users[role]!.id, `Alt room ${appointment}`],
  );
  return appointment;
}
async function draftDocument(f: Awaited<ReturnType<typeof fixture>>, role = "owner") {
  const document = randomUUID(),
    user = f.users[role]!;
  await getPool().query(
    `INSERT INTO inventory_encounter_documents(id,organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status) SELECT $1,$2,$3,$4,$5,u.id,u.name,u.professional_council,u.council_number,u.council_region,'PRESCRIPTION','Synthetic draft','Original draft remains unchanged','DRAFT' FROM inventory_users u WHERE u.id=$6`,
    [document, f.org, f.unit, user.appointment, user.patient, user.id],
  );
  return document;
}
describe("Shared clinical template privacy and revisions", () => {
  it("keeps new models private by default and never grants implicit SUPER_ADMIN access", async () => {
    const f = await fixture(),
      model = await saved(f, { visibility: undefined });
    const owner = await templates(f);
    expect(owner).toHaveLength(1);
    expect(owner[0]).toMatchObject({ id: model.id, visibility: "PRIVATE", canEdit: true });
    expect(await templates(f, "colleague")).toEqual([]);
    expect(await templates(f, "reviewer")).toEqual([]);
    expect(await templates(f, "partner")).toEqual([]);
    expect(
      (
        await f.post(
          {
            action: "PREVIEW",
            formula: f.formula(),
            protocolId: model.id,
            protocolVersion: model.version,
          },
          "reviewer",
        )
      ).status,
    ).toBe(404);
  });
  it("allows owner-authorized admin consultation and revocation without handing over editing rights", async () => {
    const f = await fixture(),
      model = await saved(f);
    expect(
      (
        await f.post({
          action: "GRANT_ACCESS",
          id: model.id,
          version: model.version,
          granteeUserId: f.users["colleague"]!.id,
        })
      ).status,
    ).toBe(400);
    const grant = await f.post({
      action: "GRANT_ACCESS",
      id: model.id,
      version: model.version,
      granteeUserId: f.users["reviewer"]!.id,
    });
    expect(grant.status).toBe(200);
    const granted = (await grant.json()).data;
    expect(await templates(f, "reviewer")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: model.id, canEdit: false })]),
    );
    expect([403, 404]).toContain(
      (
        await f.post(
          {
            action: "SAVE",
            id: model.id,
            version: granted.version,
            title: "Forbidden overwrite",
            formula: f.formula(),
            confirmedNoPatientData: true,
          },
          "reviewer",
        )
      ).status,
    );
    const revoke = await f.post({
      action: "REVOKE_ACCESS",
      id: model.id,
      version: granted.version,
      granteeUserId: f.users["reviewer"]!.id,
    });
    expect(revoke.status).toBe(200);
    expect(await templates(f, "reviewer")).toEqual([]);
    const events = await getPool().query(
      "SELECT action,after_data->>'granteeUserId' grantee,after_data->>'grantActive' active FROM inventory_prescription_protocol_events WHERE protocol_id=$1 AND action IN ('GRANT_ACCESS','REVOKE_ACCESS') ORDER BY created_at,id",
      [model.id],
    );
    expect(events.rows).toEqual([
      { action: "GRANT_ACCESS", grantee: f.users["reviewer"]!.id, active: "true" },
      { action: "REVOKE_ACCESS", grantee: f.users["reviewer"]!.id, active: "false" },
    ]);
  });
  it("shares organization models only with authorized units and never across organizations", async () => {
    const f = await fixture(),
      foreign = await fixture(),
      model = await saved(f, { visibility: "ORGANIZATION", unitIds: [f.unit] });
    expect(await templates(f, "colleague")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: model.id, canEdit: false })]),
    );
    expect(await templates(f, "outside")).toEqual([]);
    expect(await templates(foreign)).toEqual([]);
    expect([400, 403, 404]).toContain((await f.save({ unitIds: [foreign.unit] })).status);
    expect(
      (
        await f.post(
          {
            action: "PREVIEW",
            formula: f.formula(),
            protocolId: model.id,
            protocolVersion: model.version,
          },
          "outside",
        )
      ).status,
    ).toBe(404);
  });
  it("requires explicit no-patient-data confirmation, rejects structured identity fields and obvious identifier text", async () => {
    const f = await fixture();
    expect((await f.save({ confirmedNoPatientData: false })).status).toBe(400);
    expect((await f.save({ confirmedNoPatientData: undefined })).status).toBe(400);
    expect((await f.save({ patientId: f.users["owner"]!.patient })).status).toBe(400);
    expect((await f.save({ description: "Contact synthetic-patient@example.test" })).status).toBe(
      400,
    );
    expect((await f.save({ description: "Synthetic model patient" })).status).toBe(400);
    expect(await templates(f)).toEqual([]);
  });
  it("preserves immutable earlier formula revisions after a shared template is edited", async () => {
    const f = await fixture(),
      model = await saved(f, { visibility: "ORGANIZATION" });
    const original = structuredClone((await templates(f, "colleague"))[0]!.formula);
    const changed = f.formula();
    changed.ingredients[0]!.dose = "2";
    expect(
      (
        await f.save({
          id: model.id,
          version: model.version,
          formula: changed,
          visibility: "ORGANIZATION",
        })
      ).status,
    ).toBe(200);
    expect(original).toEqual(f.formula());
    expect((await templates(f, "colleague"))[0]!.formula).toEqual(changed);
    const versions = await getPool().query(
      "SELECT version,formula FROM inventory_prescription_protocol_versions WHERE protocol_id=$1 ORDER BY version",
      [model.id],
    );
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0].formula).toEqual(original);
    await expect(
      getPool().query(
        "UPDATE inventory_prescription_protocol_versions SET description='changed' WHERE protocol_id=$1",
        [model.id],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_prescription_protocol_versions WHERE protocol_id=$1", [
        model.id,
      ]),
    ).rejects.toThrow();
  });
  it("rejects stale edits and preserves the original appointment and current patient unit guards", async () => {
    const f = await fixture(),
      model = await saved(f);
    const edits = await Promise.all([
      f.save({ id: model.id, version: model.version, title: "Concurrent model one" }),
      f.save({ id: model.id, version: model.version, title: "Concurrent model two" }),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await f.read("colleague", f.users["owner"]!.appointment)).status).toBe(403);
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.users["owner"]!.patient,
      f.otherUnit,
    ]);
    expect((await f.read()).status).toBe(404);
    expect((await f.save()).status).toBe(404);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.users["owner"]!.membership, f.otherUnit],
    );
    expect((await f.read()).status).toBe(200);
  });
  it("denies mutations from the shared Preview identity", async () => {
    const f = await fixture();
    const credential = await integrationCredentialResponse(
      new Request(`${origin}/api/v1/inventory/integration-credentials`, {
        method: "POST",
        headers: {
          origin,
          "Content-Type": "application/json",
          cookie: f.users["reviewer"]!.cookie,
        },
        body: JSON.stringify({
          action: "CREATE",
          name: "Synthetic shared model integration",
          expiresInDays: 30,
          permissions: ["inventory.read"],
        }),
      }),
    );
    expect(credential.status).toBe(201);
    const { data: integration } = await credential.json();
    expect(
      (
        await prescriptionComposerResponse(
          new Request(`${origin}/api/v1/inventory/prescription-composer`, {
            method: "POST",
            headers: {
              origin,
              "Content-Type": "application/json",
              authorization: `Bearer ${integration.token}`,
            },
            body: JSON.stringify({
              action: "SAVE",
              appointmentId: f.users["owner"]!.appointment,
              title: "Forbidden integration model",
              formula: f.formula(),
              confirmedNoPatientData: true,
            }),
          }),
        )
      ).status,
    ).toBe(403);
    vi.stubEnv("INVENTORY_ENVIRONMENT", "test");
    vi.stubEnv("INVENTORY_PREVIEW_PASSWORD", "synthetic-test-password");
    vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-test-secret".repeat(3));
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    try {
      const login = await previewLogin(
        new Request(`${origin}/api/inventory-session`, {
          method: "POST",
          headers: { origin },
          body: JSON.stringify({ password: "synthetic-test-password" }),
        }),
      );
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      expect(
        (
          await prescriptionComposerResponse(
            new Request(`${origin}/api/v1/inventory/prescription-composer`, {
              method: "POST",
              headers: { origin, cookie, "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "SAVE",
                appointmentId: f.users["owner"]!.appointment,
                title: "Forbidden shared template",
                formula: f.formula(),
                confirmedNoPatientData: true,
              }),
            }),
          )
        ).status,
      ).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("applies private model unit restrictions to owners and explicitly granted SUPER_ADMIN readers", async () => {
    const f = await fixture(),
      model = await saved(f);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.users["owner"]!.membership, f.otherUnit],
    );
    const ownOther = await anotherAppointment(f, "owner", f.otherUnit),
      reviewOther = await anotherAppointment(f, "reviewer", f.otherUnit);
    expect((await (await f.read("owner", ownOther)).json()).data.templates).toEqual([]);
    const grant = await f.post({
      action: "GRANT_ACCESS",
      id: model.id,
      version: model.version,
      granteeUserId: f.users["reviewer"]!.id,
    });
    expect(grant.status).toBe(200);
    const current = (await grant.json()).data;
    expect((await (await f.read("reviewer", reviewOther)).json()).data.templates).toEqual([]);
    expect(
      (
        await f.post(
          {
            action: "PREVIEW",
            appointmentId: reviewOther,
            formula: f.formula(),
            protocolId: model.id,
            protocolVersion: current.version,
          },
          "reviewer",
        )
      ).status,
    ).toBe(404);
  });
  it("publishes institutional models only after independent approval and protects the approved revision", async () => {
    const f = await fixture(),
      model = await saved(f, { visibility: "INSTITUTIONAL" });
    expect(await templates(f, "colleague")).toEqual([]);
    expect(await templates(f, "reviewer")).toEqual([]);
    const submitted = await f.post({ action: "SUBMIT", id: model.id, version: model.version });
    expect(submitted.status).toBe(200);
    const pending = (await submitted.json()).data;
    expect(await templates(f, "colleague")).toEqual([]);
    expect(await templates(f, "reviewer")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: model.id, status: "PENDING" })]),
    );
    expect(
      (await f.post({ action: "APPROVE", id: model.id, version: pending.version })).status,
    ).toBe(403);
    const approved = await f.post(
      { action: "APPROVE", id: model.id, version: pending.version },
      "reviewer",
    );
    expect(approved.status).toBe(200);
    const revision = (await approved.json()).data;
    expect(await templates(f, "colleague")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: model.id, status: "APPROVED", canEdit: false }),
      ]),
    );
    expect(
      (await f.save({ id: model.id, version: revision.version, visibility: "INSTITUTIONAL" }))
        .status,
    ).toBe(409);
    expect(
      (await f.post({ action: "REJECT", id: model.id, version: revision.version }, "reviewer"))
        .status,
    ).toBe(409);
  });
  it("rejects self approval even for SUPER_ADMIN and allows an independent reviewer to return a pending model to draft", async () => {
    const f = await fixture();
    const creation = await f.post(
      {
        action: "SAVE",
        title: "Synthetic institutional model",
        formula: f.formula(),
        visibility: "INSTITUTIONAL",
        unitIds: [f.unit],
        confirmedNoPatientData: true,
      },
      "reviewer",
    );
    expect(creation.status).toBe(200);
    const self = (await creation.json()).data;
    const submit = await f.post(
      { action: "SUBMIT", id: self.id, version: self.version },
      "reviewer",
    );
    expect(submit.status).toBe(200);
    const pending = (await submit.json()).data;
    expect(
      (await f.post({ action: "APPROVE", id: self.id, version: pending.version }, "reviewer"))
        .status,
    ).toBe(403);
    const model = await saved(f, { visibility: "INSTITUTIONAL" }),
      submission = await f.post({ action: "SUBMIT", id: model.id, version: model.version });
    const sent = (await submission.json()).data;
    const rejected = await f.post(
      { action: "REJECT", id: model.id, version: sent.version },
      "reviewer",
    );
    expect(rejected.status).toBe(200);
    expect((await templates(f)).find((t) => t.id === model.id)).toMatchObject({
      status: "DRAFT",
      canEdit: true,
    });
    expect(await templates(f, "colleague")).toEqual([]);
  });
  it("persists independent immutable draft-linked instances with source revision and idempotent replay", async () => {
    const f = await fixture(),
      model = await saved(f, { visibility: "ORGANIZATION" }),
      documentId = await draftDocument(f);
    const instance = {
      action: "INSTANTIATE",
      id: randomUUID(),
      documentId,
      formula: f.formula(),
      sourceId: model.id,
      sourceVersion: model.version,
    };
    const response = await f.post(instance);
    expect(response.status).toBe(200);
    expect((await response.json()).data.instanceId).toBe(instance.id);
    expect((await f.post(instance)).status).toBe(200);
    const changed = f.formula();
    changed.ingredients[0]!.dose = "3";
    expect((await f.post({ ...instance, formula: changed })).status).toBe(409);
    const foreignDoc = await draftDocument(f, "colleague");
    expect((await f.post({ ...instance, id: randomUUID(), documentId: foreignDoc })).status).toBe(
      404,
    );
    expect(
      (
        await f.save({
          id: model.id,
          version: model.version,
          formula: changed,
          visibility: "ORGANIZATION",
        })
      ).status,
    ).toBe(200);
    const persisted = await getPool().query(
      "SELECT source_protocol_id,source_version,formula FROM inventory_prescription_protocol_instances WHERE id=$1",
      [instance.id],
    );
    expect(persisted.rows).toEqual([
      { source_protocol_id: model.id, source_version: model.version, formula: f.formula() },
    ]);
    const draft = await getPool().query(
      "SELECT content,status FROM inventory_encounter_documents WHERE id=$1",
      [documentId],
    );
    expect(draft.rows).toEqual([{ content: "Original draft remains unchanged", status: "DRAFT" }]);
    await expect(
      getPool().query(
        "UPDATE inventory_prescription_protocol_instances SET formula='{}' WHERE id=$1",
        [instance.id],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_prescription_protocol_instances WHERE id=$1", [
        instance.id,
      ]),
    ).rejects.toThrow();
    const count = await getPool().query(
      "SELECT count(*)::int n FROM inventory_prescription_protocol_instances WHERE document_id=$1",
      [documentId],
    );
    expect(count.rows[0].n).toBe(1);
  });
});
