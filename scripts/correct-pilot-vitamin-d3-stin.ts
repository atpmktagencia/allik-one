import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { getPool } from "../src/server/db";

const OLD_SKU = "ESS-D3-100000-IM";
const NEW_SKU = "STIN-P110";
const CATEGORY = "Catálogo Stin Pharma";
const SUPPLIER = "Stin Pharma";
const UNIT_COST = 17.9;

export async function correctPilotVitaminD3Stin(actorEmail: string) {
  if (process.env["INVENTORY_ENVIRONMENT"] !== "production" || !actorEmail.trim())
    throw new Error("This maintenance command requires the Pilot environment and an actor email.");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pilot-vitamin-d3-stin-p110'))");
    const actor = await client.query<{ id: string; name: string }>(
      `SELECT u.id,u.name FROM inventory_users u
       JOIN inventory_memberships m ON m.user_id=u.id AND m.active
       WHERE lower(u.email)=lower($1) AND u.active AND m.role='SUPER_ADMIN'`,
      [actorEmail.trim().toLowerCase()],
    );
    if (actor.rowCount !== 1) throw new Error("Active Pilot SUPER_ADMIN not found.");

    const product = await client.query<{
      id: string;
      sku: string;
      name: string;
      category: string;
    }>(
      `SELECT id,sku,name,category FROM inventory_products
       WHERE sku=ANY($1::text[]) ORDER BY CASE WHEN sku=$2 THEN 0 ELSE 1 END FOR UPDATE`,
      [[OLD_SKU, NEW_SKU], NEW_SKU],
    );
    if (product.rowCount !== 1)
      throw new Error("Vitamin D3 product was not found uniquely; maintenance stopped.");
    const current = product.rows[0]!;

    const catalog = await client.query<{ id: string; productId: string | null }>(
      `SELECT c.id,c.product_id AS "productId" FROM inventory_supplier_catalog c
       JOIN inventory_suppliers s ON s.id=c.supplier_id
       WHERE c.code=$1 AND lower(s.name) LIKE 'stin%' FOR UPDATE OF c`,
      [NEW_SKU],
    );
    if (
      catalog.rowCount !== 1 ||
      (catalog.rows[0]!.productId && catalog.rows[0]!.productId !== current.id)
    )
      throw new Error("STIN-P110 catalog link is missing or points to another product.");

    const lots = await client.query<{
      id: string;
      number: string;
      supplier: string;
      unitCost: string;
    }>(
      `SELECT id,number,supplier,unit_cost::text AS "unitCost"
       FROM inventory_lots WHERE product_id=$1 ORDER BY id FOR UPDATE`,
      [current.id],
    );
    if (!lots.rowCount) throw new Error("Vitamin D3 stock lot was not found.");

    const before = { ...current, lots: lots.rows };
    await client.query(
      `UPDATE inventory_products SET sku=$2,category=$3,version=version+1 WHERE id=$1`,
      [current.id, NEW_SKU, CATEGORY],
    );
    await client.query(`UPDATE inventory_lots SET supplier=$2,unit_cost=$3 WHERE product_id=$1`, [
      current.id,
      SUPPLIER,
      UNIT_COST,
    ]);
    await client.query("UPDATE inventory_supplier_catalog SET product_id=$2 WHERE id=$1", [
      catalog.rows[0]!.id,
      current.id,
    ]);
    const after = {
      ...current,
      sku: NEW_SKU,
      category: CATEGORY,
      lots: lots.rows.map((lot) => ({
        ...lot,
        supplier: SUPPLIER,
        unitCost: UNIT_COST.toFixed(4),
      })),
    };
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ productId: current.id, before, after }))
      .digest("hex");
    await client.query(
      `INSERT INTO inventory_catalog_changes(
         id,product_id,action,request_hash,before_data,after_data,actor,actor_user_id,reason
       ) VALUES($1,$2,'UPDATE',$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
      [
        randomUUID(),
        current.id,
        requestHash,
        JSON.stringify(before),
        JSON.stringify(after),
        actor.rows[0]!.name,
        actor.rows[0]!.id,
        "Vitamina D3 100.000 UI identificada no catálogo Stin como STIN-P110; fornecedor e custo unitário reconciliados.",
      ],
    );
    await client.query("COMMIT");
    return { before, after, catalogCode: NEW_SKU };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(
    JSON.stringify(
      await correctPilotVitaminD3Stin(process.env["INVENTORY_MAINTENANCE_ACTOR_EMAIL"] ?? ""),
    ),
  );
