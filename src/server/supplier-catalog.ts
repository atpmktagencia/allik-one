import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { hasPreviewSession } from "./auth";
import { getPool } from "./db";
import {
  supplierProfileInput,
  supplierCatalogInput,
  supplierOrderInput,
  type SupplierProfile,
  type SupplierCatalogItem,
  type SupplierOrder,
  type SupplierOrderLine,
} from "../data/supplier-input";
import { cents, decimalMoney, orderCsv, orderHtml, orderMessage } from "../data/order-export";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const supplierColumns = "id,name,phone,email,active,version";
const catalogColumns = `id,supplier_id AS "supplierId",product_id AS "productId",code,supplier_sku AS "supplierSku",name,kind,description,packaging,contents,boxes_per_pack AS "boxesPerPack",price::text,pricing_note AS "pricingNote",price_source AS "priceSource",source_page AS "sourcePage",active,version`;
const orderColumns = `o.id,p.reference,o.supplier_snapshot AS supplier,o.items_snapshot AS items,o.subtotal::text,o.freight::text,o.total::text,o.notes,o.actor,o.created_at AS date`;
class Conflict extends Error {}
class Missing extends Error {}
const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function audit(
  client: PoolClient,
  id: string,
  supplierId: string,
  catalogId: string | null,
  action: string,
  hash: string,
  before: unknown,
  after: unknown,
  reason: string,
) {
  await client.query(
    `INSERT INTO inventory_supplier_changes(id,supplier_id,catalog_item_id,action,request_hash,before_data,after_data,actor,reason) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'preview-operator',$8)`,
    [
      id,
      supplierId,
      catalogId,
      action,
      hash,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      reason,
    ],
  );
}

async function saveProfile(
  client: PoolClient,
  input: z.infer<typeof supplierProfileInput>,
  hash: string,
) {
  let before: SupplierProfile | null = null;
  let after: SupplierProfile;
  if (input.action === "CREATE") {
    after = (
      await client.query(
        `INSERT INTO inventory_suppliers(id,name,phone,email,active) VALUES($1,$2,$3,$4,$5) RETURNING ${supplierColumns}`,
        [input.id, input.name, input.phone || null, input.email || null, input.active],
      )
    ).rows[0];
  } else {
    before = (
      await client.query(
        `SELECT ${supplierColumns} FROM inventory_suppliers WHERE id=$1 FOR UPDATE`,
        [input.id],
      )
    ).rows[0];
    if (!before) throw new Missing("Fornecedor não encontrado.");
    if (before.version !== input.version)
      throw new Conflict("O fornecedor mudou. Atualize os dados e confira novamente.");
    if (before.active && !input.active) {
      const pending = await client.query(
        `SELECT 1 FROM inventory_purchases p JOIN inventory_purchase_items i ON i.purchase_id=p.id WHERE p.supplier_id=$1 AND i.received<i.quantity LIMIT 1`,
        [input.id],
      );
      if (pending.rowCount)
        throw new Conflict("O fornecedor tem pedidos com recebimento pendente.");
    }
    after = (
      await client.query(
        `UPDATE inventory_suppliers SET name=$2,phone=$3,email=$4,active=$5,version=version+1 WHERE id=$1 RETURNING ${supplierColumns}`,
        [input.id, input.name, input.phone || null, input.email || null, input.active],
      )
    ).rows[0];
  }
  await audit(
    client,
    input.operationId,
    input.id,
    null,
    input.action,
    hash,
    before,
    after,
    input.action === "CREATE" ? "Cadastro inicial do fornecedor" : input.reason,
  );
  return after;
}

