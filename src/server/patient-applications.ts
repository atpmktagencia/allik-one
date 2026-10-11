import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { actor, authenticate, can } from "./auth";
import { getPool } from "./db";
import { patientApplicationInput } from "../data/patient-application-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
class PatientApplicationConflict extends Error {}
class PatientApplicationDenied extends Error {}

async function replayOrConflict(
  client: PoolClient,
  operationId: string,
  scheduleId: string,
  hash: string,
) {
  const existing = await client.query(
    `SELECT id,request_hash FROM inventory_patient_applications
     WHERE id=$1 OR schedule_id=$2 ORDER BY (id=$1) DESC LIMIT 1`,
    [operationId, scheduleId],
  );
  if (!existing.rowCount) return null;
  if (existing.rows[0].id !== operationId || existing.rows[0].request_hash !== hash)
    throw new PatientApplicationConflict("Esta aplicação agendada já foi consumida.");
  return Response.json({ data: { id: operationId, replayed: true } }, { headers });
}

export async function patientApplicationResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para registrar a aplicação." }, { status: 401, headers });
  if (!can(auth, "inventory.consume") || !can(auth, "patients.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = patientApplicationInput.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira a aplicação, o local, o profissional e a justificativa." },
      { status: 400, headers },
    );
  const input = parsed.data;
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const scheduleResult = await client.query(
      `SELECT s.*,p.primary_unit_id,p.active AS patient_active,t.status AS treatment_status,
        pr.active AS product_active,pr.stock_controlled
       FROM inventory_patient_treatment_schedule s
       JOIN inventory_patients p ON p.id=s.patient_id
       JOIN inventory_patient_treatments t ON t.id=s.treatment_id
       JOIN inventory_products pr ON pr.id=s.product_id
       WHERE s.id=$1 AND s.patient_id=$2 AND s.organization_id=$3
       FOR UPDATE OF s`,
      [input.scheduleId, input.patientId, auth.organizationId],
    );
    if (!scheduleResult.rowCount)
      throw new PatientApplicationConflict("Aplicação prevista não encontrada.");
    const schedule = scheduleResult.rows[0];
    if (
      !can(auth, "inventory.consume", String(schedule.unit_id)) ||
      !can(auth, "patients.read", String(schedule.unit_id))
    )
      throw new PatientApplicationDenied("Unidade não autorizada para esta aplicação.");
    const replay = await replayOrConflict(client, input.operationId, input.scheduleId, hash);
    if (replay) {
      await client.query("COMMIT");
      return replay;
    }
    if (
      schedule.primary_unit_id !== schedule.unit_id ||
      !schedule.patient_active ||
      !schedule.product_active ||
      !schedule.stock_controlled ||
      !["PLANNED", "ACTIVE"].includes(String(schedule.treatment_status))
    )
      throw new PatientApplicationConflict("Paciente, tratamento ou produto indisponível.");
    if (!["PLANNED", "RESERVED"].includes(String(schedule.status)))
      throw new PatientApplicationConflict("Esta aplicação não está disponível para consumo.");
    if (schedule.version !== input.scheduleVersion)
      throw new PatientApplicationConflict("A agenda mudou. Recarregue e tente novamente.");

    const location = await client.query(
      "SELECT id FROM inventory_locations WHERE id=$1 AND unit_id=$2 AND active FOR SHARE",
      [input.locationId, schedule.unit_id],
    );
    if (!location.rowCount)
      throw new PatientApplicationConflict("Local de estoque inválido para esta unidade.");
    const presentation = await client.query(
      `SELECT id,total_base_quantity::text,technical_loss_percent::text
       FROM inventory_pricing_presentations
       WHERE organization_id=$1 AND product_id=$2 AND active AND upper(base_unit)=upper($3)
       ORDER BY pricing_status DESC,updated_at DESC LIMIT 1 FOR SHARE`,
      [auth.organizationId, schedule.product_id, schedule.dose_unit],
    );
    if (!presentation.rowCount)
      throw new PatientApplicationConflict(
        "Cadastre a apresentação e a concentração antes de consumir esta dose.",
      );
    const physical = await client.query<{ quantity: string }>(
      `SELECT ceil($1::numeric / ($2::numeric * (1-($3::numeric/100))))::text AS quantity`,
      [
        schedule.dose_quantity,
        presentation.rows[0].total_base_quantity,
        presentation.rows[0].technical_loss_percent,
      ],
    );
    const physicalQuantity = Number(physical.rows[0]!.quantity);
    const candidates = await client.query(
      `SELECT l.id AS lot_id,l.number,l.expires_on::text,b.quantity::text
       FROM inventory_balances b
       JOIN inventory_lots l ON l.id=b.lot_id
       WHERE b.location_id=$1 AND l.product_id=$2 AND l.status='AVAILABLE'
         AND l.expires_on>=(NOW() AT TIME ZONE 'America/Fortaleza')::date AND b.quantity>0
       ORDER BY l.expires_on,l.id FOR UPDATE OF b`,
      [input.locationId, schedule.product_id],
    );
    let remaining = physicalQuantity;
    const allocations: Array<{ lotId: string; lot: string; quantity: number }> = [];
    for (const candidate of candidates.rows) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, Number(candidate.quantity));
      if (allocated > 0)
        allocations.push({
          lotId: String(candidate.lot_id),
          lot: String(candidate.number),
          quantity: allocated,
        });
      remaining -= allocated;
    }
    if (remaining > 0)
      throw new PatientApplicationConflict(
        "Estoque disponível insuficiente para esta aplicação. Receba ou transfira o produto.",
      );

    await client.query(
      `INSERT INTO inventory_patient_applications(
        id,organization_id,patient_id,treatment_id,schedule_id,unit_id,location_id,product_id,
        presentation_id,request_hash,reference,professional,dose_quantity,dose_unit,
        physical_quantity,reason,actor,actor_user_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        input.operationId,
        auth.organizationId,
        schedule.patient_id,
        schedule.treatment_id,
        schedule.id,
        schedule.unit_id,
        input.locationId,
        schedule.product_id,
        presentation.rows[0].id,
        hash,
        input.reference,
        input.professional,
        schedule.dose_quantity,
        schedule.dose_unit,
        physicalQuantity,
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    for (const [index, allocation] of allocations.entries()) {
      const movement = await client.query<{ id: string }>(
        `INSERT INTO inventory_movements(
          lot_id,location_id,type,delta,actor,actor_user_id,reference,reason,operation_key
         ) VALUES($1,$2,'OUT',$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          allocation.lotId,
          input.locationId,
          `-${allocation.quantity}`,
          actor(auth).name,
          actor(auth).userId,
          input.reference,
          `Aplicação agendada: ${input.reason}`,
          `${input.operationId}:${index}`,
        ],
      );
      await client.query(
        `INSERT INTO inventory_patient_application_movements(movement_id,patient_application_id)
         VALUES($1,$2)`,
        [movement.rows[0]!.id, input.operationId],
      );
    }
    const updated = await client.query(
      `UPDATE inventory_patient_treatment_schedule
       SET status='CONSUMED',version=version+1,updated_by_user_id=$2,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [schedule.id, auth.user.id],
    );
    await client.query(
      `INSERT INTO inventory_patient_schedule_changes(
        organization_id,schedule_id,before_data,after_data,reason,actor,actor_user_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        auth.organizationId,
        schedule.id,
        schedule,
        updated.rows[0],
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      {
        data: {
          id: input.operationId,
          replayed: false,
          physicalQuantity,
          allocations,
        },
      },
      { status: 201, headers },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof PatientApplicationConflict)
      return Response.json({ error: error.message }, { status: 409, headers });
    if (error instanceof PatientApplicationDenied)
      return Response.json({ error: error.message }, { status: 403, headers });
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["23503", "23505", "23514", "22003"].includes(String(error.code))
    )
      return Response.json(
        { error: "A aplicação já foi registrada ou os dados ficaram desatualizados." },
        { status: 409, headers },
      );
    console.error(
      "Patient application failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { error: "Não foi possível confirmar a aplicação. Reenvie os mesmos dados." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
