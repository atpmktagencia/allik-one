import { describe, expect, it, vi } from "vitest";
import {
  authenticate,
  can,
  canAccessAllUnits,
  hashPassword,
  isPreviewLoginDisabled,
  verifyPassword,
  type AuthContext,
} from "@/server/auth";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const query = vi.hoisted(() => vi.fn());
vi.mock("@/server/db", () => ({ getPool: () => ({ query }) }));
const context = (role: AuthContext["role"], unitIds = ["unit-fortaleza"]): AuthContext => ({
  user: { id: "user-1", name: "Pessoa", email: "pessoa@example.test" },
  membershipId: "membership-1",
  organizationId: "organization-1",
  role,
  unitIds,
  preview: false,
  integration: null,
});

describe("pilot authentication and authorization", () => {
  it("disables Preview login only inside a Vercel Preview deployment", () => {
    vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isPreviewLoginDisabled()).toBe(true);

    vi.stubEnv("INVENTORY_ENVIRONMENT", "production");
    expect(isPreviewLoginDisabled()).toBe(false);
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPreviewLoginDisabled()).toBe(false);
    vi.unstubAllEnvs();
  });
  it("grants the isolated Preview operator without an application cookie", async () => {
    vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");

    const authenticated = await authenticate(new Request("https://preview.example.test/api"));

    expect(authenticated).toMatchObject({
      user: { name: "Operador do Preview" },
      role: "SUPER_ADMIN",
      preview: true,
    });
    vi.unstubAllEnvs();
  });
  it("prefers an individual session over the automatic Preview operator", async () => {
    vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "user-marcos",
          name: "Marcos",
          email: "marcos@example.test",
          membership_id: "membership-marcos",
          organization_id: "organization-allik",
          role: "PARTNER_ADMIN",
          unit_ids: ["unit-fortaleza", "unit-juazeiro"],
        },
      ],
    });

    const authenticated = await authenticate(
      new Request("https://preview.example.test/api", {
        headers: { cookie: "allik_inventory_session=individual-session-token" },
      }),
    );

    expect(authenticated).toMatchObject({
      user: { id: "user-marcos", name: "Marcos" },
      role: "PARTNER_ADMIN",
      preview: false,
    });
    vi.unstubAllEnvs();
  });
  it("does not restore the automatic Preview operator after explicit logout", async () => {
    vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");

    const authenticated = await authenticate(
      new Request("https://preview.example.test/api", {
        headers: { cookie: "allik_inventory_preview_opt_out=1" },
      }),
    );

    expect(authenticated).toBeNull();
    vi.unstubAllEnvs();
  });
  it("keeps application login enabled when Preview data is not explicitly synthetic", () => {
    vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "pilot");
    expect(isPreviewLoginDisabled()).toBe(false);
    vi.unstubAllEnvs();
  });
  it("hashes passwords with a random salt and verifies without storing plaintext", async () => {
    const first = await hashPassword("uma-senha-forte-123");
    const second = await hashPassword("uma-senha-forte-123");
    expect(first).not.toBe(second);
    expect(first).not.toContain("uma-senha-forte-123");
    await expect(verifyPassword("uma-senha-forte-123", first)).resolves.toBe(true);
    await expect(verifyPassword("senha-incorreta-123", first)).resolves.toBe(false);
  });
  it("enforces role and unit together", () => {
    expect(can(context("INVENTORY_MANAGER"), "inventory.adjust", "unit-fortaleza")).toBe(true);
    expect(can(context("INVENTORY_MANAGER"), "patients.read", "unit-fortaleza")).toBe(true);
    expect(can(context("INVENTORY_MANAGER"), "patients.private.read", "unit-fortaleza")).toBe(
      false,
    );
    expect(can(context("INVENTORY_MANAGER"), "patients.clinical.manage", "unit-fortaleza")).toBe(
      false,
    );
    expect(can(context("UNIT_MANAGER"), "patients.private.read", "unit-fortaleza")).toBe(false);
    expect(can(context("INVENTORY_MANAGER"), "inventory.adjust", "unit-juazeiro")).toBe(false);
    expect(can(context("FINANCE"), "inventory.adjust", "unit-fortaleza")).toBe(false);
    expect(can(context("VIEWER"), "inventory.receive", "unit-fortaleza")).toBe(false);
    expect(can(context("SUPER_ADMIN", []), "inventory.adjust", "unit-juazeiro")).toBe(true);
    expect(canAccessAllUnits(context("SUPER_ADMIN", []))).toBe(true);
    expect(canAccessAllUnits(context("PARTNER_ADMIN"))).toBe(false);
  });
  it("limits an integration even when its technical role is super admin", () => {
    const integration = {
      ...context("SUPER_ADMIN", []),
      integration: {
        id: "credential-1",
        name: "Codex",
        permissions: ["inventory.read", "inventory.catalog.manage"] as const,
      },
    } satisfies AuthContext;
    expect(can(integration, "inventory.catalog.manage")).toBe(true);
    expect(can(integration, "inventory.adjust")).toBe(false);
    expect(can(integration, "users.manage")).toBe(false);
  });
});
