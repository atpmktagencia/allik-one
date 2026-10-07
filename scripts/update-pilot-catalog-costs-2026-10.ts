import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../src/server/db";

const APPLY = process.argv.includes("--apply");
const ACTOR_EMAIL = process.env["INVENTORY_MAINTENANCE_ACTOR_EMAIL"]?.trim().toLowerCase();
const REASON = "Categoria Essentia e custos unitários reconciliados com os catálogos vigentes.";

if (process.env["INVENTORY_ENVIRONMENT"] !== "production" || (APPLY && !ACTOR_EMAIL))
  throw new Error(
    "This maintenance command requires the Pilot environment and, when applying, an actor email.",
  );

// Catalog prices are per box. Inventory quantities are individual ampoules/vials.
const unitCosts = new Map<string, number>([
  ["JDO-030-EV-L-BAIBA", 17], // ESS-P074: R$ 170 / 10 ampoules
  ["JDO-013-IM-RESVERATROL-MICELAR", 44.5], // ESS-P111: R$ 445 / 10 ampoules
  ["ESS-P108", 84.5], // ESS-P108: R$ 845 / 10 ampoules
  ["STIN-PA05060133", 46.9], // STIN-P002: R$ 469 / 10 vials
  ["STIN-P085", 4.1], // STIN-P085: R$ 41 / 10 ampoules
]);

const pool = getPool();
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('pilot-catalog-costs-2026-10'))");

  const actor = APPLY
    ? await client.query<{ id: string; name: string }>(
        `SELECT u.id,u.name FROM inventory_users u
         JOIN inventory_memberships m ON m.user_id=u.id AND m.active
         WHERE lower(u.email)=lower($1) AND u.active AND m.role='SUPER_ADMIN'`,
        [ACTOR_EMAIL],
      )
    : { rowCount: 0, rows: [] as Array<{ id: string; name: string }> };
  if (APPLY && actor.rowCount !== 1) throw new Error("Active Pilot SUPER_ADMIN not found.");

  const selected = await client.query<{ id: string }>(
    `SELECT p.id FROM inventory_products p
     WHERE p.organization_id='a1100000-0000-4000-8000-000000000001'
       AND (
         p.sku=ANY($1::text[])
         OR EXISTS (
           SELECT 1 FROM inventory_lots el
           WHERE el.product_id=p.id AND lower(el.supplier) LIKE 'essentia%'
         )
         OR EXISTS (
           SELECT 1 FROM inventory_supplier_catalog c
           JOIN inventory_suppliers s ON s.id=c.supplier_id
           WHERE c.product_id=p.id AND lower(s.name) LIKE 'essentia%'
         )
       )
     ORDER BY p.id FOR UPDATE`,
    [[...unitCosts.keys()]],
  );
  const productIds = selected.rows.map((product) => product.id);
  if (productIds.length)
    await client.query(
      "SELECT id FROM inventory_lots WHERE product_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [productIds],
    );

  const products = await client.query<{
    id: string;
    sku: string;
    name: string;
    category: string;
    lots: Array<{ id: string; number: string; supplier: string; unitCost: string }>;
  }>(
    `SELECT p.id,p.sku,p.name,p.category,
       COALESCE(jsonb_agg(jsonb_build_object(
         'id',l.id,'number',l.number,'supplier',l.supplier,'unitCost',l.unit_cost::text
       ) ORDER BY l.number) FILTER (WHERE l.id IS NOT NULL),'[]'::jsonb) AS lots
     FROM inventory_products p
     LEFT JOIN inventory_lots l ON l.product_id=p.id
     WHERE p.id=ANY($1::uuid[])
     GROUP BY p.id,p.sku,p.name,p.category
     ORDER BY p.name`,
    [productIds],
  );

  const changes: Array<Record<string, unknown>> = [];
  const pendingCosts: Array<{ sku: string; name: string }> = [];
  for (const product of products.rows) {
    const essentia = product.lots.some((lot) => lot.supplier.toLowerCase().startsWith("essentia"));
    const targetCategory = essentia ? "Catálogo Essentia Maio" : product.category;
    const targetCost = unitCosts.get(product.sku);
    const categoryChanged = product.category !== targetCategory;
    const lotsChanged =
      targetCost === undefined
        ? []
        : product.lots.filter((lot) => Number(lot.unitCost) !== targetCost);

    if (targetCost === undefined && product.lots.some((lot) => Number(lot.unitCost) === 0))
      pendingCosts.push({ sku: product.sku, name: product.name });
    if (!categoryChanged && lotsChanged.length === 0) continue;

    const before = {
      category: product.category,
      lots: product.lots.map((lot) => ({ number: lot.number, unitCost: lot.unitCost })),
    };
    const after = {
      category: targetCategory,
      lots: product.lots.map((lot) => ({
        number: lot.number,
        unitCost: lotsChanged.some((changed) => changed.id === lot.id)
          ? targetCost!.toFixed(4)
          : lot.unitCost,
      })),
    };
    changes.push({ sku: product.sku, name: product.name, before, after });

    if (!APPLY) continue;
    if (categoryChanged)
      await client.query(
        "UPDATE inventory_products SET category=$2,version=version+1 WHERE id=$1",
        [product.id, targetCategory],
      );
    if (lotsChanged.length)
      await client.query("UPDATE inventory_lots SET unit_cost=$2 WHERE id=ANY($1::uuid[])", [
        lotsChanged.map((lot) => lot.id),
        targetCost,
      ]);
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ productId: product.id, before, after }))
      .digest("hex");
    await client.query(
      `INSERT INTO inventory_catalog_changes(
         id,product_id,action,request_hash,before_data,after_data,actor,actor_user_id,reason
       ) VALUES($1,$2,'UPDATE',$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
      [
        randomUUID(),
        product.id,
        requestHash,
        JSON.stringify(before),
        JSON.stringify(after),
        actor.rows[0]!.name,
        actor.rows[0]!.id,
        REASON,
      ],
    );
  }

  if (APPLY) await client.query("COMMIT");
  else await client.query("ROLLBACK");
  console.log(JSON.stringify({ mode: APPLY ? "applied" : "dry-run", changes, pendingCosts }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
