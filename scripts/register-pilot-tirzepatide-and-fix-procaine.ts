import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { getPool } from "../src/server/db";
import stinCatalog from "../src/server/vendor-catalog/stin.json";

const TIRZEPATIDE_CODES = ["STIN-TIRZ-20", "STIN-TIRZ-60", "STIN-TIRZ-93_6"];
const TIRZEPATIDE_LOT = "SEM-LOTE-FOR-2027-03-STIN-TIRZ-20";
const REFERENCE = "CADASTRO-TIRZEPATIDA-FORTALEZA-2026-10-07";

export async function registerPilotTirzepatideAndFixProcaine(actorEmail: string) {
  if (process.env["INVENTORY_ENVIRONMENT"] !== "production" || !actorEmail.trim())
    throw new Error("This maintenance command requires the Pilot environment and an actor email.");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('pilot-tirzepatide-procaine-2026-10-07'))",
    );
    const actor = await client.query<{ id: string; name: string }>(
      `SELECT u.id,u.name FROM inventory_users u
       JOIN inventory_memberships m ON m.user_id=u.id AND m.active
       WHERE lower(u.email)=lower($1) AND u.active AND m.role='SUPER_ADMIN'`,
      [actorEmail.trim().toLowerCase()],
    );
    if (actor.rowCount !== 1) throw new Error("Active Pilot SUPER_ADMIN not found.");
    const who = actor.rows[0]!;

    const suppliers = await client.query<{ id: string; name: string }>(
      `SELECT id,name FROM inventory_suppliers
       WHERE lower(name) LIKE 'stin%' OR lower(name) LIKE 'essentia%' ORDER BY id FOR UPDATE`,
    );
    const stin = suppliers.rows.find((supplier) => supplier.name.toLowerCase().startsWith("stin"));
    const essentia = suppliers.rows.find((supplier) =>
      supplier.name.toLowerCase().startsWith("essentia"),
    );
    if (!stin || !essentia) throw new Error("Stin or Essentia supplier not found.");

    const catalogResults: Array<{ code: string; state: string }> = [];
    for (const code of TIRZEPATIDE_CODES) {
      const source = stinCatalog.items.find((item) => item.code === code);
      if (!source) throw new Error(`Catalog source ${code} not found.`);
      const inserted = await client.query(
        `INSERT INTO inventory_supplier_catalog(
           id,supplier_id,code,supplier_sku,name,kind,description,packaging,contents,
           boxes_per_pack,price,pricing_note,price_source,source_page
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT(supplier_id,code) DO NOTHING RETURNING *`,
        [
          randomUUID(),
          stin.id,
          source.code,
          source.supplierSku,
          source.name,
          source.kind,
          source.description,
          source.packaging,
          source.contents,
          source.boxesPerPack,
          source.price,
          source.pricingNote,
          source.priceSource,
          source.sourcePage,
        ],
      );
      if (inserted.rowCount) {
        const row = inserted.rows[0];
        await client.query(
          `INSERT INTO inventory_supplier_changes(
             id,supplier_id,catalog_item_id,action,request_hash,after_data,actor,actor_user_id,reason
           ) VALUES($1,$2,$3,'CREATE',$4,$5::jsonb,$6,$7,$8)`,
          [
            randomUUID(),
            stin.id,
            row.id,
            createHash("sha256").update(JSON.stringify(source)).digest("hex"),
            JSON.stringify(row),
            who.name,
            who.id,
            "Apresentação de Tirzepatida e preço informados pelo administrador.",
          ],
        );
      }
      catalogResults.push({ code, state: inserted.rowCount ? "created" : "existing" });
    }

    const location = await client.query<{ id: string; name: string }>(
      `SELECT l.id,l.name FROM inventory_locations l JOIN inventory_units u ON u.id=l.unit_id
       WHERE u.name='Fortaleza' AND l.name='Fortaleza — Estoque Central' AND l.active FOR SHARE`,
    );
    if (location.rowCount !== 1) throw new Error("Fortaleza central location not found.");
    const tirzCatalog = await client.query<{ id: string; productId: string | null }>(
      `SELECT id,product_id AS "productId" FROM inventory_supplier_catalog
       WHERE supplier_id=$1 AND code='STIN-TIRZ-20' FOR UPDATE`,
      [stin.id],
    );
    let tirzProductId = tirzCatalog.rows[0]!.productId;
    if (!tirzProductId) {
      tirzProductId = randomUUID();
      const product = (
        await client.query(
          `INSERT INTO inventory_products(id,organization_id,name,sku,category,unit,minimum)
           VALUES($1,'a1100000-0000-4000-8000-000000000001',$2,'STIN-TIRZ-20','Catálogo Stin Pharma','ampola',0)
           RETURNING id,name,sku,category,unit,minimum::text,active,version`,
          [tirzProductId, "Tirzepatida 20 mg/0,8 mL"],
        )
      ).rows[0];
      await client.query("UPDATE inventory_supplier_catalog SET product_id=$2 WHERE id=$1", [
        tirzCatalog.rows[0]!.id,
        tirzProductId,
      ]);
      await client.query(
        `INSERT INTO inventory_catalog_changes(
           id,product_id,action,request_hash,after_data,actor,actor_user_id,reason
         ) VALUES($1,$2,'CREATE',$3,$4::jsonb,$5,$6,$7)`,
        [
          randomUUID(),
          tirzProductId,
          createHash("sha256").update(JSON.stringify(product)).digest("hex"),
          JSON.stringify(product),
          who.name,
          who.id,
          "Produto vinculado à apresentação STIN-TIRZ-20 informada pelo administrador.",
        ],
      );
    }
    await client.query(
      `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost,status)
       VALUES($1,$2,'2027-03-30','Stin Pharma',591.40,'AVAILABLE')
       ON CONFLICT(product_id,number) DO NOTHING`,
      [tirzProductId, TIRZEPATIDE_LOT],
    );
    const tirzLot = await client.query<{ id: string }>(
      `SELECT id FROM inventory_lots
       WHERE product_id=$1 AND number=$2 AND expires_on='2027-03-30'
         AND supplier='Stin Pharma' AND unit_cost=591.40 FOR UPDATE`,
      [tirzProductId, TIRZEPATIDE_LOT],
    );
    if (tirzLot.rowCount !== 1) throw new Error("Tirzepatide lot conflicts with supplied data.");
    await client.query(
      `INSERT INTO inventory_movements(
         lot_id,location_id,type,delta,actor,actor_user_id,reference,reason,operation_key
       ) VALUES($1,$2,'ADJUSTMENT',1,$3,$4,$5,$6,$7) ON CONFLICT(operation_key) DO NOTHING`,
      [
        tirzLot.rows[0]!.id,
        location.rows[0]!.id,
        who.name,
        who.id,
        REFERENCE,
        "Entrada excepcional informada pelo administrador; lote do fabricante ainda não disponível.",
        `${REFERENCE}:STIN-TIRZ-20:1`,
      ],
    );

    const procaineProduct = await client.query<{
      id: string;
      sku: string;
      name: string;
      category: string;
    }>(
      `SELECT id,sku,name,category FROM inventory_products
       WHERE sku=ANY($1::text[]) ORDER BY CASE WHEN sku='ESS-P123' THEN 0 ELSE 1 END FOR UPDATE`,
      [["STIN-P085", "ESS-P123"]],
    );
    if (procaineProduct.rowCount !== 1) throw new Error("Procaine product was not found uniquely.");
    const procaine = procaineProduct.rows[0]!;
    const procaineLots = await client.query<{
      id: string;
      number: string;
      expiry: string;
      supplier: string;
      unitCost: string;
    }>(
      `SELECT id,number,expires_on::text AS expiry,supplier,unit_cost::text AS "unitCost"
       FROM inventory_lots WHERE product_id=$1 ORDER BY id FOR UPDATE`,
      [procaine.id],
    );
    const procaineBefore = { ...procaine, lots: procaineLots.rows };
    await client.query(
      `UPDATE inventory_products SET sku='ESS-P123',category='Catálogo Essentia Maio',version=version+1
       WHERE id=$1`,
      [procaine.id],
    );
    await client.query(
      `UPDATE inventory_lots SET
         number=CASE WHEN number='SEM-LOTE-FOR-2027-11-STIN-P085' THEN 'SEM-LOTE-FOR-2027-11-ESS-P123' ELSE number END,
         supplier='Essentia',unit_cost=5.10 WHERE product_id=$1`,
      [procaine.id],
    );
    await client.query(
      `UPDATE inventory_supplier_catalog SET product_id=NULL
       WHERE supplier_id=$1 AND code='STIN-P085' AND product_id=$2`,
      [stin.id, procaine.id],
    );
    const linkedEssentia = await client.query(
      `UPDATE inventory_supplier_catalog SET product_id=$3
       WHERE supplier_id=$1 AND code=$2 AND (product_id IS NULL OR product_id=$3) RETURNING id`,
      [essentia.id, "ESS-P123", procaine.id],
    );
    if (linkedEssentia.rowCount !== 1)
      throw new Error("ESS-P123 catalog link could not be assigned.");
    const procaineAfter = {
      ...procaine,
      sku: "ESS-P123",
      category: "Catálogo Essentia Maio",
      lots: procaineLots.rows.map((lot) => ({
        ...lot,
        number:
          lot.number === "SEM-LOTE-FOR-2027-11-STIN-P085"
            ? "SEM-LOTE-FOR-2027-11-ESS-P123"
            : lot.number,
        supplier: "Essentia",
        unitCost: "5.1000",
      })),
    };
    await client.query(
      `INSERT INTO inventory_catalog_changes(
         id,product_id,action,request_hash,before_data,after_data,actor,actor_user_id,reason
       ) VALUES($1,$2,'UPDATE',$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
      [
        randomUUID(),
        procaine.id,
        createHash("sha256")
          .update(JSON.stringify({ procaineBefore, procaineAfter }))
          .digest("hex"),
        JSON.stringify(procaineBefore),
        JSON.stringify(procaineAfter),
        who.name,
        who.id,
        "Procaína Benzoica 2% identificada pelo administrador como Essentia ESS-P123.",
      ],
    );

    const verification = await client.query(
      `SELECT p.sku,p.name,p.category,l.number,l.expires_on::text AS expiry,l.supplier,
         l.unit_cost::text AS "unitCost",b.quantity::text,loc.name AS location
       FROM inventory_products p JOIN inventory_lots l ON l.product_id=p.id
       JOIN inventory_balances b ON b.lot_id=l.id JOIN inventory_locations loc ON loc.id=b.location_id
       WHERE p.id=ANY($1::uuid[]) ORDER BY p.sku,l.number`,
      [[tirzProductId, procaine.id]],
    );
    await client.query("COMMIT");
    return { catalog: catalogResults, stock: verification.rows, procaine: procaineAfter };
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
      await registerPilotTirzepatideAndFixProcaine(
        process.env["INVENTORY_MAINTENANCE_ACTOR_EMAIL"] ?? "",
      ),
    ),
  );
