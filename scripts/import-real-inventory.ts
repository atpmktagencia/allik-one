import data from "../src/server/real-data/allik-oct-2026.json";
import { getPool } from "../src/server/db";

const pool = getPool();
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('allik-real-inventory-import'))");
  const previous = await client.query(
    "SELECT 1 FROM inventory_import_batches WHERE inventory_source_hash=$1",
    [data.inventorySource.sha256],
  );
  if (previous.rowCount) {
    await client.query("COMMIT");
    console.log("Dados reais já importados.");
  } else {
    const tables = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'inventory_%'
       AND tablename NOT IN ('inventory_organizations','inventory_units','inventory_users','inventory_memberships','inventory_unit_access','inventory_sessions','inventory_invites','inventory_auth_events')
       ORDER BY tablename`,
    );
    const names = tables.rows.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`);
    if (names.length) await client.query(`TRUNCATE ${names.join(", ")} CASCADE`);

    const location = await client.query<{ id: string }>(
      "INSERT INTO inventory_locations(unit_id,name,active,version) VALUES('a1100000-0000-4000-8000-000000000102',$1,true,0) RETURNING id",
      [`Allik ${data.inventorySource.clinic}`],
    );
    for (const item of data.items) {
      const displayName = `${item.name} (${item.route})`;
      const product = await client.query<{ id: string }>(
        `INSERT INTO inventory_products(organization_id,name,sku,category,unit,active,stock_controlled,minimum,version)
         VALUES('a1100000-0000-4000-8000-000000000001',$1,$2,'Injetáveis',$3,true,true,$4,0) RETURNING id`,
        [displayName, item.sku, item.unit, item.minimum],
      );
      if (item.quantity <= 0) continue;
      if (!item.expiresOn) throw new Error(`Validade ausente na linha ${item.sourceRow}.`);
      const lot = await client.query<{ id: string }>(
        `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost,status)
         VALUES($1,$2,$3,$4,0,'AVAILABLE') RETURNING id`,
        [
          product.rows[0]!.id,
          `LOTE-PENDENTE-L${item.sourceRow}`,
          item.expiresOn,
          item.supplier ?? "Fornecedor não informado",
        ],
      );
      await client.query(
        `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key)
         VALUES($1,$2,'IN',$3,'importacao-dados-reais',$4,$5,$6)`,
        [
          lot.rows[0]!.id,
          location.rows[0]!.id,
          item.quantity,
          `PLANILHA-L${item.sourceRow}`,
          "Saldo inicial importado; lote e custo de aquisição não constam na planilha.",
          `real:${data.inventorySource.sha256}:row:${item.sourceRow}`,
        ],
      );
    }
    for (const entry of data.salePrices) {
      await client.query(
        `INSERT INTO inventory_sale_prices(name,route,supplier,price,source_file,source_hash)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          entry.name,
          entry.route,
          entry.supplier,
          entry.price,
          data.priceSource.file,
          data.priceSource.sha256,
        ],
      );
    }
    await client.query(
      `INSERT INTO inventory_import_batches(inventory_source_file,inventory_source_hash,price_source_file,price_source_hash,summary,actor)
       VALUES($1,$2,$3,$4,$5::jsonb,'importacao-dados-reais')`,
      [
        data.inventorySource.file,
        data.inventorySource.sha256,
        data.priceSource.file,
        data.priceSource.sha256,
        JSON.stringify({
          clinic: data.inventorySource.clinic,
          products: data.items.length,
          positions: data.items.filter((item) => item.quantity > 0).length,
          quantity: data.items.reduce((sum, item) => sum + item.quantity, 0),
          salePrices: data.salePrices.length,
          pendingLots: data.items.filter((item) => item.quantity > 0).length,
          missingAcquisitionCosts: data.items.filter((item) => item.quantity > 0).length,
        }),
      ],
    );
    await client.query("COMMIT");
    console.log(
      `Dados reais importados: ${data.items.length} produtos e ${data.salePrices.length} valores de venda.`,
    );
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
