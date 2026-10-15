import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { authenticate, hashPassword, hashToken, pilotLogin } from "./auth";

const origin = "https://login-test.example";
const password = "synthetic-login-password-2026";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  vi.stubEnv("INVENTORY_ENVIRONMENT", "production");
  vi.stubEnv("VERCEL", "1");
  await getPool().query("DELETE FROM inventory_auth_rate_limits");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await getPool().end();
});
const login = (email: string, suppliedPassword = password, ip = "192.0.2.1") =>
  pilotLogin(
    new Request(`${origin}/api/inventory-session`, {
      method: "POST",
      headers: {
        origin,
        "Content-Type": "application/json",
        "x-vercel-forwarded-for": ip,
        "x-forwarded-for": randomUUID(),
      },
      body: JSON.stringify({ email, password: suppliedPassword }),
    }),
  );
async function fixture() {
  const user = randomUUID(),
    org = randomUUID(),
    email = `${user}@example.test`;
  await getPool().query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Login test ${org}`,
  ]);
  await getPool().query(
    "INSERT INTO inventory_users(id,name,email,password_hash) VALUES($1,'Synthetic login',$2,$3)",
    [user, email, await hashPassword(password)],
  );
  await getPool().query(
    "INSERT INTO inventory_memberships(user_id,organization_id,role) VALUES($1,$2,'SUPER_ADMIN')",
    [user, org],
  );
  return { user, email };
}
describe("individual login shared throttling", () => {
  it("still creates a usable individual session before the limit", async () => {
    const f = await fixture();
    const response = await login(f.email);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const auth = await authenticate(new Request(`${origin}/api`, { headers: { cookie } }));
    expect(auth?.user.id).toBe(f.user);
    expect(auth?.preview).toBe(false);
  });
  it("normalizes email variants and stops even a correct password after ten attempts", async () => {
    const f = await fixture();
    for (let attempt = 0; attempt < 10; attempt++)
      expect((await login(` ${f.email.toUpperCase()} `, "wrong-password")).status).toBe(401);
    const response = await login(f.email);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int AS count FROM inventory_sessions WHERE user_id=$1",
          [f.user],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("atomically limits simultaneous attempts for an unknown account without raw identifiers", async () => {
    const email = `${randomUUID()}@example.test`;
    const responses = await Promise.all(Array.from({ length: 16 }, () => login(email)));
    expect(responses.filter((value) => value.status === 401)).toHaveLength(10);
    expect(responses.filter((value) => value.status === 429)).toHaveLength(6);
    const rows = (await getPool().query("SELECT key FROM inventory_auth_rate_limits")).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.key))).toBe(true);
  });
  it("limits password spraying across emails using the trusted platform IP", async () => {
    await getPool().query(
      "INSERT INTO inventory_auth_rate_limits(key,bucket,attempts) VALUES($1,date_trunc('hour',now()),99)",
      [hashToken("login-ip:192.0.2.1")],
    );
    expect((await login(`${randomUUID()}@example.test`)).status).toBe(401);
    expect((await login(`${randomUUID()}@example.test`)).status).toBe(429);
    expect((await login(`${randomUUID()}@example.test`, password, "192.0.2.2")).status).toBe(401);
  });
  it("rejects oversized credentials before creating counters or sessions", async () => {
    expect((await login(`${"x".repeat(255)}@example.test`)).status).toBe(401);
    expect((await login("unknown@example.test", "x".repeat(201))).status).toBe(401);
    expect(
      (await getPool().query("SELECT count(*)::int AS count FROM inventory_auth_rate_limits"))
        .rows[0].count,
    ).toBe(0);
  });
});
