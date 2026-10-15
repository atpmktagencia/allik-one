import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { authenticate, can, hashToken } from "./auth";
import { userAdminResponse } from "./user-admin";

beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
async function organization() {
  return (
    await getPool().query("INSERT INTO inventory_organizations(name) VALUES($1) RETURNING id", [
      randomUUID(),
    ])
  ).rows[0].id as string;
}
async function user(org: string, number: string | null, council = "CRM", region = "CE") {
  const id = (
    await getPool().query(
      "INSERT INTO inventory_users(name,email,professional_council,council_number,council_region) VALUES('Synthetic registry test',$1,$2,$3,$4) RETURNING id",
      [`${randomUUID()}@example.test`, number ? council : null, number, number ? region : null],
    )
  ).rows[0].id as string;
  try {
    await getPool().query(
      "INSERT INTO inventory_memberships(user_id,organization_id,role) VALUES($1,$2,'SUPER_ADMIN')",
      [id, org],
    );
  } catch (error) {
    await getPool().query("DELETE FROM inventory_users WHERE id=$1", [id]);
    throw error;
  }
  return id;
}
describe("organization-scoped professional registration", () => {
  it("normalizes council prefix, punctuation and leading zeros without conflating categories or states", async () => {
    const key = async (c: string, n: string, r: string) =>
      (
        await getPool().query("SELECT inventory_professional_registration_key($1,$2,$3) AS key", [
          c,
          n,
          r,
        ])
      ).rows[0].key;
    expect(await key("crm", "CRM 00.123", "ce")).toBe("CRM|123|CE");
    expect(await key("CRM", "0000", "CE")).toBeNull();
    expect(await key("CRM", "123-CE", "CE")).toBeNull();
    expect(await key("CRM", "123", "XX")).toBeNull();
    expect(await key("CREFITO", "00123-F", "CE")).not.toBe(await key("CREFITO", "123-TO", "CE"));
  });
  it("reserves inactive accounts and permits another organization or UF", async () => {
    const org = await organization();
    const id = await user(org, "123");
    await getPool().query("UPDATE inventory_users SET active=false WHERE id=$1", [id]);
    await expect(user(org, "CRM 00.123")).rejects.toMatchObject({
      code: "23505",
      constraint: "professional_registration_identity_unique",
    });
    await expect(user(await organization(), "123")).resolves.toBeTypeOf("string");
    await expect(user(org, "123", "CRM", "SP")).resolves.toBeTypeOf("string");
    await expect(user(org, "123", "CRO")).resolves.toBeTypeOf("string");
  });
  it("serializes competing reservations with a unique database constraint", async () => {
    const org = await organization();
    const outcomes = await Promise.allSettled([user(org, "456"), user(org, "000.456")]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.code).toBe("23505");
  });
  it("rolls back profile changes conflicting with an existing account", async () => {
    const org = await organization();
    await user(org, "123");
    const second = await user(org, "456");
    await expect(
      getPool().query("UPDATE inventory_users SET council_number='00123' WHERE id=$1", [second]),
    ).rejects.toMatchObject({ code: "23505" });
    expect(
      (await getPool().query("SELECT council_number FROM inventory_users WHERE id=$1", [second]))
        .rows[0].council_number,
    ).toBe("456");
  });
  it("returns a friendly conflict through the admin API without creating an orphan account", async () => {
    const org = await organization();
    const id = await user(org, "123");
    const token = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [id, hashToken(token)],
    );
    const email = `${randomUUID()}@example.test`;
    const response = await userAdminResponse(
      new Request("http://localhost/api/inventory-users", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          cookie: `allik_inventory_session=${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "CREATE",
          name: "Synthetic duplicate",
          email,
          profession: "Médico",
          professionalCouncil: "CRM",
          councilNumber: "00.123",
          councilRegion: "CE",
          role: "CLINICIAN",
          unitIds: [],
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("outro usuário nesta organização");
    expect(
      (await getPool().query("SELECT id FROM inventory_users WHERE email=$1", [email])).rowCount,
    ).toBe(0);
    const auth = await authenticate(
      new Request("http://localhost", { headers: { cookie: `allik_inventory_session=${token}` } }),
    );
    expect(auth?.user.professionalRegistryState).toBe("OK");
    expect(auth && can(auth, "patients.clinical.manage")).toBe(true);
    expect(
      auth &&
        can(
          { ...auth, user: { ...auth.user, professionalRegistryState: "DUPLICATE" } },
          "patients.clinical.manage",
        ),
    ).toBe(false);
    expect(
      auth &&
        can(
          { ...auth, user: { ...auth.user, professionalRegistryState: "DUPLICATE" } },
          "inventory.read",
        ),
    ).toBe(true);
  });
  it("keeps legacy conflicts read-only and restores eligibility after explicit correction without changing authorship", async () => {
    const org = await organization();
    const first = await user(org, "123");
    const second = await user(org, null);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      // Test-owner-only simulation of data that predates this migration.
      await client.query(
        "ALTER TABLE inventory_users DISABLE TRIGGER professional_registration_user_sync",
      );
      await client.query(
        "UPDATE inventory_users SET professional_council='CRM',council_number='00123',council_region='CE' WHERE id=$1",
        [second],
      );
      await client.query(
        "ALTER TABLE inventory_users ENABLE TRIGGER professional_registration_user_sync",
      );
      await client.query(
        "DELETE FROM inventory_professional_registrations WHERE organization_id=$1",
        [org],
      );
      const states = await client.query(
        "SELECT inventory_professional_registration_state(id,$1) AS state FROM inventory_users WHERE id=ANY($2::uuid[])",
        [org, [first, second]],
      );
      expect(states.rows.map((row) => row.state)).toEqual(["DUPLICATE", "DUPLICATE"]);
      const unit = (
        await client.query(
          "INSERT INTO inventory_units(organization_id,name) VALUES($1,'Synthetic unit') RETURNING id",
          [org],
        )
      ).rows[0].id;
      const patient = (
        await client.query(
          "INSERT INTO inventory_patients(organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,'REG-1','Synthetic patient') RETURNING id",
          [org, unit],
        )
      ).rows[0].id;
      const appointment = (
        await client.query(
          "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES(gen_random_uuid(),$1,$2,$3,$4,'CONSULTATION','2031-02-12T10:00Z','2031-02-12T11:00Z','Synthetic room') RETURNING id",
          [org, unit, patient, first],
        )
      ).rows[0].id;
      await client.query("SAVEPOINT denied_write");
      const insert =
        "INSERT INTO inventory_encounter_documents(organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content) VALUES($1,$2,$3,$4,$5,'Original author','CRM','123','CE','PRESCRIPTION','RECEITA MÉDICA','Synthetic instructions') RETURNING author_user_id,council_number";
      await expect(
        client.query(insert, [org, unit, patient, appointment, first]),
      ).rejects.toMatchObject({ constraint: "clinical_professional_registration_conflict" });
      await client.query("ROLLBACK TO SAVEPOINT denied_write");
      await client.query("UPDATE inventory_users SET council_number='456' WHERE id=$1", [second]);
      const corrected = await client.query(
        "SELECT inventory_professional_registration_state(id,$1) AS state FROM inventory_users WHERE id=ANY($2::uuid[])",
        [org, [first, second]],
      );
      expect(corrected.rows.map((row) => row.state)).toEqual(["OK", "OK"]);
      expect(
        (await client.query(insert, [org, unit, patient, appointment, first])).rows[0],
      ).toEqual({ author_user_id: first, council_number: "123" });
      expect(
        (
          await client.query("SELECT active FROM inventory_users WHERE id=ANY($1::uuid[])", [
            [first, second],
          ])
        ).rows.every((row) => row.active),
      ).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
