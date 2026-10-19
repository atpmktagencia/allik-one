import { afterEach, describe, expect, it, vi } from "vitest";
import { fullPreviewOperatorEnabled, previewOperatorIdentity } from "@/lib/preview-operator-policy";
import { authenticate, can } from "@/server/auth";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const query = vi.hoisted(() => vi.fn());
vi.mock("@/server/db", () => ({ getPool: () => ({ query }) }));
const allowed = {
  INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS: "true",
  INVENTORY_PREVIEW_DATA_CLASSIFICATION: "synthetic",
  INVENTORY_ENVIRONMENT: "preview",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feature/allik-patients",
  DATABASE_URL: "postgres://synthetic@ep-hidden-cloud-b6hskjjt.c-2.sa-east-1.aws.neon.tech/neondb",
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
});
