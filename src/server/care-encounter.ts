import { patientAllergySummary } from "./patient-allergies";
import { recordClinicalAccess } from "./clinical-access-audit";
import { hasClinicalRegistration } from "./clinical-professional-policy";
import "@tanstack/react-start/server-only";
import { z } from "zod";
import { actor, authenticate, can } from "./auth";
import { getPool } from "./db";
import { hasClinicalRecords } from "./clinical-record-guard";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clinicalInput = z.object({
  action: z.enum(["SAVE_DRAFT", "FINALIZE"]),
  appointmentId: z.string().uuid(),
  evolution: z.string().trim().max(20000),
  conduct: z.string().trim().max(10000),
  diagnosticHypotheses: z.string().trim().max(10000).default(""),
  clinicalPlan: z.string().trim().max(10000).default(""),
  returnRecommendation: z.string().trim().max(2000).default(""),
  returnOn: z.string().date().nullable().default(null),
  chiefComplaint: z.string().trim().max(2000).default(""),
  currentHistory: z.string().trim().max(10000).default(""),
  personalHistory: z.string().trim().max(10000).default(""),
  familyHistory: z.string().trim().max(10000).default(""),
  habits: z.string().trim().max(5000).default(""),
  systemsReview: z.string().trim().max(10000).default(""),
  generalExam: z.string().trim().max(5000).default(""),
  cardiovascularExam: z.string().trim().max(5000).default(""),
  respiratoryExam: z.string().trim().max(5000).default(""),
  abdominalExam: z.string().trim().max(5000).default(""),
  neurologicalExam: z.string().trim().max(5000).default(""),
  musculoskeletalExam: z.string().trim().max(5000).default(""),
  skinExam: z.string().trim().max(5000).default(""),
  otherExam: z.string().trim().max(5000).default(""),
  systolicPressure: z.number().int().min(40).max(300).nullable().default(null),
  diastolicPressure: z.number().int().min(20).max(200).nullable().default(null),
  heartRate: z.number().int().min(20).max(300).nullable().default(null),
  oxygenSaturation: z.number().min(50).max(100).nullable().default(null),
  temperatureC: z.number().min(30).max(45).nullable().default(null),
  weightKg: z.number().positive().max(500).nullable().default(null),
  heightCm: z.number().min(30).max(250).nullable().default(null),
  version: z.number().int().nonnegative().nullable(),
});
const claimInput = z.object({
  action: z.literal("CLAIM"),
  appointmentId: z.string().uuid(),
  version: z.number().int().nonnegative(),
});

