import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb, getPool } from "./db";
import { previewLogin } from "./auth";
import { supplierCatalogResponse } from "./supplier-catalog";
import { receivingResponse } from "./receiving";
import { purchasingResponse } from "./purchases";
import type { SupplierProfile, SupplierCatalogItem, SupplierOrder } from "../data/supplier-input";
const origin = "http://localhost:4317";
let cookie = "";
const request = (path: string, body?: unknown) =>
  new Request(
    `${origin}/api/v1/inventory/${path}`,
    body === undefined
      ? { headers: { cookie } }
      : {
          method: "POST",
          headers: { origin, cookie, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
const api = (path: string, body?: unknown) => supplierCatalogResponse(request(path, body));
const importer = () =>
  promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/import-essentia.ts"], {
    env: { ...process.env, INVENTORY_ALLOW_SEED: "true" },
    timeout: 15000,
  });
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Supplier tests require a dedicated *_test database.");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  process.env["INVENTORY_PREVIEW_PASSWORD"] = "synthetic-test-password";
  process.env["INVENTORY_SESSION_SECRET"] = "synthetic-test-session-secret-32-characters";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  const login = await previewLogin(
    new Request(`${origin}/api/inventory-session`, {
      method: "POST",
      headers: { origin },
      body: JSON.stringify({ password: "synthetic-test-password" }),
    }),
  );
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});
afterAll(async () => {
  await getPool().end();
});
async function supplier() {
  const r = await api("vendors", {
    action: "CREATE",
    operationId: randomUUID(),
    id: randomUUID(),
    name: `Fornecedor ${randomUUID()}`,
    phone: "+55 48 8802-9876",
    email: "",
    active: true,
  });
  expect(r.status).toBe(201);
  return (await r.json()).data.item as SupplierProfile;
}
async function entry(s: SupplierProfile, fields: Record<string, unknown> = {}) {
  const r = await api("vendor-catalog", {
    action: "CREATE",
    operationId: randomUUID(),
    id: randomUUID(),
    supplierId: s.id,
    code: `TEST-${randomUUID()}`,
    supplierSku: "",
    name: "Produto sintético + concentração",
    kind: "PRODUCT",
    description: "Composição literal do catálogo",
    packaging: "Conjunto de 2 boxes",
    contents: "20 ampolas",
    boxesPerPack: 2,
    price: "378.00",
    priceSource: "Cotação sintética",
    active: true,
    ...fields,
  });
  expect(r.status).toBe(201);
  return (await r.json()).data.item as SupplierCatalogItem;
}
function order(s: SupplierProfile, i: SupplierCatalogItem, quantity = 2) {
  return {
    operationId: randomUUID(),
    reference: `PO-${randomUUID()}`,
    supplierId: s.id,
    supplierVersion: s.version,
    freight: "24.90",
    notes: "Pedido sintético",
    items: [{ catalogItemId: i.id, quantity, version: i.version, expectedPrice: i.price }],
  };
}
function edit(i: SupplierCatalogItem, fields: Record<string, unknown> = {}) {
  return {
    action: "UPDATE",
    operationId: randomUUID(),
    id: i.id,
    supplierId: i.supplierId,
    code: i.code,
    supplierSku: i.supplierSku ?? "",
    name: i.name,
    kind: i.kind,
    description: i.description,
    packaging: i.packaging,
    contents: i.contents,
    boxesPerPack: i.boxesPerPack,
    price: i.price,
    priceSource: i.priceSource,
    active: i.active,
    version: i.version,
    reason: "Cotação sintética confirmada",
    ...fields,
  };
}
async function saved(id: string) {
  return (await (await api(`vendor-orders?id=${id}`)).json()).data as SupplierOrder;
}
async function ledger() {
  return (await getPool().query("SELECT count(*)::int AS count FROM inventory_movements")).rows[0]
    .count;
}

