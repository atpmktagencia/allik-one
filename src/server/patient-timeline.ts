import { patientAllergySummary } from "./patient-allergies";
import "@tanstack/react-start/server-only";
import { authenticate, can, canAccessAllUnits } from "./auth";
import { getPool } from "./db";
import { recordClinicalAccess } from "./clinical-access-audit";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const kinds = [
  "APPOINTMENT",
  "CLINICAL_NOTE",
  "PRESCRIPTION",
  "DOCUMENT",
  "TREATMENT",
  "APPLICATION",
  "LABORATORY",
  "QUESTIONNAIRE",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateValid = (value: string | null) =>
  !value ||
  (datePattern.test(value) &&
    !value.startsWith("0000-") &&
    new Date(value).toISOString().slice(0, 10) === value);

export async function patientTimelineResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar o prontuário." }, { status: 401, headers });
  if (!can(auth, "patients.private.read"))
    return Response.json(
      { error: "Sem permissão para acessar o prontuário." },
      { status: 403, headers },
    );
  if (request.method !== "GET")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  const params = new URL(request.url).searchParams;
  const patientId = params.get("patientId") ?? "";
  const kind = params.get("kind") || null;
  const unitId = params.get("unitId") || null;
  const from = params.get("from") || null,
    to = params.get("to") || null;
  const filterKey = JSON.stringify([patientId, unitId, kind, from, to]);
  let cursor: { at: string; kind: string; id: string; filterKey: string } | null = null;
  try {
    const encoded = params.get("cursor");
    if (encoded) {
      if (encoded.length > 500) throw new Error("cursor");
      cursor = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (
        !cursor ||
        typeof cursor.at !== "string" ||
        !Number.isFinite(Date.parse(cursor.at)) ||
        !kinds.includes(cursor.kind) ||
        !uuid.test(cursor.id) ||
        cursor.filterKey !== filterKey
      )
        throw new Error("cursor");
    }
    if (
      !uuid.test(patientId) ||
      (unitId && !uuid.test(unitId)) ||
      (kind && !kinds.includes(kind)) ||
      !dateValid(from) ||
      !dateValid(to) ||
      (from && to && from > to)
    )
      throw new Error("filters");
  } catch {
    return Response.json({ error: "Filtros do prontuário inválidos." }, { status: 400, headers });
  }
  if (unitId && !can(auth, "patients.private.read", unitId))
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
  const pool = getPool();
  const result = await pool.query(
    `SELECT p.id,p.full_name AS name,p.internal_code AS "internalCode",p.primary_unit_id,u.name AS "unitName"
     FROM inventory_patients p JOIN inventory_units u ON u.id=p.primary_unit_id AND u.organization_id=p.organization_id
     WHERE p.id=$1 AND p.organization_id=$2`,
    [patientId, auth.organizationId],
  );
  const patient = result.rows[0];
  if (!patient || !can(auth, "patients.private.read", String(patient.primary_unit_id)))
    return Response.json({ error: "Paciente não encontrado." }, { status: 404, headers });
  const unrestricted = canAccessAllUnits(auth);
  // Each source independently checks its organization and operational unit, even if the patient is shared.
  const scope =
    "s.organization_id=$2 AND s.patient_id=$1 AND ($3::boolean OR s.unit_id=ANY($4::uuid[])) AND ($11::uuid IS NULL OR s.unit_id=$11)";
  const events = await pool.query(
    `WITH events AS (
      SELECT s.id,'APPOINTMENT'::text AS kind,s.starts_at AS occurred_at,
        'Atendimento · '||coalesce(s.other_care_type,ct.name,CASE s.care_type WHEN 'FIRST_VISIT' THEN 'Primeira consulta' WHEN 'FOLLOW_UP' THEN 'Retorno' WHEN 'CONSULTATION' THEN 'Consulta' WHEN 'TELECONSULTATION' THEN 'Teleconsulta' WHEN 'INJECTABLE' THEN 'Injetável' ELSE 'Atendimento' END) AS title,usr.name AS author_name,u.name AS unit_name,
        s.status,s.id AS appointment_id,NULL::uuid AS document_id,
        'Sala: '||s.room AS summary,NULL::text AS content
      FROM inventory_care_appointments s JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
      LEFT JOIN inventory_users usr ON usr.id=s.professional_user_id
      LEFT JOIN inventory_care_types ct ON ct.organization_id=s.organization_id AND ct.code=s.care_type WHERE ${scope}
      UNION ALL
      SELECT s.id,'CLINICAL_NOTE',s.finalized_at,'Evolução clínica',s.author_name,u.name,s.status,s.appointment_id,NULL::uuid,
        left(s.evolution,240),concat_ws(E'\n\n',nullif(s.evolution,''),
          CASE WHEN s.weight_kg IS NOT NULL THEN 'Peso: '||s.weight_kg::text||' kg' END,
          CASE WHEN s.height_cm IS NOT NULL THEN 'Altura: '||s.height_cm::text||' cm' END,
          CASE WHEN s.systolic_pressure IS NOT NULL THEN 'PA: '||s.systolic_pressure::text||'/'||coalesce(s.diastolic_pressure::text,'—')||' mmHg' END,
          CASE WHEN s.heart_rate IS NOT NULL THEN 'FC: '||s.heart_rate::text||' bpm' END,
          CASE WHEN s.oxygen_saturation IS NOT NULL THEN 'SpO₂: '||s.oxygen_saturation::text||'%' END,
          CASE WHEN s.temperature_c IS NOT NULL THEN 'Temperatura: '||s.temperature_c::text||' °C' END,
          CASE WHEN s.chief_complaint<>'' THEN 'Queixa principal: '||s.chief_complaint END,
          CASE WHEN s.current_history<>'' THEN 'História atual: '||s.current_history END,
          CASE WHEN s.personal_history<>'' THEN 'Antecedentes pessoais: '||s.personal_history END,
          CASE WHEN s.family_history<>'' THEN 'Antecedentes familiares: '||s.family_history END,
          CASE WHEN s.habits<>'' THEN 'Hábitos: '||s.habits END,
          CASE WHEN s.systems_review<>'' THEN 'Revisão de sistemas: '||s.systems_review END,
          CASE WHEN s.general_exam<>'' THEN 'Exame físico geral: '||s.general_exam END,CASE WHEN s.cardiovascular_exam<>'' THEN 'Cardiovascular: '||s.cardiovascular_exam END,CASE WHEN s.respiratory_exam<>'' THEN 'Respiratório: '||s.respiratory_exam END,CASE WHEN s.abdominal_exam<>'' THEN 'Abdominal: '||s.abdominal_exam END,
          CASE WHEN s.neurological_exam<>'' THEN 'Neurológico: '||s.neurological_exam END,CASE WHEN s.musculoskeletal_exam<>'' THEN 'Musculoesquelético: '||s.musculoskeletal_exam END,CASE WHEN s.skin_exam<>'' THEN 'Pele: '||s.skin_exam END,CASE WHEN s.other_exam<>'' THEN 'Outros achados: '||s.other_exam END,
          CASE WHEN s.diagnostic_hypotheses<>'' THEN 'Hipóteses diagnósticas: '||s.diagnostic_hypotheses END,
          CASE WHEN s.clinical_plan<>'' THEN 'Plano: '||s.clinical_plan END,
          CASE WHEN s.conduct<>'' THEN 'Conduta: '||s.conduct END,
          CASE WHEN s.return_recommendation<>'' THEN 'Retorno: '||s.return_recommendation END,
          CASE WHEN s.return_on IS NOT NULL THEN 'Data prevista de retorno: '||to_char(s.return_on,'DD/MM/YYYY') END)
      FROM inventory_clinical_notes s JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=s.organization_id WHERE ${scope} AND s.status='FINAL'
      UNION ALL
      SELECT s.id,'PRESCRIPTION',s.finalized_at,'Prescrição de injetáveis',s.author_name,u.name,s.status,s.appointment_id,NULL::uuid,
        jsonb_array_length(s.items)::text||' item(ns)',(SELECT string_agg(concat_ws(' · ',item->>'medicationName',
          (item->>'doseQuantity')||' '||coalesce(nullif(item->>'doseUnitOther',''),item->>'doseUnit'),item->>'route',
          CASE WHEN item ? 'frequencyEvery' THEN 'A cada '||(item->>'frequencyEvery')||' '||
            CASE item->>'frequencyUnit' WHEN 'HOUR' THEN 'hora(s)' WHEN 'DAY' THEN 'dia(s)' WHEN 'WEEK' THEN 'semana(s)' WHEN 'MONTH' THEN 'mês(es)' END
            ELSE item->>'frequency' END,
          CASE WHEN item->>'continuousUse'='true' THEN 'Uso contínuo' ELSE
            coalesce(item->>'durationAmount',item->>'duration')||' '||CASE item->>'durationUnit' WHEN 'DAY' THEN 'dia(s)' WHEN 'WEEK' THEN 'semana(s)' WHEN 'MONTH' THEN 'mês(es)' ELSE '' END END,
          nullif(item->>'instructions','')),E'\n' ORDER BY ord)
          FROM jsonb_array_elements(s.items) WITH ORDINALITY entries(item,ord))||E'\n'||s.general_instructions
      FROM inventory_encounter_prescriptions s JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=s.organization_id WHERE ${scope} AND s.status='FINAL'
      UNION ALL
      SELECT s.id,'DOCUMENT',s.finalized_at,s.title,coalesce(s.final_snapshot->>'authorName',s.author_name),
        coalesce(s.final_snapshot->>'unitName',u.name),s.status,s.appointment_id,s.id,
        CASE s.type WHEN 'EXAM_REQUEST' THEN 'Solicitação de exames' WHEN 'MEDICAL_CERTIFICATE' THEN 'Atestado médico'
          WHEN 'REFERRAL' THEN 'Encaminhamento' WHEN 'MEDICAL_REPORT' THEN 'Relatório médico'
          WHEN 'MEDICAL_OPINION' THEN 'Laudo médico' WHEN 'INSTRUCTIONS' THEN 'Orientações' ELSE 'Receita' END,s.content
      FROM inventory_encounter_documents s JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=s.organization_id WHERE ${scope} AND s.status='FINAL'
      UNION ALL
      SELECT s.id,'TREATMENT',s.created_at,'Plano terapêutico · '||p.name,usr.name,u.name,s.status,NULL::uuid,NULL::uuid,
        s.dose_quantity::text||' '||s.dose_unit||' · '||s.route,NULL::text
      FROM inventory_patient_treatments s JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
      JOIN inventory_products p ON p.id=s.product_id LEFT JOIN inventory_users usr ON usr.id=s.created_by_user_id WHERE ${scope}
      UNION ALL
      SELECT s.id,'APPLICATION',s.created_at,'Aplicação · '||p.name,s.actor,u.name,'APPLIED',NULL::uuid,NULL::uuid,
        s.dose_quantity::text||' '||s.dose_unit||' · '||coalesce(s.route,'')||' · '||s.reference,
        nullif(s.occurrence_notes,'')
      FROM inventory_patient_applications s JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
      JOIN inventory_products p ON p.id=s.product_id WHERE ${scope}
      UNION ALL
      SELECT s.id,'LABORATORY',s.created_at,'Exame laboratorial validado',usr.name,u.name,'VALIDATED',NULL::uuid,NULL::uuid,
        'Origem: PDF importado · revisão '||s.version::text,NULL::text
      FROM inventory_laboratory_review_versions s
      JOIN inventory_laboratory_imports i ON i.id=s.import_id AND i.organization_id=s.organization_id AND i.patient_id=s.patient_id AND i.unit_id=s.unit_id AND i.latest_review_id=s.id
      JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
      JOIN inventory_users usr ON usr.id=s.reviewed_by_user_id
      WHERE ${scope} AND EXISTS (SELECT 1 FROM inventory_laboratory_results r WHERE r.review_id=s.id AND r.organization_id=s.organization_id AND r.patient_id=s.patient_id AND r.unit_id=s.unit_id)
      UNION ALL
      SELECT s.id,'QUESTIONNAIRE',s.submitted_at,'Questionário · '||v.title,'Declarado pelo paciente',u.name,'SUBMITTED',s.appointment_id,NULL::uuid,
        'Origem: pré-consulta · respostas declaradas pelo paciente, não equivalem a diagnóstico confirmado',NULL::text
      FROM inventory_preconsultation_invitations s
      JOIN inventory_preconsultation_versions v ON v.id=s.version_id AND v.organization_id=s.organization_id
      JOIN inventory_preconsultation_responses r ON r.invitation_id=s.id
      JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
      WHERE ${scope} AND s.submitted_at IS NOT NULL
    ) SELECT id,kind,title,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt",author_name AS "authorName",unit_name AS "unitName",status,
      appointment_id AS "appointmentId",document_id AS "documentId",summary,content
    FROM events WHERE ($5::text IS NULL OR kind=$5)
      AND ($6::date IS NULL OR occurred_at >= $6::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND ($7::date IS NULL OR occurred_at < ($7::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND ($8::timestamptz IS NULL OR (occurred_at,kind,id) < ($8::timestamptz,$9::text,$10::uuid))
    ORDER BY occurred_at DESC,kind DESC,id DESC LIMIT 31`,
    [
      patientId,
      auth.organizationId,
      unrestricted,
      auth.unitIds,
      kind,
      from,
      to,
      cursor?.at ?? null,
      cursor?.kind ?? null,
      cursor?.id ?? null,
      unitId,
    ],
  );
  const rows = events.rows.slice(0, 30);
  const last = rows.at(-1);
  const nextCursor =
    events.rows.length > 30 && last
      ? Buffer.from(
          JSON.stringify({
            at: last.occurredAt,
            filterKey,
            kind: last.kind,
            id: last.id,
          }),
        ).toString("base64url")
      : null;
  try {
    await recordClinicalAccess(auth, {
      unitId: String(patient.primary_unit_id),
      patientId: String(patient.id),
      action: "READ",
      resourceIds: rows.map((row) => String(row.id)).filter((id) => uuid.test(id)),
    });
  } catch {
    console.error("CLINICAL_ACCESS_AUDIT_FAILED");
    return Response.json(
      { error: "Não foi possível carregar o prontuário. Tente novamente." },
      { status: 500, headers },
    );
  }
  return Response.json(
    {
      data: {
        patient: {
          id: patient.id,
          primaryUnitId: patient.primary_unit_id,
          name: patient.name,
          internalCode: patient.internalCode,
          unitName: patient.unitName,
        },
        canCreateEncounter:
          can(auth, "patients.manage", String(patient.primary_unit_id)) &&
          can(auth, "patients.clinical.manage", String(patient.primary_unit_id)),
        allergySummary: await patientAllergySummary(
          auth,
          patientId,
          String(patient.primary_unit_id),
        ),
        events: rows,
        nextCursor,
      },
    },
    { headers },
  );
}
