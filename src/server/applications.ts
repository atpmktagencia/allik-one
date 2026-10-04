import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { hasPreviewSession } from "./auth";
import { getPool } from "./db";
import { applicationInput } from "../data/application-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
class ApplicationConflict extends Error {}

export async function applicationResponse(request: Request) {
  if (!hasPreviewSession(request))
    return Response.json(
      { error: "Entre para acessar as aplicações de demonstração." },
      { status: 401, headers },
    );
  if (request.method === "GET") {
    try {
      const result = await getPool()
        .query(`SELECT a.id,a.reference,a.patient_ref AS "patientRef",a.service,a.professional,a.created_at AS "createdAt",loc.name AS location,
        jsonb_agg(jsonb_build_object('movementId',m.id,'productId',p.id,'product',p.name,'lotId',l.id,'lot',l.number,'quantity',(-m.delta)::text,'unit',p.unit) ORDER BY split_part(m.operation_key,':',2)::integer) AS items
        FROM inventory_applications a JOIN inventory_locations loc ON loc.id=a.location_id
        JOIN inventory_application_movements am ON am.application_id=a.id JOIN inventory_movements m ON m.id=am.movement_id
        JOIN inventory_lots l ON l.id=m.lot_id JOIN inventory_products p ON p.id=l.product_id
        GROUP BY a.id,loc.name ORDER BY a.created_at DESC,a.id LIMIT 200`);
      return Response.json({ data: result.rows }, { headers });
    } catch (error) {
      console.error(
        "Application query failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return Response.json(
        { error: "Não foi possível consultar as aplicações." },
        { status: 503, headers },
      );
    }
  }
  if (request.method !== "POST")
    return Response.json(
      { error: "Método não permitido." },
      { status: 405, headers: { ...headers, Allow: "GET, POST" } },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = applicationInput.safeParse(body);
  if (!parsed.success)
    return Response.json(
      {
        error:
          "Confira paciente sintético, referência, serviço, executor, local e itens sem lotes repetidos.",
      },
      { status: 400, headers },
    );
  const input = parsed.data;
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO inventory_applications(id,request_hash,reference,patient_ref,service,professional,location_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id",
      [
        input.operationId,
        hash,
        input.reference,
        input.patientRef,
        input.service,
        input.professional,
        input.locationId,
      ],
    );
    if (!inserted.rowCount) {
      const previous = await client.query(
        "SELECT request_hash FROM inventory_applications WHERE id=$1",
        [input.operationId],
      );
      if (previous.rows[0]?.request_hash !== hash)
        throw new ApplicationConflict("Esta aplicação já foi enviada com outros dados.");
      await client.query("COMMIT");
      return Response.json({ data: { id: input.operationId, replayed: true } }, { headers });
    }
    const location = await client.query(
      "SELECT id FROM inventory_locations WHERE id=$1 AND active FOR SHARE",
      [input.locationId],
    );
    if (!location.rowCount) throw new ApplicationConflict("Localização indisponível.");
    const lotIds = input.items.map((item) => item.lotId);
    const lots = await client.query(
      "SELECT l.id,l.product_id,l.status,(l.expires_on >= (NOW() AT TIME ZONE 'America/Fortaleza')::date) AS valid,p.active,p.stock_controlled FROM inventory_lots l JOIN inventory_products p ON p.id=l.product_id WHERE l.id=ANY($1::uuid[]) ORDER BY l.id FOR SHARE OF l,p",
      [lotIds],
    );
    for (const line of input.items) {
      const lot = lots.rows.find((row: { id: string }) => row.id === line.lotId);
      if (
        !lot ||
        lot.product_id !== line.productId ||
        !lot.active ||
        !lot.stock_controlled ||
        lot.status !== "AVAILABLE" ||
        !lot.valid
      )
        throw new ApplicationConflict(
          "Um lote está vencido, bloqueado ou não corresponde ao produto. Atualize o estoque.",
        );
    }
    // Lock every consumed balance in a consistent order before writing any movement.
    const balances = await client.query(
      "SELECT lot_id,quantity::text FROM inventory_balances WHERE location_id=$1 AND lot_id=ANY($2::uuid[]) ORDER BY lot_id FOR UPDATE",
      [input.locationId, lotIds],
    );
    for (const line of input.items) {
      const balance = balances.rows.find((row: { lot_id: string }) => row.lot_id === line.lotId);
      if (!balance)
        throw new ApplicationConflict("Lote sem saldo neste local. Atualize o estoque.");
      const available = await client.query("SELECT $1::numeric >= $2::numeric AS enough", [
        balance.quantity,
        line.quantity,
      ]);
      if (!available.rows[0].enough)
        throw new ApplicationConflict(
          "Saldo insuficiente para concluir a aplicação. Atualize o estoque.",
        );
    }
    for (const [index, line] of input.items.entries()) {
      const movement = await client.query(
        "INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) VALUES($1,$2,'OUT',$3,'preview-operator',$4,$5,$6) RETURNING id",
        [
          line.lotId,
          input.locationId,
          `-${line.quantity}`,
          input.reference,
          "Consumo por aplicação direta sintética",
          `${input.operationId}:${index}`,
        ],
      );
      await client.query(
        "INSERT INTO inventory_application_movements(application_id,movement_id) VALUES($1,$2)",
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
    if (error instanceof ApplicationConflict)
      return Response.json({ error: error.message }, { status: 409, headers });
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["23503", "23505", "23514", "22003"].includes(String(error.code))
    )
      return Response.json(
        {
          error:
            "A referência já foi registrada ou o estoque não permite esta aplicação. Confira os dados.",
        },
        { status: 409, headers },
      );
    console.error("Application failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json(
      { error: "Não foi possível confirmar a aplicação. Reenvie os mesmos dados." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
