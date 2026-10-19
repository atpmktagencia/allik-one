import { patientEncounterHistory } from "./patient-encounter-history";
import { recordClinicalAccess } from "./clinical-access-audit";
import { patientAllergySummary } from "./patient-allergies";
import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { verifiedOriginal } from "./private-original";
import { del, get, put } from "@vercel/blob";
import { actor, authenticate, can, canAccessAllUnits, type AuthContext } from "./auth";
import { getPool } from "./db";
import { treatmentInput } from "../data/treatment-input";
import { patientSupplyInput, type PatientSupplyInput } from "../data/patient-supply-input";
import { prescriptionMetadataInput } from "../data/prescription-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);

async function scopedPatient(auth: AuthContext, patientId: string) {
  const result = await getPool().query(
    `SELECT p.id,p.primary_unit_id AS "primaryUnitId",p.internal_code AS "internalCode",
      p.full_name AS "fullName",p.active,u.name AS "unitName"
     FROM inventory_patients p JOIN inventory_units u ON u.id=p.primary_unit_id
     WHERE p.id=$1 AND p.organization_id=$2`,
    [patientId, auth.organizationId],
  );
  const patient = result.rows[0];
  if (!patient || !can(auth, "patients.read", String(patient.primaryUnitId))) return null;
  return patient;
}

