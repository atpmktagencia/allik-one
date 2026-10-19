import "@tanstack/react-start/server-only";
import { z } from "zod";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { recordClinicalAccess } from "./clinical-access-audit";
import { laboratoryDate, laboratoryRow } from "../lib/laboratory-results";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const filters = z
  .object({
    patientId: z.string().uuid(),
    unitId: z.string().uuid().optional(),
    dateFrom: laboratoryDate.optional(),
    dateTo: laboratoryDate.optional(),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict()
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo);

/** Published observations only. Draft corrections never hide the last signed-off revision. */
export async function laboratoryHistoryResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para consultar os resultados.", 401);
  if (
    !auth.user.id ||
    auth.preview ||
    auth.integration ||
    !can(auth, "patients.private.read") ||
    !can(auth, "patients.clinical.manage")
  )
    return fail("Acesso clínico necessário.", 403);
  if (request.method !== "GET") return fail("Método não permitido.", 405);
  const url = new URL(request.url);
  const parsed = filters.safeParse(Object.fromEntries(url.searchParams));
  if (
    !parsed.success ||
    [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
  )
    return fail("Filtros inválidos.", 400);
  const { patientId, unitId, dateFrom, dateTo, offset } = parsed.data;
  if (
    unitId &&
    (!can(auth, "patients.private.read", unitId) || !can(auth, "patients.clinical.manage", unitId))
  )
    return fail("Unidade não autorizada.", 403);
  try {
    const patient = (
      await getPool().query(
        "SELECT primary_unit_id FROM inventory_patients WHERE id=$1 AND organization_id=$2",
        [patientId, auth.organizationId],
      )
    ).rows[0];
    if (
      !patient ||
      !can(auth, "patients.private.read", patient.primary_unit_id) ||
      !can(auth, "patients.clinical.manage", patient.primary_unit_id)
    )
      return fail("Paciente não encontrado.", 404);
    const units = auth.role === "SUPER_ADMIN" ? null : auth.unitIds;
    const found = (
      await getPool().query(
        `SELECT r.id,r.review_id,d.id AS document_id,d.title AS document_title,r.payload
       FROM inventory_laboratory_results r
       JOIN inventory_laboratory_imports i ON i.id=r.import_id AND i.organization_id=r.organization_id
         AND i.patient_id=r.patient_id AND i.unit_id=r.unit_id AND i.latest_review_id=r.review_id
       JOIN inventory_laboratory_review_versions v ON v.id=r.review_id AND v.import_id=i.id
         AND v.organization_id=r.organization_id AND v.patient_id=r.patient_id AND v.unit_id=r.unit_id
       JOIN inventory_patient_documents d ON d.id=i.document_id AND d.organization_id=i.organization_id
         AND d.patient_id=i.patient_id AND d.unit_id=i.unit_id AND d.sha256=i.source_sha256
       JOIN inventory_patients p ON p.id=r.patient_id AND p.organization_id=r.organization_id
       WHERE r.patient_id=$1 AND r.organization_id=$2
         AND ($3::uuid[] IS NULL OR (r.unit_id=ANY($3) AND p.primary_unit_id=ANY($3)))
         AND ($4::text IS NULL OR COALESCE(r.payload->>'collectedOn',r.payload->>'reportedOn') >= $4)
         AND ($5::text IS NULL OR COALESCE(r.payload->>'collectedOn',r.payload->>'reportedOn') <= $5)
       ORDER BY COALESCE(r.payload->>'collectedOn',r.payload->>'reportedOn') DESC NULLS LAST,
         v.created_at DESC,r.review_id,r.ordinal
       LIMIT 501 OFFSET $6`,
        [patientId, auth.organizationId, units, dateFrom ?? null, dateTo ?? null, offset],
      )
    ).rows;
    const rows = found.slice(0, 500).map((r) => ({
      id: r.id as string,
      reviewId: r.review_id as string,
      documentId: r.document_id as string,
      documentTitle: r.document_title as string,
      previewUrl:
        "/api/v1/inventory/patient-document-file?patientId=" +
        patientId +
        "&sourceKind=GENERAL_DOCUMENT&sourceId=" +
        r.document_id,
      payload: laboratoryRow.parse(r.payload),
    }));
    await recordClinicalAccess(auth, {
      patientId,
      unitId: patient.primary_unit_id,
      action: "READ",
      resourceIds: rows.map((r) => r.id),
    });
    return Response.json({ data: { rows, hasMore: found.length > 500, offset } }, { headers });
  } catch {
    return fail("Não foi possível consultar os resultados com segurança.", 503);
  }
}
