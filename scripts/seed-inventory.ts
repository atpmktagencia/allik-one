import { getPool } from "../src/server/db";
const environment = process.env["INVENTORY_ENVIRONMENT"];
if (
  !["development", "preview", "test"].includes(environment ?? "") ||
  process.env["INVENTORY_ALLOW_SEED"] !== "true"
)
  throw new Error(
    "Seed permitido somente em development/preview/test com INVENTORY_ALLOW_SEED=true.",
  );
if (process.env["VERCEL_ENV"] === "production") throw new Error("Seed proibido em produção.");
const pool = getPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(4282604)");
  const items = [
    ["Injetável A", "ALLIK-001", "Produto clínico", "un", "40"],
    ["Injetável B", "ALLIK-002", "Produto clínico", "un", "30"],
    ["Material C", "ALLIK-003", "Material", "un", "100"],
    ["Kit de aplicação D", "ALLIK-004", "Material", "kit", "25"],
    ["Produto E", "ALLIK-005", "Produto clínico", "un", "12"],
    ["Injetável F", "ALLIK-006", "Produto clínico", "un", "20"],
  ];
  for (const item of items)
    await client.query(
      "INSERT INTO inventory_products(name,sku,category,unit,minimum) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      item,
    );
  const positions = [
    ["ALLIK-001", "A-SEED-01", 180, "Essentia", "185", "86", "Allik Fortaleza", "AVAILABLE"],
    ["ALLIK-001", "A-SEED-02", 60, "Stin", "179", "14", "Sala de Procedimentos", "AVAILABLE"],
    ["ALLIK-002", "B-SEED-01", 40, "Essentia", "240", "18", "Allik Fortaleza", "AVAILABLE"],
    ["ALLIK-002", "B-SEED-EXPIRED", -1, "Stin", "225", "5", "Allik Fortaleza", "AVAILABLE"],
    [
      "ALLIK-003",
      "MC-SEED-01",
      700,
      "Fornecedor sintético",
      "4.8",
      "240",
      "Almoxarifado",
      "AVAILABLE",
    ],
    [
      "ALLIK-004",
      "KD-SEED-01",
      90,
      "Fornecedor sintético",
      "32",
      "22",
      "Sala de Procedimentos",
      "AVAILABLE",
    ],
    ["ALLIK-005", "E-SEED-01", 18, "Stin", "310", "7", "Allik Fortaleza", "AVAILABLE"],
    ["ALLIK-006", "F-SEED-01", 16, "Essentia", "165", "34", "Sala de Procedimentos", "AVAILABLE"],
    [
      "ALLIK-006",
      "F-SEED-BLOCKED",
      180,
      "Essentia",
      "165",
      "3",
      "Sala de Procedimentos",
      "BLOCKED",
    ],
  ];
  for (const [sku, number, days, supplier, cost, quantity, location, status] of positions) {
    const seedKey = `seed-m1:${number}`;
    if (
      (await client.query("SELECT id FROM inventory_movements WHERE operation_key=$1", [seedKey]))
        .rowCount
    )
      continue;
    // An existing seed movement identifies its original location even after a rename.
    // Only create locations for missing initial entries; never recreate renamed seed locations.
    await client.query("INSERT INTO inventory_locations(name) VALUES($1) ON CONFLICT DO NOTHING", [
      location,
    ]);
    const product = await client.query(
      "SELECT id FROM inventory_products WHERE lower(sku)=lower($1)",
      [sku],
    );
    const loc = await client.query(
      "SELECT id FROM inventory_locations WHERE lower(name)=lower($1)",
      [location],
    );
    const lot = await client.query(
      `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost,status)
      VALUES($1,$2,(NOW() AT TIME ZONE 'America/Fortaleza')::date + $3::integer,$4,$5,$6)
      ON CONFLICT(product_id,number) DO UPDATE SET number=EXCLUDED.number RETURNING id`,
      [product.rows[0].id, number, days, supplier, cost, status],
    );
    await client.query(
      `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key)
      VALUES($1,$2,'IN',$3,'seed-synthetic','SEED-M1','Saldo inicial sintético do Preview',$4) ON CONFLICT(operation_key) DO NOTHING`,
      [lot.rows[0].id, loc.rows[0].id, quantity, seedKey],
    );
  }
  await client.query("COMMIT");
  console.log("Seed sintético aplicado sem duplicar entradas.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
