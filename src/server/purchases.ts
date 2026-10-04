import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { hasPreviewSession } from "./auth";
import { getPool } from "./db";
import { purchaseInput, supplierInput } from "../data/purchase-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
class PurchaseConflict extends Error {}

export async function purchasingResponse(request: Request, resource: "suppliers" | "purchases") {
  if (!hasPreviewSession(request))
    return Response.json({ error: "Entre para acessar as compras." }, { status: 401, headers });
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  let client: PoolClient | undefined;
  try {
    if (request.method === "GET") {
      const result =
        resource === "suppliers"
          ? await getPool().query(
              "SELECT id,name FROM inventory_suppliers WHERE active ORDER BY name",
            )
          : await getPool()
              .query(`SELECT p.id,p.reference,p.supplier_id AS "supplierId",s.name AS supplier,
          CASE WHEN bool_and(i.received=i.quantity) THEN 'RECEIVED' WHEN bool_or(i.received>0) THEN 'PARTIAL' ELSE 'OPEN' END AS status,
          json_agg(json_build_object('id',i.id,'productId',i.product_id,'name',pr.name,'quantity',i.quantity::text,'received',i.received::text,'unitCost',i.unit_cost::text,'remaining',(i.quantity-i.received)::text) ORDER BY pr.name) AS items
          FROM inventory_purchases p JOIN inventory_suppliers s ON s.id=p.supplier_id
          JOIN inventory_purchase_items i ON i.purchase_id=p.id JOIN inventory_products pr ON pr.id=i.product_id
          GROUP BY p.id,s.name ORDER BY p.created_at DESC,p.id LIMIT 200`);
      return Response.json({ data: result.rows }, { headers });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
    }
    if (resource === "suppliers") {
      const parsed = supplierInput.safeParse(body);
      if (!parsed.success)
        return Response.json({ error: "Informe o nome do fornecedor." }, { status: 400, headers });
      const result = await getPool().query(
        "INSERT INTO inventory_suppliers(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id",
        [parsed.data.id, parsed.data.name],
      );
      if (!result.rowCount) {
        const existing = await getPool().query(
          "SELECT name,active FROM inventory_suppliers WHERE id=$1",
          [parsed.data.id],
        );
        if (existing.rows[0]?.name !== parsed.data.name || !existing.rows[0]?.active)
          throw new PurchaseConflict("Este cadastro já foi enviado com outros dados.");
      }
      return Response.json(
        { data: { id: parsed.data.id } },
        { status: result.rowCount ? 201 : 200, headers },
      );
    }
    const parsed = purchaseInput.safeParse(body);
    if (!parsed.success)
      return Response.json(
        {
          error:
            "Confira fornecedor, referência e itens. Cada produto deve aparecer uma única vez.",
        },
        { status: 400, headers },
      );
    const input = parsed.data;
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    client = await getPool().connect();
    await client.query("BEGIN");
    const supplier = await client.query(
      "SELECT id FROM inventory_suppliers WHERE id=$1 AND active FOR SHARE",
      [input.supplierId],
    );
    if (!supplier.rowCount) throw new PurchaseConflict("Fornecedor indisponível.");
    const result = await client.query(
      "INSERT INTO inventory_purchases(id,reference,supplier_id,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id",
      [input.id, input.reference, input.supplierId, hash],
    );
    if (!result.rowCount) {
      const existing = await client.query(
        "SELECT request_hash FROM inventory_purchases WHERE id=$1",
        [input.id],
      );
      if (existing.rows[0]?.request_hash !== hash)
        throw new PurchaseConflict("Este pedido já foi enviado com outros dados.");
    } else {
      for (const item of input.items) {
        const product = await client.query(
          "SELECT id FROM inventory_products WHERE id=$1 AND active AND stock_controlled FOR SHARE",
          [item.productId],
        );
        if (!product.rowCount) throw new PurchaseConflict("Produto indisponível para estoque.");
        await client.query(
          "INSERT INTO inventory_purchase_items(purchase_id,product_id,quantity,unit_cost) VALUES($1,$2,$3,$4)",
          [input.id, item.productId, item.quantity, item.unitCost],
        );
      }
    }
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.id } },
      { status: result.rowCount ? 201 : 200, headers },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof PurchaseConflict)
      return Response.json({ error: error.message }, { status: 409, headers });
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      return Response.json(
        { error: "Já existe um cadastro com este nome ou referência." },
        { status: 409, headers },
      );
    console.error(
      "Inventory purchase failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { error: "Não foi possível acessar as compras. Tente novamente com os mesmos dados." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
