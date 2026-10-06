import { randomUUID } from "node:crypto";
import { getPool } from "../src/server/db";

const LOCATION_NAME = "Fortaleza — Estoque Central";
const ACTOR_EMAIL = "marcos326@gmail.com";
const REFERENCE = "CONTAGEM-FISICA-FORTALEZA-2026-10-06";

type Item = {
  key: string;
  name: string;
  sku: string;
  supplier: string;
  quantity: number;
  expiresOn: string;
  catalogCode?: string;
  productSku?: string;
};

const items: Item[] = [
  {
    key: "ess-l-baiba",
    name: "L-BAIBA 100 mg/1 mL EV",
    sku: "ESS-P074",
    supplier: "Essentia",
    quantity: 2,
    expiresOn: "2026-12-31",
    catalogCode: "ESS-P074",
    productSku: "JDO-030-EV-L-BAIBA",
  },
  {
    key: "ess-adek-600000",
    name: "ADEK 600.000 UI/1 mL IM",
    sku: "ESS-P159",
    supplier: "Essentia",
    quantity: 0,
    expiresOn: "2026-12-31",
    catalogCode: "ESS-P159",
    productSku: "JDO-001-IM-ADEK",
  },
  {
    key: "ess-resveratrol-micelar",
    name: "Nanomicelas de Resveratrol 10 mg/1 mL IM",
    sku: "ESS-P111",
    supplier: "Essentia",
    quantity: 2,
    expiresOn: "2026-11-30",
    catalogCode: "ESS-P111",
    productSku: "JDO-013-IM-RESVERATROL-MICELAR",
  },
  {
    key: "ess-vitamina-d3-100000",
    name: "Vitamina D3 100.000 UI/1 mL IM",
    sku: "ESS-D3-100000-IM",
    supplier: "Essentia",
    quantity: 1,
    expiresOn: "2027-04-30",
    productSku: "JDO-019-IM-VITAMINA-D3",
  },
  {
    key: "ess-curcumina-nanomicelas",
    name: "Nanomicelas de Curcuminoides 2 mg/2 mL EV",
    sku: "ESS-P108",
    supplier: "Essentia",
    quantity: 1,
    expiresOn: "2027-05-31",
    catalogCode: "ESS-P108",
  },
  {
    key: "stin-alfa-lipoico-600",
    name: "Ácido Alfa-lipoico 600 mg/30 mL EV",
    sku: "STIN-PA05060133",
    supplier: "Stin Pharma",
    quantity: 8,
    expiresOn: "2027-06-30",
    productSku: "STIN-PA05060133",
  },
  {
    key: "stin-procaina-2",
    name: "Procaína benzoica 2% 40 mg/2 mL IM",
    sku: "STIN-P085",
    supplier: "Stin Pharma",
    quantity: 10,
    expiresOn: "2027-11-30",
    catalogCode: "STIN-P085",
  },
];

