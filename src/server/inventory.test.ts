import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import { getDb, getPool } from "./db";
import { hasPreviewSession, previewLogin } from "./auth";
import { inventoryResponse } from "./inventory";
const origin = "http://localhost:4317";
let cookie = "";
beforeAll(async () => {
  const url = new URL(process.env["DATABASE_URL"] ?? "postgres://invalid");
  if (!url.pathname.endsWith("_test"))
    throw new Error("Integration tests require a dedicated *_test database.");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  process.env["INVENTORY_PREVIEW_PASSWORD"] = "synthetic-test-password";
  process.env["INVENTORY_SESSION_SECRET"] = "synthetic-test-session-secret-32-characters";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  const response = await previewLogin(
    new Request(`${origin}/api/inventory-session`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "synthetic-test-password" }),
    }),
  );
  cookie = response.headers.get("set-cookie")!.split(";")[0]!;
});
afterAll(async () => {
  await getPool().end();
});
async function fixture(quantity = "10", days = 90) {
  const product = await getPool().query(
    `INSERT INTO inventory_products(name,sku,category,unit) VALUES('Produto de teste',$1,'Material','un') RETURNING id`,
    [randomUUID()],
  );
  const location = await getPool().query(
    "INSERT INTO inventory_locations(name) VALUES($1) RETURNING id",
    [`Local ${randomUUID()}`],
  );
  const lot = await getPool().query(
    `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost) VALUES($1,$2,(NOW() AT TIME ZONE 'America/Fortaleza')::date + $3::integer,'Fornecedor sintético',2) RETURNING id`,
    [product.rows[0].id, randomUUID(), days],
  );
  const params = [lot.rows[0].id, location.rows[0].id];
  await movement(params, quantity, "IN");
  return { productId: product.rows[0].id as string, params };
}
function movement(params: unknown[], delta: string, type = "OUT") {
  return getPool().query(
    `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) VALUES($1,$2,$3,$4,'test-operator','TEST','Teste sintético',$5) RETURNING id`,
    [...params, type, delta, randomUUID()],
  );
}
const request = (resource: string) =>
  new Request(`${origin}/api/v1/inventory/${resource}`, { headers: { cookie } });
describe("Preview access", () => {
  it("denies unauthenticated inventory reads", async () => {
    expect((await inventoryResponse(new Request(`${origin}/api/v1/inventory/stock`))).status).toBe(
      401,
    );
  });
  it("rejects cross-origin login", async () => {
    expect(
      (
        await previewLogin(
          new Request(`${origin}/api/inventory-session`, {
            method: "POST",
            headers: { origin: "https://attacker.invalid" },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("rejects invalid password", async () => {
    expect(
      (
        await previewLogin(
          new Request(`${origin}/api/inventory-session`, {
            method: "POST",
            headers: { origin },
            body: JSON.stringify({ password: "wrong" }),
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("validates session signature and expiry", () => {
    expect(hasPreviewSession(request("stock"))).toBe(true);
    expect(
      hasPreviewSession(new Request(origin, { headers: { cookie: cookie + "tampered" } })),
    ).toBe(false);
    expect(hasPreviewSession(request("stock"), Date.now() + 9 * 60 * 60 * 1000)).toBe(false);
  });
  it("fails closed in production", () => {
    process.env["INVENTORY_ENVIRONMENT"] = "production";
    expect(hasPreviewSession(request("stock"))).toBe(false);
    process.env["INVENTORY_ENVIRONMENT"] = "test";
  });
});
describe("PostgreSQL ledger integrity", () => {
  it("projects balance and audit from a movement", async () => {
    const f = await fixture("12.125");
    const b = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(b.rows[0].quantity).toBe("12.125");
    const a = await getPool().query(
      "SELECT count(*)::int AS count FROM inventory_audit a JOIN inventory_movements m ON m.id=a.movement_id WHERE m.lot_id=$1",
      [f.params[0]],
    );
    expect(a.rows[0].count).toBe(1);
  });
  it("rejects insufficient stock without partial movement or audit", async () => {
    const f = await fixture();
    await expect(movement(f.params, "-11")).rejects.toThrow();
    const r = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(r.rows[0].quantity).toBe("10.000");
    const m = await getPool().query(
      "SELECT count(*)::int AS count FROM inventory_movements WHERE lot_id=$1",
      [f.params[0]],
    );
    expect(m.rows[0].count).toBe(1);
  });
  it("serializes concurrent withdrawals", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([movement(f.params, "-6"), movement(f.params, "-6")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const b = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(b.rows[0].quantity).toBe("4.000");
  });
  it("prevents edits and deletion of movements and audit", async () => {
    const f = await fixture();
    await expect(
      getPool().query("UPDATE inventory_movements SET delta=20 WHERE lot_id=$1", [f.params[0]]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query("DELETE FROM inventory_movements WHERE lot_id=$1", [f.params[0]]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query(
        "UPDATE inventory_audit SET action='OTHER' WHERE movement_id IN (SELECT id FROM inventory_movements WHERE lot_id=$1)",
        [f.params[0]],
      ),
    ).rejects.toThrow("append-only");
  });
  it("prevents arbitrary projection edits", async () => {
    const f = await fixture();
    await expect(
      getPool().query("UPDATE inventory_balances SET quantity=100 WHERE lot_id=$1", [f.params[0]]),
    ).rejects.toThrow("ledger projection");
  });
  it("rejects expired lot consumption", async () => {
    const f = await fixture("10", -1);
    await expect(movement(f.params, "-1")).rejects.toThrow("not available");
    const body = await (await inventoryResponse(request(`lots?productId=${f.productId}`))).json();
    expect(body.data[0].status).toBe("EXPIRED");
  });
  it("rejects repeated operation keys", async () => {
    const f = await fixture();
    const key = randomUUID();
    const sql = `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) VALUES($1,$2,'IN',2,'test','TEST','Teste',$3)`;
    await getPool().query(sql, [...f.params, key]);
    await expect(getPool().query(sql, [...f.params, key])).rejects.toThrow();
    const b = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(b.rows[0].quantity).toBe("12.000");
  });
  it("rolls back ledger, audit and balance together", async () => {
    const f = await fixture();
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) VALUES($1,$2,'IN',5,'test','TEST','Teste',$3)`,
        [...f.params, randomUUID()],
      );
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    const b = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(b.rows[0].quantity).toBe("10.000");
  });
});
describe("Inventory API", () => {
  it("returns real filtered stock without caching private responses", async () => {
    const f = await fixture("3");
    const response = await inventoryResponse(request(`stock?productId=${f.productId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].quantity).toBe(3);
  });
  it("returns not found instead of another product", async () => {
    expect((await inventoryResponse(request(`products/${randomUUID()}`))).status).toBe(404);
  });
  it("rejects malformed filters", async () => {
    expect((await inventoryResponse(request("stock?productId=invalid"))).status).toBe(400);
  });
  it("returns empty data for a valid unmatched filter", async () => {
    const body = await (await inventoryResponse(request(`stock?productId=${randomUUID()}`))).json();
    expect(body.data).toEqual([]);
  });
});
