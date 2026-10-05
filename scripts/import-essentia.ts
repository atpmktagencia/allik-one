import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../src/server/db";
import catalog from "../src/server/vendor-catalog/essentia.json";

if (
  !["development", "preview", "test"].includes(process.env["INVENTORY_ENVIRONMENT"] ?? "") ||
  process.env["INVENTORY_ALLOW_SEED"] !== "true" ||
  process.env["VERCEL_ENV"] === "production"
)
  throw new Error(
    "Importação Essentia exige banco isolado de development/preview/test e autorização explícita.",
  );
const client = await getPool().connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(4282605)");
  const saved = await client.query(
    "INSERT INTO inventory_suppliers(id,name,phone) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
    [randomUUID(), catalog.supplier.name, catalog.supplier.phone],
  );
  const supplier = (
    await client.query(
      "SELECT id,name,phone,email,active,version FROM inventory_suppliers WHERE lower(name)=lower($1) FOR UPDATE",
      [catalog.supplier.name],
    )
  ).rows[0];
  if (saved.rowCount)
    await client.query(
      "INSERT INTO inventory_supplier_changes(id,supplier_id,action,request_hash,after_data,actor,reason) VALUES($1,$2,'IMPORT',$3,$4::jsonb,'preview-operator','Fornecedor cadastrado a partir do arquivo Essentia e contato informado pelo usuário')",
      [
        randomUUID(),
        supplier.id,
        createHash("sha256").update(catalog.sourceSha256).digest("hex"),
        JSON.stringify(supplier),
      ],
    );
  if (!saved.rowCount && !supplier.phone && supplier.version === 0) {
    const before = { ...supplier };
    Object.assign(
      supplier,
      (
        await client.query(
          "UPDATE inventory_suppliers SET phone=$2,version=version+1 WHERE id=$1 RETURNING id,name,phone,email,active,version",
          [supplier.id, catalog.supplier.phone],
        )
      ).rows[0],
    );
    await client.query(
      "INSERT INTO inventory_supplier_changes(id,supplier_id,action,request_hash,before_data,after_data,actor,reason) VALUES($1,$2,'IMPORT',$3,$4::jsonb,$5::jsonb,'preview-operator','WhatsApp informado pelo usuário para o fornecedor Essentia')",
      [
        randomUUID(),
        supplier.id,
        catalog.sourceSha256,
        JSON.stringify(before),
        JSON.stringify(supplier),
      ],
    );
  }
  let inserted = 0;
  for (const item of catalog.items) {
    const result = await client.query(
      `INSERT INTO inventory_supplier_catalog(supplier_id,code,supplier_sku,name,kind,description,packaging,contents,boxes_per_pack,price,pricing_note,price_source,source_page)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(supplier_id,code) DO NOTHING RETURNING *`,
      [
        supplier.id,
        item.code,
        item.supplierSku,
        item.name,
        item.kind,
        item.description,
        item.packaging,
        item.contents,
        item.boxesPerPack,
        item.price,
        item.pricingNote,
        item.priceSource,
        item.sourcePage,
      ],
    );
    if (result.rowCount) {
      inserted++;
      const row = result.rows[0];
      await client.query(
        "INSERT INTO inventory_supplier_changes(id,supplier_id,catalog_item_id,action,request_hash,after_data,actor,reason) VALUES($1,$2,$3,'IMPORT',$4,$5::jsonb,'preview-operator','Importação do arquivo Essentia fornecido pelo usuário')",
        [randomUUID(), supplier.id, row.id, catalog.sourceSha256, JSON.stringify(row)],
      );
    }
  }
  await client.query("COMMIT");
  console.log(
    `Catálogo Essentia: ${inserted} registros novos. Preços e contatos já editados foram preservados.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await getPool().end();
}