async function saveCatalog(
  client: PoolClient,
  input: z.infer<typeof supplierCatalogInput>,
  hash: string,
) {
  const supplier = await client.query(
    "SELECT id FROM inventory_suppliers WHERE id=$1 AND active FOR SHARE",
    [input.supplierId],
  );
  if (!supplier.rowCount) throw new Conflict("Fornecedor indisponível.");
  let before: SupplierCatalogItem | null = null;
  if (input.action === "UPDATE") {
    before = (
      await client.query(
        `SELECT ${catalogColumns} FROM inventory_supplier_catalog WHERE id=$1 FOR UPDATE`,
        [input.id],
      )
    ).rows[0];
    if (!before || before.supplierId !== input.supplierId)
      throw new Missing("Item não encontrado neste fornecedor.");
    if (before.version !== input.version)
      throw new Conflict("O item ou preço mudou. Atualize o catálogo e confira novamente.");
    if (
      before.productId &&
      (before.code !== input.code ||
        before.packaging !== input.packaging ||
        before.contents !== input.contents ||
        before.boxesPerPack !== input.boxesPerPack)
    )
      throw new Conflict(
        "Este item já tem pedidos. Cadastre uma nova apresentação para alterar código, embalagem ou conteúdo.",
      );
  }
  const values = [
    input.id,
    input.supplierId,
    input.code,
    input.supplierSku || null,
    input.name,
    input.kind,
    input.description,
    input.packaging,
    input.contents,
    input.boxesPerPack,
    input.price,
    input.priceSource,
    input.active,
  ];
  const after: SupplierCatalogItem = (
    await client.query(
      input.action === "CREATE"
        ? `INSERT INTO inventory_supplier_catalog(id,supplier_id,code,supplier_sku,name,kind,description,packaging,contents,boxes_per_pack,price,price_source,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${catalogColumns}`
        : `UPDATE inventory_supplier_catalog SET code=$3,supplier_sku=$4,name=$5,kind=$6,description=$7,packaging=$8,contents=$9,boxes_per_pack=$10,price=$11,price_source=$12,active=$13,pricing_note=NULL,version=version+1 WHERE id=$1 AND supplier_id=$2 RETURNING ${catalogColumns}`,
      values,
    )
  ).rows[0];
  await audit(
    client,
    input.operationId,
    input.supplierId,
    input.id,
    input.action,
    hash,
    before,
    after,
    input.action === "CREATE" ? "Cadastro inicial do item comercial" : input.reason,
  );
  return after;
}

