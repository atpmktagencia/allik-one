import "@tanstack/react-start/server-only";
import { z } from "zod";
import { actor, authenticate, can } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clinicalInput = z.object({
  action: z.enum(["SAVE_DRAFT", "FINALIZE"]),
  appointmentId: z.string().uuid(),
  evolution: z.string().trim().max(20000),
  conduct: z.string().trim().max(10000),
  version: z.number().int().nonnegative().nullable(),
});

export async function careEncounterResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar o atendimento." }, { status: 401, headers });
  if (!can(auth, "patients.private.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (!["GET", "POST"].includes(request.method))
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });

  if (request.method === "POST") return saveClinicalNote(request, auth);

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
  const [changes, treatments, schedule, clinicalNote] = await Promise.all([
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
    pool.query(
      `SELECT id,evolution,conduct,status,version,author_name AS "authorName",
        professional_council AS "professionalCouncil",council_number AS "councilNumber",
        council_region AS "councilRegion",finalized_at AS "finalizedAt",updated_at AS "updatedAt"
       FROM inventory_clinical_notes WHERE appointment_id=$1 AND organization_id=$2`,
      [appointmentId, auth.organizationId],
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
        clinicalNote: clinicalNote.rows[0] ?? null,
        canAuthorClinicalNote:
          Boolean(auth.user.id) &&
          can(auth, "patients.clinical.manage", unitId) &&
          auth.user.id === String(appointment["professionalUserId"]),
      },
    },
    { headers },
  );
}

async function saveClinicalNote(
  request: Request,
  auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>,
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (!can(auth, "patients.clinical.manage"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (!auth.user.id || auth.integration || auth.preview)
    return Response.json(
      { error: "Use uma conta profissional individual para registrar a evolução." },
      { status: 403, headers },
    );
  let parsed: z.infer<typeof clinicalInput>;
  try {
    parsed = clinicalInput.parse(await request.json());
  } catch {
    return Response.json({ error: "Dados da evolução inválidos." }, { status: 400, headers });
  }
  if (parsed.action === "FINALIZE" && parsed.evolution.length < 10)
    return Response.json(
      { error: "Informe uma evolução com pelo menos 10 caracteres." },
      { status: 400, headers },
    );

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const appointmentResult = await client.query(
      `SELECT a.id,a.organization_id,a.unit_id,a.patient_id,a.professional_user_id,a.status,
        u.name AS author_name,u.professional_council,u.council_number,u.council_region
       FROM inventory_care_appointments a JOIN inventory_users u ON u.id=a.professional_user_id
       WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a`,
      [parsed.appointmentId, auth.organizationId],
    );
    const appointment = appointmentResult.rows[0];
    if (!appointment || !can(auth, "patients.clinical.manage", appointment.unit_id)) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Atendimento não encontrado." }, { status: 404, headers });
    }
    if (appointment.professional_user_id !== auth.user.id) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Somente o profissional responsável pode assinar esta evolução." },
        { status: 403, headers },
      );
    }
    if (
      !appointment.professional_council ||
      !appointment.council_number ||
      !appointment.council_region
    ) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Complete o conselho profissional do responsável antes de registrar a evolução." },
        { status: 409, headers },
      );
    }
    if (["CANCELED", "NO_SHOW"].includes(appointment.status)) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Este atendimento não aceita evolução clínica." },
        { status: 409, headers },
      );
    }
    const currentResult = await client.query(
      `SELECT * FROM inventory_clinical_notes WHERE appointment_id=$1 FOR UPDATE`,
      [parsed.appointmentId],
    );
    const current = currentResult.rows[0];
    if (current?.status === "FINAL") {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "A evolução finalizada é imutável." },
        { status: 409, headers },
      );
    }
    if ((current ? Number(current.version) : null) !== parsed.version) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "A evolução mudou em outra sessão. Atualize a página." },
        { status: 409, headers },
      );
    }
    const signer = actor(auth);
    const final = parsed.action === "FINALIZE";
    const noteResult = current
      ? await client.query(
          `UPDATE inventory_clinical_notes SET evolution=$2,conduct=$3,status=$4,
             finalized_at=CASE WHEN $4='FINAL' THEN now() ELSE NULL END,version=version+1,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [current.id, parsed.evolution, parsed.conduct, final ? "FINAL" : "DRAFT"],
        )
      : await client.query(
          `INSERT INTO inventory_clinical_notes(organization_id,unit_id,appointment_id,patient_id,
             author_user_id,author_name,professional_council,council_number,council_region,
             evolution,conduct,status,finalized_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $12='FINAL' THEN now() ELSE NULL END)
           RETURNING *`,
          [
            auth.organizationId,
            appointment.unit_id,
            parsed.appointmentId,
            appointment.patient_id,
            auth.user.id,
            signer.name,
            appointment.professional_council,
            appointment.council_number,
            appointment.council_region,
            parsed.evolution,
            parsed.conduct,
            final ? "FINAL" : "DRAFT",
          ],
        );
    const note = noteResult.rows[0];
    await client.query(
      `INSERT INTO inventory_clinical_note_changes(organization_id,clinical_note_id,action,before_data,after_data,actor_user_id)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        auth.organizationId,
        note.id,
        final ? "FINALIZE" : current ? "UPDATE" : "CREATE",
        current
          ? {
              evolution: current.evolution,
              conduct: current.conduct,
              status: current.status,
              version: current.version,
            }
          : null,
        {
          evolution: note.evolution,
          conduct: note.conduct,
          status: note.status,
          version: note.version,
        },
        auth.user.id,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: note.id, status: note.status, version: note.version } },
      { status: current ? 200 : 201, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "clinical note write failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      { error: "Não foi possível salvar a evolução." },
      { status: 500, headers },
    );
  } finally {
    client.release();
  }
}
