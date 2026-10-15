import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb, getPool } from "./db";
import { previewLogin } from "./auth";
import { catalogResponse } from "./catalog";
import { inventoryResponse } from "./inventory";
import { receivingResponse } from "./receiving";
import { purchasingResponse } from "./purchases";
import type { CatalogProduct, CatalogLocation } from "../data/catalog-input";

const origin = "http://localhost:4317";
let cookie = "";
beforeAll(async () => {
  const url = new URL(process.env["DATABASE_URL"] ?? "postgres://invalid");
  if (!url.pathname.endsWith("_test"))
    throw new Error("Catalog tests require a dedicated *_test database.");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  process.env["INVENTORY_PREVIEW_PASSWORD"] = "synthetic-test-password";
  process.env["INVENTORY_SESSION_SECRET"] = "synthetic-test-session-secret-32-characters";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  const response = await previewLogin(
    new Request(`${origin}/api/inventory-session`, {
      method: "POST",
      headers: { origin },
      body: JSON.stringify({ password: "synthetic-test-password" }),
    }),
  );
  cookie = response.headers.get("set-cookie")!.split(";")[0]!;
});
afterAll(async () => {
  await getPool().end();
});
function request(path: string, body?: unknown) {
  return new Request(
    `${origin}/api/v1/inventory/${path}`,
    body === undefined
      ? { headers: { cookie } }
      : {
          method: "POST",
          headers: { origin, cookie, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
const write = (kind: "products" | "locations", body: unknown) =>
  catalogResponse(request(`catalog/${kind}`, body), kind);
function productInput() {
  return {
    action: "CREATE",
    operationId: randomUUID(),
    id: randomUUID(),
    name: `Produto ${randomUUID()}`,
    sku: `SKU-${randomUUID()}`,
    category: "Material",
    unit: "un",
    minimum: "1.125",
  };
}
async function product() {
  const response = await write("products", productInput());
  expect(response.status).toBe(201);
  return (await response.json()).data.item as CatalogProduct;
}
async function location() {
  const response = await write("locations", {
    action: "CREATE",
    operationId: randomUUID(),
    id: randomUUID(),
    name: `Local ${randomUUID()}`,
  });
  expect(response.status).toBe(201);
  return (await response.json()).data.item as CatalogLocation;
}
function update(item: CatalogProduct | CatalogLocation, changes: Record<string, unknown> = {}) {
  return {
    action: "UPDATE",
    operationId: randomUUID(),
    id: item.id,
    version: item.version,
    name: item.name,
    active: item.active,
    reason: "Alteração sintética de cadastro",
    ...("sku" in item ? { category: item.category, minimum: item.minimum } : {}),
    ...changes,
  };
}
async function history(kind: "PRODUCT" | "LOCATION", id: string) {
  const response = await catalogResponse(
    request(`catalog/history?resource=${kind}&itemId=${id}`),
    "history",
  );
  expect(response.status).toBe(200);
  return (await response.json()).data as {
    id: string;
    actor: string;
    before: CatalogProduct | CatalogLocation | null;
    after: CatalogProduct | CatalogLocation;
  }[];
}
function receipt(p: CatalogProduct, l: CatalogLocation) {
  return {
    operationId: randomUUID(),
    reference: `RC-${randomUUID()}`,
    supplier: "Fornecedor sintético",
    locationId: l.id,
    items: [
      {
        productId: p.id,
        lot: `CAT-${randomUUID()}`,
        expiry: "2099-01-01",
        quantity: "2.125",
        unitCost: "4.8",
      },
    ],
  };
}

describe("PostgreSQL catalog", () => {
  it("creates selectable records with zero stock and an audit that preserves exact minimum", async () => {
    const p = await product();
    const l = await location();
    expect(p).toMatchObject({ minimum: "1.125", active: true, stockControlled: true, version: 0 });
    const products = await inventoryResponse(request(`products/${p.id}`));
    expect((await products.json()).data).toEqual(expect.objectContaining({ id: p.id }));
    const stock = await inventoryResponse(request(`stock?productId=${p.id}`));
    expect((await stock.json()).data).toEqual([]);
    const events = await history("PRODUCT", p.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "preview-operator", before: null, after: p });
    expect(await history("LOCATION", l.id)).toHaveLength(1);
  });
  it("serializes concurrent retries and rejects reusing an operation with changed content", async () => {
    const input = productInput();
    const responses = await Promise.all([write("products", input), write("products", input)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await history("PRODUCT", input.id)).toHaveLength(1);
    expect((await write("products", { ...input, name: "Outro nome" })).status).toBe(409);
    expect(await history("PRODUCT", input.id)).toHaveLength(1);
  });
  it("protects SKU and location uniqueness regardless of letter case, without extra audit", async () => {
    const p = await product();
    const l = await location();
    const duplicate = { ...productInput(), sku: p.sku.toLowerCase() };
    expect((await write("products", duplicate)).status).toBe(409);
    expect(await history("PRODUCT", duplicate.id)).toEqual([]);
    const duplicateLocation = {
      action: "CREATE",
      operationId: randomUUID(),
      id: randomUUID(),
      name: l.name.toUpperCase(),
    };
    expect((await write("locations", duplicateLocation)).status).toBe(409);
    expect(await history("LOCATION", duplicateLocation.id)).toEqual([]);
  });
  it("records before and after once and replays the original edit even after a subsequent edit", async () => {
    const p = await product();
    const change = update(p, { name: "Produto revisado", minimum: "4.250" });
    const first = await write("products", change);
    expect(first.status).toBe(200);
    const revised = (await first.json()).data.item as CatalogProduct;
    expect((await write("products", update(revised, { name: "Produto final" }))).status).toBe(200);
    const replay = await write("products", change);
    expect((await replay.json()).data).toEqual({ item: revised, replayed: true });
    const events = await history("PRODUCT", p.id);
    expect(events).toHaveLength(3);
    expect(events.find((e) => e.id === change.operationId)).toMatchObject({
      before: p,
      after: revised,
    });
    expect(revised).toMatchObject({ sku: p.sku, unit: p.unit, minimum: "4.250", version: 1 });
  });
  it("rejects stale simultaneous edits instead of overwriting the accepted version", async () => {
    const l = await location();
    const responses = await Promise.all([
      write("locations", update(l, { name: `${l.name} A` })),
      write("locations", update(l, { name: `${l.name} B` })),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const events = await history("LOCATION", l.id);
    expect(events).toHaveLength(2);
    expect(events[0]!.after.version).toBe(1);
    expect((await write("locations", update(l, { name: "Tentativa antiga" }))).status).toBe(409);
  });
  it("preserves physical ledger and refuses deactivation with blocked or expired stock", async () => {
    const p = await product();
    const l = await location();
    const body = receipt(p, l);
    expect((await receivingResponse(request("receipts", body))).status).toBe(201);
    const before = await getPool().query(
      "SELECT m.id,m.delta::text,b.quantity::text FROM inventory_movements m JOIN inventory_balances b ON b.lot_id=m.lot_id WHERE m.operation_key=$1",
      [`${body.operationId}:0`],
    );
    await getPool().query(
      "UPDATE inventory_lots SET status='BLOCKED',expires_on='2000-01-01' WHERE product_id=$1",
      [p.id],
    );
    for (const [kind, item] of [
      ["products", p],
      ["locations", l],
    ] as const)
      expect((await write(kind, update(item, { active: false }))).status).toBe(409);
    expect(
      (await write("products", update(p, { name: "Nome revisado com saldo", minimum: "8.000" })))
        .status,
    ).toBe(200);
    const after = await getPool().query(
      "SELECT m.id,m.delta::text,b.quantity::text FROM inventory_movements m JOIN inventory_balances b ON b.lot_id=m.lot_id WHERE m.operation_key=$1",
      [`${body.operationId}:0`],
    );
    expect(after.rows).toEqual(before.rows);
    expect(await history("PRODUCT", p.id)).toHaveLength(2);
    expect(await history("LOCATION", l.id)).toHaveLength(1);
  });
  it("rejects deactivation while purchases are pending even with zero physical balance", async () => {
    const p = await product();
    const supplierId = randomUUID();
    expect(
      (
        await purchasingResponse(
          request("suppliers", { id: supplierId, name: `Fornecedor ${supplierId}` }),
          "suppliers",
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await purchasingResponse(
          request("purchases", {
            id: randomUUID(),
            reference: `PO-${randomUUID()}`,
            supplierId,
            items: [{ productId: p.id, quantity: "1", unitCost: "2" }],
          }),
          "purchases",
        )
      ).status,
    ).toBe(201);
    const response = await write("products", update(p, { active: false }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("pendente");
    expect(await history("PRODUCT", p.id)).toHaveLength(1);
  });
  it("allows inactivation and reactivation of empty records while retaining history", async () => {
    for (const [kind, item] of [
      ["products", await product()],
      ["locations", await location()],
    ] as const) {
      const response = await write(kind, update(item, { active: false }));
      expect(response.status).toBe(200);
      const inactive = (await response.json()).data.item as CatalogProduct | CatalogLocation;
      const list = await catalogResponse(request(`catalog/${kind}`), kind);
      expect((await list.json()).data).toContainEqual(inactive);
      expect((await write(kind, update(inactive, { active: true }))).status).toBe(200);
      expect(await history(kind === "products" ? "PRODUCT" : "LOCATION", item.id)).toHaveLength(3);
    }
  });
  it("serializes deactivation against concurrent receipts so an inactive record never gains stock", async () => {
    for (const kind of ["products", "locations"] as const) {
      const p = await product();
      const l = await location();
      const item = kind === "products" ? p : l;
      const results = await Promise.all([
        write(kind, update(item, { active: false })),
        receivingResponse(request("receipts", receipt(p, l))),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(1);
      const state = await getPool().query(
        `SELECT active,COALESCE((SELECT sum(b.quantity) FROM inventory_balances b ${kind === "products" ? "JOIN inventory_lots l ON l.id=b.lot_id WHERE l.product_id=$1" : "WHERE b.location_id=$1"}),0)::text AS quantity FROM ${kind === "products" ? "inventory_products" : "inventory_locations"} WHERE id=$1`,
        [item.id],
      );
      expect(state.rows[0].active || Number(state.rows[0].quantity) === 0).toBe(true);
    }
  });
  it("rolls back the edited record when the audit insert fails and permits an unchanged retry", async () => {
    const p = await product();
    const body = update(p, { name: "Nome após recuperação" });
    await getPool()
      .query(`CREATE FUNCTION test_catalog_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END; $$;
      CREATE TRIGGER test_catalog_audit_failure BEFORE INSERT ON inventory_catalog_changes
      FOR EACH ROW WHEN (NEW.id='${body.operationId}'::uuid) EXECUTE FUNCTION test_catalog_audit_failure();`);
    try {
      const isolated = await write("products", body);
      expect(isolated.status).toBe(503);
      const row = await getPool().query("SELECT name,version FROM inventory_products WHERE id=$1", [
        p.id,
      ]);
      expect(row.rows[0]).toEqual({ name: p.name, version: p.version });
    } finally {
      await getPool().query(
        "DROP TRIGGER test_catalog_audit_failure ON inventory_catalog_changes; DROP FUNCTION test_catalog_audit_failure();",
      );
    }
    expect((await write("products", body)).status).toBe(200);
    expect(await history("PRODUCT", p.id)).toHaveLength(2);
  });
  it("rejects rewriting or deleting catalog audit rows", async () => {
    const p = await product();
    const [event] = await history("PRODUCT", p.id);
    await expect(
      getPool().query("UPDATE inventory_catalog_changes SET reason='Reescrita' WHERE id=$1", [
        event!.id,
      ]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query("DELETE FROM inventory_catalog_changes WHERE id=$1", [event!.id]),
    ).rejects.toThrow("append-only");
  });
  it("does not recreate a renamed seed location or reset edited product metadata on a later seed", async () => {
    const run = () =>
      promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/seed-inventory.ts"], {
        env: { ...process.env, INVENTORY_ALLOW_SEED: "true" },
        timeout: 10000,
      });
    await run();
    const l = (
      await getPool().query(
        "SELECT id,name,active,version FROM inventory_locations WHERE name='Almoxarifado'",
      )
    ).rows[0] as CatalogLocation;
    const p = (
      await getPool().query(
        "SELECT id,name,sku,category,unit,minimum::text,active,stock_controlled AS \"stockControlled\",version FROM inventory_products WHERE sku='ALLIK-003'",
      )
    ).rows[0] as CatalogProduct;
    expect((await write("locations", update(l, { name: "Almoxarifado revisado" }))).status).toBe(
      200,
    );
    expect(
      (await write("products", update(p, { name: "Material revisado", minimum: "75.125" }))).status,
    ).toBe(200);
    const counts = (
      await getPool().query(
        "SELECT (SELECT count(*) FROM inventory_locations) AS locations,(SELECT count(*) FROM inventory_movements) AS movements",
      )
    ).rows;
    await run();
    expect(
      (
        await getPool().query(
          "SELECT (SELECT count(*) FROM inventory_locations) AS locations,(SELECT count(*) FROM inventory_movements) AS movements",
        )
      ).rows,
    ).toEqual(counts);
    expect(
      (await getPool().query("SELECT name FROM inventory_locations WHERE id=$1", [l.id])).rows[0]
        .name,
    ).toBe("Almoxarifado revisado");
    expect(
      (
        await getPool().query("SELECT name,minimum::text FROM inventory_products WHERE id=$1", [
          p.id,
        ])
      ).rows[0],
    ).toEqual({ name: "Material revisado", minimum: "75.125" });
  });
});
