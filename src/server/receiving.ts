import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { actor, authenticate, can, canAccessLocations } from "./auth";
import { getPool } from "./db";
import { receiptInput } from "../data/receipt-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
class ReceiptConflict extends Error {}

export async function receivingResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json(
      { error: "Entre para registrar o recebimento." },
      { status: 401, headers },
    );
  if (!can(auth, "inventory.receive"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = receiptInput.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira produto, localização, lote, validade, quantidade e custo." },
      { status: 400, headers },
    );
  const input = parsed.data;
  if (!(await canAccessLocations(auth, [input.locationId])))
    return Response.json(
      { error: "A localização não pertence a uma unidade autorizada." },
      { status: 403, headers },
    );
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO inventory_receipts(id,request_hash,reference,purchase_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id",
      [input.operationId, hash, input.reference, input.purchaseId ?? null],
    );
    if (!inserted.rowCount) {
      const previous = await client.query(
        "SELECT request_hash FROM inventory_receipts WHERE id=$1",
        [input.operationId],
      );
      if (previous.rows[0]?.request_hash !== hash)
        throw new ReceiptConflict("Este recebimento já foi enviado com outros dados.");
      await client.query("COMMIT");
      return Response.json({ data: { id: input.operationId, replayed: true } }, { headers });
    }
    if (input.purchaseId) {
      const purchase = await client.query(
        "SELECT p.reference,s.name AS supplier,s.active FROM inventory_purchases p JOIN inventory_suppliers s ON s.id=p.supplier_id WHERE p.id=$1 FOR NO KEY UPDATE OF p",
        [input.purchaseId],
      );
      const order = purchase.rows[0];
      if (
        !order ||
        !order.active ||
        order.reference !== input.reference ||
        order.supplier !== input.supplier
      )
        throw new ReceiptConflict(
          "Pedido ou fornecedor indisponível. Atualize os dados da compra.",
        );
    }
    const location = await client.query(
      "SELECT id FROM inventory_locations WHERE id=$1 AND active FOR SHARE",
      [input.locationId],
    );
    if (!location.rowCount) throw new ReceiptConflict("Localização indisponível.");
    const today = (
      await client.query("SELECT (NOW() AT TIME ZONE 'America/Fortaleza')::date::text AS today")
    ).rows[0].today as string;
    for (const [index, item] of input.items.entries()) {
      if (input.purchaseId) {
        const updated = await client.query(
          "UPDATE inventory_purchase_items SET received=received+$1::numeric WHERE id=$2 AND purchase_id=$3 AND product_id=$4 AND unit_cost=$5::numeric AND received+$1::numeric<=quantity RETURNING id",
          [item.quantity, item.purchaseItemId, input.purchaseId, item.productId, item.unitCost],
        );
        if (!updated.rowCount)
          throw new ReceiptConflict(
            "Quantidade acima do saldo pendente ou item/custo diferente do pedido.",
          );
      }
      if (item.expiry < today) throw new ReceiptConflict("Não é possível receber um lote vencido.");
      const product = await client.query(
        "SELECT id FROM inventory_products WHERE id=$1 AND active AND stock_controlled FOR SHARE",
        [item.productId],
      );
      if (!product.rowCount) throw new ReceiptConflict("Produto indisponível para estoque.");
      await client.query(
        "INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost) VALUES($1,$2,$3,$4,$5) ON CONFLICT(product_id,number) DO NOTHING",
        [item.productId, item.lot, item.expiry, input.supplier, item.unitCost],
      );
      const lot = await client.query(
        "SELECT id, status, expires_on::text AS expiry, supplier, unit_cost::text AS cost FROM inventory_lots WHERE product_id=$1 AND number=$2 FOR UPDATE",
        [item.productId, item.lot],
      );
      const existing = lot.rows[0];
      if (
        existing.status !== "AVAILABLE" ||
        existing.expiry !== item.expiry ||
        existing.supplier !== input.supplier ||
        Number(existing.cost) !== Number(item.unitCost)
      )
        throw new ReceiptConflict(
          "O lote existente tem validade, fornecedor, custo ou status diferente. Confira os dados.",
        );
      const movement = await client.query(
        "INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,actor_user_id,reference,reason,operation_key) VALUES($1,$2,'IN',$3,$4,$5,$6,'Recebimento de compra',$7) RETURNING id",
        [
          existing.id,
          input.locationId,
          item.quantity,
          actor(auth).name,
          actor(auth).userId,
          input.reference,
          `${input.operationId}:${index}`,
        ],
      );
      await client.query(
        "INSERT INTO inventory_receipt_movements(receipt_id,movement_id) VALUES($1,$2)",
        [input.operationId, movement.rows[0].id],
      );
      if (item.purchaseItemId)
        await client.query(
          "INSERT INTO inventory_receipt_items(receipt_id,purchase_item_id,movement_id) VALUES($1,$2,$3)",
          [input.operationId, item.purchaseItemId, movement.rows[0].id],
        );
    }
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.operationId, replayed: false } },
      { status: 201, headers },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof ReceiptConflict)
      return Response.json({ error: error.message }, { status: 409, headers });
    if (error && typeof error === "object" && "code" in error && error.code === "23503")
      return Response.json(
        { error: "Pedido ou item não encontrado. Atualize os dados da compra." },
        { status: 409, headers },
      );
    console.error(
      "Inventory receiving failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { error: "Não foi possível registrar o recebimento. Tente novamente com os mesmos dados." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
