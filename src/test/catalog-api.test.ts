import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogResponse } from "@/server/catalog";
import { previewLogin } from "@/server/auth";
import { productCatalogInput, locationCatalogInput } from "@/data/catalog-input";

const db = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/server/db", () => ({ getPool: () => db }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const origin = "http://localhost:4317";
async function cookie() {
  vi.stubEnv("INVENTORY_ENVIRONMENT", "test");
  vi.stubEnv("INVENTORY_PREVIEW_PASSWORD", "synthetic-test-password");
  vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-test-session-secret-32-characters");
  const response = await previewLogin(
    new Request(`${origin}/api/inventory-session`, {
      method: "POST",
      headers: { origin },
      body: JSON.stringify({ password: "synthetic-test-password" }),
    }),
  );
  return response.headers.get("set-cookie")!.split(";")[0]!;
}
const input = {
  action: "CREATE",
  operationId: "11111111-1111-4111-8111-111111111111",
  id: "22222222-2222-4222-8222-222222222222",
  name: "Produto novo",
  sku: "catalog-01",
  category: "Material",
  unit: "un",
  minimum: "1.125",
};
describe("Catalog authorization and input", () => {
  it("denies reads and writes without a session and denies cross-origin writes before using the database", async () => {
    for (const resource of ["products", "locations", "history"] as const)
      expect(
        (
          await catalogResponse(
            new Request(`${origin}/api/v1/inventory/catalog/${resource}`),
            resource,
          )
        ).status,
      ).toBe(401);
    const token = await cookie();
    const response = await catalogResponse(
      new Request(`${origin}/api/v1/inventory/catalog/products`, {
        method: "POST",
        headers: { cookie: token, origin: "https://other.invalid" },
        body: JSON.stringify(input),
      }),
      "products",
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.connect).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
  it("rejects invalid history filters and attempts to write history without using the database", async () => {
    const token = await cookie();
    expect(
      (
        await catalogResponse(
          new Request(
            `${origin}/api/v1/inventory/catalog/history?resource=PRODUCT&itemId=invalid`,
            { headers: { cookie: token } },
          ),
          "history",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await catalogResponse(
          new Request(`${origin}/api/v1/inventory/catalog/history`, {
            method: "POST",
            headers: { cookie: token, origin },
            body: "{}",
          }),
          "history",
        )
      ).status,
    ).toBe(405);
    expect(db.query).not.toHaveBeenCalled();
  });
  it("validates exact decimal limits and rejects injecting actor, unit or SKU into an edit", () => {
    for (const minimum of ["-1", "0.0001", "100000000000", "1e2", ""])
      expect(productCatalogInput.safeParse({ ...input, minimum }).success).toBe(false);
    expect(productCatalogInput.parse({ ...input, minimum: "0001.2" })).toMatchObject({
      sku: "CATALOG-01",
      minimum: "1.200",
    });
    const edit = {
      action: "UPDATE",
      operationId: input.operationId,
      id: input.id,
      name: input.name,
      category: input.category,
      minimum: "2",
      active: true,
      version: 0,
      reason: "Atualização sintética",
    };
    for (const extra of [
      { unit: "kit" },
      { sku: "OUTRO" },
      { actor: "administrator" },
      { stockControlled: false },
    ])
      expect(productCatalogInput.safeParse({ ...edit, ...extra }).success).toBe(false);
    expect(
      locationCatalogInput.safeParse({ ...edit, category: undefined, minimum: undefined }).success,
    ).toBe(false);
  });
});
