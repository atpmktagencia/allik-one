import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDb, getPool } from "./db";
import { hasPreviewSession, previewLogin } from "./auth";
import { inventoryResponse } from "./inventory";
import { receivingResponse } from "./receiving";
import { purchasingResponse } from "./purchases";
import { stockOperationResponse } from "./stock-operations";
import { applicationResponse } from "./applications";
import { lotTraceResponse } from "./lot-trace";
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
const receivingRequest = (body: unknown) =>
  new Request(`${origin}/api/v1/inventory/receipts`, {
    method: "POST",
    headers: { cookie, origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PostgreSQL receiving", () => {
  async function receiptFixture() {
    const f = await fixture();
    return {
      operationId: randomUUID(),
      reference: "RECEIPT-TEST",
      supplier: "Fornecedor sintético",
      locationId: String(f.params[1]),
      items: [
        {
          productId: f.productId,
          lot: randomUUID(),
          expiry: "2099-01-01",
          quantity: "2.125",
          unitCost: "2",
        },
      ],
    };
  }
  it("serializes duplicate receipts and projects one movement, balance and audit", async () => {
    const body = await receiptFixture();
    const results = await Promise.all([
      receivingResponse(receivingRequest(body)),
      receivingResponse(receivingRequest(body)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const ledger = await getPool().query(
      "SELECT m.delta::text AS quantity, b.quantity::text AS balance, (SELECT count(*)::int FROM inventory_audit a WHERE a.movement_id=m.id) AS audits FROM inventory_movements m JOIN inventory_balances b ON b.lot_id=m.lot_id AND b.location_id=m.location_id WHERE m.operation_key=$1",
      [`${body.operationId}:0`],
    );
    expect(ledger.rows).toEqual([{ quantity: "2.125", balance: "2.125", audits: 1 }]);
  });
  it("rolls back new lots, receipts and entries when a later product is invalid", async () => {
    const body = await receiptFixture();
    body.items.push({ ...body.items[0]!, productId: randomUUID(), lot: randomUUID() });
    expect((await receivingResponse(receivingRequest(body))).status).toBe(409);
    const receipt = await getPool().query("SELECT id FROM inventory_receipts WHERE id=$1", [
      body.operationId,
    ]);
    const lot = await getPool().query(
      "SELECT id FROM inventory_lots WHERE product_id=$1 AND number=$2",
      [body.items[0]!.productId, body.items[0]!.lot],
    );
    expect(receipt.rows).toHaveLength(0);
    expect(lot.rows).toHaveLength(0);
  });
  it("rejects changes to an already committed operation without adding stock", async () => {
    const body = await receiptFixture();
    expect((await receivingResponse(receivingRequest(body))).status).toBe(201);
    body.items[0]!.quantity = "99";
    expect((await receivingResponse(receivingRequest(body))).status).toBe(409);
    const ledger = await getPool().query(
      "SELECT delta::text AS quantity FROM inventory_movements WHERE operation_key=$1",
      [`${body.operationId}:0`],
    );
    expect(ledger.rows).toEqual([{ quantity: "2.125" }]);
  });
});

describe("PostgreSQL purchase receiving", () => {
  async function purchaseFixture() {
    const f = await fixture();
    const supplierId = randomUUID();
    const supplier = `Fornecedor ${supplierId}`;
    expect(
      (await purchasingResponse(receivingRequest({ id: supplierId, name: supplier }), "suppliers"))
        .status,
    ).toBe(201);
    const purchaseId = randomUUID();
    const reference = `PO-${purchaseId}`;
    const order = {
      id: purchaseId,
      reference,
      supplierId,
      items: [{ productId: f.productId, quantity: "10", unitCost: "2" }],
    };
    expect((await purchasingResponse(receivingRequest(order), "purchases")).status).toBe(201);
    const line = (
      await getPool().query("SELECT id FROM inventory_purchase_items WHERE purchase_id=$1", [
        purchaseId,
      ])
    ).rows[0].id as string;
    const body = {
      operationId: randomUUID(),
      purchaseId,
      reference,
      supplier,
      locationId: String(f.params[1]),
      items: [
        {
          productId: f.productId,
          purchaseItemId: line,
          lot: randomUUID(),
          expiry: "2099-01-01",
          quantity: "4",
          unitCost: "2",
        },
      ],
    };
    return { body, order };
  }
  async function readOrder(id: string) {
    const response = await purchasingResponse(
      new Request(`${origin}/api/v1/inventory/purchases`, { headers: { cookie } }),
      "purchases",
    );
    const result = await response.json();
    return result.data.find((order: { id: string }) => order.id === id);
  }
  it("tracks open, partial and fully received orders without duplicate replay", async () => {
    const { body } = await purchaseFixture();
    expect((await readOrder(body.purchaseId)).status).toBe("OPEN");
    expect((await receivingResponse(receivingRequest(body))).status).toBe(201);
    expect((await receivingResponse(receivingRequest(body))).status).toBe(200);
    const partial = await readOrder(body.purchaseId);
    expect(partial.status).toBe("PARTIAL");
    expect(partial.items[0].remaining).toBe("6.000");
    body.operationId = randomUUID();
    body.items[0]!.quantity = "6";
    expect((await receivingResponse(receivingRequest(body))).status).toBe(201);
    expect((await readOrder(body.purchaseId)).status).toBe("RECEIVED");
  });
  it("serializes competing deliveries and rejects excess quantities", async () => {
    const { body } = await purchaseFixture();
    body.items[0]!.quantity = "6";
    const second = {
      ...body,
      operationId: randomUUID(),
      items: [{ ...body.items[0]!, lot: randomUUID() }],
    };
    const results = await Promise.all([
      receivingResponse(receivingRequest(body)),
      receivingResponse(receivingRequest(second)),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await readOrder(body.purchaseId)).items[0].received).toBe("6.000");
  });
  it("rolls back the purchase counter when a lot is invalid", async () => {
    const { body } = await purchaseFixture();
    body.items[0]!.expiry = "2020-01-01";
    expect((await receivingResponse(receivingRequest(body))).status).toBe(409);
    expect((await readOrder(body.purchaseId)).items[0].received).toBe("0.000");
  });
  it("replays order creation without duplicating its lines and rejects a changed request", async () => {
    const { body, order } = await purchaseFixture();
    expect((await purchasingResponse(receivingRequest(order), "purchases")).status).toBe(200);
    expect((await readOrder(body.purchaseId)).items).toHaveLength(1);
    order.items[0]!.quantity = "11";
    expect((await purchasingResponse(receivingRequest(order), "purchases")).status).toBe(409);
  });
});
describe("PostgreSQL transfers and physical counts", () => {
  async function transferFixture(quantity = "10", days = 90) {
    const f = await fixture(quantity, days);
    const destination = await getPool().query(
      "INSERT INTO inventory_locations(name) VALUES($1) RETURNING id",
      [`Destino ${randomUUID()}`],
    );
    const body = {
      operationId: randomUUID(),
      lotId: String(f.params[0]),
      sourceId: String(f.params[1]),
      destinationId: String(destination.rows[0].id),
      quantity: "3.125",
      reference: `TR-${randomUUID()}`,
      reason: `Reposição entre locais ${randomUUID()}`,
    };
    return { f, body };
  }
  const transfer = (body: unknown) => stockOperationResponse(receivingRequest(body), "TRANSFER");
  const count = (body: unknown) => stockOperationResponse(receivingRequest(body), "ADJUSTMENT");
  const counting = (
    body: Awaited<ReturnType<typeof transferFixture>>["body"],
    expectedQuantity = "10",
    countedQuantity = "7.125",
  ) => ({
    operationId: randomUUID(),
    lotId: body.lotId,
    locationId: body.sourceId,
    expectedQuantity,
    countedQuantity,
    reference: `CT-${randomUUID()}`,
    reason: "Conferência física no fechamento",
  });
  async function balances(lotId: string) {
    return (
      await getPool().query(
        "SELECT location_id,quantity::text FROM inventory_balances WHERE lot_id=$1",
        [lotId],
      )
    ).rows as { location_id: string; quantity: string }[];
  }
  it("moves the same lot atomically, preserves total and exposes both locations and reason", async () => {
    const { body } = await transferFixture();
    expect((await transfer(body)).status).toBe(201);
    const stock = await balances(body.lotId);
    expect(stock.find((row) => row.location_id === body.sourceId)?.quantity).toBe("6.875");
    expect(stock.find((row) => row.location_id === body.destinationId)?.quantity).toBe("3.125");
    const ledger = await getPool().query(
      "SELECT m.delta::text, (SELECT count(*)::int FROM inventory_audit a WHERE a.movement_id=m.id) AS audits FROM inventory_operation_movements om JOIN inventory_movements m ON m.id=om.movement_id WHERE om.operation_id=$1 ORDER BY m.delta",
      [body.operationId],
    );
    expect(ledger.rows).toEqual([
      { delta: "-3.125", audits: 1 },
      { delta: "3.125", audits: 1 },
    ]);
    const response = await inventoryResponse(request(`movements?search=${body.reference}`));
    const history = (await response.json()).data;
    expect(history).toHaveLength(2);
    expect(
      history.every(
        (row: { operationId: string; origin: string; destination: string; reason: string }) =>
          row.operationId === body.operationId &&
          row.origin.startsWith("Local ") &&
          row.destination.startsWith("Destino ") &&
          row.reason === body.reason,
      ),
    ).toBe(true);
    const reasonSearch = await inventoryResponse(
      request(`movements?search=${encodeURIComponent(body.reason)}`),
    );
    expect((await reasonSearch.json()).data).toHaveLength(2);
  });
  it("replays simultaneous submissions exactly once and rejects changed payloads", async () => {
    const { body } = await transferFixture();
    const responses = await Promise.all([transfer(body), transfer(body)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect((await transfer({ ...body, quantity: "4" })).status).toBe(409);
    expect(
      (await balances(body.lotId)).find((row) => row.location_id === body.sourceId)?.quantity,
    ).toBe("6.875");
  });
  it("rolls back both movements when the destination would exceed numeric capacity", async () => {
    const { body } = await transferFixture();
    await movement([body.lotId, body.destinationId], "99999999999.000", "IN");
    expect((await transfer(body)).status).toBe(409);
    const stock = await balances(body.lotId);
    expect(stock.find((row) => row.location_id === body.sourceId)?.quantity).toBe("10.000");
    expect(stock.find((row) => row.location_id === body.destinationId)?.quantity).toBe(
      "99999999999.000",
    );
    const operation = await getPool().query("SELECT id FROM inventory_operations WHERE id=$1", [
      body.operationId,
    ]);
    expect(operation.rowCount).toBe(0);
    const ledger = await getPool().query("SELECT id FROM inventory_movements WHERE reference=$1", [
      body.reference,
    ]);
    expect(ledger.rowCount).toBe(0);
  });
  it("serializes competing transfers without allowing negative stock", async () => {
    const { body } = await transferFixture();
    body.quantity = "6";
    const responses = await Promise.all([
      transfer(body),
      transfer({ ...body, operationId: randomUUID() }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await balances(body.lotId)).find((row) => row.location_id === body.sourceId)?.quantity,
    ).toBe("4.000");
  });
  it("locks opposite transfers in the same order", async () => {
    const { body } = await transferFixture();
    await movement([body.lotId, body.destinationId], "10", "IN");
    const reverse = {
      ...body,
      operationId: randomUUID(),
      sourceId: body.destinationId,
      destinationId: body.sourceId,
      quantity: "2.125",
    };
    const responses = await Promise.all([transfer(body), transfer(reverse)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(
      (await balances(body.lotId)).find((row) => row.location_id === body.sourceId)?.quantity,
    ).toBe("9.000");
  });
  it("refuses expired, blocked and inactive destinations without changing stock", async () => {
    const expired = await transferFixture("10", -1);
    expect((await transfer(expired.body)).status).toBe(409);
    const { body } = await transferFixture();
    await getPool().query("UPDATE inventory_lots SET status='BLOCKED' WHERE id=$1", [body.lotId]);
    expect((await transfer(body)).status).toBe(409);
    await getPool().query("UPDATE inventory_lots SET status='AVAILABLE' WHERE id=$1", [body.lotId]);
    await getPool().query("UPDATE inventory_locations SET active=false WHERE id=$1", [
      body.destinationId,
    ]);
    expect((await transfer(body)).status).toBe(409);
    expect(await balances(body.lotId)).toEqual([
      { location_id: body.sourceId, quantity: "10.000" },
    ]);
  });
  it("records exact count differences, including zero, and replays without duplication", async () => {
    const { body } = await transferFixture();
    const adjustment = counting(body);
    expect((await count(adjustment)).status).toBe(201);
    expect((await count(adjustment)).status).toBe(200);
    expect((await balances(body.lotId))[0]?.quantity).toBe("7.125");
    expect((await count(counting(body, "7.125", "0"))).status).toBe(201);
    expect((await balances(body.lotId))[0]?.quantity).toBe("0.000");
    const ledger = await getPool().query(
      "SELECT delta::text FROM inventory_movements WHERE lot_id=$1 AND type='ADJUSTMENT' ORDER BY inventory_movements.delta",
      [body.lotId],
    );
    expect(ledger.rows).toEqual([{ delta: "-7.125" }, { delta: "-2.875" }]);
  });
  it("rejects stale and concurrent counts instead of overwriting new movements", async () => {
    const { body } = await transferFixture();
    const responses = await Promise.all([
      count(counting(body, "10", "8")),
      count(counting(body, "10", "9")),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const consulted = (await balances(body.lotId))[0]!.quantity;
    await movement([body.lotId, body.sourceId], "2", "IN");
    const stale = await count(counting(body, consulted));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain("saldo mudou");
  });
  it("allows counting unavailable stock without making it usable", async () => {
    const { body } = await transferFixture("10", -1);
    await getPool().query("UPDATE inventory_lots SET status='BLOCKED' WHERE id=$1", [body.lotId]);
    expect((await count(counting(body, "10", "12.125"))).status).toBe(201);
    expect((await balances(body.lotId))[0]?.quantity).toBe("12.125");
    expect((await transfer({ ...body, operationId: randomUUID() })).status).toBe(409);
    const lot = await getPool().query("SELECT status FROM inventory_lots WHERE id=$1", [
      body.lotId,
    ]);
    expect(lot.rows[0].status).toBe("BLOCKED");
  });
  it("rejects unchanged counts and prevents history alterations", async () => {
    const { body } = await transferFixture();
    expect((await count(counting(body, "10", "10"))).status).toBe(409);
    expect((await transfer(body)).status).toBe(201);
    await expect(
      getPool().query("UPDATE inventory_operations SET request_hash='modified' WHERE id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query("DELETE FROM inventory_operation_movements WHERE operation_id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
  });
  it("denies unauthenticated and cross-origin writes", async () => {
    expect((await stockOperationResponse(new Request(origin), "TRANSFER")).status).toBe(401);
    expect(
      (
        await stockOperationResponse(
          new Request(origin, {
            method: "POST",
            headers: { cookie, origin: "https://other.invalid" },
          }),
          "ADJUSTMENT",
        )
      ).status,
    ).toBe(403);
  });
});
describe("PostgreSQL direct applications", () => {
  async function applicationFixture(days = 90) {
    const f = await fixture("10", days);
    return {
      operationId: randomUUID(),
      patientRef: "demo-patient-a",
      reference: `AP-${randomUUID()}`,
      service: "Procedimento sintético",
      professional: "Executor sintético",
      locationId: String(f.params[1]),
      items: [{ productId: f.productId, lotId: String(f.params[0]), quantity: "2.125" }],
    };
  }
  const apply = (body: unknown) => applicationResponse(receivingRequest(body));
  async function quantity(lotId: string, locationId: string) {
    return (
      await getPool().query(
        "SELECT quantity::text FROM inventory_balances WHERE lot_id=$1 AND location_id=$2",
        [lotId, locationId],
      )
    ).rows[0].quantity;
  }
  it("confirms exactly once under concurrent replay and links stock, audit and application history", async () => {
    const body = await applicationFixture();
    const responses = await Promise.all([apply(body), apply(body)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("7.875");
    const ledger = await getPool().query(
      "SELECT m.delta::text,m.actor,(SELECT count(*)::int FROM inventory_audit au WHERE au.movement_id=m.id) AS audits FROM inventory_application_movements am JOIN inventory_movements m ON m.id=am.movement_id WHERE am.application_id=$1",
      [body.operationId],
    );
    expect(ledger.rows).toEqual([{ delta: "-2.125", actor: "preview-operator", audits: 1 }]);
    const history = await applicationResponse(request("applications"));
    expect(history.headers.get("cache-control")).toContain("no-store");
    const saved = (await history.json()).data.find(
      (application: { id: string }) => application.id === body.operationId,
    );
    expect(saved).toMatchObject({
      patientRef: "demo-patient-a",
      reference: body.reference,
      professional: body.professional,
    });
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toMatchObject({ lotId: body.items[0]!.lotId, quantity: "2.125" });
    const movementHistory = await inventoryResponse(request(`movements?search=${body.reference}`));
    expect((await movementHistory.json()).data[0].applicationId).toBe(body.operationId);
  });
  it("rejects changed replays and duplicate references without a second withdrawal", async () => {
    const body = await applicationFixture();
    expect((await apply(body)).status).toBe(201);
    expect((await apply({ ...body, service: "Outro procedimento" })).status).toBe(409);
    expect((await apply({ ...body, operationId: randomUUID() })).status).toBe(409);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("7.875");
  });
  it("serializes competing applications without overspending", async () => {
    const body = await applicationFixture();
    body.items[0]!.quantity = "6";
    const second = { ...body, operationId: randomUUID(), reference: `AP-${randomUUID()}` };
    const responses = await Promise.all([apply(body), apply(second)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("4.000");
  });
  it("refuses the entire application when a later item has insufficient stock", async () => {
    const body = await applicationFixture();
    const second = await fixture("3");
    await movement([second.params[0], body.locationId], "3", "IN");
    body.items.push({
      productId: second.productId,
      lotId: String(second.params[0]),
      quantity: "4",
    });
    expect((await apply(body)).status).toBe(409);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("10.000");
    expect(await quantity(body.items[1]!.lotId, body.locationId)).toBe("3.000");
    expect(
      (
        await getPool().query("SELECT id FROM inventory_applications WHERE id=$1", [
          body.operationId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await getPool().query("SELECT id FROM inventory_movements WHERE reference=$1", [
          body.reference,
        ])
      ).rowCount,
    ).toBe(0);
    body.items[1]!.quantity = "1.125";
    expect((await apply(body)).status).toBe(201);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("7.875");
    expect(await quantity(body.items[1]!.lotId, body.locationId)).toBe("1.875");
  });
  it("accepts today's validity but rejects expired and quarantined lots", async () => {
    const expired = await applicationFixture(-1);
    expect((await apply(expired)).status).toBe(409);
    const today = await applicationFixture(0);
    expect((await apply(today)).status).toBe(201);
    const blocked = await applicationFixture();
    await getPool().query("UPDATE inventory_lots SET status='QUARANTINED' WHERE id=$1", [
      blocked.items[0]!.lotId,
    ]);
    expect((await apply(blocked)).status).toBe(409);
  });
  it("rolls back an earlier withdrawal when a later movement fails in the database", async () => {
    const body = await applicationFixture();
    const second = await fixture();
    await movement([second.params[0], body.locationId], "10", "IN");
    body.items.push({
      productId: second.productId,
      lotId: String(second.params[0]),
      quantity: "1",
    });
    const name = `test_application_failure_${randomUUID().replaceAll("-", "")}`;
    // Fault injection in the disposable test database, after the first item is written.
    await getPool().query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.reference='${body.reference}' AND NEW.lot_id='${second.params[0]}'::uuid THEN RAISE EXCEPTION 'Synthetic later movement failure'; END IF; RETURN NEW; END; $$`);
    await getPool().query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      expect((await apply(body)).status).toBe(503);
      expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("10.000");
      expect(await quantity(body.items[1]!.lotId, body.locationId)).toBe("10.000");
      expect(
        (
          await getPool().query("SELECT id FROM inventory_applications WHERE id=$1", [
            body.operationId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await getPool().query("SELECT id FROM inventory_movements WHERE reference=$1", [
            body.reference,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await getPool().query(`DROP TRIGGER ${name} ON inventory_movements`);
      await getPool().query(`DROP FUNCTION ${name}()`);
    }
    expect((await apply(body)).status).toBe(201);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("7.875");
  });
  it("locks multi-item applications consistently even when item order is reversed", async () => {
    const body = await applicationFixture();
    const second = await fixture();
    await movement([second.params[0], body.locationId], "10", "IN");
    body.items[0]!.quantity = "6";
    body.items.push({
      productId: second.productId,
      lotId: String(second.params[0]),
      quantity: "6",
    });
    const reversed = {
      ...body,
      operationId: randomUUID(),
      reference: `AP-${randomUUID()}`,
      items: [...body.items].reverse(),
    };
    const responses = await Promise.all([apply(body), apply(reversed)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("4.000");
    expect(await quantity(body.items[1]!.lotId, body.locationId)).toBe("4.000");
  });
  it("rejects inactive products and locations and products without stock control", async () => {
    const body = await applicationFixture();
    await getPool().query("UPDATE inventory_products SET active=false WHERE id=$1", [
      body.items[0]!.productId,
    ]);
    expect((await apply(body)).status).toBe(409);
    await getPool().query(
      "UPDATE inventory_products SET active=true,stock_controlled=false WHERE id=$1",
      [body.items[0]!.productId],
    );
    expect((await apply(body)).status).toBe(409);
    await getPool().query("UPDATE inventory_products SET stock_controlled=true WHERE id=$1", [
      body.items[0]!.productId,
    ]);
    await getPool().query("UPDATE inventory_locations SET active=false WHERE id=$1", [
      body.locationId,
    ]);
    expect((await apply(body)).status).toBe(409);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("10.000");
  });
  it("rejects mismatched products and stock from a different local", async () => {
    const body = await applicationFixture();
    const unrelated = await fixture();
    expect(
      (await apply({ ...body, items: [{ ...body.items[0], productId: unrelated.productId }] }))
        .status,
    ).toBe(409);
    expect((await apply({ ...body, locationId: String(unrelated.params[1]) })).status).toBe(409);
  });
  it("rejects repeated lots and real patient references before accessing stock", async () => {
    const body = await applicationFixture();
    expect((await apply({ ...body, items: [body.items[0], body.items[0]] })).status).toBe(400);
    expect((await apply({ ...body, patientRef: "external-patient" })).status).toBe(400);
    expect((await apply({ ...body, items: [{ ...body.items[0], quantity: "0" }] })).status).toBe(
      400,
    );
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("10.000");
  });
  it("protects application history and requires same-origin Preview authentication", async () => {
    const body = await applicationFixture();
    expect((await applicationResponse(new Request(origin))).status).toBe(401);
    expect(
      (
        await applicationResponse(
          new Request(origin, {
            method: "POST",
            headers: { cookie, origin: "https://other.invalid" },
          }),
        )
      ).status,
    ).toBe(403);
    expect((await apply(body)).status).toBe(201);
    await expect(
      getPool().query("UPDATE inventory_applications SET reference='EDITED' WHERE id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query("DELETE FROM inventory_application_movements WHERE application_id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
  });
});
describe("Lot traceability", () => {
  it("links two deliveries, a transfer, an application and a count to the same lot and reconciles every local", async () => {
    const f = await fixture();
    const supplierId = randomUUID();
    const supplier = `Fornecedor de rastreio ${supplierId}`;
    expect(
      (await purchasingResponse(receivingRequest({ id: supplierId, name: supplier }), "suppliers"))
        .status,
    ).toBe(201);
    const purchaseId = randomUUID();
    const reference = `PO-${purchaseId}`;
    expect(
      (
        await purchasingResponse(
          receivingRequest({
            id: purchaseId,
            reference,
            supplierId,
            items: [{ productId: f.productId, quantity: "10", unitCost: "2" }],
          }),
          "purchases",
        )
      ).status,
    ).toBe(201);
    const purchaseItemId = (
      await getPool().query("SELECT id FROM inventory_purchase_items WHERE purchase_id=$1", [
        purchaseId,
      ])
    ).rows[0].id;
    const firstReceipt = randomUUID();
    const secondReceipt = randomUUID();
    const number = `TRACE-${randomUUID()}`;
    const receipt = {
      operationId: firstReceipt,
      purchaseId,
      reference,
      supplier,
      locationId: String(f.params[1]),
      items: [
        {
          purchaseItemId,
          productId: f.productId,
          lot: number,
          expiry: "2099-01-01",
          quantity: "6",
          unitCost: "2",
        },
      ],
    };
    expect((await receivingResponse(receivingRequest(receipt))).status).toBe(201);
    expect(
      (
        await receivingResponse(
          receivingRequest({
            ...receipt,
            operationId: secondReceipt,
            items: [{ ...receipt.items[0], quantity: "4" }],
          }),
        )
      ).status,
    ).toBe(201);
    const lotId = (
      await getPool().query("SELECT id FROM inventory_lots WHERE product_id=$1 AND number=$2", [
        f.productId,
        number,
      ])
    ).rows[0].id as string;
    const destination = (
      await getPool().query("INSERT INTO inventory_locations(name) VALUES($1) RETURNING id", [
        `Destino trace ${randomUUID()}`,
      ])
    ).rows[0].id as string;
    const operationId = randomUUID();
    expect(
      (
        await stockOperationResponse(
          receivingRequest({
            operationId,
            lotId,
            sourceId: f.params[1],
            destinationId: destination,
            quantity: "4",
            reference: `TR-${operationId}`,
            reason: "Reposição sintética de unidade",
          }),
          "TRANSFER",
        )
      ).status,
    ).toBe(201);
    const applicationId = randomUUID();
    const applicationReference = `AP-${applicationId}`;
    expect(
      (
        await applicationResponse(
          receivingRequest({
            operationId: applicationId,
            patientRef: "demo-patient-b",
            reference: applicationReference,
            service: "Procedimento sintético",
            professional: "Executor sintético",
            locationId: destination,
            items: [{ productId: f.productId, lotId, quantity: "1" }],
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await stockOperationResponse(
          receivingRequest({
            operationId: randomUUID(),
            lotId,
            locationId: destination,
            expectedQuantity: "3",
            countedQuantity: "2.875",
            reference: `CT-${randomUUID()}`,
            reason: "Diferença na contagem física",
          }),
          "ADJUSTMENT",
        )
      ).status,
    ).toBe(201);
    const response = await lotTraceResponse(request(`trace/lots/${lotId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const trace = (await response.json()).data;
    expect(trace.lot).toMatchObject({ id: lotId, number, supplier, productId: f.productId });
    expect(trace.summary).toMatchObject({
      received: "10.000",
      consumed: "1.000",
      adjusted: "-0.125",
      ledgerQuantity: "8.875",
      balanceQuantity: "8.875",
      totalEvents: 6,
      auditEntries: 6,
      auditedEvents: 6,
      reconciled: true,
    });
    expect(trace.balances.every((balance: { matches: boolean }) => balance.matches)).toBe(true);
    expect(
      trace.balances.find((balance: { locationId: string }) => balance.locationId === destination)
        .quantity,
    ).toBe("2.875");
    const receipts = trace.events.filter((event: { receiptId: string | null }) => event.receiptId);
    expect(new Set(receipts.map((event: { receiptId: string }) => event.receiptId))).toEqual(
      new Set([firstReceipt, secondReceipt]),
    );
    expect(
      receipts.every(
        (event: { purchaseId: string; supplierId: string }) =>
          event.purchaseId === purchaseId && event.supplierId === supplierId,
      ),
    ).toBe(true);
    expect(
      trace.events.filter((event: { operationId: string }) => event.operationId === operationId),
    ).toHaveLength(2);
    expect(
      trace.events.find(
        (event: { applicationId: string }) => event.applicationId === applicationId,
      ),
    ).toMatchObject({ applicationReference, patientRef: "demo-patient-b", quantity: "-1.000" });
    expect(trace.events.every((event: { audit: unknown[] }) => event.audit.length === 1)).toBe(
      true,
    );
    expect(trace.nextCursor).toBeNull();
    expect(JSON.stringify(trace)).not.toContain("request_hash");
  });
  it("links direct receipts explicitly even when two operations share the same reference", async () => {
    const f = await fixture();
    const reference = `DIRECT-${randomUUID()}`;
    const body = {
      operationId: randomUUID(),
      reference,
      supplier: "Fornecedor direto sintético",
      locationId: String(f.params[1]),
      items: [
        {
          productId: f.productId,
          lot: `DIRECT-${randomUUID()}`,
          expiry: "2099-01-01",
          quantity: "2",
          unitCost: "2",
        },
      ],
    };
    expect((await receivingResponse(receivingRequest(body))).status).toBe(201);
    const second = {
      ...body,
      operationId: randomUUID(),
      items: [{ ...body.items[0], quantity: "3" }],
    };
    expect((await receivingResponse(receivingRequest(second))).status).toBe(201);
    const lot = (
      await getPool().query("SELECT id FROM inventory_lots WHERE product_id=$1 AND number=$2", [
        f.productId,
        body.items[0]!.lot,
      ])
    ).rows[0].id;
    const trace = (await (await lotTraceResponse(request(`trace/lots/${lot}`))).json()).data;
    expect(trace.events).toHaveLength(2);
    expect(new Set(trace.events.map((event: { receiptId: string }) => event.receiptId))).toEqual(
      new Set([body.operationId, second.operationId]),
    );
    expect(
      trace.events.every((event: { purchaseId: string | null }) => event.purchaseId === null),
    ).toBe(true);
    await expect(
      getPool().query("DELETE FROM inventory_receipt_movements WHERE receipt_id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
  });
  it("backfills old receipt links from operation UUIDs and ignores seed and withdrawal keys", async () => {
    const migration = await readFile("drizzle/0005_colorful_susan_delgado.sql", "utf8");
    const backfill = migration
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes("INSERT INTO inventory_receipt_movements"))!;
    const client = await getPool().connect();
    const schema = `test_legacy_trace_${randomUUID().replaceAll("-", "")}`;
    const receiptIds = [randomUUID(), randomUUID()];
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema},public`);
      await client.query(
        "CREATE TABLE inventory_receipts(id uuid PRIMARY KEY,reference text); CREATE TABLE inventory_movements(id uuid PRIMARY KEY,operation_key text,type text,reference text); CREATE TABLE inventory_receipt_movements(movement_id uuid PRIMARY KEY,receipt_id uuid)",
      );
      await client.query(
        "INSERT INTO inventory_receipts VALUES($1,'SAME-REF'),($2,'SAME-REF')",
        receiptIds,
      );
      await client.query(
        "INSERT INTO inventory_movements VALUES($1,$2,'IN','SAME-REF'),($3,$4,'IN','SAME-REF'),($5,'seed-m1:TEST','IN','SAME-REF'),($6,$7,'OUT','SAME-REF')",
        [
          ids[0],
          `${receiptIds[0]!.toUpperCase()}:0`,
          ids[1],
          `${receiptIds[1]}:1`,
          ids[2],
          ids[3],
          `${receiptIds[0]}:2`,
        ],
      );
      await client.query(backfill);
      await client.query(backfill);
      const links = (
        await client.query("SELECT movement_id,receipt_id FROM inventory_receipt_movements")
      ).rows;
      expect(links).toHaveLength(2);
      expect(links).toEqual(
        expect.arrayContaining([
          { movement_id: ids[0], receipt_id: receiptIds[0] },
          { movement_id: ids[1], receipt_id: receiptIds[1] },
        ]),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("paginates identical timestamps without dropping or duplicating movements", async () => {
    const f = await fixture();
    await getPool().query(
      "INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) SELECT $1,$2,'IN',1,'test','PAGE-TEST','Histórico sintético de paginação',gen_random_uuid()::text FROM generate_series(1,60)",
      f.params,
    );
    const first = (await (await lotTraceResponse(request(`trace/lots/${f.params[0]}`))).json())
      .data;
    expect(first.events).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const next = (
      await (
        await lotTraceResponse(
          request(`trace/lots/${f.params[0]}?cursor=${encodeURIComponent(first.nextCursor)}`),
        )
      ).json()
    ).data;
    expect(next.events).toHaveLength(11);
    expect(next.nextCursor).toBeNull();
    expect(
      new Set([...first.events, ...next.events].map((event: { id: string }) => event.id)).size,
    ).toBe(61);
    expect(first.summary.totalEvents).toBe(61);
    expect(next.summary.reconciled).toBe(true);
  });
  it("retains zero balances, expired lots and inactive locations for historical inspection", async () => {
    const f = await fixture("10", -1);
    await movement(f.params, "-10", "ADJUSTMENT");
    await getPool().query("UPDATE inventory_locations SET active=false WHERE id=$1", [f.params[1]]);
    const trace = (await (await lotTraceResponse(request(`trace/lots/${f.params[0]}`))).json())
      .data;
    expect(trace.lot.status).toBe("EXPIRED");
    expect(trace.summary.balanceQuantity).toBe("0.000");
    expect(trace.balances).toHaveLength(1);
    expect(trace.balances[0]).toMatchObject({ active: false, quantity: "0.000", matches: true });
    expect(trace.events).toHaveLength(2);
  });
  it("requires authentication and validates lot and pagination before queries", async () => {
    expect(
      (await lotTraceResponse(new Request(`${origin}/api/v1/inventory/trace/lots/${randomUUID()}`)))
        .status,
    ).toBe(401);
    expect((await lotTraceResponse(request("trace/lots/invalid"))).status).toBe(400);
    expect(
      (await lotTraceResponse(request(`trace/lots/${randomUUID()}?cursor=invalid`))).status,
    ).toBe(400);
    expect((await lotTraceResponse(request(`trace/lots/${randomUUID()}`))).status).toBe(404);
  });
});
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
