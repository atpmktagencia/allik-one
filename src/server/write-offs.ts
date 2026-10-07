import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { actor, authenticate, can, canAccessLocations } from "./auth";
import { getPool } from "./db";
import { decimal } from "../data/receipt-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const inputSchema = z.object({
  operationId: z.string().uuid(),
  type: z.enum(["LOSS", "DAMAGE", "EXPIRED", "CONSUMPTION"]),
  lotId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: decimal(11, 3, true),
  reference: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(10).max(500),
});

export async function writeOffResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para registrar a baixa." }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira lote, local, quantidade, referência e motivo." },
      { status: 400, headers },
    );
  const input = parsed.data;
  const permission = input.type === "CONSUMPTION" ? "inventory.consume" : "inventory.loss.record";
  if (!can(auth, permission) || !(await canAccessLocations(auth, [input.locationId])))
    return Response.json({ error: "Acesso negado para esta unidade." }, { status: 403, headers });
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `write-off:${input.operationId}`,
    ]);
    const previous = await client.query(
      "SELECT request_hash,movement_id FROM inventory_write_offs WHERE id=$1",
      [input.operationId],
    );
    if (previous.rowCount) {
      if (previous.rows[0].request_hash !== hash) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Esta baixa já foi enviada com outros dados." },
          { status: 409, headers },
        );
      }
      await client.query("COMMIT");
      return Response.json(
        {
          data: { id: input.operationId, movementId: previous.rows[0].movement_id, replayed: true },
        },
        { headers },
      );
    }
    const balance = await client.query(
      `SELECT b.quantity::text,l.status,
              l.expires_on < (NOW() AT TIME ZONE 'America/Fortaleza')::date AS expired
         FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id
        WHERE b.lot_id=$1 AND b.location_id=$2 FOR UPDATE OF b,l`,
      [input.lotId, input.locationId],
    );
    if (!balance.rowCount || Number(balance.rows[0].quantity) < Number(input.quantity)) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Saldo insuficiente para esta baixa." },
        { status: 409, headers },
      );
    }
    if (
      input.type === "CONSUMPTION" &&
      (balance.rows[0].status !== "AVAILABLE" || balance.rows[0].expired)
    ) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Lote bloqueado, em quarentena ou vencido não pode ser consumido." },
        { status: 409, headers },
      );
    }
    if (input.type === "EXPIRED" && !balance.rows[0].expired) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Use a baixa por vencimento somente para lotes vencidos." },
        { status: 409, headers },
      );
    }
    const movement = await client.query(
      "INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,actor_user_id,reference,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [
        input.lotId,
        input.locationId,
        input.type,
        `-${input.quantity}`,
        actor(auth).name,
        actor(auth).userId,
        input.reference,
        input.reason,
        `${input.operationId}:0`,
      ],
    );
    await client.query(
      "INSERT INTO inventory_write_offs(id,movement_id,type,request_hash,reference,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [input.operationId, movement.rows[0].id, input.type, hash, input.reference, input.reason],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.operationId, movementId: movement.rows[0].id, replayed: false } },
      { status: 201, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(
      "Inventory write-off failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { error: "Não foi possível registrar a baixa." },
      { status: 503, headers },
    );
  } finally {
    client.release();
  }
}
