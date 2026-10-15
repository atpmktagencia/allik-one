import { afterAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("production database identity guard", () => {
  it("refuses to query with an elevated or owner identity", async () => {
    if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
      throw new Error("Dedicated test database required");
    const user = decodeURIComponent(new URL(process.env["DATABASE_URL"]!).username);
    vi.stubEnv("INVENTORY_ENVIRONMENT", "production");
    vi.stubEnv("INVENTORY_RUNTIME_ROLE", user);
    vi.stubEnv("DATABASE_ADMIN_URL", "");
    const { getPool } = await import("./db");
    const pool = getPool();
    try {
      await expect(pool.query("SELECT 1")).rejects.toThrow("INVENTORY_RUNTIME_ROLE_REJECTED");
      await expect(pool.connect()).rejects.toThrow("INVENTORY_RUNTIME_ROLE_REJECTED");
      const callbackConnection = await new Promise<{
        error: Error | undefined;
        receivedClient: boolean;
      }>((resolve) => {
        pool.connect((error, client, release) => {
          if (client) release();
          resolve({ error, receivedClient: Boolean(client) });
        });
      });
      expect(callbackConnection.error?.message).toBe("INVENTORY_RUNTIME_ROLE_REJECTED");
      expect(callbackConnection.receivedClient).toBe(false);
      const callbackQuery = await new Promise<Error>((resolve) => {
        pool.query("SELECT 1", (error) => resolve(error));
      });
      expect(callbackQuery?.message).toBe("INVENTORY_RUNTIME_ROLE_REJECTED");
    } finally {
      await pool.end();
    }
  });
  it("preserves concurrent Promise and callback queries for a restricted login", async () => {
    const ownerUrl = process.env["DATABASE_URL"]!;
    const owner = new Pool({ connectionString: ownerUrl });
    const role = `runtime_callbacks_${randomBytes(6).toString("hex")}`;
    const password = randomBytes(32).toString("hex");
    const runtimeUrl = new URL(ownerUrl);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    let runtime: Pool | undefined;
    try {
      await owner.query(`CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD '${password}'`);
      const db = runtimeUrl.pathname.slice(1).replaceAll('"', '""');
      await owner.query(`REVOKE TEMPORARY ON DATABASE "${db}" FROM PUBLIC`);
      await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      vi.stubEnv("DATABASE_URL", runtimeUrl.href);
      vi.stubEnv("INVENTORY_RUNTIME_ROLE", role);
      vi.resetModules();
      runtime = (await import("./db")).getPool();
      const activePool = runtime;
      const identities = await Promise.all([
        activePool.query("SELECT current_user AS actor").then((result) => result.rows[0].actor),
        new Promise<string>((resolve, reject) => {
          activePool.query("SELECT current_user AS actor", (error, result) => {
            if (error) reject(error);
            else resolve(result.rows[0].actor);
          });
        }),
        new Promise<string>((resolve, reject) => {
          activePool.connect((error, client, release) => {
            if (error || !client) return reject(error ?? new Error("Missing client"));
            client.query("SELECT current_user AS actor").then(
              (result) => {
                release();
                resolve(result.rows[0].actor);
              },
              (queryError) => {
                release();
                reject(queryError);
              },
            );
          });
        }),
      ]);
      expect(identities).toEqual([role, role, role]);
    } finally {
      if (runtime) await runtime.end();
      await owner.query(`DROP OWNED BY ${role}`).catch(() => {});
      await owner.query(`DROP ROLE IF EXISTS ${role}`);
      await owner.end();
    }
  });
});
