import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import { hasPreviewSession } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const cursorSchema = z.object({
  date: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});
export async function lotTraceResponse(request: Request) {
  if (!hasPreviewSession(request))
    return Response.json(
      { error: "Entre para consultar a rastreabilidade." },
      { status: 401, headers },
    );
  if (request.method !== "GET")
    return Response.json(
      { error: "Método não permitido." },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/inventory\/trace\/lots\/([^/]+)\/?$/);
  if (!match) return Response.json({ error: "Recurso não encontrado." }, { status: 404, headers });
  const lotId = match[1]!;
  if (!z.string().uuid().safeParse(lotId).success)
    return Response.json({ error: "Lote inválido." }, { status: 400, headers });
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (url.searchParams.has("cursor")) {
    try {
      const encoded = url.searchParams.get("cursor")!;
      if (encoded.length > 500 || !/^[A-Za-z0-9_-]+$/.test(encoded))
        throw new Error("Invalid cursor");
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    } catch {
      return Response.json({ error: "Página de histórico inválida." }, { status: 400, headers });
    }
  }
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    // Every page reads lot, balances, ledger and audit from one consistent snapshot.
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const lot = await client.query(
      `SELECT l.id,l.number,l.expires_on::text AS expiry,l.supplier,l.unit_cost::text AS "unitCost",
      CASE WHEN l.expires_on < (NOW() AT TIME ZONE 'America/Fortaleza')::date THEN 'EXPIRED' ELSE l.status END AS status,
      p.id AS "productId",p.name AS product,p.unit,p.active AS "productActive"
      FROM inventory_lots l JOIN inventory_products p ON p.id=l.product_id WHERE l.id=$1`,
      [lotId],
    );
    if (!lot.rowCount) {
      await client.query("COMMIT");
      return Response.json({ error: "Lote não encontrado." }, { status: 404, headers });
    }
    const balances = await client.query(
      `WITH ledger AS (SELECT location_id,sum(delta) AS quantity FROM inventory_movements WHERE lot_id=$1 GROUP BY location_id)
      SELECT loc.id AS "locationId",loc.name AS location,loc.active,COALESCE(b.quantity,0)::text AS quantity,
      COALESCE(ledger.quantity,0)::text AS "ledgerQuantity",COALESCE(b.quantity,0)=COALESCE(ledger.quantity,0) AS matches
      FROM inventory_locations loc LEFT JOIN inventory_balances b ON b.location_id=loc.id AND b.lot_id=$1
      LEFT JOIN ledger ON ledger.location_id=loc.id WHERE b.id IS NOT NULL OR ledger.location_id IS NOT NULL ORDER BY loc.name,loc.id`,
      [lotId],
    );
    const summary = await client.query(
      `SELECT COALESCE(sum(m.delta) FILTER(WHERE m.type='IN'),0)::text AS received,
      COALESCE(sum(-m.delta) FILTER(WHERE am.application_id IS NOT NULL),0)::text AS consumed,
      COALESCE(sum(m.delta) FILTER(WHERE m.type='ADJUSTMENT'),0)::text AS adjusted,
      COALESCE(sum(m.delta),0)::text AS "ledgerQuantity",
      (SELECT COALESCE(sum(quantity),0)::text FROM inventory_balances WHERE lot_id=$1) AS "balanceQuantity",
      count(m.id)::int AS "totalEvents",
      count(m.id) FILTER(WHERE EXISTS(SELECT 1 FROM inventory_audit a WHERE a.movement_id=m.id))::int AS "auditedEvents",
      COALESCE(sum((SELECT count(*) FROM inventory_audit a WHERE a.movement_id=m.id)),0)::int AS "auditEntries"
      FROM inventory_movements m LEFT JOIN inventory_application_movements am ON am.movement_id=m.id WHERE m.lot_id=$1`,
      [lotId],
    );
    const events = await client.query(
      `SELECT m.id,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS date,
      m.type,m.delta::text AS quantity,m.reference,m.reason,m.actor,loc.name AS location,
      r.id AS "receiptId",r.reference AS "receiptReference",p.id AS "purchaseId",p.reference AS "purchaseReference",s.id AS "supplierId",s.name AS supplier,
      o.id AS "operationId",origin.name AS origin,destination.name AS destination,
      ap.id AS "applicationId",ap.reference AS "applicationReference",ap.patient_ref AS "patientRef",ap.service,ap.professional,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'actor',a.actor,'action',a.action,'date',a.created_at) ORDER BY a.created_at,a.id) FROM inventory_audit a WHERE a.movement_id=m.id),'[]'::jsonb) AS audit
      FROM inventory_movements m JOIN inventory_locations loc ON loc.id=m.location_id
      LEFT JOIN inventory_receipt_movements rm ON rm.movement_id=m.id LEFT JOIN inventory_receipts r ON r.id=rm.receipt_id
      LEFT JOIN inventory_purchases p ON p.id=r.purchase_id LEFT JOIN inventory_suppliers s ON s.id=p.supplier_id
      LEFT JOIN inventory_operation_movements om ON om.movement_id=m.id LEFT JOIN inventory_operations o ON o.id=om.operation_id
      LEFT JOIN inventory_locations origin ON origin.id=o.source_id LEFT JOIN inventory_locations destination ON destination.id=o.destination_id
      LEFT JOIN inventory_application_movements am ON am.movement_id=m.id LEFT JOIN inventory_applications ap ON ap.id=am.application_id
      WHERE m.lot_id=$1 AND ($2::timestamptz IS NULL OR (m.created_at,m.id)<($2::timestamptz,$3::uuid))
      ORDER BY m.created_at DESC,m.id DESC LIMIT 51`,
      [lotId, cursor?.date ?? null, cursor?.id ?? null],
    );
    const hasMore = events.rows.length > 50;
    const visible = events.rows.slice(0, 50);
    const last = visible.at(-1);
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ date: last.date, id: last.id })).toString("base64url")
      : null;
    await client.query("COMMIT");
    return Response.json(
      {
        data: {
          lot: lot.rows[0],
          summary: {
            ...summary.rows[0],
            reconciled: balances.rows.every((balance: { matches: boolean }) => balance.matches),
          },
          balances: balances.rows,
          events: visible,
          nextCursor,
        },
      },
      { headers },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Lot trace failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json(
      { error: "Não foi possível consultar a rastreabilidade do lote." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