export async function patientDetailResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar pacientes." }, { status: 401, headers });
  if (!can(auth, "patients.private.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  const patientId = new URL(request.url).searchParams.get("patientId");
  if (!patientId)
    return Response.json({ error: "Paciente não informado." }, { status: 400, headers });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId))
    return Response.json(
      { error: "Identificador do paciente inválido." },
      { status: 400, headers },
    );
  const patient = await scopedPatient(auth, patientId);
  if (!patient || !can(auth, "patients.private.read", String(patient.primaryUnitId)))
    return Response.json({ error: "Paciente não encontrado." }, { status: 404, headers });

  if (request.method === "GET") {
    const [
      treatments,
      prescriptions,
      products,
      purchases,
      schedule,
      presentations,
      stock,
      locations,
      unitDemand,
      openStock,
      clinicalHistory,
      clinicalProblems,
      clinicalAlerts,
      encounters,
    ] = await Promise.all([
      getPool().query(
        `SELECT t.id,t.product_id AS "productId",p.name AS "productName",p.sku,
          t.dose_quantity AS "doseQuantity",t.dose_unit AS "doseUnit",t.route,
          t.frequency_every_days AS "frequencyEveryDays",t.frequency_every AS "frequencyEvery",t.frequency_unit AS "frequencyUnit",t.first_scheduled_on AS "firstScheduledOn",
          t.planned_administrations AS "plannedAdministrations",t.status,t.version
         FROM inventory_patient_treatments t JOIN inventory_products p ON p.id=t.product_id
         WHERE t.patient_id=$1 AND t.organization_id=$2 AND ($3::boolean OR t.unit_id=ANY($4::uuid[])) ORDER BY t.first_scheduled_on,t.created_at`,
        [patientId, auth.organizationId, canAccessAllUnits(auth), auth.unitIds],
      ),
      getPool().query(
        `SELECT id,treatment_id AS "treatmentId",original_filename AS "originalFilename",
          content_type AS "contentType",size_bytes AS "sizeBytes",sha256 IS NOT NULL AS "hasIntegrityReference",uploaded_at AS "uploadedAt",
          prescriber_name AS "prescriberName",council_number AS "councilNumber",
          council_region AS "councilRegion",issued_on::text AS "issuedOn",
          valid_until::text AS "validUntil",document_status AS "documentStatus",version,
          supersedes_id AS "supersedesId",
          CASE WHEN document_status='ACTIVE' AND (issued_on IS NULL OR valid_until IS NULL)
            THEN 'LEGACY_REVIEW'
            WHEN document_status='ACTIVE' AND issued_on<=current_date AND valid_until>=current_date
            THEN 'VALID' WHEN document_status='ACTIVE' AND valid_until<current_date THEN 'EXPIRED'
            WHEN document_status='ACTIVE' AND issued_on>current_date THEN 'NOT_YET_VALID'
            ELSE document_status END AS "effectiveStatus"
         FROM inventory_patient_prescriptions WHERE patient_id=$1 AND organization_id=$2 AND treatment_id IN (SELECT id FROM inventory_patient_treatments WHERE organization_id=$2 AND ($3::boolean OR unit_id=ANY($4::uuid[])))
         ORDER BY treatment_id,version DESC,uploaded_at DESC`,
        [patientId, auth.organizationId, canAccessAllUnits(auth), auth.unitIds],
      ),
      getPool().query(
        `SELECT id,name,sku,unit FROM inventory_products
         WHERE organization_id=$1 AND active AND stock_controlled ORDER BY lower(name)`,
        [auth.organizationId],
      ),
      getPool().query(
        `SELECT id,treatment_id AS "treatmentId",purchased_quantity AS "purchasedQuantity",quantity_unit AS "quantityUnit",total_value AS "totalValue",reference,purchased_on::text AS "purchasedOn",created_at AS "createdAt" FROM inventory_patient_treatment_purchases WHERE patient_id=$1 AND organization_id=$2 AND ($3::boolean OR unit_id=ANY($4::uuid[])) ORDER BY purchased_on,created_at`,
        [patientId, auth.organizationId, canAccessAllUnits(auth), auth.unitIds],
      ),
      getPool().query(
        `SELECT s.id,s.treatment_id AS "treatmentId",s.sequence,s.scheduled_on::text AS "scheduledOn",
          s.dose_quantity AS "doseQuantity",s.dose_unit AS "doseUnit",s.status,s.version,
          EXISTS(SELECT 1 FROM inventory_patient_prescriptions pr
            WHERE pr.treatment_id=s.treatment_id AND pr.document_status='ACTIVE'
              AND pr.issued_on<=s.scheduled_on AND pr.valid_until>=s.scheduled_on
          ) AS "hasValidPrescription",
          a.id AS "applicationId",a.reference AS "applicationReference",
          a.professional AS "applicationProfessional",a.physical_quantity AS "physicalQuantity",
          a.route AS "applicationRoute",a.dose_volume_ml AS "applicationDoseVolumeMl",
          a.occurrence_notes AS "applicationOccurrenceNotes",a.prescription_id AS "applicationPrescriptionId",
          a.created_at AS "administeredAt"
         FROM inventory_patient_treatment_schedule s
         LEFT JOIN inventory_patient_applications a ON a.schedule_id=s.id
         WHERE s.patient_id=$1 AND s.organization_id=$2 AND ($3::boolean OR s.unit_id=ANY($4::uuid[])) ORDER BY s.scheduled_on,s.sequence`,
        [patientId, auth.organizationId, canAccessAllUnits(auth), auth.unitIds],
      ),
      getPool().query(
        `SELECT DISTINCT ON (product_id,upper(base_unit)) product_id AS "productId",upper(base_unit) AS "baseUnit",name,total_base_quantity AS "totalBaseQuantity",technical_loss_percent AS "technicalLossPercent",total_volume_ml AS "totalVolumeMl" FROM inventory_pricing_presentations WHERE organization_id=$1 AND active AND product_id IS NOT NULL ORDER BY product_id,upper(base_unit),pricing_status DESC,updated_at DESC`,
        [auth.organizationId],
      ),
      getPool().query(
        `SELECT l.product_id AS "productId",COALESCE(sum(b.quantity),0) AS quantity FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id JOIN inventory_locations loc ON loc.id=b.location_id WHERE loc.unit_id=$1 AND l.status='AVAILABLE' AND l.expires_on>=current_date GROUP BY l.product_id`,
        [patient.primaryUnitId],
      ),
      getPool().query(
        `SELECT id,name FROM inventory_locations
         WHERE unit_id=$1 AND active ORDER BY lower(name)`,
        [patient.primaryUnitId],
      ),
      getPool().query(
        `SELECT product_id AS "productId",upper(dose_unit) AS "doseUnit",sum(dose_quantity) AS quantity,
           COALESCE(sum(dose_quantity) FILTER (WHERE status='RESERVED'),0) AS "reservedQuantity"
           FROM inventory_patient_treatment_schedule
           WHERE unit_id=$1 AND ((status='PLANNED' AND scheduled_on>=current_date) OR status='RESERVED')
           GROUP BY product_id,upper(dose_unit)`,
        [patient.primaryUnitId],
      ),
      getPool().query(
        `SELECT product_id AS "productId",upper(base_unit) AS "baseUnit",
          COALESCE(sum(remaining_base_quantity),0) AS quantity
         FROM inventory_open_presentations
         WHERE unit_id=$1 AND status='OPEN' AND usable_until>now()
         GROUP BY product_id,upper(base_unit)`,
        [patient.primaryUnitId],
      ),
      getPool().query(
        `SELECT n.id,n.appointment_id AS "appointmentId",n.evolution,n.conduct,
          n.diagnostic_hypotheses AS "diagnosticHypotheses",n.clinical_plan AS "clinicalPlan",
          n.return_recommendation AS "returnRecommendation",n.return_on::text AS "returnOn",
          n.chief_complaint AS "chiefComplaint",n.current_history AS "currentHistory",
          n.personal_history AS "personalHistory",n.family_history AS "familyHistory",
          n.habits,n.systems_review AS "systemsReview",
          n.general_exam AS "generalExam",n.cardiovascular_exam AS "cardiovascularExam",
          n.respiratory_exam AS "respiratoryExam",n.abdominal_exam AS "abdominalExam",
          n.neurological_exam AS "neurologicalExam",n.musculoskeletal_exam AS "musculoskeletalExam",
          n.skin_exam AS "skinExam",n.other_exam AS "otherExam",
          n.author_name AS "authorName",n.professional_council AS "professionalCouncil",
          n.council_number AS "councilNumber",n.council_region AS "councilRegion",
          n.systolic_pressure AS "systolicPressure",n.diastolic_pressure AS "diastolicPressure",
          n.heart_rate AS "heartRate",n.oxygen_saturation AS "oxygenSaturation",
          n.temperature_c AS "temperatureC",n.weight_kg AS "weightKg",n.height_cm AS "heightCm",
          n.finalized_at AS "finalizedAt",n.unit_id AS "unitId",u.name AS "unitName",a.starts_at AS "appointmentStartsAt",
          COALESCE(ct.name,a.other_care_type,a.care_type) AS "careTypeName"
         FROM inventory_clinical_notes n
         JOIN inventory_care_appointments a ON a.id=n.appointment_id AND a.organization_id=n.organization_id AND a.patient_id=n.patient_id AND a.unit_id=n.unit_id
         JOIN inventory_units u ON u.id=n.unit_id AND u.organization_id=n.organization_id
         LEFT JOIN inventory_care_types ct ON ct.organization_id=a.organization_id AND ct.code=a.care_type
         WHERE n.patient_id=$1 AND n.organization_id=$2 AND ($3::boolean OR n.unit_id=ANY($4::uuid[])) AND n.status='FINAL'
         ORDER BY n.finalized_at DESC,n.id DESC LIMIT 101`,
        [patientId, auth.organizationId, canAccessAllUnits(auth), auth.unitIds],
      ),
      getPool().query(
        `SELECT id,unit_id AS "unitId",(SELECT u.name FROM inventory_units u WHERE u.id=inventory_patient_clinical_problems.unit_id) AS "unitName",description,icd10_code AS "icd10Code",onset_on::text AS "onsetOn",
          resolved_on::text AS "resolvedOn",status,notes,author_name AS "authorName",
          professional_council AS "professionalCouncil",council_number AS "councilNumber",
          council_region AS "councilRegion",version,created_at AS "createdAt",updated_at AS "updatedAt"
         FROM inventory_patient_clinical_problems
         WHERE patient_id=$1 AND organization_id=$2 AND ($3::boolean OR unit_id=ANY($4::uuid[]))
         ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'RESOLVED' THEN 1 ELSE 2 END,
           updated_at DESC,id DESC LIMIT 201`,
        [patientId, auth.organizationId, canAccessAllUnits(auth), auth.unitIds],
      ),
      getPool().query(
        `SELECT id,unit_id AS "unitId",(SELECT u.name FROM inventory_units u WHERE u.id=inventory_patient_clinical_alerts.unit_id) AS "unitName",type,title,reaction,severity,status,notes,author_name AS "authorName",
          professional_council AS "professionalCouncil",council_number AS "councilNumber",
          council_region AS "councilRegion",version,created_at AS "createdAt",updated_at AS "updatedAt"
         FROM inventory_patient_clinical_alerts
         WHERE patient_id=$1 AND organization_id=$2
           AND (($3::boolean OR unit_id=ANY($4::uuid[])) OR (type='ALLERGY' AND status='ACTIVE'))
         ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
          CASE severity WHEN 'SEVERE' THEN 0 WHEN 'MODERATE' THEN 1 WHEN 'MILD' THEN 2 ELSE 3 END,
          updated_at DESC,id DESC LIMIT 201`,
        [patientId, auth.organizationId, canAccessAllUnits(auth), auth.unitIds],
      ),
      patientEncounterHistory(auth, patientId),
    ]);
    const purchaseRows = purchases.rows as Array<Record<string, unknown>>;
    const scheduleRows = schedule.rows as Array<Record<string, unknown>>;
    const presentationRows = presentations.rows as Array<Record<string, unknown>>;
    const stockRows = stock.rows as Array<Record<string, unknown>>;
    const unitDemandRows = unitDemand.rows as Array<Record<string, unknown>>;
    const openStockRows = openStock.rows as Array<Record<string, unknown>>;
    const groupByTreatment = (rows: Array<Record<string, unknown>>) => {
      const grouped = new Map<string, Array<Record<string, unknown>>>();
      for (const row of rows) {
        const key = String(row["treatmentId"]);
        const group = grouped.get(key);
        if (group) group.push(row);
        else grouped.set(key, [row]);
      }
      return grouped;
    };
    const schedulesByTreatment = groupByTreatment(scheduleRows);
    const purchasesByTreatment = groupByTreatment(purchaseRows);
    const productUnitKey = (product: unknown, unit: unknown) =>
      `${String(product)}:${String(unit)}`;
    const presentationsByProductUnit = new Map(
      presentationRows.map((row) => [productUnitKey(row["productId"], row["baseUnit"]), row]),
    );
    const stockByProduct = new Map(stockRows.map((row) => [String(row["productId"]), row]));
    const openByProductUnit = new Map(
      openStockRows.map((row) => [productUnitKey(row["productId"], row["baseUnit"]), row]),
    );
    const demandByProductUnit = new Map(
      unitDemandRows.map((row) => [productUnitKey(row["productId"], row["doseUnit"]), row]),
    );
    const summaries = treatments.rows.map((treatment: Record<string, unknown>) => {
      const treatmentId = String(treatment["id"]);
      const doseUnit = String(treatment["doseUnit"]).toUpperCase();
      const treatmentSchedule = schedulesByTreatment.get(treatmentId) ?? [];
      const activeSchedule = treatmentSchedule.filter((row) => row["status"] !== "CANCELED");
      const purchasedQuantity = (purchasesByTreatment.get(treatmentId) ?? []).reduce(
        (sum, row) => sum + Number(row["purchasedQuantity"]),
        0,
      );
      const reservedQuantity = activeSchedule
        .filter((row) => row["status"] === "RESERVED")
        .reduce((sum, row) => sum + Number(row["doseQuantity"]), 0);
      const consumedQuantity = activeSchedule
        .filter((row) => row["status"] === "CONSUMED")
        .reduce((sum, row) => sum + Number(row["doseQuantity"]), 0);
      const plannedQuantity = activeSchedule
        .filter((row) => row["status"] === "PLANNED")
        .reduce((sum, row) => sum + Number(row["doseQuantity"]), 0);
      const presentation = presentationsByProductUnit.get(
        productUnitKey(treatment["productId"], doseUnit),
      );
      const availableStockUnits = Number(
        stockByProduct.get(String(treatment["productId"]))?.["quantity"] ?? 0,
      );
      const usablePerPresentation = presentation
        ? Number(presentation["totalBaseQuantity"]) *
          (1 - Number(presentation["technicalLossPercent"]) / 100)
        : null;
      const doseVolumeMl =
        presentation?.["totalVolumeMl"] && Number(presentation["totalBaseQuantity"]) > 0
          ? (Number(treatment["doseQuantity"]) / Number(presentation["totalBaseQuantity"])) *
            Number(presentation["totalVolumeMl"])
          : null;
      const demandQuantity = plannedQuantity + reservedQuantity;
      const openQuantity = Number(
        openByProductUnit.get(productUnitKey(treatment["productId"], doseUnit))?.["quantity"] ?? 0,
      );
      const physicalAvailableDose =
        usablePerPresentation === null
          ? null
          : openQuantity + availableStockUnits * usablePerPresentation;
      const requiredPresentationUnits =
        usablePerPresentation && usablePerPresentation > 0
          ? Math.ceil(demandQuantity / usablePerPresentation)
          : null;
      const unitDemandQuantity = Number(
        demandByProductUnit.get(productUnitKey(treatment["productId"], doseUnit))?.["quantity"] ??
          0,
      );
      const unitReservedQuantity = Number(
        demandByProductUnit.get(productUnitKey(treatment["productId"], doseUnit))?.[
          "reservedQuantity"
        ] ?? 0,
      );
      const unitRequiredPresentationUnits =
        usablePerPresentation && usablePerPresentation > 0
          ? Math.ceil(unitDemandQuantity / usablePerPresentation)
          : null;
      return {
        treatmentId,
        purchasedQuantity,
        reservedQuantity,
        consumedQuantity,
        plannedQuantity,
        purchasedRemaining: Math.max(0, purchasedQuantity - consumedQuantity),
        purchasedAvailableToReserve: Math.max(
          0,
          purchasedQuantity - consumedQuantity - reservedQuantity,
        ),
        presentationName: presentation?.["name"] ?? null,
        doseVolumeMl,
        usablePerPresentation,
        availableStockUnits,
        openQuantity,
        physicalAvailableDose,
        physicalUnreservedDose:
          physicalAvailableDose === null
            ? null
            : Math.max(0, physicalAvailableDose - unitReservedQuantity),
        requiredPresentationUnits,
        shortageUnits:
          requiredPresentationUnits === null
            ? null
            : Math.max(0, requiredPresentationUnits - availableStockUnits),
        unitDemandQuantity,
        unitReservedQuantity,
        unitRequiredPresentationUnits,
        unitShortageUnits:
          unitRequiredPresentationUnits === null
            ? null
            : Math.max(0, unitRequiredPresentationUnits - availableStockUnits),
      };
    });
    try {
      await recordClinicalAccess(auth, {
        unitId: String(patient.primaryUnitId),
        patientId,
        action: "READ",
        resourceIds: [
          ...clinicalHistory.rows.map((n) => n.id),
          ...encounters.rows.flatMap((entry) => [
            entry.id,
            ...(entry.note ? [entry.note.id] : []),
            ...(entry.prescription ? [entry.prescription.id] : []),
            ...entry.documents.map((document: { id: string }) => document.id),
          ]),
        ],
      });
    } catch {
      console.error("CLINICAL_ACCESS_AUDIT_FAILED");
      return Response.json(
        { error: "Não foi possível carregar o resumo das consultas. Tente novamente." },
        { status: 500, headers },
      );
    }
    return Response.json(
      {
        data: {
          encounterHistory: encounters.rows.slice(0, 50),
          patient,
          treatments: treatments.rows,
          prescriptions: prescriptions.rows,
          products: products.rows,
          purchases: purchaseRows,
          schedule: scheduleRows,
          supplySummaries: summaries,
          locations: locations.rows,
          historyScope: "AUTHORIZED_UNITS",
          historyLimits: {
            clinicalHistory: 100,
            clinicalProblems: 200,
            clinicalAlerts: 200,
            encounters: 50,
          },
          historyHasMore: {
            clinicalHistory: clinicalHistory.rows.length > 100,
            clinicalProblems: clinicalProblems.rows.length > 200,
            clinicalAlerts: clinicalAlerts.rows.length > 200,
            encounters: encounters.rows.length > 50,
          },
          clinicalHistory: clinicalHistory.rows.slice(0, 100),
          clinicalProblems: clinicalProblems.rows.slice(0, 200),
          clinicalAlerts: clinicalAlerts.rows.slice(0, 200),
          allergySummary: await patientAllergySummary(
            auth,
            patientId,
            String(patient.primaryUnitId),
          ),
          canManageClinicalProblems:
            Boolean(auth.user.id) &&
            !auth.preview &&
            !auth.integration &&
            can(auth, "patients.clinical.manage", String(patient.primaryUnitId)),
          canManage:
            can(auth, "patients.manage", String(patient.primaryUnitId)) &&
            can(auth, "patients.clinical.manage", String(patient.primaryUnitId)),
          canConsume:
            can(auth, "patients.read", String(patient.primaryUnitId)) &&
            can(auth, "inventory.consume", String(patient.primaryUnitId)),
        },
      },
      { headers },
    );
  }

  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (
    !can(auth, "patients.manage", String(patient.primaryUnitId)) ||
    !can(auth, "patients.clinical.manage", String(patient.primaryUnitId))
  )
    return Response.json(
      { error: "Sem permissão para alterar tratamentos." },
      { status: 403, headers },
    );

  if (request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return uploadPrescription(request, auth, patient);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const supplyParsed = patientSupplyInput.safeParse(body);
  if (supplyParsed.success) {
    if (supplyParsed.data.patientId !== patientId)
      return Response.json({ error: "Paciente inválido." }, { status: 400, headers });
    return updatePatientSupply(auth, patient, supplyParsed.data);
  }
  const parsed = treatmentInput.safeParse(body);
  if (!parsed.success || parsed.data.patientId !== patientId)
    return Response.json(
      { error: "Confira os dados do tratamento ou da compra." },
      { status: 400, headers },
    );
  const input = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const product = await client.query(
      "SELECT id FROM inventory_products WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
      [input.productId, auth.organizationId],
    );
    if (!product.rowCount) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Produto inválido." }, { status: 400, headers });
    }
    let before: unknown = null;
    let result;
    if (input.action === "CREATE_TREATMENT") {
      result = await client.query(
        `INSERT INTO inventory_patient_treatments(id,organization_id,patient_id,unit_id,product_id,dose_quantity,dose_unit,route,frequency_every_days,first_scheduled_on,planned_administrations,status,created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [
          input.id,
          auth.organizationId,
          patientId,
          patient.primaryUnitId,
          input.productId,
          input.doseQuantity,
          input.doseUnit,
          input.route,
          input.frequencyEveryDays,
          input.firstScheduledOn,
          input.plannedAdministrations,
          input.status,
          auth.user.id,
        ],
      );
      if (input.plannedAdministrations)
        await client.query(
          `INSERT INTO inventory_patient_treatment_schedule(organization_id,patient_id,treatment_id,unit_id,product_id,sequence,scheduled_on,dose_quantity,dose_unit,updated_by_user_id)
         SELECT $1,$2,$3,$4,$5,g,($6::date + (($7::numeric * (g-1)) * interval '1 day'))::date,$8,$9,$10 FROM generate_series(1,$11::integer) g`,
          [
            auth.organizationId,
            patientId,
            input.id,
            patient.primaryUnitId,
            input.productId,
            input.firstScheduledOn,
            input.frequencyEveryDays,
            input.doseQuantity,
            input.doseUnit,
            auth.user.id,
            input.plannedAdministrations,
          ],
        );
    } else {
      const current = await client.query(
        "SELECT * FROM inventory_patient_treatments WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR UPDATE",
        [input.id, patientId, auth.organizationId],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Tratamento não encontrado." }, { status: 404, headers });
      }
      if (!can(auth, "patients.clinical.manage", current.rows[0].unit_id)) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
      }
      if (current.rows[0].version !== input.version) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "O tratamento mudou. Recarregue e tente novamente." },
          { status: 409, headers },
        );
      }
      before = current.rows[0];
      if (current.rows[0].source_quote_id) {
        await client.query("ROLLBACK");
        return Response.json(
          {
            error:
              "Este plano foi gerado de um orçamento pago. A alteração da prescrição exige revisão clínica específica.",
          },
          { status: 409, headers },
        );
      }
      result = await client.query(
        `UPDATE inventory_patient_treatments SET product_id=$4,dose_quantity=$5,dose_unit=$6,route=$7,frequency_every_days=$8,first_scheduled_on=$9,planned_administrations=$10,status=$11,updated_by_user_id=$12,version=version+1,updated_at=now()
         WHERE id=$1 AND patient_id=$2 AND organization_id=$3 RETURNING *`,
        [
          input.id,
          patientId,
          auth.organizationId,
          input.productId,
          input.doseQuantity,
          input.doseUnit,
          input.route,
          input.frequencyEveryDays,
          input.firstScheduledOn,
          input.plannedAdministrations,
          input.status,
          auth.user.id,
        ],
      );
    }
    await client.query(
      `INSERT INTO inventory_patient_treatment_changes(organization_id,treatment_id,action,before_data,after_data,reason,actor,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        auth.organizationId,
        input.id,
        input.action === "CREATE_TREATMENT" ? "CREATE" : "UPDATE",
        before,
        result.rows[0],
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.id } },
      { status: input.action === "CREATE_TREATMENT" ? 201 : 200, headers },
    );
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json(
      { error: "Não foi possível salvar o tratamento." },
      { status: 503, headers },
    );
  } finally {
    client.release();
  }
}

