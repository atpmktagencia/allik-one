import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewLogin } from "@/server/auth";
import { receivingResponse } from "@/server/receiving";
import { purchasingResponse } from "@/server/purchases";
import { purchaseInput } from "@/data/purchase-input";

const db = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/server/db", () => ({ getPool: () => ({ connect: db.connect, query: db.query }) }));
const origin = "http://localhost:4317";
const input = {
  operationId: "11111111-1111-4111-8111-111111111111",
  supplier: "Fornecedor de teste",
  reference: "PO-42",
  locationId: "22222222-2222-4222-8222-222222222222",
  items: [
    {
      productId: "33333333-3333-4333-8333-333333333333",
      lot: "L1",
      expiry: "2099-01-01",
      quantity: "2.125",
      unitCost: "10.50",
    },
  ],
};
let cookie: string;
afterEach(() => vi.unstubAllEnvs());
const request = (body: unknown = input, extra: Record<string, string> = {}) =>
  new Request(`${origin}/api/v1/inventory/receipts`, {
    method: "POST",
    headers: { origin, cookie, "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("INVENTORY_ENVIRONMENT", "test");
  vi.stubEnv("INVENTORY_PREVIEW_PASSWORD", "synthetic-test-password");
  vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-test-session-secret-32-characters");
  const login = await previewLogin(
    new Request(`${origin}/api/inventory-session`, {
      method: "POST",
      headers: { origin },
      body: JSON.stringify({ password: "synthetic-test-password" }),
    }),
  );
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  db.connect.mockResolvedValue(db);
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes(" AS today")) return { rows: [{ today: "2026-01-01" }], rowCount: 1 };
    if (sql.includes("unit_cost::text"))
      return {
        rows: [
          {
            id: "lot-id",
            status: "AVAILABLE",
            expiry: "2099-01-01",
            supplier: input.supplier,
            cost: "10.5000",
          },
        ],
        rowCount: 1,
      };
    return { rows: [{ id: "id" }], rowCount: 1 };
  });
});
describe("Receipt API", () => {
  it("denies unauthenticated and cross-origin writes before opening the database", async () => {
    expect((await receivingResponse(request(input, { cookie: "" }))).status).toBe(401);
    expect(
      (await receivingResponse(request(input, { origin: "https://other.invalid" }))).status,
    ).toBe(403);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it("rejects zero quantities and impossible dates", async () => {
    for (const item of [
      { ...input.items[0], quantity: "0" },
      { ...input.items[0], expiry: "2026-02-30" },
    ])
      expect((await receivingResponse(request({ ...input, items: [item] }))).status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it("commits every line and records the actor from the server", async () => {
    const response = await receivingResponse(
      request({ ...input, items: [input.items[0], input.items[0]] }),
    );
    expect(response.status).toBe(201);
    const movements = db.query.mock.calls.filter(([sql]) =>
      sql.startsWith("INSERT INTO inventory_movements"),
    );
    expect(movements).toHaveLength(2);
    expect(movements[0]![0]).toContain("actor_user_id");
    expect(movements[0]![1]).toEqual([
      "lot-id",
      input.locationId,
      "2.125",
      "preview-operator",
      null,
      "PO-42",
      `${input.operationId}:0`,
    ]);
    expect(db.query).toHaveBeenLastCalledWith("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
  });
  it("rolls back the whole receipt when a later line fails", async () => {
    const response = await receivingResponse(
      request({ ...input, items: [input.items[0], { ...input.items[0], expiry: "2020-01-01" }] }),
    );
    expect(response.status).toBe(409);
    expect(db.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(db.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
    expect(db.release).toHaveBeenCalledOnce();
  });
  it("returns a replay without inserting movements for a committed identical request", async () => {
    let hash = "";
    db.query.mockImplementation(async (sql: string, params?: string[]) => {
      if (sql.startsWith("INSERT INTO inventory_receipts")) {
        hash = params![1]!;
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ request_hash: hash }], rowCount: 1 };
    });
    const response = await receivingResponse(request());
    expect((await response.json()).data.replayed).toBe(true);
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO inventory_movements")),
    ).toBe(false);
  });
  it("rejects reusing the same operation key with different content", async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.startsWith("INSERT INTO inventory_receipts")
        ? { rows: [], rowCount: 0 }
        : { rows: [{ request_hash: "different" }], rowCount: 1 },
    );
    expect((await receivingResponse(request())).status).toBe(409);
    expect(db.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it("rejects a purchase link without corresponding item links", async () => {
    expect(
      (await receivingResponse(request({ ...input, purchaseId: input.operationId }))).status,
    ).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it("rolls back a receipt that exceeds the remaining purchase quantity", async () => {
    const fallback = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FOR NO KEY UPDATE OF p"))
        return {
          rows: [{ reference: input.reference, supplier: input.supplier, active: true }],
          rowCount: 1,
        };
      if (sql.startsWith("UPDATE inventory_purchase_items")) return { rows: [], rowCount: 0 };
      return fallback(sql, params);
    });
    const response = await receivingResponse(
      request({
        ...input,
        purchaseId: input.operationId,
        items: [{ ...input.items[0], purchaseItemId: input.locationId }],
      }),
    );
    expect(response.status).toBe(409);
    expect(db.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO inventory_movements")),
    ).toBe(false);
  });
});

describe("Purchase API", () => {
  const order = {
    id: input.operationId,
    reference: "PO-42",
    supplierId: input.locationId,
    items: [{ productId: input.items[0]!.productId, quantity: "10", unitCost: "10.5" }],
  };
  it("rejects duplicate products and invalid quantities before saving an order", async () => {
    expect(
      purchaseInput.safeParse({ ...order, items: [order.items[0], order.items[0]] }).success,
    ).toBe(false);
    expect(
      (
        await purchasingResponse(
          request({ ...order, items: [{ ...order.items[0], quantity: "0" }] }),
          "purchases",
        )
      ).status,
    ).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it("creates a purchase without changing inventory", async () => {
    expect((await purchasingResponse(request(order), "purchases")).status).toBe(201);
    expect(db.query).toHaveBeenLastCalledWith("COMMIT");
    expect(db.query.mock.calls.some(([sql]) => sql.includes("inventory_movements"))).toBe(false);
  });
  it("requires authentication and same-origin access for supplier creation", async () => {
    expect(
      (
        await purchasingResponse(
          request({ id: input.operationId, name: "Teste" }, { cookie: "" }),
          "suppliers",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await purchasingResponse(
          request({ id: input.operationId, name: "Teste" }, { origin: "https://other.invalid" }),
          "suppliers",
        )
      ).status,
    ).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});