const pool = getPool();
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('fortaleza-physical-stock-2026-10-06'))",
  );
  const location = await client.query<{ id: string }>(
    `SELECT l.id FROM inventory_locations l
     JOIN inventory_units u ON u.id=l.unit_id
     WHERE l.name=$1 AND u.name='Fortaleza' AND l.active AND u.active FOR SHARE`,
    [LOCATION_NAME],
  );
  const actor = await client.query<{ id: string; name: string }>(
    `SELECT u.id,u.name FROM inventory_users u
     JOIN inventory_memberships m ON m.user_id=u.id AND m.active
     WHERE lower(u.email)=lower($1) AND u.active AND m.role='SUPER_ADMIN'`,
    [ACTOR_EMAIL],
  );
  if (location.rowCount !== 1 || actor.rowCount !== 1)
    throw new Error("Fortaleza central location or pilot administrator not found");

  const summary: Array<{ sku: string; name: string; before: string; after: string }> = [];
  for (const item of items) {
    let product = item.productSku
      ? await client.query<{ id: string }>(
          "SELECT id FROM inventory_products WHERE sku=$1 FOR UPDATE",
          [item.productSku],
        )
      : { rowCount: 0, rows: [] as Array<{ id: string }> };
    if (!product.rowCount && item.catalogCode) {
      const catalog = await client.query<{ id: string; product_id: string | null }>(
        `SELECT c.id,c.product_id FROM inventory_supplier_catalog c
         JOIN inventory_suppliers s ON s.id=c.supplier_id
         WHERE c.code=$1 AND lower(s.name) LIKE $2 ORDER BY c.id LIMIT 1 FOR UPDATE OF c`,
        [item.catalogCode, `%${item.supplier.split(" ")[0]!.toLowerCase()}%`],
      );
      if (catalog.rows[0]?.product_id) {
        product = await client.query<{ id: string }>(
          "SELECT id FROM inventory_products WHERE id=$1 FOR UPDATE",
          [catalog.rows[0]!.product_id],
        );
      } else if (catalog.rowCount) {
        const productId = randomUUID();
        product = await client.query<{ id: string }>(
          `INSERT INTO inventory_products(id,organization_id,name,sku,category,unit,minimum)
           VALUES($1,'a1100000-0000-4000-8000-000000000001',$2,$3,'Injetáveis','unidade',0)
           RETURNING id`,
          [productId, item.name, item.sku],
        );
        await client.query("UPDATE inventory_supplier_catalog SET product_id=$2 WHERE id=$1", [
          catalog.rows[0]!.id,
          productId,
        ]);
      }
    }
    if (!product.rowCount) {
      product = await client.query<{ id: string }>(
        `INSERT INTO inventory_products(organization_id,name,sku,category,unit,minimum)
         VALUES('a1100000-0000-4000-8000-000000000001',$1,$2,'Injetáveis','unidade',0)
         ON CONFLICT(sku) DO UPDATE SET active=true RETURNING id`,
        [item.name, item.sku],
      );
    }
    const productId = product.rows[0]!.id;
    const balances = await client.query<{ lot_id: string; quantity: string }>(
      `SELECT b.lot_id,b.quantity::text FROM inventory_balances b
       JOIN inventory_lots l ON l.id=b.lot_id
       WHERE l.product_id=$1 AND b.location_id=$2 ORDER BY b.lot_id FOR UPDATE OF b`,
      [productId, location.rows[0]!.id],
    );
    const before = balances.rows.reduce((sum, row) => sum + Number(row.quantity), 0);
    const provisionalNumber = `SEM-LOTE-FOR-${item.expiresOn.slice(0, 7)}-${item.sku}`;
    let targetLotId: string | null = null;
    if (item.quantity > 0) {
      await client.query(
        `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost,status)
         VALUES($1,$2,$3,$4,0,'AVAILABLE') ON CONFLICT(product_id,number) DO NOTHING`,
        [productId, provisionalNumber, item.expiresOn, item.supplier],
      );
      targetLotId = (
        await client.query<{ id: string }>(
          "SELECT id FROM inventory_lots WHERE product_id=$1 AND number=$2 FOR UPDATE",
          [productId, provisionalNumber],
        )
      ).rows[0]!.id;
    }
    let movementIndex = 0;
    for (const balance of balances.rows) {
      const desired = balance.lot_id === targetLotId ? item.quantity : 0;
      const delta = desired - Number(balance.quantity);
      if (delta === 0) continue;
      await client.query(
        `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,actor_user_id,reference,reason,operation_key)
         VALUES($1,$2,'ADJUSTMENT',$3,$4,$5,$6,$7,$8) ON CONFLICT(operation_key) DO NOTHING`,
        [
          balance.lot_id,
          location.rows[0]!.id,
          delta,
          actor.rows[0]!.name,
          actor.rows[0]!.id,
          REFERENCE,
          "Contagem física de Fortaleza informada pelo administrador; lote do fabricante pendente.",
          `${REFERENCE}:${item.key}:${movementIndex++}`,
        ],
      );
    }
    if (item.quantity > 0 && !balances.rows.some((row) => row.lot_id === targetLotId)) {
      await client.query(
        `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,actor_user_id,reference,reason,operation_key)
         VALUES($1,$2,'ADJUSTMENT',$3,$4,$5,$6,$7,$8) ON CONFLICT(operation_key) DO NOTHING`,
        [
          targetLotId,
          location.rows[0]!.id,
          item.quantity,
          actor.rows[0]!.name,
          actor.rows[0]!.id,
          REFERENCE,
          "Contagem física de Fortaleza informada pelo administrador; lote do fabricante pendente.",
          `${REFERENCE}:${item.key}:target`,
        ],
      );
    }
    const after = await client.query<{ quantity: string }>(
      `SELECT COALESCE(sum(b.quantity),0)::text AS quantity FROM inventory_balances b
       JOIN inventory_lots l ON l.id=b.lot_id WHERE l.product_id=$1 AND b.location_id=$2`,
      [productId, location.rows[0]!.id],
    );
    if (Number(after.rows[0]!.quantity) !== item.quantity)
      throw new Error(`Reconciliation failed for ${item.sku}`);
    summary.push({
      sku: item.sku,
      name: item.name,
      before: before.toFixed(3),
      after: Number(after.rows[0]!.quantity).toFixed(3),
    });
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ reference: REFERENCE, location: LOCATION_NAME, items: summary }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
