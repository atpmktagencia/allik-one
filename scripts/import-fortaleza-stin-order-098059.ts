import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ORDER_ID = "11f99171-7035-424b-9218-061d8bc15330";
const SUPPLIER_ID = "c7317c20-7f8e-4aa8-a96e-e24560f7b56f";
const REFERENCE = "STIN-098059-FOR-2026-10-24";
const SOURCE_SHA256 = "035880734e7377f87d4253dd81e2836a4cb59fa619cf75e73c312b32bbacf0f4";

type Line = {
  supplierSku: string;
  catalogCode?: string;
  name: string;
  quantity: number;
  price: string;
  packaging: string;
  contents: string;
};

// Quantities are commercial boxes. Repeated PDF lines were consolidated.
const lines: Line[] = [
  {
    supplierSku: "PA05060133",
    catalogCode: "STIN-P002",
    name: "Ácido Alfa-lipoico 600 mg/30 mL EV",
    quantity: 1,
    price: "469.00",
    packaging: "Box — 10 frascos",
    contents: "10 frascos · 30 mL",
  },
  {
    supplierSku: "PA05110010",
    catalogCode: "STIN-P007",
    name: "ADEK 600.000 UI/1 mL IM",
    quantity: 1,
    price: "699.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 1 mL",
  },
  {
    supplierSku: "PA05060045",
    catalogCode: "STIN-P023",
    name: "Coenzima Q10 100 mg/2 mL IM",
    quantity: 1,
    price: "255.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060090",
    catalogCode: "STIN-P032",
    name: "Curcumina 200 mg/2 mL IM",
    quantity: 1,
    price: "115.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060126",
    catalogCode: "STIN-P014",
    name: "ATP 20 mg + L-Carnitina 600 mg + PQQ 5 mg/2 mL EV/IM",
    quantity: 1,
    price: "228.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05080001",
    name: "Testosterona Undecanoato 120 mg + Propionato 100 mg + Cipionato 100 mg/2 mL IM",
    quantity: 1,
    price: "690.00",
    packaging: "Box — 10 frascos",
    contents: "10 frascos · 2 mL",
  },
  {
    supplierSku: "PA05080006",
    name: "Testosterona Cipionato 200 mg/2 mL IM",
    quantity: 1,
    price: "384.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05110014",
    catalogCode: "STIN-P101",
    name: "Vitamina B12 Metilcobalamina 2.500 mcg/1 mL",
    quantity: 1,
    price: "171.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 1 mL",
  },
  {
    supplierSku: "PA05060120",
    catalogCode: "STIN-P055",
    name: "L-Glutationa 600 mg/5 mL EV/IM",
    quantity: 1,
    price: "289.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 5 mL",
  },
  {
    supplierSku: "PA05060043",
    catalogCode: "STIN-P054",
    name: "L-Glutationa 100 mg/2 mL",
    quantity: 3,
    price: "158.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060023",
    name: "Lidocaína sem vasoconstritor 2%/2 mL",
    quantity: 4,
    price: "36.10",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05080007",
    name: "Nandrolona Decanoato 50 mg/mL IM",
    quantity: 1,
    price: "365.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · volume a conferir no recebimento",
  },
  {
    supplierSku: "PA05070002",
    catalogCode: "STIN-P075",
    name: "NADH 50 mg — pó estéril para reconstituição",
    quantity: 1,
    price: "592.00",
    packaging: "Box — 10 frascos",
    contents: "10 frascos · 50 mg",
  },
  {
    supplierSku: "PA05060138",
    catalogCode: "STIN-P089",
    name: "Resveratrol 10 mg/1 mL IM/SC",
    quantity: 1,
    price: "158.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 1 mL",
  },
  {
    supplierSku: "PA05060009",
    catalogCode: "STIN-P047",
    name: "Insulin Support 5 mL IM",
    quantity: 1,
    price: "380.00",
    packaging: "Box — 10 frascos",
    contents: "10 frascos · 5 mL; conferir volume no recebimento",
  },
  {
    supplierSku: "PA05060128",
    catalogCode: "STIN-P096",
    name: "Trio Metilador 2 mL EV/IM",
    quantity: 1,
    price: "332.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060084",
    catalogCode: "STIN-P036",
    name: "D-Ribose 500 mg/2 mL",
    quantity: 2,
    price: "102.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060036",
    catalogCode: "STIN-P051",
    name: "L-Carnitina 600 mg/2 mL",
    quantity: 2,
    price: "91.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060083",
    catalogCode: "STIN-P080",
    name: "PQQ 5 mg/2 mL",
    quantity: 1,
    price: "131.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05110013",
    catalogCode: "STIN-P105",
    name: "Vitamina B3 (Niacinamida) 30 mg/2 mL",
    quantity: 1,
    price: "45.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05110009",
    catalogCode: "STIN-P028",
    name: "Complexo B sem B1/2 mL",
    quantity: 1,
    price: "39.80",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060080",
    catalogCode: "STIN-P031",
    name: "Cromo Picolinato 200 mcg/2 mL",
    quantity: 2,
    price: "51.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060116",
    catalogCode: "STIN-P062",
    name: "L-Taurina 150 mg/2 mL",
    quantity: 1,
    price: "47.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
  {
    supplierSku: "PA05060063",
    catalogCode: "STIN-P091",
    name: "Selênio 80 mcg/2 mL",
    quantity: 1,
    price: "40.00",
    packaging: "Box — 10 ampolas",
    contents: "10 ampolas · 2 mL",
  },
];

const subtotal = lines.reduce((total, line) => total + Number(line.price) * line.quantity, 0);
if (subtotal.toFixed(2) !== "6536.20") throw new Error("Order total mismatch");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const existing = await client.query("SELECT id FROM inventory_purchases WHERE reference=$1", [
    REFERENCE,
  ]);
  if (existing.rowCount) {
    console.log(`Order already exists: ${existing.rows[0].id}`);
    await client.query("ROLLBACK");
    process.exitCode = 0;
  } else {
    const unit = await client.query(
      `SELECT id,organization_id AS "organizationId" FROM inventory_units
       WHERE id='a1100000-0000-4000-8000-000000000101' AND name='Fortaleza'`,
    );
    await client.query(
      `INSERT INTO inventory_suppliers(id,organization_id,name,active,phone,email)
       VALUES($1,$2,'Stin Pharma',true,'551120781800','stinpharma@stinpharma.com.br')
       ON CONFLICT(id) DO NOTHING`,
      [SUPPLIER_ID, unit.rows[0]?.organizationId],
    );
    const supplier = await client.query(
      "SELECT id,name,phone,email,active,version FROM inventory_suppliers WHERE id=$1 AND organization_id=$2 AND name='Stin Pharma' AND active",
      [SUPPLIER_ID, unit.rows[0]?.organizationId],
    );
    const actor = await client.query(
      `SELECT u.id,u.name FROM inventory_users u
       JOIN inventory_memberships m ON m.user_id=u.id AND m.active
       WHERE u.active AND m.role='SUPER_ADMIN' AND m.organization_id=(SELECT organization_id FROM inventory_suppliers WHERE id=$1)
       ORDER BY u.created_at LIMIT 1`,
      [supplier.rows[0]?.id ?? null],
    );
    if (unit.rowCount !== 1 || supplier.rowCount !== 1 || actor.rowCount !== 1)
      throw new Error("Fortaleza, Stin Pharma or active pilot administrator not found");

    const snapshotLines = [];
    for (const line of lines) {
      let catalog = line.catalogCode
        ? await client.query(
            "SELECT * FROM inventory_supplier_catalog WHERE supplier_id=$1 AND code=$2 FOR UPDATE",
            [supplier.rows[0].id, line.catalogCode],
          )
        : await client.query(
            "SELECT * FROM inventory_supplier_catalog WHERE supplier_id=$1 AND supplier_sku=$2 FOR UPDATE",
            [supplier.rows[0].id, line.supplierSku],
          );
      if (!catalog.rowCount) {
        const catalogId = randomUUID();
        catalog = await client.query(
          `INSERT INTO inventory_supplier_catalog(id,supplier_id,code,supplier_sku,name,kind,description,packaging,contents,boxes_per_pack,price,price_source,active)
           VALUES($1,$2,$3,$4,$5,'PRODUCT',$6,$7,$8,1,$9,$10,true) RETURNING *`,
          [
            catalogId,
            supplier.rows[0].id,
            `STIN-OF-${line.supplierSku}`,
            line.supplierSku,
            line.name,
            "Apresentação transcrita do espelho 098059; conferir lote, validade e volume no recebimento.",
            line.packaging,
            line.contents,
            line.price,
            "Espelho Stin 098059 · emissão 29/09/2026",
          ],
        );
      }
      const item = catalog.rows[0];
      if (Number(item.price).toFixed(2) !== line.price)
        throw new Error(`Catalog price differs for ${line.catalogCode ?? line.supplierSku}`);
      let productId = item.product_id as string | null;
      if (!productId) {
        productId = randomUUID();
        await client.query(
          "INSERT INTO inventory_products(id,organization_id,name,sku,category,unit,minimum) SELECT $1,organization_id,$2,$3,'Catálogo Stin Pharma','apresentação',0 FROM inventory_suppliers WHERE id=$4",
          [productId, line.name, `STIN-${line.supplierSku}`, supplier.rows[0].id],
        );
        await client.query("UPDATE inventory_supplier_catalog SET product_id=$2 WHERE id=$1", [
          item.id,
          productId,
        ]);
      }
      await client.query(
        "UPDATE inventory_supplier_catalog SET supplier_sku=COALESCE(supplier_sku,$2) WHERE id=$1",
        [item.id, line.supplierSku],
      );
      snapshotLines.push({
        catalogItemId: item.id,
        productId,
        code: item.code,
        supplierSku: line.supplierSku,
        name: line.name,
        packaging: line.packaging,
        contents: line.contents,
        quantity: line.quantity,
        boxes: line.quantity,
        price: line.price,
        subtotal: (Number(line.price) * line.quantity).toFixed(2),
        priceSource: "Espelho Stin 098059 · emissão 29/09/2026",
      });
    }

    const notes =
      "Unidade operacional: Fortaleza. Previsão informada de chegada: 24/10/2026. Documento original contém endereço de Juazeiro do Norte; destino Fortaleza confirmado pelo solicitante. Quantidades em caixas comerciais. Nenhum saldo criado antes do recebimento físico. Fonte SHA-256: " +
      SOURCE_SHA256;
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ reference: REFERENCE, lines, notes }))
      .digest("hex");
    await client.query(
      "INSERT INTO inventory_purchases(id,unit_id,reference,supplier_id,request_hash) VALUES($1,$2,$3,$4,$5)",
      [ORDER_ID, unit.rows[0].id, REFERENCE, supplier.rows[0].id, requestHash],
    );
    for (const item of snapshotLines)
      await client.query(
        "INSERT INTO inventory_purchase_items(purchase_id,product_id,quantity,unit_cost) VALUES($1,$2,$3,$4)",
        [ORDER_ID, item.productId, item.quantity, item.price],
      );
    await client.query(
      "INSERT INTO inventory_supplier_orders(id,request_hash,supplier_snapshot,items_snapshot,subtotal,freight,total,notes,actor,actor_user_id) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,0,$5,$6,$7,$8)",
      [
        ORDER_ID,
        requestHash,
        JSON.stringify(supplier.rows[0]),
        JSON.stringify(snapshotLines),
        subtotal.toFixed(2),
        notes,
        actor.rows[0].name,
        actor.rows[0].id,
      ],
    );
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        id: ORDER_ID,
        reference: REFERENCE,
        unit: "Fortaleza",
        lines: lines.length,
        total: subtotal.toFixed(2),
        received: "0.000",
      }),
    );
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