async function updatePatientSupply(
  auth: AuthContext,
  patient: Record<string, unknown>,
  input: PatientSupplyInput,
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (input.action === "CREATE_PURCHASE") {
      const treatment = await client.query(
        "SELECT id,dose_unit,unit_id FROM inventory_patient_treatments WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR SHARE",
        [input.treatmentId, patient["id"], auth.organizationId],
      );
      if (!treatment.rowCount) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Tratamento inválido." }, { status: 400, headers });
      }
      if (!can(auth, "patients.clinical.manage", treatment.rows[0].unit_id)) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
      }
      await client.query(
        `INSERT INTO inventory_patient_treatment_purchases(id,organization_id,patient_id,treatment_id,unit_id,purchased_quantity,quantity_unit,total_value,reference,purchased_on,reason,actor,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          input.id,
          auth.organizationId,
          patient["id"],
          input.treatmentId,
          treatment.rows[0].unit_id,
          input.purchasedQuantity,
          treatment.rows[0].dose_unit,
          input.totalValue,
          input.reference,
          input.purchasedOn,
          input.reason,
          actor(auth).name,
          actor(auth).userId,
        ],
      );
      await client.query("COMMIT");
      return Response.json({ data: { id: input.id } }, { status: 201, headers });
    }
    const current = await client.query(
      "SELECT * FROM inventory_patient_treatment_schedule WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR UPDATE",
      [input.scheduleId, patient["id"], auth.organizationId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Aplicação prevista não encontrada." },
        { status: 404, headers },
      );
    }
    if (!can(auth, "patients.clinical.manage", current.rows[0].unit_id)) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
    }
    if (current.rows[0].status === "CONSUMED") {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Uma aplicação consumida não pode ser alterada por este fluxo." },
        { status: 409, headers },
      );
    }
    if (current.rows[0].version !== input.version) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "A reserva mudou. Recarregue e tente novamente." },
        { status: 409, headers },
      );
    }
    if (input.status === "RESERVED") {
      const schedule = current.rows[0];
      await client.query(
        "SELECT id FROM inventory_patient_treatments WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR UPDATE",
        [schedule.treatment_id, patient["id"], auth.organizationId],
      );
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${schedule.unit_id}:${schedule.product_id}`,
      ]);
      const entitlement = await client.query(
        `SELECT
          COALESCE((SELECT sum(purchased_quantity) FROM inventory_patient_treatment_purchases
            WHERE treatment_id=$1),0) AS purchased,
          COALESCE((SELECT sum(dose_quantity) FROM inventory_patient_treatment_schedule
            WHERE treatment_id=$1 AND status='CONSUMED'),0) AS consumed,
          COALESCE((SELECT sum(dose_quantity) FROM inventory_patient_treatment_schedule
            WHERE treatment_id=$1 AND status='RESERVED' AND id<>$2),0) AS reserved`,
        [schedule.treatment_id, schedule.id],
      );
      const availableToReserve =
        Number(entitlement.rows[0].purchased) -
        Number(entitlement.rows[0].consumed) -
        Number(entitlement.rows[0].reserved);
      if (availableToReserve + 0.0000001 < Number(schedule.dose_quantity)) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "A quantidade comprada disponível não cobre esta dose." },
          { status: 409, headers },
        );
      }
      const presentation = await client.query(
        `SELECT total_base_quantity::text,technical_loss_percent::text
         FROM inventory_pricing_presentations
         WHERE organization_id=$1 AND product_id=$2 AND active AND upper(base_unit)=upper($3)
         ORDER BY pricing_status DESC,updated_at DESC LIMIT 1 FOR SHARE`,
        [auth.organizationId, schedule.product_id, schedule.dose_unit],
      );
      if (!presentation.rowCount) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Cadastre a apresentação e a concentração antes de reservar." },
          { status: 409, headers },
        );
      }
      const balances = await client.query(
        `SELECT b.quantity::text FROM inventory_balances b
         JOIN inventory_lots l ON l.id=b.lot_id
         JOIN inventory_locations loc ON loc.id=b.location_id
         WHERE loc.unit_id=$1 AND l.product_id=$2 AND l.status='AVAILABLE'
           AND l.expires_on>=current_date AND b.quantity>0 FOR UPDATE OF b`,
        [schedule.unit_id, schedule.product_id],
      );
      const opened = await client.query(
        `SELECT remaining_base_quantity::text FROM inventory_open_presentations
         WHERE unit_id=$1 AND product_id=$2 AND upper(base_unit)=upper($3)
           AND status='OPEN' AND usable_until>now() AND remaining_base_quantity>0 FOR UPDATE`,
        [schedule.unit_id, schedule.product_id, schedule.dose_unit],
      );
      const unitReserved = await client.query(
        `SELECT COALESCE(sum(dose_quantity),0)::text AS quantity
         FROM inventory_patient_treatment_schedule
         WHERE unit_id=$1 AND product_id=$2 AND upper(dose_unit)=upper($3)
           AND status='RESERVED' AND id<>$4`,
        [schedule.unit_id, schedule.product_id, schedule.dose_unit, schedule.id],
      );
      const usablePerUnit =
        Number(presentation.rows[0].total_base_quantity) *
        (1 - Number(presentation.rows[0].technical_loss_percent) / 100);
      const physicalUnits = balances.rows.reduce((sum, row) => sum + Number(row.quantity), 0);
      const openQuantity = opened.rows.reduce(
        (sum, row) => sum + Number(row.remaining_base_quantity),
        0,
      );
      const capacity = openQuantity + physicalUnits * usablePerUnit;
      if (
        Number(unitReserved.rows[0].quantity) + Number(schedule.dose_quantity) >
        capacity + 0.0000001
      ) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "O estoque físico livre não cobre esta reserva." },
          { status: 409, headers },
        );
      }
    }
    const updated = await client.query(
      `UPDATE inventory_patient_treatment_schedule
       SET status=$2,attendance_status=CASE WHEN $2='CANCELED' THEN 'CANCELED' ELSE attendance_status END,
         version=version+1,updated_by_user_id=$3,updated_at=now() WHERE id=$1 RETURNING *`,
      [input.scheduleId, input.status, auth.user.id],
    );
    await client.query(
      `INSERT INTO inventory_patient_schedule_changes(organization_id,schedule_id,before_data,after_data,reason,actor,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        auth.organizationId,
        input.scheduleId,
        current.rows[0],
        updated.rows[0],
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: { id: input.scheduleId } }, { headers });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json(
      { error: "Não foi possível atualizar a previsão do paciente." },
      { status: 503, headers },
    );
  } finally {
    client.release();
  }
}

async function uploadPrescription(
  request: Request,
  auth: AuthContext,
  patient: Record<string, unknown>,
) {
  const form = await request.formData();
  const file = form.get("file");
  const metadata = prescriptionMetadataInput.safeParse({
    treatmentId: String(form.get("treatmentId") ?? ""),
    prescriberName: String(form.get("prescriberName") ?? ""),
    councilNumber: String(form.get("councilNumber") ?? ""),
    councilRegion: String(form.get("councilRegion") ?? ""),
    issuedOn: String(form.get("issuedOn") ?? ""),
    validUntil: String(form.get("validUntil") ?? ""),
    supersedesId: String(form.get("supersedesId") ?? ""),
    reason: String(form.get("reason") ?? ""),
  });
  if (
    !(file instanceof File) ||
    !allowedTypes.has(file.type) ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024 ||
    !metadata.success
  )
    return Response.json(
      {
        error:
          "Envie PDF ou imagem de até 10 MB e confira prescritor, conselho, emissão, validade e motivo.",
      },
      { status: 400, headers },
    );
  const input = metadata.data;
  const treatment = await getPool().query(
    "SELECT id,unit_id FROM inventory_patient_treatments WHERE id=$1 AND patient_id=$2 AND organization_id=$3",
    [input.treatmentId, patient["id"], auth.organizationId],
  );
  if (!treatment.rowCount)
    return Response.json({ error: "Tratamento inválido." }, { status: 400, headers });
  if (!can(auth, "patients.clinical.manage", treatment.rows[0].unit_id))
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
  const prescriptionId = crypto.randomUUID();
  const extension =
    file.type === "application/pdf" ? "pdf" : file.type.split("/")[1]!.replace("jpeg", "jpg");
  const pathname = `prescriptions/${auth.organizationId}/${patient["id"]}/${prescriptionId}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const blob = await put(pathname, bytes, {
    access: "private",
    addRandomSuffix: false,
    contentType: file.type,
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let version = 1;
    if (input.supersedesId) {
      const previous = await client.query(
        `SELECT id,version FROM inventory_patient_prescriptions
         WHERE id=$1 AND patient_id=$2 AND treatment_id=$3 AND organization_id=$4
           AND document_status='ACTIVE' FOR UPDATE`,
        [input.supersedesId, patient["id"], input.treatmentId, auth.organizationId],
      );
      if (!previous.rowCount) {
        await client.query("ROLLBACK");
        await del(blob.pathname).catch(() => {});
        return Response.json(
          { error: "A prescrição substituída mudou. Atualize e confira novamente." },
          { status: 409, headers },
        );
      }
      version = Number(previous.rows[0].version) + 1;
      await client.query(
        "UPDATE inventory_patient_prescriptions SET document_status='SUPERSEDED' WHERE id=$1",
        [input.supersedesId],
      );
    }
    await client.query(
      `INSERT INTO inventory_patient_prescriptions(
        id,organization_id,patient_id,treatment_id,blob_pathname,original_filename,content_type,
        size_bytes,prescriber_name,council_number,council_region,issued_on,valid_until,
        document_status,version,supersedes_id,uploaded_by_user_id,sha256
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ACTIVE',$14,$15,$16,$17)`,
      [
        prescriptionId,
        auth.organizationId,
        patient["id"],
        input.treatmentId,
        blob.pathname,
        file.name.slice(0, 180),
        file.type,
        file.size,
        input.prescriberName,
        input.councilNumber,
        input.councilRegion.toUpperCase(),
        input.issuedOn,
        input.validUntil,
        version,
        input.supersedesId || null,
        auth.user.id,
        sha256,
      ],
    );
    await client.query(
      `INSERT INTO inventory_patient_treatment_changes(organization_id,treatment_id,action,after_data,reason,actor,actor_user_id) VALUES($1,$2,'UPLOAD_PRESCRIPTION',$3,$4,$5,$6)`,
      [
        auth.organizationId,
        input.treatmentId,
        {
          prescriptionId,
          contentType: file.type,
          sizeBytes: file.size,
          prescriberName: input.prescriberName,
          councilNumber: input.councilNumber,
          councilRegion: input.councilRegion.toUpperCase(),
          issuedOn: input.issuedOn,
          validUntil: input.validUntil,
          version,
          supersedesId: input.supersedesId || null,
        },
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: { id: prescriptionId } }, { status: 201, headers });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    await del(blob.pathname).catch(() => {});
    return Response.json(
      { error: "Não foi possível guardar a prescrição." },
      { status: 503, headers },
    );
  } finally {
    client.release();
  }
}

export async function prescriptionDownloadResponse(request: Request, prescriptionId: string) {
  const auth = await authenticate(request);
  if (!auth || !can(auth, "patients.private.read"))
    return Response.json({ error: "Acesso negado." }, { status: auth ? 403 : 401, headers });
  const result = await getPool().query(
    `SELECT d.id,d.patient_id,d.sha256,d.size_bytes,d.blob_pathname,d.original_filename,d.content_type,p.primary_unit_id,t.unit_id FROM inventory_patient_prescriptions d JOIN inventory_patients p ON p.id=d.patient_id AND p.organization_id=d.organization_id JOIN inventory_patient_treatments t ON t.id=d.treatment_id AND t.organization_id=d.organization_id WHERE d.id=$1 AND d.organization_id=$2`,
    [prescriptionId, auth.organizationId],
  );
  const document = result.rows[0];
  if (!document || !can(auth, "patients.private.read", String(document.primary_unit_id)))
    return Response.json({ error: "Documento não encontrado." }, { status: 404, headers });
  if (!can(auth, "patients.private.read", String(document.unit_id)))
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
  const blob = await get(String(document.blob_pathname), { access: "private" });
  if (!blob || blob.statusCode !== 200)
    return Response.json({ error: "Documento não encontrado." }, { status: 404, headers });
  let bytes: Buffer;
  try {
    bytes = await verifiedOriginal(
      blob.stream,
      Number(document.size_bytes),
      document.sha256 ?? null,
      10 * 1024 * 1024,
    );
    await recordClinicalAccess(auth, {
      patientId: String(document.patient_id),
      unitId: String(document.unit_id),
      sourceKind: "UPLOADED_PRESCRIPTION",
      sourceId: String(document.id),
      action:
        new URL(request.url).searchParams.get("download") === "true"
          ? "DOCUMENT_DOWNLOAD"
          : "DOCUMENT_OPEN",
      resourceIds: [String(document.id)],
    });
  } catch {
    return Response.json(
      { error: "Não foi possível verificar ou auditar o original. Nenhum arquivo foi entregue." },
      { status: 503, headers },
    );
  }
  await getPool().query(
    `INSERT INTO inventory_patient_prescription_access
      (organization_id,prescription_id,actor,actor_user_id) VALUES($1,$2,$3,$4)`,
    [auth.organizationId, prescriptionId, actor(auth).name, actor(auth).userId],
  );
  const safeName = String(document.original_filename).replace(/["\\\r\n]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": String(document.content_type),
      "X-Allik-Original-Integrity": document.sha256 ? "verified" : "legacy-unverified",
      "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "true" ? "attachment" : "inline"}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
