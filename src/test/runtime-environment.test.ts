import { describe, expect, it } from "vitest";
import { runtimeEnvironmentProblem } from "../server/db";

const base = {
  INVENTORY_RUNTIME_ROLE: "allik_runtime",
  DATABASE_URL: "postgres://allik_runtime:secret@db.example/neondb",
};

describe("production runtime database environment", () => {
  it("accepts the restricted runtime identity", () => {
    expect(runtimeEnvironmentProblem({ ...base })).toBeNull();
    expect(
      runtimeEnvironmentProblem({
        ...base,
        POSTGRES_URL: "postgres://allik_runtime:secret@db.example/neondb",
        PGUSER: "allik_runtime",
      }),
    ).toBeNull();
  });
  it("rejects missing role, owner URLs, maintenance credentials and owner aliases", () => {
    expect(runtimeEnvironmentProblem({ DATABASE_URL: base.DATABASE_URL })).toMatch(/required/);
    expect(
      runtimeEnvironmentProblem({
        ...base,
        DATABASE_URL: "postgres://neondb_owner:x@db.example/neondb",
      }),
    ).toMatch(/runtime role/);
    expect(
      runtimeEnvironmentProblem({ ...base, DATABASE_ADMIN_URL: "postgres://owner:x@db/neondb" }),
    ).toMatch(/Maintenance/);
    expect(
      runtimeEnvironmentProblem({
        ...base,
        DATABASE_URL_UNPOOLED: "postgres://neondb_owner:x@db.example/neondb",
      }),
    ).toMatch(/DATABASE_URL_UNPOOLED/);
    expect(runtimeEnvironmentProblem({ ...base, PGUSER: "neondb_owner" })).toMatch(/PGUSER/);
  });
});
