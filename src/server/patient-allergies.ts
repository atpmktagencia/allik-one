import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import { actor, can, type AuthContext } from "./auth";
import { getPool } from "./db";
import { hasClinicalRegistration } from "./clinical-professional-policy";
import { resolveAllergies, type AllergySummary } from "../lib/patient-allergies";
export async function patientAllergySummary(
  auth: AuthContext,
  patientId: string,
  unitId: string,
): Promise<AllergySummary> {
  if (!can(auth, "patients.private.read", unitId)) throw new Error("ALLERGY_SCOPE_DENIED");
  const result = await getPool().query(
    `SELECT p.primary_unit_id,p.private_data,p.allergy_status,p.allergy_reviewed_at,p.version,p.active,
    reviewer.name AS reviewed_by,me.professional_council,me.council_number,me.council_region,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('type',a.type,'title',a.title)) FROM inventory_patient_clinical_alerts a
      WHERE a.patient_id=p.id AND a.organization_id=p.organization_id AND a.status='ACTIVE' AND a.type='ALLERGY'),'[]'::jsonb) AS alerts
    FROM inventory_patients p LEFT JOIN inventory_users reviewer ON reviewer.id=p.allergy_reviewed_by_user_id
    LEFT JOIN inventory_users me ON me.id=$3 AND me.active
    WHERE p.id=$1 AND p.organization_id=$2`,
    // Active allergies are patient-safety information: they follow the patient
    // across units of the organization once the reader may see this patient.
    [patientId, auth.organizationId, auth.user.id],
  );
  const patient = result.rows[0];
  if (!patient) throw new Error("ALLERGY_PATIENT_NOT_FOUND");
  const canReadAssessment = can(auth, "patients.private.read", patient.primary_unit_id);
  return {
    ...resolveAllergies(
      canReadAssessment ? patient.private_data : {},
      patient.alerts,
      canReadAssessment ? patient.allergy_status : "UNKNOWN",
    ),
    reviewedAt: canReadAssessment ? patient.allergy_reviewed_at : null,
    reviewedBy: canReadAssessment ? patient.reviewed_by : null,
    ...(canReadAssessment ? { version: patient.version } : {}),
    canAssess: Boolean(
      patient.active &&
      auth.user.id &&
      !auth.preview &&
      !auth.integration &&
      unitId === patient.primary_unit_id &&
      can(auth, "patients.clinical.manage", unitId) &&
      hasClinicalRegistration(patient),
    ),
  };
}
export async function auditAllergyAssessment(
  client: PoolClient,
  auth: AuthContext,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  reason: string,
) {
  await client.query(
    `INSERT INTO inventory_patient_changes(organization_id,patient_id,action,before_data,after_data,reason,actor,actor_user_id) VALUES($1,$2,'UPDATE',$3,$4,$5,$6,$7)`,
    [
      auth.organizationId,
      after["id"],
      before,
      after,
      reason.slice(0, 500),
      actor(auth).name,
      auth.user.id,
    ],
  );
}
