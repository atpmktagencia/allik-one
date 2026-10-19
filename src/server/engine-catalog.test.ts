import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken, previewLogin } from "./auth";
import { integrationCredentialResponse } from "./integration-credentials";
import { engineCatalogResponse } from "./engine-catalog";
const origin = "https://engine-catalog.example.test";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
async function fixture() {
  const pool = getPool(),
    org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    product = randomUUID(),
    inactiveProduct = randomUUID();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Engine test ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Unit one'),($2,$3,'Unit two')",
    [unit, otherUnit, org],
  );
  await pool.query(
    "INSERT INTO inventory_products(id,organization_id,name,sku,category,unit,minimum,active) VALUES($1,$3,'Same ingredient name',$4,'Test','UN',0,true),($2,$3,'Inactive synthetic SKU',$5,'Test','UN',0,false)",
    [product, inactiveProduct, org, randomUUID(), randomUUID()],
  );
  const users: Record<string, { id: string; membership: string; cookie: string }> = {};
  for (const [key, role, scope] of [
    ["super", "SUPER_ADMIN", unit],
    ["partner", "PARTNER_ADMIN", unit],
    ["inventory", "INVENTORY_MANAGER", unit],
    ["manager", "UNIT_MANAGER", unit],
    ["doctor", "CLINICIAN", unit],
    ["finance", "FINANCE", unit],
    ["outside", "INVENTORY_MANAGER", otherUnit],
  ]) {
    const id = randomUUID(),
      membership = randomUUID(),
      token = randomUUID();
    users[key!] = { id, membership, cookie: `allik_inventory_session=${token}` };
    await pool.query(
      "INSERT INTO inventory_users(id,name,email) VALUES($1,'Synthetic catalog operator',$2)",
      [id, `${id}@example.test`],
    );
    await pool.query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
      [membership, id, org, role],
    );
    await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
      membership,
      scope,
    ]);
    await pool.query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [id, hashToken(token)],
    );
  }
  const request = (role: string, params = "", body?: Record<string, unknown>) =>
    engineCatalogResponse(
      new Request(`${origin}/api/v1/inventory/engine-catalog${params}`, {
        method: body ? "POST" : "GET",
        headers: {
          cookie: users[role]!.cookie,
          ...(body ? { origin, "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const read = (role = "inventory", params = "") => request(role, params);
  const post = (body: Record<string, unknown>, role = "inventory") => request(role, "", body);
  const item = (kind = "SERVICE", overrides = {}) => ({
    action: "SAVE_ITEM",
    id: randomUUID(),
    operationId: randomUUID(),
    version: null,
    kind,
    name: `Synthetic ${kind} ${randomUUID()}`,
    description: "Synthetic catalog only",
    active: true,
    ...overrides,
  });
  const price = (catalogItemId: string | null = null, overrides = {}) => ({
    action: "SET_UNIT_PRICE",
    id: randomUUID(),
    operationId: randomUUID(),
    version: null,
    unitId: unit,
    productId: catalogItemId ? null : product,
    catalogItemId,
    amount: "125.50",
    sellingUnit: "session",
    source: "Synthetic approved price source",
    validFrom: "2020-01-01",
    validUntil: null,
    availability: "AVAILABLE",
    active: true,
    ...overrides,
  });
  const create = async (kind = "SERVICE", overrides = {}) => {
    const draft = item(kind, overrides);
    const response = await post(draft);
    expect([200, 201]).toContain(response.status);
    return { draft, data: (await response.json()).data };
  };
  return { org, unit, otherUnit, product, inactiveProduct, users, read, post, item, price, create };
}
describe("Typed engine catalog boundaries", () => {
  it("keeps active ingredients, medication identities and stock SKUs separate without inferring links or prices", async () => {
    const f = await fixture();
    const active = await f.create("ACTIVE", { name: "Same ingredient name" }),
      medication = await f.create("MEDICATION");
    const data = (await (await f.read()).json()).data;
    expect(data.products.some((p: { id: string }) => p.id === f.product)).toBe(true);
    expect(data.items.map((i: { id: string }) => i.id)).toEqual(
      expect.arrayContaining([active.draft.id, medication.draft.id]),
    );
    expect(active.draft.id).not.toBe(f.product);
    expect(data.links).toEqual([]);
    expect(data.mappings).toEqual([]);
    expect(data.prices).toEqual([]);
    for (const id of [active.draft.id, medication.draft.id])
      expect([400, 409]).toContain((await f.post(f.price(id))).status);
  });
  it("links same-organization active ingredients and products many to many, rejecting wrong types or tenant identities", async () => {
    const f = await fixture(),
      foreign = await fixture();
    const active = await f.create("ACTIVE"),
      second = await f.create("ACTIVE"),
      service = await f.create("SERVICE"),
      foreignActive = await foreign.create("ACTIVE");
    const link = (productId: string, activeItemId: string) => ({
      action: "LINK_ACTIVE",
      id: randomUUID(),
      operationId: randomUUID(),
      version: null,
      productId,
      activeItemId,
      active: true,
    });
    expect([200, 201]).toContain((await f.post(link(f.product, active.draft.id))).status);
    expect([200, 201]).toContain((await f.post(link(f.product, second.draft.id))).status);
    expect([400, 404, 409]).toContain((await f.post(link(f.product, service.draft.id))).status);
    expect([400, 404, 409]).toContain(
      (await f.post(link(f.product, foreignActive.draft.id))).status,
    );
    expect([400, 404, 409]).toContain(
      (await f.post(link(foreign.product, active.draft.id))).status,
    );
    expect([400, 404, 409]).toContain(
      (await f.post(link(f.inactiveProduct, active.draft.id))).status,
    );
    const data = (await (await f.read()).json()).data;
    expect(data.links).toHaveLength(2);
    await expect(
      getPool().query(
        "INSERT INTO inventory_engine_product_active_links(id,organization_id,product_id,active_item_id) VALUES($1,$2,$3,$4)",
        [randomUUID(), f.org, foreign.product, active.draft.id],
      ),
    ).rejects.toThrow();
  });
  it("records explicit separate or included mappings without creating commercial charges or inventory movements", async () => {
    const f = await fixture();
    const medication = await f.create("MEDICATION"),
      service = await f.create("SERVICE");
    const before = (
      await getPool().query(
        "SELECT (SELECT count(*) FROM inventory_movements)::text movements,(SELECT count(*) FROM inventory_encounter_quotes)::text quotes",
      )
    ).rows;
    const mapping = {
      action: "SAVE_MAPPING",
      id: randomUUID(),
      operationId: randomUUID(),
      version: null,
      sourceItemId: medication.draft.id,
      targetProductId: f.product,
      targetItemId: null,
      billingMode: "SEPARATE",
      chargeGroup: "synthetic-treatment",
      active: true,
    };
    expect([200, 201]).toContain((await f.post(mapping)).status);
    expect([200, 201]).toContain(
      (
        await f.post({
          ...mapping,
          id: randomUUID(),
          operationId: randomUUID(),
          targetProductId: null,
          targetItemId: service.draft.id,
          billingMode: "INCLUDED",
        })
      ).status,
    );
    const data = (await (await f.read()).json()).data;
    expect(data.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ billingMode: "SEPARATE", chargeGroup: "synthetic-treatment" }),
        expect.objectContaining({ billingMode: "INCLUDED", chargeGroup: "synthetic-treatment" }),
      ]),
    );
    expect([200, 201]).toContain((await f.post(f.price(service.draft.id))).status);
    const after = (
      await getPool().query(
        "SELECT (SELECT count(*) FROM inventory_movements)::text movements,(SELECT count(*) FROM inventory_encounter_quotes)::text quotes",
      )
    ).rows;
    expect(after).toEqual(before);
  });
  it("requires canonical positive prices, provenance and real validity dates; unavailable prices never become zero", async () => {
    const f = await fixture(),
      service = await f.create("SERVICE");
    for (const amount of ["0.00", "-1.00", "1", "01.00", "1,00", "NaN", "10000000000.00"])
      expect((await f.post(f.price(service.draft.id, { amount }))).status).toBe(400);
    for (const changes of [
      { source: "" },
      { validFrom: "2026-02-30" },
      { validUntil: "2019-12-31" },
    ])
      expect((await f.post(f.price(service.draft.id, changes))).status).toBe(400);
    const expired = f.price(service.draft.id, {
      validFrom: "2019-01-01",
      validUntil: "2020-01-01",
    });
    expect([200, 201]).toContain((await f.post(expired)).status);
    const data = (await (await f.read()).json()).data;
    const row = data.prices.find((p: { id: string }) => p.id === expired.id);
    expect(row.amount).toBe("125.50");
    expect(row.effectiveAvailability).not.toBe("AVAILABLE");
    expect(data.prices.some((p: { amount: string }) => p.amount === "0.00")).toBe(false);
    const unpriced = await f.create("PROCEDURE");
    expect(
      (await (await f.read()).json()).data.prices.some(
        (p: { catalogItemId: string }) => p.catalogItemId === unpriced.draft.id,
      ),
    ).toBe(false);
    const future = f.price(null, { validFrom: "2099-01-01" });
    expect([200, 201]).toContain((await f.post(future)).status);
    const unknown = f.price(unpriced.draft.id, { availability: "UNKNOWN" });
    expect([200, 201]).toContain((await f.post(unknown)).status);
    const refreshed = (await (await f.read()).json()).data;
    expect(refreshed.prices.find((p: { id: string }) => p.id === future.id)).toMatchObject({
      amount: "125.50",
      effectiveAvailability: "UNAVAILABLE",
    });
    expect(refreshed.prices.find((p: { id: string }) => p.id === unknown.id)).toMatchObject({
      amount: "125.50",
      effectiveAvailability: "UNKNOWN",
    });
  });
  it("marks inactive products, catalog targets and units unavailable without rewriting stored prices", async () => {
    const f = await fixture(),
      service = await f.create("SERVICE"),
      productPrice = f.price(),
      servicePrice = f.price(service.draft.id);
    for (const draft of [productPrice, servicePrice])
      expect([200, 201]).toContain((await f.post(draft)).status);
    const before = (await (await f.read()).json()).data;
    expect(
      before.prices.every(
        (price: { effectiveAvailability: string }) => price.effectiveAvailability === "AVAILABLE",
      ),
    ).toBe(true);
    await getPool().query("UPDATE inventory_products SET active=false WHERE id=$1", [f.product]);
    expect(
      (await f.post({ ...service.draft, operationId: randomUUID(), version: 1, active: false }))
        .status,
    ).toBe(200);
    const inactive = (await (await f.read()).json()).data;
    expect(inactive.prices).toHaveLength(2);
    expect(
      inactive.prices.every(
        (price: { effectiveAvailability: string; availability: string }) =>
          price.effectiveAvailability === "UNAVAILABLE" && price.availability === "AVAILABLE",
      ),
    ).toBe(true);
    expect(
      (await f.post({ ...service.draft, operationId: randomUUID(), version: 2, active: true }))
        .status,
    ).toBe(200);
    await getPool().query("UPDATE inventory_units SET active=false WHERE id=$1", [f.unit]);
    const inactiveUnit = (await (await f.read()).json()).data;
    expect(
      inactiveUnit.prices.find((price: { id: string }) => price.id === servicePrice.id),
    ).toMatchObject({
      availability: "AVAILABLE",
      effectiveAvailability: "UNAVAILABLE",
      amount: "125.50",
    });
    const stored = await getPool().query(
      "SELECT availability,amount::text FROM inventory_engine_unit_sale_prices WHERE organization_id=$1",
      [f.org],
    );
    expect(
      stored.rows.every(
        (price: { availability: string; amount: string }) =>
          price.availability === "AVAILABLE" && price.amount === "125.50",
      ),
    ).toBe(true);
  });
  it("replays an identical operation without duplicate histories and rejects changed replays or stale revisions", async () => {
    const f = await fixture(),
      service = await f.create("SERVICE"),
      draft = f.price(service.draft.id);
    const first = await f.post(draft);
    expect([200, 201]).toContain(first.status);
    const original = await first.json();
    const replay = await f.post(draft);
    expect([200, 201]).toContain(replay.status);
    expect(await replay.json()).toEqual(original);
    expect((await f.post({ ...draft, amount: "126.50" })).status).toBe(409);
    const versions = await getPool().query(
      "SELECT count(*)::int n FROM inventory_engine_unit_sale_price_versions WHERE price_id=$1",
      [draft.id],
    );
    expect(versions.rows[0].n).toBe(1);
    const change = { ...draft, version: 1, amount: "130.00" };
    const updates = await Promise.all([
      f.post({ ...change, operationId: randomUUID() }),
      f.post({ ...change, operationId: randomUUID() }),
    ]);
    expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
    const count = await getPool().query(
      "SELECT count(*)::int n FROM inventory_engine_unit_sale_price_versions WHERE price_id=$1",
      [draft.id],
    );
    expect(count.rows[0].n).toBe(2);
  });
  it("enforces tenant and unit isolation on price reads and writes, preserving catalog identities within the tenant", async () => {
    const f = await fixture(),
      foreign = await fixture(),
      service = await f.create("SERVICE");
    const draft = f.price(service.draft.id);
    expect([200, 201]).toContain((await f.post(draft)).status);
    expect((await f.read("outside", `?unitId=${f.unit}`)).status).toBe(403);
    expect((await (await f.read("outside")).json()).data.prices).toEqual([]);
    expect((await (await foreign.read()).json()).data.items).toEqual([]);
    expect((await (await foreign.read()).json()).data.prices).toEqual([]);
    expect([403, 404]).toContain((await foreign.post(f.price(service.draft.id))).status);
    expect([403, 404]).toContain(
      (
        await f.post(
          { ...draft, operationId: randomUUID(), version: 1, amount: "140.00" },
          "outside",
        )
      ).status,
    );
    await expect(
      getPool().query(
        "INSERT INTO inventory_engine_unit_sale_prices(id,organization_id,unit_id,catalog_item_id,amount,selling_unit,source,valid_from,availability) VALUES($1,$2,$3,$4,10,'session','Synthetic source','2020-01-01','AVAILABLE')",
        [randomUUID(), foreign.org, foreign.unit, service.draft.id],
      ),
    ).rejects.toThrow();
  });
  it("separates catalog editing, price management, clinical consultation and shared Preview mutations", async () => {
    const f = await fixture();
    expect([200, 201]).toContain((await f.post(f.item(), "manager")).status);
    expect((await f.post(f.item(), "doctor")).status).toBe(403);
    expect((await f.post(f.price(), "manager")).status).toBe(403);
    expect((await f.post(f.price(), "finance")).status).toBe(403);
    const clinical = (await (await f.read("doctor")).json()).data;
    expect(clinical.canManageCatalog).toBe(false);
    expect(clinical.canManagePrices).toBe(false);
    const credential = await integrationCredentialResponse(
      new Request(`${origin}/api/v1/inventory/integration-credentials`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", cookie: f.users["super"]!.cookie },
        body: JSON.stringify({
          action: "CREATE",
          name: "Synthetic catalog integration",
          expiresInDays: 30,
          permissions: ["inventory.read", "inventory.catalog.manage"],
        }),
      }),
    );
    expect(credential.status).toBe(201);
    const { data: integration } = await credential.json();
    expect(
      (
        await engineCatalogResponse(
          new Request(`${origin}/api/v1/inventory/engine-catalog`, {
            method: "POST",
            headers: {
              origin,
              "Content-Type": "application/json",
              authorization: `Bearer ${integration.token}`,
            },
            body: JSON.stringify(f.item()),
          }),
        )
      ).status,
    ).toBe(403);
    vi.stubEnv("INVENTORY_ENVIRONMENT", "test");
    vi.stubEnv("INVENTORY_PREVIEW_PASSWORD", "synthetic-test-password");
    vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-test-secret".repeat(3));
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    try {
      const login = await previewLogin(
        new Request(`${origin}/api/inventory-session`, {
          method: "POST",
          headers: { origin },
          body: JSON.stringify({ password: "synthetic-test-password" }),
        }),
      );
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      expect(
        (
          await engineCatalogResponse(
            new Request(`${origin}/api/v1/inventory/engine-catalog`, {
              method: "POST",
              headers: { origin, cookie, "Content-Type": "application/json" },
              body: JSON.stringify(f.item()),
            }),
          )
        ).status,
      ).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("protects historical price snapshots and events from update, delete and truncate at the database boundary", async () => {
    const f = await fixture();
    const draft = f.price();
    expect([200, 201]).toContain((await f.post(draft)).status);
    for (const table of [
      "inventory_engine_unit_sale_price_versions",
      "inventory_engine_catalog_events",
    ]) {
      await expect(
        getPool().query(
          `UPDATE ${table} SET ${table.endsWith("versions") ? "snapshot" : "after_data"}='{}' WHERE ${table.endsWith("versions") ? "price_id" : "resource_id"}=$1`,
          [draft.id],
        ),
      ).rejects.toThrow();
      await expect(
        getPool().query(
          `DELETE FROM ${table} WHERE ${table.endsWith("versions") ? "price_id" : "resource_id"}=$1`,
          [draft.id],
        ),
      ).rejects.toThrow();
      await expect(getPool().query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow();
    }
    const active = await f.create("ACTIVE");
    await expect(
      getPool().query(
        "INSERT INTO inventory_engine_unit_sale_prices(id,organization_id,unit_id,catalog_item_id,amount,selling_unit,source,valid_from,availability) VALUES($1,$2,$3,$4,10,'unit','Synthetic source','2020-01-01','AVAILABLE')",
        [randomUUID(), f.org, f.unit, active.draft.id],
      ),
    ).rejects.toThrow();
  });
});
