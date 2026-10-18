import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticate, can, canAccessAllUnits } from "./auth";
import { getPool } from "./db";
import { engineCatalogInput } from "../data/engine-catalog";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const fields = {
  items: `id,kind,name,description,category,unit,presentation,concentration,internal_code AS "internalCode",supplier_id AS "supplierId",active,version`,
  links: `id,product_id AS "productId",active_item_id AS "activeItemId",active,version`,
  mappings: `id,source_item_id AS "sourceItemId",target_product_id AS "targetProductId",target_item_id AS "targetItemId",billing_mode AS "billingMode",charge_group AS "chargeGroup",active,version`,
  prices: `id,unit_id AS "unitId",product_id AS "productId",catalog_item_id AS "catalogItemId",amount::text,selling_unit AS "sellingUnit",source,valid_from::text AS "validFrom",valid_until::text AS "validUntil",availability,active,version,CASE WHEN NOT active
    OR NOT EXISTS(SELECT 1 FROM inventory_units u WHERE u.id=inventory_engine_unit_sale_prices.unit_id AND u.organization_id=inventory_engine_unit_sale_prices.organization_id AND u.active)
    OR (product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_products p WHERE p.id=inventory_engine_unit_sale_prices.product_id AND p.organization_id=inventory_engine_unit_sale_prices.organization_id AND p.active))
    OR (catalog_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_engine_catalog_items i WHERE i.id=inventory_engine_unit_sale_prices.catalog_item_id AND i.organization_id=inventory_engine_unit_sale_prices.organization_id AND i.active AND i.kind IN ('SERVICE','PROCEDURE')))
    OR (now() AT TIME ZONE 'America/Fortaleza')::date<valid_from OR (valid_until IS NOT NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date>valid_until) THEN 'UNAVAILABLE' ELSE availability END AS "effectiveAvailability"`,
};
export async function engineCatalogResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para acessar o catálogo.", 401);
  const read = (unit?: string) =>
    can(auth, "inventory.read", unit) ||
    can(auth, "patients.clinical.manage", unit) ||
    can(auth, "quotes.manage", unit);
  if (!read()) return fail("Acesso negado.", 403);
  const individual = Boolean(auth.user.id) && !auth.preview && !auth.integration;
  const url = new URL(request.url);
  if (request.method === "GET") {
    const parsed = z
      .object({
        unitId: z.string().uuid().optional(),
        search: z.string().trim().max(160).default(""),
        limit: z.coerce.number().int().min(1).max(100).default(100),
        offset: z.coerce.number().int().min(0).max(10000).default(0),
      })
      .strict()
      .safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return fail("Filtros inválidos.", 400);
    const f = parsed.data;
    if (f.unitId && !read(f.unitId)) return fail("Unidade não autorizada.", 403);
    const pool = getPool();
    const all = canAccessAllUnits(auth);
    const scope = [auth.organizationId, all, auth.unitIds, f.unitId ?? null];
    const units = (
      await pool.query(
        `SELECT id,name FROM inventory_units WHERE organization_id=$1 AND ($2::boolean OR id=ANY($3::uuid[])) AND ($4::uuid IS NULL OR id=$4) ORDER BY name,id LIMIT 500`,
        scope,
      )
    ).rows;
    const search = [auth.organizationId, `%${f.search}%`, f.limit, f.offset];
    const [products, items, links, mappings, prices, clock, suppliers] = await Promise.all([
      pool.query(
        `SELECT id,name,sku,active FROM inventory_products WHERE organization_id=$1 AND (name ILIKE $2 OR sku ILIKE $2) ORDER BY name,id LIMIT $3 OFFSET $4`,
        search,
      ),
      pool.query(
        `SELECT ${fields.items} FROM inventory_engine_catalog_items WHERE organization_id=$1 AND name ILIKE $2 ORDER BY name,id LIMIT $3 OFFSET $4`,
        search,
      ),
      pool.query(
        `SELECT ${fields.links} FROM inventory_engine_product_active_links WHERE organization_id=$1 ORDER BY id LIMIT $2 OFFSET $3`,
        [auth.organizationId, f.limit, f.offset],
      ),
      pool.query(
        `SELECT ${fields.mappings} FROM inventory_engine_commercial_mappings WHERE organization_id=$1 ORDER BY id LIMIT $2 OFFSET $3`,
        [auth.organizationId, f.limit, f.offset],
      ),
      pool.query(
        `SELECT ${fields.prices} FROM inventory_engine_unit_sale_prices WHERE organization_id=$1 AND ($2::boolean OR unit_id=ANY($3::uuid[])) AND ($4::uuid IS NULL OR unit_id=$4) ORDER BY unit_id,id LIMIT $5 OFFSET $6`,
        [...scope, f.limit, f.offset],
      ),
      pool.query(`SELECT (now() AT TIME ZONE 'America/Fortaleza')::date::text AS date`),
      pool.query(
        `SELECT id,name FROM inventory_suppliers WHERE organization_id=$1 AND active ORDER BY name,id LIMIT 500`,
        [auth.organizationId],
      ),
    ]);
    return Response.json(
      {
        data: {
          products: products.rows,
          suppliers: suppliers.rows,
          items: items.rows,
          links: links.rows,
          mappings: mappings.rows,
          prices: prices.rows,
          units,
          canManageCatalog: individual && can(auth, "inventory.catalog.manage"),
          canManagePrices: individual && can(auth, "pricing.manage", f.unitId),
          referenceDate: clock.rows[0].date,
          limit: f.limit,
          offset: f.offset,
        },
      },
      { headers },
    );
  }
  if (request.method !== "POST") return fail("Método não permitido.", 405);
  if (request.headers.get("origin") !== url.origin) return fail("Origem não autorizada.", 403);
  if (!individual) return fail("Use uma conta individual autorizada.", 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Requisição inválida.", 400);
  }
  const parsed = engineCatalogInput.safeParse(body);
  if (!parsed.success) return fail("Confira os dados do catálogo.", 400);
  const d = parsed.data;
  const permission = d.action === "SET_UNIT_PRICE" ? "pricing.manage" : "inventory.catalog.manage";
  if (!can(auth, permission, d.action === "SET_UNIT_PRICE" ? d.unitId : undefined))
    return fail("Acesso negado.", 403);
  const hash = createHash("sha256")
    .update(JSON.stringify({ actor: auth.user.id, input: d }))
    .digest("hex");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${auth.organizationId}:${d.operationId}`,
    ]);
    const previous = (
      await client.query(
        `SELECT request_hash,result FROM inventory_engine_catalog_events WHERE organization_id=$1 AND operation_id=$2`,
        [auth.organizationId, d.operationId],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== hash) {
        await client.query("ROLLBACK");
        return fail("Operação já utilizada com outros dados.", 409);
      }
      await client.query("COMMIT");
      return Response.json({ data: previous.result }, { headers });
    }
    const reference = async (table: string, id: string, kinds?: readonly string[]) => {
      const record = (
        await client.query(
          `SELECT * FROM ${table} WHERE id=$1 AND organization_id=$2 AND active FOR SHARE`,
          [id, auth.organizationId],
        )
      ).rows[0];
      if (!record || (kinds && !kinds.includes(record.kind)))
        throw Object.assign(new Error("INVALID_REFERENCE"), { code: "P0001" });
    };
    if (d.active) {
      if (d.action === "SAVE_ITEM" && d.supplierId)
        await reference("inventory_suppliers", d.supplierId);
      if (d.action === "LINK_ACTIVE") {
        await reference("inventory_products", d.productId);
        await reference("inventory_engine_catalog_items", d.activeItemId, ["ACTIVE"]);
      }
      if (d.action === "SAVE_MAPPING") {
        await reference("inventory_engine_catalog_items", d.sourceItemId);
        if (d.targetProductId) await reference("inventory_products", d.targetProductId);
        if (d.targetItemId)
          await reference("inventory_engine_catalog_items", d.targetItemId, [
            "SERVICE",
            "PROCEDURE",
          ]);
      }
      if (d.action === "SET_UNIT_PRICE") {
        await reference("inventory_units", d.unitId);
        if (d.productId) await reference("inventory_products", d.productId);
        if (d.catalogItemId)
          await reference("inventory_engine_catalog_items", d.catalogItemId, [
            "SERVICE",
            "PROCEDURE",
          ]);
      }
    }
    let table: string;
    let columns: Record<string, unknown>;
    if (d.action === "SAVE_ITEM") {
      table = "inventory_engine_catalog_items";
      columns = {
        kind: d.kind,
        name: d.name,
        description: d.description,
        active: d.active,
        category: d.category,
        unit: d.unit,
        presentation: d.presentation,
        concentration: d.concentration,
        internal_code: d.internalCode,
        supplier_id: d.supplierId,
      };
    } else if (d.action === "LINK_ACTIVE") {
      table = "inventory_engine_product_active_links";
      columns = { product_id: d.productId, active_item_id: d.activeItemId, active: d.active };
    } else if (d.action === "SAVE_MAPPING") {
      table = "inventory_engine_commercial_mappings";
      columns = {
        source_item_id: d.sourceItemId,
        target_product_id: d.targetProductId,
        target_item_id: d.targetItemId,
        billing_mode: d.billingMode,
        charge_group: d.chargeGroup,
        active: d.active,
      };
    } else {
      table = "inventory_engine_unit_sale_prices";
      columns = {
        unit_id: d.unitId,
        product_id: d.productId,
        catalog_item_id: d.catalogItemId,
        amount: d.amount,
        selling_unit: d.sellingUnit,
        source: d.source,
        valid_from: d.validFrom,
        valid_until: d.validUntil,
        availability: d.availability,
        active: d.active,
      };
    }
    const before = (
      await client.query(`SELECT * FROM ${table} WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [
        d.id,
        auth.organizationId,
      ])
    ).rows[0];
    if ((!before && d.version !== null) || (before && before.version !== d.version)) {
      await client.query("ROLLBACK");
      return fail("Registro alterado. Atualize a lista.", 409);
    }
    if (before && d.action === "SET_UNIT_PRICE" && !can(auth, "pricing.manage", before.unit_id)) {
      await client.query("ROLLBACK");
      return fail("Unidade não autorizada.", 403);
    }
    const keys = Object.keys(columns),
      values = Object.values(columns);
    const after = before
      ? (
          await client.query(
            `UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")},version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,
            [d.id, auth.organizationId, ...values],
          )
        ).rows[0]
      : (
          await client.query(
            `INSERT INTO ${table}(id,organization_id,${keys.join(",")}) VALUES($1,$2,${keys.map((_, i) => `$${i + 3}`).join(",")}) RETURNING *`,
            [d.id, auth.organizationId, ...values],
          )
        ).rows[0];
    const snapshot = (
      await client.query(
        `SELECT to_jsonb(t) AS snapshot FROM ${table} t WHERE id=$1 AND organization_id=$2`,
        [d.id, auth.organizationId],
      )
    ).rows[0].snapshot;
    const result = { id: after.id, version: after.version };
    if (d.action === "SET_UNIT_PRICE")
      await client.query(
        `INSERT INTO inventory_engine_unit_sale_price_versions(organization_id,unit_id,price_id,version,snapshot) VALUES($1,$2,$3,$4,$5)`,
        [auth.organizationId, d.unitId, d.id, after.version, JSON.stringify(snapshot)],
      );
    await client.query(
      `INSERT INTO inventory_engine_catalog_events(organization_id,unit_id,actor_user_id,operation_id,request_hash,action,resource_id,before_data,after_data,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        auth.organizationId,
        d.action === "SET_UNIT_PRICE" ? d.unitId : null,
        auth.user.id,
        d.operationId,
        hash,
        d.action,
        d.id,
        before ? JSON.stringify(before) : null,
        JSON.stringify(snapshot),
        JSON.stringify(result),
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: result }, { headers, status: before ? 200 : 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "23505")
      return fail("Este vínculo ou preço já existe. Edite o registro existente.", 409);
    if (["23503", "23514", "P0001"].includes(String(code)))
      return fail("Referências, escopo ou origem inválidos.", 400);
    return fail("Não foi possível salvar o catálogo.", 500);
  } finally {
    client.release();
  }
}
