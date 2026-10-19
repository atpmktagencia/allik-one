import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fullPreviewOperatorEnabled,
  previewOperatorIdentity,
  sharedPreviewBoundaryEnabled,
  sharedPreviewBoundaryProblem,
  sharedPreviewRuntimeRoleState,
} from "@/lib/preview-operator-policy";
import { authenticate, can, hasPreviewSession, previewLogin, sessionResponse } from "@/server/auth";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const query = vi.hoisted(() => vi.fn());
vi.mock("@/server/db", () => ({ getPool: () => ({ query }) }));
const allowed = {
  INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS: "true",
  INVENTORY_PREVIEW_DATA_CLASSIFICATION: "synthetic",
  INVENTORY_ENVIRONMENT: "preview",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feature/allik-patients",
  DATABASE_URL:
    "postgres://allik_runtime@ep-hidden-cloud-b6hskjjt.c-2.sa-east-1.aws.neon.tech/neondb",
};
function environment() {
  for (const [key, value] of Object.entries(allowed)) vi.stubEnv(key, value);
  vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
}
afterEach(() => {
  vi.unstubAllEnvs();
  query.mockReset();
});
describe("synthetic shared Preview operator", () => {
  it("classifies only public runtime-role matches without disclosing actual identities or URL values", () => {
    expect(sharedPreviewRuntimeRoleState(allowed)).toEqual({
      expectedRoleIsAllikRuntime: true,
      urlUserIsAllikRuntime: true,
      pgUserIsAllikRuntime: false,
    });
    const state = sharedPreviewRuntimeRoleState({
      ...allowed,
      INVENTORY_RUNTIME_ROLE: "secret-expected-role",
      PGUSER: "secret-pg-user",
      DATABASE_URL:
        "postgres://secret-url-user:secret-password@secret-host/secret-db?secret-param=secret-value",
    });
    expect(state).toEqual({
      expectedRoleIsAllikRuntime: false,
      urlUserIsAllikRuntime: false,
      pgUserIsAllikRuntime: false,
    });
    expect(Object.values(state).every((value) => typeof value === "boolean")).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/secret|postgres|neon\.tech/);
    expect(
      sharedPreviewRuntimeRoleState({
        DATABASE_URL: "invalid-secret-url",
        INVENTORY_RUNTIME_ROLE: " allik_runtime ",
        PGUSER: "allik_runtime",
      }),
    ).toEqual({
      expectedRoleIsAllikRuntime: true,
      urlUserIsAllikRuntime: false,
      pgUserIsAllikRuntime: true,
    });
  });
  it("adds only role-match booleans to the runtime-user warning and continues denying access", async () => {
    environment();
    vi.stubEnv("INVENTORY_RUNTIME_ROLE", "secret-configured-role");
    vi.stubEnv("PGUSER", "secret-pg-user");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.resetModules();
      const isolatedAuth = await import("@/server/auth");
      const response = await isolatedAuth.sessionResponse(
        new Request("https://preview.example.test/api/inventory-session"),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Sessão inválida ou expirada." });
      expect(warning.mock.calls).toEqual([
        [
          "SHARED_PREVIEW_ACCESS_DENIED",
          "PREVIEW_BOUNDARY_RUNTIME_USER",
          {
            expectedRoleIsAllikRuntime: false,
            urlUserIsAllikRuntime: true,
            pgUserIsAllikRuntime: false,
          },
        ],
      ]);
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/secret|postgres|neon\.tech/);
      expect(query).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("returns only fixed boundary reason codes without connection credentials, parameter keys or values", () => {
    const cases = [
      [
        { INVENTORY_PREVIEW_DATA_CLASSIFICATION: "secret-classification" },
        "PREVIEW_BOUNDARY_CLASSIFICATION",
      ],
      [{ DATABASE_URL: "invalid-secret-url" }, "PREVIEW_BOUNDARY_URL_PARSE"],
      [
        { DATABASE_URL: "https://secret-user:secret-password@secret-host/neondb" },
        "PREVIEW_BOUNDARY_URL_PROTOCOL",
      ],
      [
        { DATABASE_URL: allowed.DATABASE_URL + "?secret-param-key=secret-param-value" },
        "PREVIEW_BOUNDARY_PARAMETERS",
      ],
      [{ VERCEL_ENV: "production" }, "PREVIEW_BOUNDARY_DEPLOYMENT_ENV"],
      [{ INVENTORY_ENVIRONMENT: "production" }, "PREVIEW_BOUNDARY_APPLICATION_ENV"],
      [{ VERCEL_GIT_COMMIT_REF: "secret-branch" }, "PREVIEW_BOUNDARY_BRANCH"],
      [
        {
          DATABASE_URL: allowed.DATABASE_URL.replace(
            "allik_runtime@",
            "secret-user:secret-password@",
          ),
        },
        "PREVIEW_BOUNDARY_RUNTIME_USER",
      ],
      [
        { DATABASE_URL: "postgres://allik_runtime:secret-password@secret-host/neondb" },
        "PREVIEW_BOUNDARY_HOST",
      ],
      [
        { DATABASE_URL: allowed.DATABASE_URL.replace("/neondb", ":5433/neondb") },
        "PREVIEW_BOUNDARY_PORT",
      ],
      [
        { DATABASE_URL: allowed.DATABASE_URL.replace("/neondb", "/secret-database") },
        "PREVIEW_BOUNDARY_DATABASE",
      ],
    ] as const;
    expect(sharedPreviewBoundaryProblem(allowed)).toBeNull();
    for (const [override, code] of cases) {
      const env = { ...allowed, ...override };
      const problem = sharedPreviewBoundaryProblem(env);
      expect(problem).toBe(code);
      expect(problem).not.toMatch(/secret|postgres|neon\.tech/);
      expect(sharedPreviewBoundaryEnabled(env)).toBe(false);
    }
    const local = {
      NODE_ENV: "test",
      INVENTORY_ENVIRONMENT: "test",
      INVENTORY_PREVIEW_DATA_CLASSIFICATION: "synthetic",
      DATABASE_URL: "postgres://local@127.0.0.1/allik_test",
    };
    expect(sharedPreviewBoundaryProblem(local)).toBeNull();
    expect(sharedPreviewBoundaryProblem({ ...local, NODE_ENV: "production" })).toBe(
      "PREVIEW_BOUNDARY_LOCAL",
    );
    expect(sharedPreviewBoundaryEnabled(allowed)).toBe(true);
  });
  it("logs a fixed boundary reason once for denied full-operator Preview sessions and keeps the response generic", async () => {
    environment();
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "secret-classification");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://secret-user:secret-password@secret-host/secret-database?secret-param=secret-value",
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let index = 0; index < 2; index++) {
        const response = await sessionResponse(
          new Request("https://preview.example.test/api/inventory-session"),
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Sessão inválida ou expirada." });
      }
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0]).toEqual([
        "SHARED_PREVIEW_ACCESS_DENIED",
        "PREVIEW_BOUNDARY_CLASSIFICATION",
      ]);
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/secret|postgres|neon\.tech/);
      expect(query).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("requires every explicit deployment, data classification, branch and database boundary", () => {
    expect(fullPreviewOperatorEnabled(allowed)).toBe(true);
    expect(
      fullPreviewOperatorEnabled({
        ...allowed,
        DATABASE_URL: allowed.DATABASE_URL.replace(".c-2", "-pooler.c-2"),
      }),
    ).toBe(true);
    for (const key of Object.keys(allowed))
      expect(fullPreviewOperatorEnabled({ ...allowed, [key]: undefined })).toBe(false);
    for (const override of [
      { VERCEL_ENV: "production" },
      { INVENTORY_ENVIRONMENT: "production" },
      { INVENTORY_PREVIEW_DATA_CLASSIFICATION: "real" },
      { VERCEL_GIT_COMMIT_REF: "main" },
      { DATABASE_URL: "postgres://synthetic@production.example.test/neondb" },
      { DATABASE_URL: allowed.DATABASE_URL.replace("/neondb", "/other") },
      { DATABASE_URL: allowed.DATABASE_URL + "?host=production.example.test" },
      { DATABASE_URL: allowed.DATABASE_URL + "?user=neondb_owner" },
      { DATABASE_URL: allowed.DATABASE_URL + "?options=endpoint%3Dep-production" },
    ])
      expect(fullPreviewOperatorEnabled({ ...allowed, ...override })).toBe(false);
  });
  it("uses only the reserved fictitious actor and grants clinical and organization-wide admin capabilities", async () => {
    environment();
    query.mockResolvedValue({ rows: [{ registry_state: "OK" }] });
    const auth = await authenticate(new Request("https://preview.example.test/api"));
    expect(auth).toMatchObject({
      user: { id: previewOperatorIdentity.id, name: previewOperatorIdentity.name },
      role: "SUPER_ADMIN",
      sharedPreviewOperator: true,
      preview: false,
    });
    expect(query.mock.calls[0]?.[1]).toEqual([
      previewOperatorIdentity.id,
      previewOperatorIdentity.membershipId,
      previewOperatorIdentity.organizationId,
      previewOperatorIdentity.email,
      previewOperatorIdentity.name,
      previewOperatorIdentity.councilNumber,
    ]);
    expect(can(auth!, "patients.clinical.manage", "any-unit")).toBe(true);
    expect(can(auth!, "patients.private.read", "any-unit")).toBe(true);
    expect(can(auth!, "users.manage", "any-unit")).toBe(true);
  });
  it("fails closed for a missing or invalid reserved actor", async () => {
    environment();
    query.mockResolvedValue({ rows: [] });
    expect(await authenticate(new Request("https://preview.example.test/api"))).toBeNull();
    query.mockResolvedValue({ rows: [{ registry_state: "DUPLICATE" }] });
    expect(await authenticate(new Request("https://preview.example.test/api"))).toBeNull();
  });
  it("retains the restricted Preview behavior without the explicit flag", async () => {
    environment();
    vi.stubEnv("INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS", "false");
    expect(await authenticate(new Request("https://preview.example.test/api"))).toMatchObject({
      preview: true,
      user: { id: null },
    });
    expect(query).not.toHaveBeenCalled();
  });
  it("never authenticates the shared actor in production even if the flag leaks", async () => {
    environment();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await authenticate(new Request("https://production.example.test/api"))).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects password-only login, existing cookies, automatic login and the legacy fallback when any deployed boundary changes", async () => {
    environment();
    vi.stubEnv("INVENTORY_PREVIEW_PASSWORD", "synthetic-test-password");
    vi.stubEnv("INVENTORY_SESSION_SECRET", "s".repeat(40));
    const loginRequest = () =>
      new Request("https://preview.example.test/api/inventory-session", {
        method: "POST",
        headers: { origin: "https://preview.example.test", "Content-Type": "application/json" },
        body: JSON.stringify({ password: "synthetic-test-password" }),
      });
    const initial = await previewLogin(loginRequest());
    expect(initial.status).toBe(200);
    const cookie = initial.headers.get("set-cookie")!.split(";")[0]!;
    const authenticatedRequest = () =>
      new Request("https://preview.example.test/api", { headers: { cookie } });
    expect(hasPreviewSession(authenticatedRequest())).toBe(true);
    for (const [key, value] of [
      ["INVENTORY_PREVIEW_DATA_CLASSIFICATION", "pilot"],
      ["INVENTORY_PREVIEW_DATA_CLASSIFICATION", ""],
      ["VERCEL_ENV", "production"],
      ["INVENTORY_ENVIRONMENT", "production"],
      ["VERCEL_GIT_COMMIT_REF", "main"],
      ["INVENTORY_RUNTIME_ROLE", "wrong_role"],
      ["DATABASE_URL", "postgres://restricted@production.example.test/neondb"],
    ]) {
      environment();
      vi.stubEnv(key!, value!);
      expect((await previewLogin(loginRequest())).status).toBe(503);
      expect(hasPreviewSession(authenticatedRequest())).toBe(false);
      expect(await authenticate(authenticatedRequest())).toBeNull();
      expect(await authenticate(new Request("https://preview.example.test/api"))).toBeNull();
      vi.stubEnv("INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS", "false");
      expect(await authenticate(authenticatedRequest())).toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
  });
  it("allows synthetic local disposable test databases but never deployed/local production or a remote database", () => {
    const local = {
      NODE_ENV: "test",
      INVENTORY_ENVIRONMENT: "test",
      INVENTORY_PREVIEW_DATA_CLASSIFICATION: "synthetic",
      DATABASE_URL: "postgres://restricted@127.0.0.1/allik_test",
    };
    expect(sharedPreviewBoundaryEnabled(local)).toBe(true);
    for (const override of [
      { NODE_ENV: "production" },
      { VERCEL_ENV: "production" },
      { VERCEL: "1" },
      { DATABASE_URL: "postgres://restricted@127.0.0.1/allik" },
      { DATABASE_URL: "postgres://restricted@production.example.test/allik_test" },
      { INVENTORY_PREVIEW_DATA_CLASSIFICATION: undefined },
    ])
      expect(sharedPreviewBoundaryEnabled({ ...local, ...override })).toBe(false);
  });
  it("still routes individual credentials to individual authentication outside the shared boundary", async () => {
    environment();
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "pilot");
    // Invalid individual credentials receive the individual validation result, never a Preview cookie.
    const response = await sessionResponse(
      new Request("https://preview.example.test/api/inventory-session", {
        method: "POST",
        headers: { origin: "https://preview.example.test", "Content-Type": "application/json" },
        body: JSON.stringify({ email: "individual@example.test", password: 123 }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
