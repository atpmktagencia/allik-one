import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { actor, authenticate, can, canAccessLocations } from "./auth";
import { getPool } from "./db";
import { adjustmentInput, transferInput } from "../data/stock-operation-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
class StockConflict extends Error {}

export async function stockOperationResponse(request: Request, type: "TRANSFER" | "ADJUSTMENT") {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para movimentar o estoque." }, { status: 401, headers });
  if (!can(auth, type === "TRANSFER" ? "inventory.transfer" : "inventory.adjust"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed =
    type === "TRANSFER" ? transferInput.safeParse(body) : adjustmentInput.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira lote, locais, quantidade, referência e motivo (mínimo de 10 caracteres)." },
      { status: 400, headers },
    );
  const input = parsed.data;
  const sourceId = "sourceId" in input ? input.sourceId : input.locationId;
  const destinationId = "destinationId" in input ? input.destinationId : null;
  if (!(await canAccessLocations(auth, destinationId ? [sourceId, destinationId] : [sourceId])))
    return Response.json(
      { error: "Uma das localizações não pertence a uma unidade autorizada." },
      { status: 403, headers },
    );
  const hash = createHash("sha256").update(JSON.stringify({ type, input })).digest("hex");
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO inventory_operations(id,type,request_hash,source_id,destination_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id",
      [input.operationId, type, hash, sourceId, destinationId],
    );
    if (!inserted.rowCount) {
      const previous = await client.query(
        "SELECT request_hash FROM inventory_operations WHERE id=$1",
        [input.operationId],
      );
      if (previous.rows[0]?.request_hash !== hash)
        throw new StockConflict("Esta operação já foi enviada com outros dados.");
      await client.query("COMMIT");
      return Response.json({ data: { id: input.operationId, replayed: true } }, { headers });
    }
    const locations = await client.query(
      "SELECT id FROM inventory_locations WHERE id=ANY($1::uuid[]) AND active ORDER BY id FOR SHARE",
      [destinationId ? [sourceId, destinationId] : [sourceId]],
    );
    if (locations.rowCount !== (destinationId ? 2 : 1))
      throw new StockConflict("Localização indisponível.");
    const lot = await client.query(
      "SELECT l.status,(l.expires_on >= (NOW() AT TIME ZONE 'America/Fortaleza')::date) AS valid,p.active,p.stock_controlled FROM inventory_lots l JOIN inventory_products p ON p.id=l.product_id WHERE l.id=$1 FOR SHARE OF l,p",
      [input.lotId],
    );
    const item = lot.rows[0];
    if (!item?.active || !item.stock_controlled)
      throw new StockConflict("Produto ou lote indisponível para estoque.");
    if (type === "TRANSFER" && (item.status !== "AVAILABLE" || !item.valid))
      throw new StockConflict("Transferências exigem um lote disponível e dentro da validade.");
    // Consistent lock ordering avoids opposite transfers deadlocking on existing balances.
    const balances = await client.query(
      "SELECT location_id,quantity::text FROM inventory_balances WHERE lot_id=$1 AND location_id=ANY($2::uuid[]) ORDER BY location_id FOR UPDATE",
      [input.lotId, destinationId ? [sourceId, destinationId] : [sourceId]],
    );
    const source = balances.rows.find(
      (row: { location_id: string }) => row.location_id === sourceId,
    );
    if (!source) throw new StockConflict("Posição de estoque não encontrada. Atualize os dados.");
    let changes: { locationId: string; delta: string }[];
    if ("quantity" in input) {
      const available = await client.query("SELECT $1::numeric >= $2::numeric AS enough", [
        source.quantity,
        input.quantity,
      ]);
      if (!available.rows[0].enough)
        throw new StockConflict("Saldo insuficiente para esta transferência.");
      changes = [
        { locationId: sourceId, delta: `-${input.quantity}` },
        { locationId: input.destinationId, delta: input.quantity },
      ];
    } else {
      const comparison = await client.query(
        "SELECT $1::numeric=$2::numeric AS matches,($3::numeric-$1::numeric)::text AS delta",
        [source.quantity, input.expectedQuantity, input.countedQuantity],
      );
      if (!comparison.rows[0].matches)
        throw new StockConflict(
          "O saldo mudou desde a consulta. Atualize o estoque e confira a contagem novamente.",
        );
      const delta = comparison.rows[0].delta as string;
      if (Number(delta) === 0)
        throw new StockConflict("A contagem é igual ao saldo atual. Nenhum ajuste é necessário.");
      changes = [{ locationId: sourceId, delta }];
    }
    for (const [index, change] of changes.entries()) {
      const movement = await client.query(
        "INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,actor_user_id,reference,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        [
          input.lotId,
          change.locationId,
          type,
          change.delta,
          actor(auth).name,
          actor(auth).userId,
          input.reference,
          input.reason,
          `${input.operationId}:${index}`,
        ],
      );
      await client.query(
        "INSERT INTO inventory_operation_movements(operation_id,movement_id) VALUES($1,$2)",
        [input.operationId, movement.rows[0].id],
      );
    }
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.operationId, replayed: false } },
      { status: 201, headers },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof StockConflict)
      return Response.json({ error: error.message }, { status: 409, headers });
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["23503", "23514", "22003"].includes(String(error.code))
    )
      return Response.json(
        {
          error:
            "O estoque não permite esta movimentação. Atualize os dados e confira as quantidades.",
        },
        { status: 409, headers },
      );
    console.error("Stock operation failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json(
      { error: "Não foi possível confirmar a operação. Tente novamente com os mesmos dados." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
