import { afterAll, describe, expect, it, vi } from "vitest";

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
    } finally {
      await pool.end();
    }
  });
});