async function createOrder(
  client: PoolClient,
  input: z.infer<typeof supplierOrderInput>,
  hash: string,
): Promise<SupplierOrder> {
  const supplier: SupplierProfile = (
    await client.query(`SELECT ${supplierColumns} FROM inventory_suppliers WHERE id=$1 FOR SHARE`, [
      input.supplierId,
    ])
  ).rows[0];
  if (!supplier?.active) throw new Conflict("Fornecedor indisponível.");
  if (supplier.version !== input.supplierVersion)
    throw new Conflict("O fornecedor mudou. Atualize e confira o pedido novamente.");
  // Consistent ordering prevents cross-order deadlocks. All prices are rechecked under the row locks.
  const locked = await client.query(
    `SELECT ${catalogColumns} FROM inventory_supplier_catalog WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [input.items.map((i) => i.catalogItemId)],
  );
  const items: SupplierOrderLine[] = [];
  let subtotal = 0n;
  for (const selected of input.items) {
    const item = locked.rows.find((i: SupplierCatalogItem) => i.id === selected.catalogItemId) as
      SupplierCatalogItem | undefined;
    if (!item || item.supplierId !== input.supplierId || !item.active || item.price === null)
      throw new Conflict("Um item está indisponível ou tem preço pendente de confirmação.");
    if (item.version !== selected.version || cents(item.price) !== cents(selected.expectedPrice))
      throw new Conflict(
        `O preço ou cadastro de ${item.code} mudou. Atualize o catálogo e confira os custos novamente.`,
      );
    let productId = item.productId;
    if (!productId) {
      productId = randomUUID();
      const product = (
        await client.query(
          `INSERT INTO inventory_products(id,name,sku,category,unit,minimum) VALUES($1,$2,$3,$4,'apresentação',0) RETURNING id,name,sku,category,unit,minimum::text,active,stock_controlled AS "stockControlled",version`,
          [productId, item.name, `CAT-${item.id}`, `Catálogo ${supplier.name}`.slice(0, 100)],
        )
      ).rows[0];
      await client.query("UPDATE inventory_supplier_catalog SET product_id=$2 WHERE id=$1", [
        item.id,
        productId,
      ]);
      await client.query(
        `INSERT INTO inventory_catalog_changes(id,product_id,action,request_hash,after_data,actor,reason) VALUES($1,$2,'CREATE',$3,$4::jsonb,'preview-operator','Produto vinculado à apresentação comercial do pedido')`,
        [randomUUID(), productId, hash, JSON.stringify(product)],
      );
    } else {
      const product = await client.query(
        "SELECT id FROM inventory_products WHERE id=$1 AND active AND stock_controlled AND unit='apresentação' FOR SHARE",
        [productId],
      );
      if (!product.rowCount)
        throw new Conflict(`O produto de ${item.code} está indisponível para estoque.`);
    }
    const lineTotal = cents(item.price) * BigInt(selected.quantity);
    subtotal += lineTotal;
    items.push({
      catalogItemId: item.id,
      productId,
      code: item.code,
      supplierSku: item.supplierSku,
      name: item.name,
      packaging: item.packaging,
      contents: item.contents,
      quantity: selected.quantity,
      boxes: item.boxesPerPack === null ? null : item.boxesPerPack * selected.quantity,
      price: item.price,
      subtotal: decimalMoney(lineTotal),
      priceSource: item.priceSource,
    });
  }
  const total = subtotal + (input.freight === null ? 0n : cents(input.freight));
  if (total > 99999999999999n)
    throw new Conflict(
      "O total excede o limite permitido para um pedido. Divida os itens em pedidos menores.",
    );
  await client.query(
    "INSERT INTO inventory_purchases(id,reference,supplier_id,request_hash) VALUES($1,$2,$3,$4)",
    [input.operationId, input.reference, input.supplierId, hash],
  );
  for (const item of items)
    await client.query(
      "INSERT INTO inventory_purchase_items(purchase_id,product_id,quantity,unit_cost) VALUES($1,$2,$3,$4)",
      [input.operationId, item.productId, item.quantity, item.price],
    );
  const saved = await client.query(
    `INSERT INTO inventory_supplier_orders(id,request_hash,supplier_snapshot,items_snapshot,subtotal,freight,total,notes,actor) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,'preview-operator') RETURNING created_at AS date`,
    [
      input.operationId,
      hash,
      JSON.stringify(supplier),
      JSON.stringify(items),
      decimalMoney(subtotal),
      input.freight,
      decimalMoney(total),
      input.notes,
    ],
  );
  return {
    id: input.operationId,
    reference: input.reference,
    supplier,
    items,
    subtotal: decimalMoney(subtotal),
    freight: input.freight,
    total: decimalMoney(total),
    notes: input.notes,
    actor: "preview-operator",
    date: saved.rows[0].date,
  };
}

export async function supplierCatalogResponse(request: Request) {
  if (!hasPreviewSession(request))
    return Response.json(
      { error: "Entre para acessar fornecedores e pedidos." },
      { status: 401, headers },
    );
  if (!["GET", "POST"].includes(request.method))
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  const url = new URL(request.url);
  const resource = url.pathname.replace(/\/$/, "").split("/").at(-1);
  let client: PoolClient | undefined;
  try {
    if (request.method === "GET") {
      if (resource === "vendors")
        return Response.json(
          {
            data: (
              await getPool().query(
                `SELECT ${supplierColumns} FROM inventory_suppliers ORDER BY name,id`,
              )
            ).rows,
          },
          { headers },
        );
      if (resource === "vendor-catalog" || resource === "vendor-history") {
        const supplierId = z.string().uuid().safeParse(url.searchParams.get("supplierId"));
        if (!supplierId.success)
          return Response.json(
            { error: "Informe um fornecedor válido." },
            { status: 400, headers },
          );
        const rows =
          resource === "vendor-catalog"
            ? await getPool().query(
                `SELECT ${catalogColumns} FROM inventory_supplier_catalog WHERE supplier_id=$1 ORDER BY code,id`,
                [supplierId.data],
              )
            : await getPool().query(
                `SELECT id,catalog_item_id AS "catalogItemId",action,actor,reason,created_at AS date,before_data AS before,after_data AS after FROM inventory_supplier_changes WHERE supplier_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`,
                [supplierId.data],
              );
        return Response.json({ data: rows.rows }, { headers });
      }
      if (resource === "vendor-orders") {
        const id = url.searchParams.get("id");
        if (id && !z.string().uuid().safeParse(id).success)
          return Response.json({ error: "Pedido inválido." }, { status: 400, headers });
        const result = await getPool().query(
          `SELECT ${orderColumns},(SELECT CASE WHEN bool_and(i.received=i.quantity) THEN 'RECEIVED' WHEN bool_or(i.received>0) THEN 'PARTIAL' ELSE 'OPEN' END FROM inventory_purchase_items i WHERE i.purchase_id=o.id) AS status FROM inventory_supplier_orders o JOIN inventory_purchases p ON p.id=o.id ${id ? "WHERE o.id=$1" : ""} ORDER BY o.created_at DESC,o.id LIMIT 100`,
          id ? [id] : [],
        );
        if (id && !result.rowCount) throw new Missing("Pedido não encontrado.");
        const format = url.searchParams.get("format");
        if (id && format) {
          const order = result.rows[0] as SupplierOrder;
          const filename = `pedido-${order.reference.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100)}`;
          if (format === "csv")
            return new Response(orderCsv(order), {
              headers: {
                ...headers,
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}.csv"`,
              },
            });
          if (format === "txt")
            return new Response(orderMessage(order), {
              headers: {
                ...headers,
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}.txt"`,
              },
            });
          if (format === "html")
            return new Response(orderHtml(order), {
              headers: {
                ...headers,
                "Content-Type": "text/html; charset=utf-8",
                "Content-Security-Policy":
                  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
              },
            });
          return Response.json({ error: "Formato não permitido." }, { status: 400, headers });
        }
        return Response.json({ data: id ? result.rows[0] : result.rows }, { headers });
      }
      throw new Missing("Recurso não encontrado.");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
    }
    const schema =
      resource === "vendors"
        ? supplierProfileInput
        : resource === "vendor-catalog"
          ? supplierCatalogInput
          : resource === "vendor-orders"
            ? supplierOrderInput
            : null;
    if (!schema) throw new Missing("Recurso não encontrado.");
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return Response.json(
        {
          error:
            "Confira os campos, quantidades e preços. Edições exigem motivo com pelo menos 10 caracteres.",
        },
        { status: 400, headers },
      );
    const hash = hashOf({ resource, input: parsed.data });
    client = await getPool().connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `vendor:${parsed.data.operationId}`,
    ]);
    const previous =
      resource === "vendor-orders"
        ? await client.query(
            `SELECT o.request_hash,${orderColumns} FROM inventory_supplier_orders o JOIN inventory_purchases p ON p.id=o.id WHERE o.id=$1`,
            [parsed.data.operationId],
          )
        : await client.query(
            "SELECT request_hash,after_data FROM inventory_supplier_changes WHERE id=$1",
            [parsed.data.operationId],
          );
    if (previous.rowCount) {
      if (previous.rows[0].request_hash !== hash)
        throw new Conflict("Esta operação já foi enviada com outros dados.");
      await client.query("COMMIT");
      const row = previous.rows[0];
      if (resource === "vendor-orders") delete row.request_hash;
      return Response.json(
        {
          data:
            resource === "vendor-orders"
              ? { order: row, replayed: true }
              : { item: row.after_data, replayed: true },
        },
        { headers },
      );
    }
    const result =
      resource === "vendors"
        ? await saveProfile(client, supplierProfileInput.parse(body), hash)
        : resource === "vendor-catalog"
          ? await saveCatalog(client, supplierCatalogInput.parse(body), hash)
          : await createOrder(client, supplierOrderInput.parse(body), hash);
    await client.query("COMMIT");
    return Response.json(
      {
        data:
          resource === "vendor-orders"
            ? { order: result, replayed: false }
            : { item: result, replayed: false },
      },
      {
        status:
          resource === "vendor-orders" ||
          ("action" in parsed.data && parsed.data.action === "CREATE")
            ? 201
            : 200,
        headers,
      },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof Conflict || error instanceof Missing)
      return Response.json(
        { error: error.message },
        { status: error instanceof Missing ? 404 : 409, headers },
      );
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (["23505", "40P01"].includes(code))
      return Response.json(
        {
          error:
            code === "23505"
              ? "Já existe um cadastro com este código, nome ou referência."
              : "Outra operação alterou os dados. Atualize e confira novamente.",
        },
        { status: 409, headers },
      );
    console.error("Supplier catalog failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json(
      { error: "Não foi possível confirmar a operação. Reenvie os mesmos dados para conferir." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
