import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import { actor, authenticate, can } from "./auth";
import { getPool } from "./db";
import { openPresentationInput } from "../data/open-presentation-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
class OpenPresentationConflict extends Error {}
class OpenPresentationDenied extends Error {}

export async function openPresentationResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json(
      { error: "Entre para acessar apresentações abertas." },
      { status: 401, headers },
    );
  const url = new URL(request.url);
  const requestedUnit = url.searchParams.get("unitId");
  if (request.method === "GET") {
    if (!can(auth, "inventory.read"))
      return Response.json({ error: "Acesso negado." }, { status: 403, headers });
    if (requestedUnit && !can(auth, "inventory.read", requestedUnit))
      return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
    const unrestricted =
      auth.preview || auth.role === "SUPER_ADMIN" || auth.role === "PARTNER_ADMIN";
    const result = await getPool().query(
      `SELECT op.id,op.unit_id AS "unitId",u.name AS "unitName",op.location_id AS "locationId",
        loc.name AS "locationName",op.product_id AS "productId",p.name AS "productName",p.sku,
        op.presentation_id AS "presentationId",pp.name AS "presentationName",op.lot_id AS "lotId",
        l.number AS lot,op.base_unit AS "baseUnit",op.initial_base_quantity AS "initialQuantity",
        op.remaining_base_quantity AS "remainingQuantity",op.opened_at AS "openedAt",
        op.usable_until AS "usableUntil",op.status,op.version,
        COALESCE(sum(e.quantity) FILTER (WHERE e.type='CONSUME'),0) AS "consumedQuantity",
        COALESCE(sum(e.quantity) FILTER (WHERE e.type IN ('TECHNICAL_LOSS','EXPIRED','DAMAGE','DISCARD')),0) AS "lossQuantity"
       FROM inventory_open_presentations op
       JOIN inventory_units u ON u.id=op.unit_id
       JOIN inventory_locations loc ON loc.id=op.location_id
       JOIN inventory_products p ON p.id=op.product_id
       JOIN inventory_pricing_presentations pp ON pp.id=op.presentation_id
       JOIN inventory_lots l ON l.id=op.lot_id
       LEFT JOIN inventory_open_presentation_events e ON e.open_presentation_id=op.id
       WHERE op.organization_id=$1 AND ($2::uuid IS NULL OR op.unit_id=$2)
         AND ($3::boolean OR op.unit_id=ANY($4::uuid[]))
       GROUP BY op.id,u.name,loc.name,p.name,p.sku,pp.name,l.number
       ORDER BY (op.status='OPEN') DESC,op.usable_until,op.opened_at DESC LIMIT 300`,
      [auth.organizationId, requestedUnit, unrestricted, auth.unitIds],
    );
    return Response.json(
      { data: { items: result.rows, canDiscard: can(auth, "inventory.loss.record") } },
      { headers },
    );
  }
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== url.origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (!can(auth, "inventory.loss.record"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = openPresentationInput.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira o motivo e o tipo de descarte." },
      { status: 400, headers },
    );
  const input = parsed.data;
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const replay = await client.query(
      "SELECT id FROM inventory_open_presentation_events WHERE id=$1",
      [input.eventId],
    );
    if (replay.rowCount) {
      await client.query("COMMIT");
      return Response.json({ data: { id: input.eventId, replayed: true } }, { headers });
    }
    const current = await client.query(
      `SELECT * FROM inventory_open_presentations
       WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
      [input.openPresentationId, auth.organizationId],
    );
    if (!current.rowCount)
      throw new OpenPresentationConflict("Apresentação aberta não encontrada.");
    const item = current.rows[0];
    if (!can(auth, "inventory.loss.record", String(item.unit_id)))
      throw new OpenPresentationDenied("Unidade não autorizada.");
    if (item.version !== input.version)
      throw new OpenPresentationConflict("A apresentação mudou. Recarregue e tente novamente.");
    if (item.status !== "OPEN" || Number(item.remaining_base_quantity) <= 0)
      throw new OpenPresentationConflict("Esta apresentação não possui saldo aberto.");
    await client.query(
      `UPDATE inventory_open_presentations SET remaining_base_quantity=0,status='DISCARDED',
        version=version+1,updated_at=now() WHERE id=$1`,
      [input.openPresentationId],
    );
    await client.query(
      `INSERT INTO inventory_open_presentation_events(
        id,open_presentation_id,type,quantity,reason,actor,actor_user_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.eventId,
        input.openPresentationId,
        input.type,
        item.remaining_base_quantity,
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.eventId, replayed: false } },
      { status: 201, headers },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof OpenPresentationConflict)
      return Response.json({ error: error.message }, { status: 409, headers });
    if (error instanceof OpenPresentationDenied)
      return Response.json({ error: error.message }, { status: 403, headers });
    return Response.json(
      { error: "Não foi possível registrar o descarte." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
