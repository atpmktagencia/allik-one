import "@tanstack/react-start/server-only";
import { z } from "zod";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { hasClinicalRegistration, canWriteClinicalDocument } from "./clinical-professional-policy";
import { recordClinicalAccess } from "./clinical-access-audit";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
export async function composerPlanOptionsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para consultar os planos.", 401);
  if (
    !auth.user.id ||
    auth.preview ||
    auth.integration ||
    !can(auth, "patients.clinical.manage") ||
    !can(auth, "patients.private.read")
  )
    return fail("Use uma conta clínica individual autorizada.", 403);
  if (request.method !== "GET") return fail("Método não permitido.", 405);
  const parsed = z
    .object({
      appointmentId: z.string().uuid(),
      documentId: z.string().uuid(),
      unitId: z.string().uuid().optional(),
    })
    .strict()
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return fail("Atendimento ou documento inválido.", 400);
  const f = parsed.data,
    pool = getPool();
  try {
    if (
      f.unitId &&
      (!can(auth, "patients.clinical.manage", f.unitId) ||
        !can(auth, "patients.private.read", f.unitId) ||
        !(
          await pool.query("SELECT id FROM inventory_units WHERE id=$1 AND organization_id=$2", [
            f.unitId,
            auth.organizationId,
          ])
        ).rowCount)
    )
      return fail("Unidade não autorizada.", 403);
    const context = (
      await pool.query(
        `SELECT a.id,a.unit_id,a.patient_id,a.professional_user_id,a.status,p.primary_unit_id,p.active AS patient_active,u.professional_council,u.council_number,u.council_region,inventory_professional_registration_state(u.id,a.organization_id) AS registry_state,ou.name AS unit_name FROM inventory_care_appointments a JOIN inventory_patients p ON p.id=a.patient_id AND p.organization_id=a.organization_id JOIN inventory_users u ON u.id=a.professional_user_id JOIN inventory_units ou ON ou.id=a.unit_id AND ou.organization_id=a.organization_id JOIN inventory_encounter_documents d ON d.appointment_id=a.id AND d.organization_id=a.organization_id AND d.patient_id=a.patient_id AND d.unit_id=a.unit_id WHERE a.id=$1 AND a.organization_id=$2 AND d.id=$3 AND d.type='PRESCRIPTION' AND d.status='DRAFT' AND d.discarded_at IS NULL AND d.author_user_id=$4`,
        [f.appointmentId, auth.organizationId, f.documentId, auth.user.id],
      )
    ).rows[0];
    if (
      !context ||
      !can(auth, "patients.private.read", context.unit_id) ||
      !can(auth, "patients.private.read", context.primary_unit_id) ||
      !can(auth, "patients.clinical.manage", context.unit_id) ||
      !can(auth, "patients.clinical.manage", context.primary_unit_id)
    )
      return fail("Rascunho de receita não encontrado.", 404);
    if (
      context.professional_user_id !== auth.user.id ||
      !context.patient_active ||
      ["CANCELED", "NO_SHOW"].includes(context.status) ||
      ["INVALID", "DUPLICATE"].includes(context.registry_state) ||
      !hasClinicalRegistration(context) ||
      !canWriteClinicalDocument(context.professional_council, "PRESCRIPTION")
    )
      return fail("Composição indisponível para este atendimento.", 403);
    const rows = (
      await pool.query(
        `SELECT p.id,p.title,p.version,p.status,p.unit_id AS "unitId",u.name AS "unitName",p.author_user_id AS "authorUserId",EXISTS(SELECT 1 FROM inventory_clinical_plan_items i JOIN inventory_prescription_protocol_instances pi ON pi.id=i.prescription_instance_id AND pi.organization_id=i.organization_id WHERE i.plan_id=p.id AND i.active AND pi.document_id=$4) AS "linkedToDocument" FROM inventory_clinical_plans p JOIN inventory_units u ON u.id=p.unit_id WHERE p.organization_id=$1 AND p.patient_id=$2 AND p.unit_id=$3 ORDER BY p.updated_at DESC,p.id LIMIT 25`,
        [auth.organizationId, context.patient_id, context.unit_id, f.documentId],
      )
    ).rows;
    const canEstimate =
      can(auth, "quotes.manage", context.unit_id) &&
      can(auth, "quotes.manage", context.primary_unit_id);
    const plans = rows.map((row) => ({
      id: row.id,
      title: row.title,
      version: row.version,
      status: row.status,
      unitId: row.unitId,
      unitName: row.unitName,
      linkedToDocument: row.linkedToDocument,
      canEstimate:
        canEstimate &&
        row.status !== "ARCHIVED" &&
        (auth.role !== "CLINICIAN" || row.authorUserId === auth.user.id),
    }));
    await recordClinicalAccess(auth, {
      unitId: context.unit_id,
      patientId: context.patient_id,
      appointmentId: context.id,
      documentId: f.documentId,
      action: "READ",
      resourceIds: plans.map((plan) => plan.id),
    });
    return Response.json(
      {
        data: {
          patientId: context.patient_id,
          unitId: context.unit_id,
          unitName: context.unit_name,
          plans,
          canReadPlans: true,
        },
      },
      { headers },
    );
  } catch {
    return fail("Não foi possível consultar os planos desta receita.", 503);
  }
}
