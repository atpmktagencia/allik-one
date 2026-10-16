import "@tanstack/react-start/server-only";
import type { AuthContext } from "./auth";
import { getPool } from "./db";

/** Record authorized disclosure before returning clinical data; persistence failures fail closed. */
export async function recordClinicalAccess(
  auth: AuthContext,
  access: {
    unitId: string;
    patientId: string;
    appointmentId?: string;
    documentId?: string;
    action: "READ" | "PRINT" | "PDF_SOURCE" | "SIGNED_DOWNLOAD";
    resourceIds?: string[];
  },
) {
  await getPool().query(
    `INSERT INTO inventory_clinical_access_events
      (organization_id,unit_id,patient_id,appointment_id,document_id,actor_user_id,preview_actor,action,resource_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      auth.organizationId,
      access.unitId,
      access.patientId,
      access.appointmentId ?? null,
      access.documentId ?? null,
      auth.user.id,
      auth.preview
        ? "preview-operator"
        : auth.integration
          ? `integration:${auth.integration.id}`
          : null,
      access.action,
      JSON.stringify(access.resourceIds ?? []),
    ],
  );
}

/** One atomic insert for a bounded authorized list; never store search text or record contents. */
export async function recordClinicalListAccess(
  auth: AuthContext,
  records: { unitId: string; patientId: string; appointmentId?: string }[],
) {
  if (!records.length) return;
  await getPool().query(
    `INSERT INTO inventory_clinical_access_events
      (organization_id,unit_id,patient_id,appointment_id,actor_user_id,preview_actor,action,resource_ids)
     SELECT $1,r."unitId",r."patientId",r."appointmentId",$3,$4,'READ','[]'::jsonb
     FROM jsonb_to_recordset($2::jsonb)
       AS r("unitId" uuid,"patientId" uuid,"appointmentId" uuid)`,
    [
      auth.organizationId,
      JSON.stringify(records),
      auth.user.id,
      auth.preview
        ? "preview-operator"
        : auth.integration
          ? `integration:${auth.integration.id}`
          : null,
    ],
  );
}