describe("supplier catalog and immutable commercial orders", () => {
  it("imports 388 entries without inventing official SKUs, prices or physical stock; preserves edits on reimport", async () => {
    const before = await ledger();
    await importer();
    const s = ((await (await api("vendors")).json()).data as SupplierProfile[]).find(
      (x) => x.name === "Essentia",
    )!;
    expect(s.phone).toBe("554888029876");
    const items = (await (await api(`vendor-catalog?supplierId=${s.id}`)).json())
      .data as SupplierCatalogItem[];
    expect(items).toHaveLength(388);
    expect(items.filter((i) => i.price === null)).toHaveLength(7);
    expect(items.every((i) => i.supplierSku === null && i.productId === null)).toBe(true);
    const group = items.find((i) => i.code === "ESS-P092")!;
    expect(group).toMatchObject({ boxesPerPack: 2, price: "378.00" });
    expect(
      (await api("vendor-catalog", edit(group, { price: "380.25", supplierSku: "OFFICIAL-092" })))
        .status,
    ).toBe(200);
    await importer();
    const changed = (
      (await (await api(`vendor-catalog?supplierId=${s.id}`)).json()).data as SupplierCatalogItem[]
    ).find((i) => i.id === group.id)!;
    expect(changed).toMatchObject({ price: "380.25", supplierSku: "OFFICIAL-092", version: 1 });
    expect(await ledger()).toBe(before);
  });
  it("serializes concurrent identical submissions, computes pack costs exactly and creates no stock until receiving", async () => {
    const s = await supplier(),
      i = await entry(s),
      body = order(s, i),
      before = await ledger();
    const results = await Promise.all([api("vendor-orders", body), api("vendor-orders", body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const snapshot = await saved(body.operationId);
    expect(snapshot).toMatchObject({
      subtotal: "756.00",
      freight: "24.90",
      total: "780.90",
      supplier: { phone: "554888029876" },
      items: [{ quantity: 2, boxes: 4, price: "378.00", subtotal: "756.00" }],
    });
    expect(await ledger()).toBe(before);
    const po = await getPool().query(
      "SELECT id,product_id,quantity::text,received::text,unit_cost::text FROM inventory_purchase_items WHERE purchase_id=$1",
      [body.operationId],
    );
    expect(po.rows).toHaveLength(1);
    expect(po.rows[0]).toMatchObject({
      quantity: "2.000",
      received: "0.000",
      unit_cost: "378.0000",
    });
    const locationId = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_locations(id,unit_id,name) VALUES($1,'a1100000-0000-4000-8000-000000000102',$2)",
      [locationId, `Local ${randomUUID()}`],
    );
    const received = await receivingResponse(
      request("receipts", {
        operationId: randomUUID(),
        purchaseId: body.operationId,
        reference: body.reference,
        supplier: s.name,
        locationId,
        items: [
          {
            productId: po.rows[0].product_id,
            purchaseItemId: po.rows[0].id,
            lot: `LOT-${randomUUID()}`,
            expiry: "2099-01-01",
            quantity: "1",
            unitCost: "378",
          },
        ],
      }),
    );
    expect(received.status).toBe(201);
    expect(await ledger()).toBe(before + 1);
    expect((await (await api(`vendor-orders?id=${body.operationId}`)).json()).data.status).toBe(
      "PARTIAL",
    );
  });
  it("rejects stale prices and keeps old order snapshots and replay after later catalog/contact edits", async () => {
    const s = await supplier(),
      i = await entry(s, { price: "0.10" }),
      body = order(s, i, 3);
    expect((await api("vendor-orders", body)).status).toBe(201);
    expect(
      (await api("vendor-catalog", edit(i, { price: "123.45", supplierSku: "SKU-CONFIRMADO" })))
        .status,
    ).toBe(200);
    expect(
      (
        await api("vendors", {
          action: "UPDATE",
          operationId: randomUUID(),
          id: s.id,
          name: s.name,
          phone: "5548999999999",
          email: "",
          active: true,
          version: 0,
          reason: "Contato sintético atualizado",
        })
      ).status,
    ).toBe(200);
    expect((await api("vendor-orders", body)).status).toBe(200);
    const snapshot = await saved(body.operationId);
    expect(snapshot).toMatchObject({
      subtotal: "0.30",
      total: "25.20",
      supplier: { phone: "554888029876" },
      items: [{ price: "0.10", supplierSku: null }],
    });
    expect(
      (
        await api("vendor-orders", {
          ...body,
          operationId: randomUUID(),
          reference: `NEW-${randomUUID()}`,
          supplierVersion: 1,
        })
      ).status,
    ).toBe(409);
    expect((await api("vendor-orders", { ...body, notes: "Outro conteúdo" })).status).toBe(409);
    const csv = await api(`vendor-orders?id=${body.operationId}&format=csv`);
    expect(csv.headers.get("cache-control")).toBe("private, no-store");
    expect(await csv.text()).toContain('"0,10"');
  });
  it("rejects unconfirmed, inactive, duplicate and wrong-vendor items before creating any purchase", async () => {
    const s = await supplier(),
      other = await supplier(),
      i = await entry(s),
      body = order(s, i);
    await getPool().query("UPDATE inventory_supplier_catalog SET price=NULL WHERE id=$1", [i.id]);
    expect((await api("vendor-orders", body)).status).toBe(409);
    await getPool().query(
      "UPDATE inventory_supplier_catalog SET price=378,active=false WHERE id=$1",
      [i.id],
    );
    expect((await api("vendor-orders", body)).status).toBe(409);
    await getPool().query("UPDATE inventory_supplier_catalog SET active=true WHERE id=$1", [i.id]);
    expect((await api("vendor-orders", { ...body, supplierId: other.id })).status).toBe(409);
    expect(
      (await api("vendor-orders", { ...body, items: [...body.items, ...body.items] })).status,
    ).toBe(400);
    expect(
      (await getPool().query("SELECT id FROM inventory_purchases WHERE id=$1", [body.operationId]))
        .rowCount,
    ).toBe(0);
  });
  it("protects linked packaging, pending suppliers and concurrent edit versions", async () => {
    const s = await supplier(),
      i = await entry(s),
      body = order(s, i);
    expect((await api("vendor-orders", body)).status).toBe(201);
    expect((await api("vendor-catalog", edit(i, { packaging: "Box avulso" }))).status).toBe(409);
    expect(
      (
        await api("vendors", {
          action: "UPDATE",
          operationId: randomUUID(),
          id: s.id,
          name: s.name,
          phone: s.phone,
          email: "",
          active: false,
          version: 0,
          reason: "Desativação sintética pendente",
        })
      ).status,
    ).toBe(409);
    const results = await Promise.all([
      api("vendor-catalog", edit(i, { price: "375.01" })),
      api("vendor-catalog", edit(i, { price: "376.02" })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("rolls back linked products, purchase lines and snapshots on failure and safely retries", async () => {
    const s = await supplier(),
      i = await entry(s),
      body = order(s, i);
    await getPool().query(
      `CREATE FUNCTION test_supplier_order_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic snapshot failure'; END; $$; CREATE TRIGGER test_supplier_order_failure BEFORE INSERT ON inventory_supplier_orders FOR EACH ROW WHEN (NEW.id='${body.operationId}'::uuid) EXECUTE FUNCTION test_supplier_order_failure();`,
    );
    try {
      expect((await api("vendor-orders", body)).status).toBe(503);
      expect(
        (
          await getPool().query("SELECT product_id FROM inventory_supplier_catalog WHERE id=$1", [
            i.id,
          ])
        ).rows[0].product_id,
      ).toBeNull();
      expect(
        (
          await getPool().query("SELECT id FROM inventory_purchases WHERE id=$1", [
            body.operationId,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await getPool().query(
        "DROP TRIGGER test_supplier_order_failure ON inventory_supplier_orders; DROP FUNCTION test_supplier_order_failure();",
      );
    }
    expect((await api("vendor-orders", body)).status).toBe(201);
  });
  it("rejects mutation of order snapshots and supplier audits", async () => {
    const s = await supplier(),
      i = await entry(s),
      body = order(s, i);
    expect((await api("vendor-orders", body)).status).toBe(201);
    await expect(
      getPool().query("UPDATE inventory_supplier_orders SET total=1 WHERE id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query("DELETE FROM inventory_supplier_changes WHERE supplier_id=$1", [s.id]),
    ).rejects.toThrow("append-only");
  });
  it("denies unauthenticated exports, foreign origins and actor or cost injection", async () => {
    expect(
      (
        await supplierCatalogResponse(
          new Request(`${origin}/api/v1/inventory/vendor-orders?id=${randomUUID()}&format=csv`),
        )
      ).status,
    ).toBe(401);
    const s = await supplier(),
      i = await entry(s),
      body = order(s, i);
    expect(
      (
        await supplierCatalogResponse(
          new Request(`${origin}/api/v1/inventory/vendor-orders`, {
            method: "POST",
            headers: { origin: "https://foreign.example", cookie },
            body: JSON.stringify(body),
          }),
        )
      ).status,
    ).toBe(403);
    expect((await api("vendor-orders", { ...body, actor: "injected" })).status).toBe(400);
    expect((await api("vendor-orders", { ...body, total: "0.01" })).status).toBe(400);
    expect(
      (await api("vendor-orders", { ...body, items: [{ ...body.items[0], quantity: 1.5 }] }))
        .status,
    ).toBe(400);
  });
  it("bounds totals and preserves blank freight as unknown", async () => {
    const s = await supplier(),
      i = await entry(s, { price: "9999999999.99" }),
      body = order(s, i, 9999);
    expect((await api("vendor-orders", body)).status).toBe(409);
    const cheap = await entry(s, {
      price: "12.34",
      boxesPerPack: null,
      packaging: "Frasco avulso",
    });
    const r = await api("vendor-orders", { ...order(s, cheap, 3), freight: null });
    expect(r.status).toBe(201);
    expect((await r.json()).data.order).toMatchObject({
      subtotal: "37.02",
      total: "37.02",
      freight: null,
      items: [{ boxes: null }],
    });
    // Existing receipt screens see the same durable purchase, without a second procurement database.
    const purchases = await purchasingResponse(request("purchases"), "purchases");
    expect(purchases.status).toBe(200);
  });
  it("imports Stin boxes and the complete kit without merging vendors or entering physical stock", async () => {
    const run = () =>
      promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/import-stin.ts"], {
        env: { ...process.env, INVENTORY_ALLOW_SEED: "true" },
        timeout: 15000,
      });
    const before = await ledger();
    const essentiaBefore = (
      await getPool().query(
        "SELECT c.* FROM inventory_supplier_catalog c JOIN inventory_suppliers s ON s.id=c.supplier_id WHERE s.name='Essentia' ORDER BY c.id",
      )
    ).rows;
    await Promise.all([run(), run()]);
    const stin = ((await (await api("vendors")).json()).data as SupplierProfile[]).find(
      (s) => s.name === "Stin Pharma",
    )!;
    expect(stin.phone).toBe("551120781800");
    const catalog = (await (await api(`vendor-catalog?supplierId=${stin.id}`)).json())
      .data as SupplierCatalogItem[];
    expect(catalog).toHaveLength(116);
    expect(catalog.filter((i) => i.kind === "PRODUCT")).toHaveLength(115);
    expect(catalog.every((i) => i.productId === null && i.supplierSku === null)).toBe(true);
    const first = catalog.find((i) => i.code === "STIN-P001")!,
      kit = catalog.find((i) => i.code === "STIN-K001")!;
    expect(first).toMatchObject({ price: "55.00", boxesPerPack: 1, packaging: "Box — 10 ampolas" });
    expect(kit).toMatchObject({
      price: "499.00",
      boxesPerPack: null,
      contents: "5 frascos + 1 ampola",
    });
    expect(kit.description).toContain("STIN-K001-F5");
    expect(catalog.some((i) => i.code.startsWith("STIN-K001-F"))).toBe(false);
    expect(catalog.find((i) => i.code === "STIN-P038")!.description).toContain(
      "Pendência de cadastro:",
    );
    expect(await ledger()).toBe(before);
    expect(
      (
        await getPool().query(
          "SELECT c.* FROM inventory_supplier_catalog c JOIN inventory_suppliers s ON s.id=c.supplier_id WHERE s.name='Essentia' ORDER BY c.id",
        )
      ).rows,
    ).toEqual(essentiaBefore);
    const purchase = {
      ...order(stin, first, 2),
      freight: null,
      items: [
        { catalogItemId: first.id, quantity: 2, version: 0, expectedPrice: "55.00" },
        { catalogItemId: kit.id, quantity: 1, version: 0, expectedPrice: "499.00" },
      ],
    };
    const savedResponse = await api("vendor-orders", purchase);
    expect(savedResponse.status).toBe(201);
    expect((await savedResponse.json()).data.order).toMatchObject({
      subtotal: "609.00",
      total: "609.00",
      items: [
        { quantity: 2, boxes: 2, subtotal: "110.00" },
        { quantity: 1, boxes: null, subtotal: "499.00" },
      ],
    });
    expect(await ledger()).toBe(before);
    expect((await api("vendor-catalog", edit(first, { price: "56.25" }))).status).toBe(200);
    expect(
      (
        await api("vendors", {
          action: "UPDATE",
          operationId: randomUUID(),
          id: stin.id,
          name: "Stin Pharma revisada",
          phone: "551120781801",
          email: "",
          active: true,
          version: stin.version,
          reason: "Contato sintético atualizado",
        })
      ).status,
    ).toBe(200);
    const historyBefore = (
      await getPool().query(
        "SELECT count(*)::int AS n FROM inventory_supplier_changes WHERE supplier_id=$1",
        [stin.id],
      )
    ).rows[0].n;
    await run();
    const updated = (await (await api(`vendor-catalog?supplierId=${stin.id}`)).json())
      .data as SupplierCatalogItem[];
    expect(updated).toHaveLength(116);
    expect(updated.find((i) => i.id === first.id)!.price).toBe("56.25");
    expect(
      ((await (await api("vendors")).json()).data as SupplierProfile[]).find(
        (s) => s.id === stin.id,
      )!.phone,
    ).toBe("551120781801");
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int AS n FROM inventory_supplier_changes WHERE supplier_id=$1",
          [stin.id],
        )
      ).rows[0].n,
    ).toBe(historyBefore);
    expect(
      ((await (await api("vendors")).json()).data as SupplierProfile[]).filter(
        (s) => s.id === stin.id,
      ),
    ).toEqual([expect.objectContaining({ name: "Stin Pharma revisada", phone: "551120781801" })]);
  });
});
