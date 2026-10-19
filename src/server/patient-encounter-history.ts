import "@tanstack/react-start/server-only";
import { canAccessAllUnits, type AuthContext } from "./auth";
import { getPool } from "./db";

/** Summarize authorized encounters without disclosing another author's drafts. */
export async function patientEncounterHistory(auth: AuthContext, patientId: string) {
  return getPool().query(
    `SELECT a.id,a.starts_at AS "startsAt",a.status,u.name AS "unitName",
      usr.name AS "professionalName",COALESCE(ct.name,a.other_care_type,a.care_type) AS "careTypeName",
      (SELECT jsonb_build_object('id',n.id,'evolution',n.evolution,'conduct',n.conduct,
        'clinicalPlan',n.clinical_plan,'returnRecommendation',n.return_recommendation,'returnOn',n.return_on,
        'authorName',n.author_name) FROM inventory_clinical_notes n
        WHERE n.appointment_id=a.id AND n.patient_id=a.patient_id AND n.organization_id=a.organization_id
          AND n.unit_id=a.unit_id AND n.status='FINAL') AS note,
      EXISTS(SELECT 1 FROM inventory_clinical_notes n WHERE n.appointment_id=a.id
        AND n.organization_id=a.organization_id AND n.patient_id=a.patient_id AND n.unit_id=a.unit_id
        AND n.status='DRAFT' AND n.author_user_id=$5) AS "hasOwnDraft",
      (SELECT jsonb_build_object('id',p.id,'items',p.items,'generalInstructions',p.general_instructions)
        FROM inventory_encounter_prescriptions p WHERE p.appointment_id=a.id AND p.patient_id=a.patient_id
          AND p.organization_id=a.organization_id AND p.unit_id=a.unit_id AND p.status='FINAL') AS prescription,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'type',d.type)
          ORDER BY d.finalized_at,d.id) FROM inventory_encounter_documents d
        WHERE d.appointment_id=a.id AND d.patient_id=a.patient_id AND d.organization_id=a.organization_id
          AND d.unit_id=a.unit_id AND d.status='FINAL'),'[]'::jsonb) AS documents
     FROM inventory_care_appointments a
     JOIN inventory_units u ON u.id=a.unit_id AND u.organization_id=a.organization_id
     LEFT JOIN inventory_users usr ON usr.id=a.professional_user_id
     LEFT JOIN inventory_care_types ct ON ct.organization_id=a.organization_id AND ct.code=a.care_type
     WHERE a.patient_id=$1 AND a.organization_id=$2 AND ($3::boolean OR a.unit_id=ANY($4::uuid[]))
     ORDER BY a.starts_at DESC,a.id DESC LIMIT 51`,
    [patientId, auth.organizationId, canAccessAllUnits(auth), auth.unitIds, auth.user.id],
  );
}
