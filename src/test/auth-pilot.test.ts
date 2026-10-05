import { describe, expect, it, vi } from "vitest";
import { can, hashPassword, verifyPassword, type AuthContext } from "@/server/auth";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const context = (role: AuthContext["role"], unitIds = ["unit-fortaleza"]): AuthContext => ({
  user: { id: "user-1", name: "Pessoa", email: "pessoa@example.test" },
  membershipId: "membership-1",
  organizationId: "organization-1",
  role,
  unitIds,
  preview: false,
});

describe("pilot authentication and authorization", () => {
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
    expect(can(context("INVENTORY_MANAGER"), "inventory.adjust", "unit-juazeiro")).toBe(false);
    expect(can(context("FINANCE"), "inventory.adjust", "unit-fortaleza")).toBe(false);
    expect(can(context("VIEWER"), "inventory.receive", "unit-fortaleza")).toBe(false);
    expect(can(context("SUPER_ADMIN", []), "inventory.adjust", "unit-juazeiro")).toBe(true);
  });
});
