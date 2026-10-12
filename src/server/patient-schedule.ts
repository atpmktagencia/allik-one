import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import { actor, authenticate, can, canAccessAllUnits } from "./auth";
import { getPool } from "./db";
import { scheduleOperationInput } from "../data/schedule-operation-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const allowedPeriods = new Set([7, 14, 30]);
const allowedStatuses = new Set(["PENDING", "ALL", "CONSUMED"]);
const fortalezaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Fortaleza",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function currentFortalezaDate() {
  const parts = new Map(
    fortalezaDate.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

function databaseDate(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function patientScheduleResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar a agenda." }, { status: 401, headers });
  const permission = request.method === "GET" ? "patients.read" : "patients.manage";
  if (!can(auth, permission))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });

  if (request.method === "POST") {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
    }
    const parsed = scheduleOperationInput.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: "Confira a ação, a data e o motivo informado." },
        { status: 400, headers },
      );
    let client: PoolClient | undefined;
    try {
      client = await getPool().connect();
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT * FROM inventory_patient_treatment_schedule
         WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [parsed.data.scheduleId, auth.organizationId],
      );
      const schedule = current.rows[0];
      if (!schedule || !can(auth, "patients.manage", schedule.unit_id)) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Aplicação não encontrada." }, { status: 404, headers });
      }
      if (schedule.version !== parsed.data.version) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "A agenda mudou. Atualize e tente novamente." },
          { status: 409, headers },
        );
      }
      if (["CONSUMED", "CANCELED"].includes(schedule.status)) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Uma aplicação finalizada não pode ser alterada." },
          { status: 409, headers },
        );
      }
      if (parsed.data.action === "RESCHEDULE" && parsed.data.scheduledOn < currentFortalezaDate()) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "A nova data não pode estar no passado." },
          { status: 400, headers },
        );
      }
      if (
        parsed.data.action === "NO_SHOW" &&
        databaseDate(schedule.scheduled_on) > currentFortalezaDate()
      ) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Não é possível registrar falta antes da data agendada." },
          { status: 409, headers },
        );
      }
      const next =
        parsed.data.action === "CONFIRM"
          ? { status: schedule.status, attendance: "CONFIRMED", date: schedule.scheduled_on }
          : parsed.data.action === "RESCHEDULE"
            ? { status: schedule.status, attendance: "SCHEDULED", date: parsed.data.scheduledOn }
            : parsed.data.action === "NO_SHOW"
              ? { status: "CANCELED", attendance: "NO_SHOW", date: schedule.scheduled_on }
              : { status: "CANCELED", attendance: "CANCELED", date: schedule.scheduled_on };
      const updated = await client.query(
        `UPDATE inventory_patient_treatment_schedule
         SET status=$2,attendance_status=$3,scheduled_on=$4,version=version+1,
           updated_by_user_id=$5,updated_at=now() WHERE id=$1 RETURNING *`,
        [schedule.id, next.status, next.attendance, next.date, auth.user.id],
      );
      await client.query(
        `INSERT INTO inventory_patient_schedule_changes
          (organization_id,schedule_id,before_data,after_data,reason,actor,actor_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          auth.organizationId,
          schedule.id,
          schedule,
          updated.rows[0],
          parsed.data.reason,
          actor(auth).name,
          actor(auth).userId,
        ],
      );
      await client.query("COMMIT");
      return Response.json({ data: { id: schedule.id } }, { headers });
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => {});
      console.error(
        "Patient schedule operation failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return Response.json(
        { error: "Não foi possível atualizar a agenda." },
        { status: 503, headers },
      );
    } finally {
      client?.release();
    }
  }

  const url = new URL(request.url);
  const requestedUnit = url.searchParams.get("unitId");
  const days = Number(url.searchParams.get("days") ?? 7);
  const status = (url.searchParams.get("status") ?? "PENDING").toUpperCase();
  if (!allowedPeriods.has(days) || !allowedStatuses.has(status))
    return Response.json({ error: "Filtros da agenda inválidos." }, { status: 400, headers });
  if (requestedUnit && !can(auth, "patients.read", requestedUnit))
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });

  const unrestricted = canAccessAllUnits(auth);
  const result = await getPool().query(
    `WITH physical_stock AS (
       SELECT loc.unit_id,l.product_id,COALESCE(sum(b.quantity),0) AS units
       FROM inventory_balances b
       JOIN inventory_lots l ON l.id=b.lot_id
       JOIN inventory_locations loc ON loc.id=b.location_id
       WHERE l.status='AVAILABLE' AND l.expires_on>=current_date AND b.quantity>0
       GROUP BY loc.unit_id,l.product_id
     ), open_stock AS (
       SELECT unit_id,product_id,base_unit,COALESCE(sum(remaining_base_quantity),0) AS quantity
       FROM inventory_open_presentations
       WHERE status='OPEN' AND usable_until>now() AND remaining_base_quantity>0
       GROUP BY unit_id,product_id,base_unit
     ), scoped AS (
       SELECT s.*,pat.full_name,pat.internal_code,p.name AS product_name,p.sku,u.name AS unit_name,
         t.route,
         pp.name AS presentation_name,pp.total_base_quantity,pp.technical_loss_percent,
         COALESCE(ps.units,0) AS physical_units,COALESCE(os.quantity,0) AS open_quantity,
         count(pr.id) > 0 AS has_prescription_document,
         count(pr.id) FILTER (WHERE pr.document_status='ACTIVE'
           AND pr.issued_on<=s.scheduled_on AND pr.valid_until>=s.scheduled_on) > 0
           AS has_valid_prescription
       FROM inventory_patient_treatment_schedule s
       JOIN inventory_patients pat ON pat.id=s.patient_id
       JOIN inventory_patient_treatments t ON t.id=s.treatment_id
       JOIN inventory_products p ON p.id=s.product_id
       JOIN inventory_units u ON u.id=s.unit_id
       LEFT JOIN physical_stock ps ON ps.unit_id=s.unit_id AND ps.product_id=s.product_id
       LEFT JOIN open_stock os ON os.unit_id=s.unit_id AND os.product_id=s.product_id
         AND upper(os.base_unit)=upper(s.dose_unit)
       LEFT JOIN LATERAL (
         SELECT name,total_base_quantity,technical_loss_percent
         FROM inventory_pricing_presentations
         WHERE organization_id=s.organization_id AND product_id=s.product_id AND active
           AND upper(base_unit)=upper(s.dose_unit)
         ORDER BY pricing_status DESC,updated_at DESC LIMIT 1
       ) pp ON true
       LEFT JOIN inventory_patient_prescriptions pr ON pr.treatment_id=s.treatment_id
       WHERE s.organization_id=$1
         AND s.scheduled_on BETWEEN current_date-30 AND current_date+($2::integer-1)
         AND ($3::uuid IS NULL OR s.unit_id=$3)
         AND ($4::boolean OR s.unit_id=ANY($5::uuid[]))
         AND (($6='PENDING' AND s.status IN ('PLANNED','RESERVED'))
           OR ($6='CONSUMED' AND s.status='CONSUMED') OR $6='ALL')
       GROUP BY s.id,pat.full_name,pat.internal_code,p.name,p.sku,u.name,t.route,
         pp.name,pp.total_base_quantity,pp.technical_loss_percent,ps.units,os.quantity
     )
     SELECT id,patient_id AS "patientId",treatment_id AS "treatmentId",unit_id AS "unitId",
       unit_name AS "unitName",full_name AS "patientName",internal_code AS "internalCode",
       product_id AS "productId",product_name AS "productName",sku,route,sequence,
       scheduled_on::text AS "scheduledOn",dose_quantity::text AS "doseQuantity",
       upper(dose_unit) AS "doseUnit",status,attendance_status AS "attendanceStatus",version,
       has_prescription_document AS "hasPrescriptionDocument",
       has_valid_prescription AS "hasPrescription",
       presentation_name AS "presentationName",physical_units::text AS "physicalUnits",
       open_quantity::text AS "openQuantity",
       CASE WHEN total_base_quantity IS NULL THEN NULL ELSE
         (open_quantity + physical_units * total_base_quantity * (1-technical_loss_percent/100))::text
       END AS "availableDoseQuantity",
       sum(CASE WHEN status IN ('PLANNED','RESERVED') THEN dose_quantity ELSE 0 END) OVER (
         PARTITION BY unit_id,product_id,upper(dose_unit)
         ORDER BY scheduled_on,sequence,id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       )::text AS "cumulativeDemandQuantity",
       scheduled_on<current_date AND status IN ('PLANNED','RESERVED') AS overdue
     FROM scoped
     ORDER BY overdue DESC,scheduled_on,unit_name,lower(full_name),sequence
     LIMIT 500`,
    [auth.organizationId, days, requestedUnit, unrestricted, auth.unitIds, status],
  );

  const items = result.rows.map((row) => {
    const available = row.availableDoseQuantity === null ? null : Number(row.availableDoseQuantity);
    const cumulative = Number(row.cumulativeDemandQuantity);
    return {
      ...row,
      doseQuantity: Number(row.doseQuantity),
      physicalUnits: Number(row.physicalUnits),
      openQuantity: Number(row.openQuantity),
      availableDoseQuantity: available,
      cumulativeDemandQuantity: cumulative,
      stockWarning: available !== null && cumulative > available,
      presentationMissing: row.presentationName === null,
    };
  });
  const today = currentFortalezaDate();
  return Response.json(
    {
      data: {
        days,
        status,
        generatedOn: new Date().toISOString(),
        items,
        summary: {
          total: items.length,
          today: items.filter((item) => item.scheduledOn === today).length,
          overdue: items.filter((item) => item.overdue).length,
          stockWarnings: items.filter((item) => item.stockWarning || item.presentationMissing)
            .length,
        },
      },
    },
    { headers },
  );
}