export async function careEncounterResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar o atendimento." }, { status: 401, headers });
  if (!can(auth, "patients.private.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (!["GET", "POST"].includes(request.method))
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });

  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
    }
    const claim = claimInput.safeParse(body);
    if (claim.success) return claimAppointment(claim.data, auth);
    return saveClinicalNote(body, auth);
  }

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
  const [changes, treatments, schedule, clinicalNote, clinicalAlerts] = await Promise.all([
    pool.query(
      `SELECT c.id,c.action,c.reason,c.actor,c.created_at AS "createdAt"
       FROM inventory_care_appointment_changes c
       WHERE c.appointment_id=$1 AND c.organization_id=$2
       ORDER BY c.created_at DESC`,
      [appointmentId, auth.organizationId],
    ),
    pool.query(
      `SELECT t.id,p.name AS "productName",p.sku,t.dose_quantity AS "doseQuantity",
        t.dose_unit AS "doseUnit",t.route,t.frequency_every_days AS "frequencyEveryDays",
        t.frequency_every AS "frequencyEvery",t.frequency_unit AS "frequencyUnit",t.status
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
      `SELECT id,evolution,conduct,diagnostic_hypotheses AS "diagnosticHypotheses",
        clinical_plan AS "clinicalPlan",return_recommendation AS "returnRecommendation",
        return_on::text AS "returnOn",chief_complaint AS "chiefComplaint",
        current_history AS "currentHistory",personal_history AS "personalHistory",
        family_history AS "familyHistory",habits,systems_review AS "systemsReview",
        general_exam AS "generalExam",cardiovascular_exam AS "cardiovascularExam",
        respiratory_exam AS "respiratoryExam",abdominal_exam AS "abdominalExam",
        neurological_exam AS "neurologicalExam",musculoskeletal_exam AS "musculoskeletalExam",
        skin_exam AS "skinExam",other_exam AS "otherExam",
        status,version,author_user_id AS "authorUserId",author_name AS "authorName",
        professional_council AS "professionalCouncil",council_number AS "councilNumber",
        council_region AS "councilRegion",systolic_pressure AS "systolicPressure",
        diastolic_pressure AS "diastolicPressure",heart_rate AS "heartRate",
        oxygen_saturation AS "oxygenSaturation",temperature_c AS "temperatureC",
        weight_kg AS "weightKg",height_cm AS "heightCm",
        finalized_at AS "finalizedAt",updated_at AS "updatedAt"
       FROM inventory_clinical_notes WHERE appointment_id=$1 AND organization_id=$2 AND (status='FINAL' OR author_user_id=$3)`,
      [appointmentId, auth.organizationId, auth.user.id],
    ),
    pool.query(
      `SELECT id,type,title,reaction,severity,notes
       FROM inventory_patient_clinical_alerts
       WHERE patient_id=$1 AND organization_id=$2 AND unit_id=$3 AND status='ACTIVE'
       ORDER BY CASE severity WHEN 'SEVERE' THEN 0 WHEN 'MODERATE' THEN 1 WHEN 'MILD' THEN 2 ELSE 3 END,
         updated_at DESC,id DESC`,
      [patientId, auth.organizationId, unitId],
    ),
  ]);

  const isAssignedProfessional = auth.user.id === String(appointment["professionalUserId"]);
  const hasClinicalPermission = can(auth, "patients.clinical.manage", unitId);
  const hasCompleteCouncil = hasClinicalRegistration({
    professional_council: String(appointment["professionalCouncil"] ?? ""),
    council_number: String(appointment["councilNumber"] ?? ""),
    council_region: String(appointment["councilRegion"] ?? ""),
  });
  const canAuthorClinicalNote =
    Boolean(auth.user.id) &&
    hasClinicalPermission &&
    isAssignedProfessional &&
    hasCompleteCouncil &&
    (!clinicalNote.rows[0] || clinicalNote.rows[0].authorUserId === auth.user.id);
  const clinicalRecords = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM inventory_clinical_notes WHERE appointment_id=$1) OR EXISTS(SELECT 1 FROM inventory_encounter_prescriptions WHERE appointment_id=$1) OR EXISTS(SELECT 1 FROM inventory_encounter_documents WHERE appointment_id=$1) AS present`,
    [appointmentId],
  );
  const canClaimClinicalNote =
    Boolean(auth.user.id) &&
    !auth.preview &&
    !auth.integration &&
    hasClinicalPermission &&
    !isAssignedProfessional &&
    !clinicalRecords.rows[0].present &&
    !["NO_SHOW", "CANCELED"].includes(String(appointment["status"]));

  await recordClinicalAccess(auth, {
    unitId,
    patientId,
    appointmentId,
    action: "READ",
    resourceIds: clinicalNote.rows.map((n) => n.id),
  });
  return Response.json(
    {
      data: {
        appointment,
        changes: changes.rows,
        treatments: treatments.rows,
        schedule: schedule.rows,
        canManage: can(auth, "patients.manage", unitId),
        clinicalNote: clinicalNote.rows[0] ?? null,
        clinicalAlerts: clinicalAlerts.rows,
        allergySummary: await patientAllergySummary(auth, patientId, unitId),
        canAuthorClinicalNote,
        canClaimClinicalNote,
        needsProfessionalRegistration:
          Boolean(auth.user.id) && isAssignedProfessional && !hasCompleteCouncil,
        clinicalAuthorBlockReason: canAuthorClinicalNote
          ? null
          : !hasClinicalPermission
            ? "Seu perfil não possui permissão clínica nesta unidade."
            : clinicalNote.rows[0]?.status === "FINAL"
              ? "Esta evolução já foi finalizada e é imutável."
              : ["NO_SHOW", "CANCELED"].includes(String(appointment["status"]))
                ? "Atendimentos cancelados ou com falta não aceitam evolução clínica."
                : !isAssignedProfessional
                  ? `Este atendimento está atribuído a ${String(appointment["professionalName"])}.`
                  : !hasCompleteCouncil
                    ? "Complete seu conselho profissional antes de registrar a evolução."
                    : "Este atendimento não permite uma nova evolução.",
      },
    },
    { headers },
  );
}

async function saveClinicalNote(
  body: unknown,
  auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>,
) {
  if (!can(auth, "patients.clinical.manage"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (!auth.user.id || auth.integration || auth.preview)
    return Response.json(
      { error: "Use uma conta profissional individual para registrar a evolução." },
      { status: 403, headers },
    );
  let parsed: z.infer<typeof clinicalInput>;
  try {
    parsed = clinicalInput.parse(body);
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
    if (!hasClinicalRegistration(appointment)) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Registro profissional não habilitado para este fluxo." },
        { status: 403, headers },
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
    if (current && current.author_user_id !== auth.user.id) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Somente o autor pode alterar ou finalizar este rascunho." },
        { status: 403, headers },
      );
    }
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
             systolic_pressure=$5,diastolic_pressure=$6,heart_rate=$7,oxygen_saturation=$8,
             temperature_c=$9,weight_kg=$10,height_cm=$11,
             chief_complaint=$12,current_history=$13,personal_history=$14,family_history=$15,
             habits=$16,systems_review=$17,
             general_exam=$18,cardiovascular_exam=$19,respiratory_exam=$20,abdominal_exam=$21,
             neurological_exam=$22,musculoskeletal_exam=$23,skin_exam=$24,other_exam=$25,
             diagnostic_hypotheses=$26,clinical_plan=$27,return_recommendation=$28,return_on=$29,
             finalized_at=CASE WHEN $4='FINAL' THEN now() ELSE NULL END,version=version+1,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [
            current.id,
            parsed.evolution,
            parsed.conduct,
            final ? "FINAL" : "DRAFT",
            parsed.systolicPressure,
            parsed.diastolicPressure,
            parsed.heartRate,
            parsed.oxygenSaturation,
            parsed.temperatureC,
            parsed.weightKg,
            parsed.heightCm,
            parsed.chiefComplaint,
            parsed.currentHistory,
            parsed.personalHistory,
            parsed.familyHistory,
            parsed.habits,
            parsed.systemsReview,
            parsed.generalExam,
            parsed.cardiovascularExam,
            parsed.respiratoryExam,
            parsed.abdominalExam,
            parsed.neurologicalExam,
            parsed.musculoskeletalExam,
            parsed.skinExam,
            parsed.otherExam,
            parsed.diagnosticHypotheses,
            parsed.clinicalPlan,
            parsed.returnRecommendation,
            parsed.returnOn,
          ],
        )
      : await client.query(
          `INSERT INTO inventory_clinical_notes(organization_id,unit_id,appointment_id,patient_id,
             author_user_id,author_name,professional_council,council_number,council_region,
             evolution,conduct,status,systolic_pressure,diastolic_pressure,heart_rate,
             oxygen_saturation,temperature_c,weight_kg,height_cm,chief_complaint,current_history,
             personal_history,family_history,habits,systems_review,general_exam,cardiovascular_exam,
             respiratory_exam,abdominal_exam,neurological_exam,musculoskeletal_exam,skin_exam,
             other_exam,diagnostic_hypotheses,clinical_plan,return_recommendation,return_on,
             finalized_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             $20,$21,$22,$23,$24,$25,
             $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,
             CASE WHEN $12='FINAL' THEN now() ELSE NULL END)
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
            parsed.systolicPressure,
            parsed.diastolicPressure,
            parsed.heartRate,
            parsed.oxygenSaturation,
            parsed.temperatureC,
            parsed.weightKg,
            parsed.heightCm,
            parsed.chiefComplaint,
            parsed.currentHistory,
            parsed.personalHistory,
            parsed.familyHistory,
            parsed.habits,
            parsed.systemsReview,
            parsed.generalExam,
            parsed.cardiovascularExam,
            parsed.respiratoryExam,
            parsed.abdominalExam,
            parsed.neurologicalExam,
            parsed.musculoskeletalExam,
            parsed.skinExam,
            parsed.otherExam,
            parsed.diagnosticHypotheses,
            parsed.clinicalPlan,
            parsed.returnRecommendation,
            parsed.returnOn,
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
              vitals: clinicalVitals(current),
              anamnesis: clinicalAnamnesis(current),
              physicalExam: clinicalPhysicalExam(current),
              closure: clinicalClosure(current),
            }
          : null,
        {
          evolution: note.evolution,
          conduct: note.conduct,
          status: note.status,
          version: note.version,
          vitals: clinicalVitals(note),
          anamnesis: clinicalAnamnesis(note),
          physicalExam: clinicalPhysicalExam(note),
          closure: clinicalClosure(note),
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

async function claimAppointment(
  input: z.infer<typeof claimInput>,
  auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>,
) {
  if (!auth.user.id || auth.preview || auth.integration)
    return Response.json(
      { error: "Use uma conta profissional individual para assumir o atendimento." },
      { status: 403, headers },
    );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT a.*,u.name AS assigned_professional_name
       FROM inventory_care_appointments a
       JOIN inventory_users u ON u.id=a.professional_user_id
       WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a`,
      [input.appointmentId, auth.organizationId],
    );
    const appointment = result.rows[0];
    if (!appointment || !can(auth, "patients.clinical.manage", appointment.unit_id))
      throw new Error("NOT_FOUND");
    if (Number(appointment.version) !== input.version) throw new Error("STALE");
    if (appointment.professional_user_id === auth.user.id) throw new Error("ALREADY_ASSIGNED");
    if (["NO_SHOW", "CANCELED"].includes(appointment.status)) throw new Error("TERMINAL");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `care-professional:${auth.organizationId}:${auth.user.id}`,
    ]);
    const author = await client.query(
      `SELECT name,professional_council,council_number,council_region
       FROM inventory_users WHERE id=$1 AND active FOR SHARE`,
      [auth.user.id],
    );
    const professional = author.rows[0];
    if (
      !professional?.professional_council ||
      !professional.council_number ||
      !professional.council_region
    )
      throw new Error("INCOMPLETE_COUNCIL");
    const existingNoteResult = await client.query(
      "SELECT * FROM inventory_clinical_notes WHERE appointment_id=$1 FOR UPDATE",
      [input.appointmentId],
    );
    const existingNote = existingNoteResult.rows[0];
    if (existingNote || (await hasClinicalRecords(client, input.appointmentId)))
      throw new Error("CLINICAL_LOCKED");
    if (!hasClinicalRegistration(professional)) throw new Error("INCOMPLETE_COUNCIL");
    const conflict = await client.query(
      `SELECT 1 FROM inventory_care_appointments
       WHERE organization_id=$1 AND professional_user_id=$2 AND id<>$3
         AND status NOT IN ('COMPLETED','CANCELED','NO_SHOW') AND starts_at<$5 AND ends_at>$4
       LIMIT 1 FOR SHARE`,
      [
        auth.organizationId,
        auth.user.id,
        input.appointmentId,
        appointment.starts_at,
        appointment.ends_at,
      ],
    );
    if (conflict.rowCount) throw new Error("CONFLICT");
    const updated = await client.query(
      `UPDATE inventory_care_appointments SET professional_user_id=$2,updated_by_user_id=$2,
       version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [input.appointmentId, auth.user.id],
    );
    const acting = actor(auth);
    await client.query(
      `INSERT INTO inventory_care_appointment_changes
       (organization_id,appointment_id,action,before_data,after_data,reason,actor,actor_user_id)
       VALUES($1,$2,'REASSIGN',$3,$4,$5,$6,$7)`,
      [
        auth.organizationId,
        input.appointmentId,
        appointment,
        updated.rows[0],
        `Responsabilidade clínica assumida por ${professional.name}. Profissional anterior: ${appointment.assigned_professional_name}.`,
        acting.name,
        acting.userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: { id: input.appointmentId } }, { headers });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const reason = error instanceof Error ? error.message : "";
    const response =
      reason === "NOT_FOUND"
        ? ["Atendimento não encontrado.", 404]
        : reason === "CLINICAL_LOCKED"
          ? [
              "Há registros clínicos neste atendimento. A responsabilidade e a autoria não podem ser transferidas.",
              409,
            ]
          : reason === "STALE"
            ? ["O atendimento mudou. Atualize a página e tente novamente.", 409]
            : reason === "INCOMPLETE_COUNCIL"
              ? ["Complete seu conselho profissional antes de assumir o atendimento.", 409]
              : reason === "NOTE_FINAL"
                ? ["A evolução finalizada é imutável e não pode trocar de responsável.", 409]
                : reason === "CONFLICT"
                  ? ["Você já possui outro atendimento neste horário.", 409]
                  : reason === "TERMINAL"
                    ? ["Atendimentos cancelados ou com falta não podem trocar de responsável.", 409]
                    : reason === "ALREADY_ASSIGNED"
                      ? ["Este atendimento já está atribuído a você.", 409]
                      : ["Não foi possível assumir o atendimento.", 503];
    return Response.json({ error: response[0] }, { status: response[1] as number, headers });
  } finally {
    client.release();
  }
}

function clinicalVitals(row: Record<string, unknown>) {
  return {
    systolicPressure: row["systolic_pressure"],
    diastolicPressure: row["diastolic_pressure"],
    heartRate: row["heart_rate"],
    oxygenSaturation: row["oxygen_saturation"],
    temperatureC: row["temperature_c"],
    weightKg: row["weight_kg"],
    heightCm: row["height_cm"],
  };
}

function clinicalAnamnesis(row: Record<string, unknown>) {
  return {
    chiefComplaint: row["chief_complaint"],
    currentHistory: row["current_history"],
    personalHistory: row["personal_history"],
    familyHistory: row["family_history"],
    habits: row["habits"],
    systemsReview: row["systems_review"],
  };
}

function clinicalPhysicalExam(row: Record<string, unknown>) {
  return {
    generalExam: row["general_exam"],
    cardiovascularExam: row["cardiovascular_exam"],
    respiratoryExam: row["respiratory_exam"],
    abdominalExam: row["abdominal_exam"],
    neurologicalExam: row["neurological_exam"],
    musculoskeletalExam: row["musculoskeletal_exam"],
    skinExam: row["skin_exam"],
    otherExam: row["other_exam"],
  };
}

function clinicalClosure(row: Record<string, unknown>) {
  return {
    diagnosticHypotheses: row["diagnostic_hypotheses"],
    clinicalPlan: row["clinical_plan"],
    returnRecommendation: row["return_recommendation"],
    returnOn: row["return_on"],
  };
}
