import "@tanstack/react-start/server-only";
import { authenticate, can } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function careEncounterResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar o atendimento." }, { status: 401, headers });
  if (!can(auth, "patients.private.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (request.method !== "GET")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });

  const appointmentId = new URL(request.url).searchParams.get("appointmentId");
  if (!appointmentId || !uuidPattern.test(appointmentId))
    return Response.json({ error: "Atendimento inválido." }, { status: 400, headers });

  const pool = getPool();
  const appointmentResult = await pool.query(
    `SELECT a.id,a.unit_id AS "unitId",u.name AS "unitName",a.patient_id AS "patientId",
      p.full_name AS "patientName",p.internal_code AS "patientCode",
      a.professional_user_id AS "professionalUserId",usr.name AS "professionalName",
      usr.professional_council AS "professionalCouncil",
      usr.council_number AS "councilNumber",usr.council_region AS "councilRegion",
      a.care_type AS "careType",COALESCE(ct.name,a.other_care_type,a.care_type) AS "careTypeName",
      a.other_care_type AS "otherCareType",a.starts_at AS "startsAt",a.ends_at AS "endsAt",
      a.room,a.chair,a.resource_name AS "resourceName",a.notes,a.status,a.version
     FROM inventory_care_appointments a
     JOIN inventory_units u ON u.id=a.unit_id
     JOIN inventory_patients p ON p.id=a.patient_id
     JOIN inventory_users usr ON usr.id=a.professional_user_id
     LEFT JOIN inventory_care_types ct ON ct.organization_id=a.organization_id AND ct.code=a.care_type
     WHERE a.id=$1 AND a.organization_id=$2`,
    [appointmentId, auth.organizationId],
  );
  const appointment = appointmentResult.rows[0] as Record<string, unknown> | undefined;
  if (!appointment || !can(auth, "patients.private.read", String(appointment["unitId"])))
    return Response.json({ error: "Atendimento não encontrado." }, { status: 404, headers });

  const patientId = String(appointment["patientId"]);
  const unitId = String(appointment["unitId"]);
  const [changes, treatments, schedule] = await Promise.all([
    pool.query(
      `SELECT c.id,c.action,c.reason,c.actor,c.created_at AS "createdAt"
       FROM inventory_care_appointment_changes c
       WHERE c.appointment_id=$1 AND c.organization_id=$2
       ORDER BY c.created_at DESC`,
      [appointmentId, auth.organizationId],
    ),
    pool.query(
      `SELECT t.id,p.name AS "productName",p.sku,t.dose_quantity AS "doseQuantity",
        t.dose_unit AS "doseUnit",t.route,t.frequency_every_days AS "frequencyEveryDays",t.status
       FROM inventory_patient_treatments t JOIN inventory_products p ON p.id=t.product_id
       WHERE t.patient_id=$1 AND t.organization_id=$2 AND t.unit_id=$3
       ORDER BY t.created_at DESC LIMIT 20`,
      [patientId, auth.organizationId, unitId],
    ),
    pool.query(
      `SELECT s.id,s.scheduled_on::text AS "scheduledOn",s.dose_quantity AS "doseQuantity",
        s.dose_unit AS "doseUnit",s.status,p.name AS "productName"
       FROM inventory_patient_treatment_schedule s
       JOIN inventory_products p ON p.id=s.product_id
       WHERE s.patient_id=$1 AND s.organization_id=$2 AND s.unit_id=$3
         AND s.scheduled_on BETWEEN (current_date-interval '30 days') AND (current_date+interval '90 days')
       ORDER BY s.scheduled_on,s.sequence LIMIT 30`,
      [patientId, auth.organizationId, unitId],
    ),
  ]);

  return Response.json(
    {
      data: {
        appointment,
        changes: changes.rows,
        treatments: treatments.rows,
        schedule: schedule.rows,
        canManage: can(auth, "patients.manage", unitId),
      },
    },
    { headers },
  );
}
