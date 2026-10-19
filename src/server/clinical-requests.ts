import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { recordClinicalAccess } from "./clinical-access-audit";
import { hasClinicalRegistration } from "./clinical-professional-policy";
import { clinicalRequestActions, type ClinicalRequestStatus } from "../data/clinical-requests";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const input = z
  .object({
    appointmentId: z.string().uuid(),
    sourceKind: z.enum(["DOCUMENT", "PLAN"]),
    sourceId: z.string().uuid(),
    action: z.enum(["ISSUED", "RETURNED", "REVIEWED"]),
    version: z.number().int().nonnegative(),
    operationId: z.string().uuid(),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
async function bounded(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      data.set(part, offset);
      offset += part.length;
    }
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
export async function clinicalRequestsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para consultar as solicitações.", 401);
  if (
    !auth.user.id ||
    auth.preview ||
    auth.integration ||
    !can(auth, "patients.private.read") ||
    !can(auth, "patients.clinical.manage")
  )
    return fail("Acesso clínico necessário.", 403);
  if (!["GET", "POST"].includes(request.method)) return fail("Método não permitido.", 405);
  const url = new URL(request.url);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return fail("Origem não autorizada.", 403);
  const parsed = request.method === "POST" ? input.safeParse(await bounded(request)) : null;
  if (parsed && !parsed.success) return fail("Confira a solicitação e o estado informado.", 400);
  const body = parsed?.success ? parsed.data : null;
  const appointmentId = body?.appointmentId ?? url.searchParams.get("appointmentId");
  if (!z.string().uuid().safeParse(appointmentId).success)
    return fail("Atendimento inválido.", 400);
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const a = (
      await c.query(
        `SELECT a.*,p.primary_unit_id,u.name AS unit_name FROM inventory_care_appointments a JOIN inventory_patients p ON p.id=a.patient_id AND p.organization_id=a.organization_id JOIN inventory_units u ON u.id=a.unit_id AND u.organization_id=a.organization_id WHERE a.id=$1 AND a.organization_id=$2 ${body ? "FOR UPDATE OF a" : "FOR SHARE OF a"}`,
        [appointmentId, auth.organizationId],
      )
    ).rows[0];
    if (
      !a ||
      ![a.unit_id, a.primary_unit_id].every(
        (unit) =>
          can(auth, "patients.private.read", unit) && can(auth, "patients.clinical.manage", unit),
      )
    )
      return fail("Atendimento não encontrado.", 404);
    const professional = (
      await c.query(
        "SELECT *,inventory_professional_registration_state(id,$2) registry_state FROM inventory_users WHERE id=$1 AND active",
        [auth.user.id, auth.organizationId],
      )
    ).rows[0];
    const canManage =
      !!professional &&
      hasClinicalRegistration(professional) &&
      professional.registry_state === "OK" &&
      a.professional_user_id === auth.user.id &&
      !["CANCELED", "NO_SHOW"].includes(a.status);
    const sources = `SELECT d.id,d.title,d.type,d.status,d.version,d.author_user_id,'DOCUMENT'::text source_kind FROM inventory_encounter_documents d WHERE d.appointment_id=$1 AND d.organization_id=$2 AND d.type IN ('EXAM_REQUEST','REFERRAL') AND (d.status='FINAL' OR d.author_user_id=$3)
      UNION ALL SELECT p.id,p.title,'PROCEDURE'::text,p.status,p.version,p.author_user_id,'PLAN'::text FROM inventory_clinical_plans p WHERE p.appointment_id=$1 AND p.organization_id=$2 AND p.status<>'ARCHIVED' AND (p.status<>'DRAFT' OR p.author_user_id=$3)`;
    if (!body) {
      const found = (
        await c.query(
          `WITH sources AS (${sources}) SELECT s.*,e.status event_status,e.version event_version,e.source_version,e.created_at,EXISTS(SELECT 1 FROM inventory_clinical_document_amendments m JOIN inventory_encounter_documents d ON d.id=m.document_id WHERE s.source_kind='DOCUMENT' AND m.parent_document_id=s.id AND m.kind='RECTIFICATION' AND d.status='FINAL') superseded FROM sources s LEFT JOIN LATERAL(SELECT status,version,source_version,created_at FROM inventory_clinical_request_events WHERE organization_id=$2 AND source_kind=s.source_kind AND source_id=s.id ORDER BY version DESC LIMIT 1)e ON true ORDER BY s.title,s.id LIMIT 101`,
          [appointmentId, auth.organizationId, auth.user.id],
        )
      ).rows;
      const requests = found.slice(0, 100).map((r) => {
        const status = (r.event_status ?? "NOT_ISSUED") as ClinicalRequestStatus;
        const changed = r.source_version != null && r.source_version !== r.version;
        return {
          sourceKind: r.source_kind,
          sourceId: r.id,
          title: r.title,
          type: r.type,
          recordStatus: r.status,
          status,
          sourceChanged: changed,
          version: r.event_version ?? 0,
          sourceVersion: r.version,
          updatedAt: r.created_at ?? null,
          allowedActions:
            canManage && !r.superseded ? clinicalRequestActions(r.status, status, changed) : [],
        };
      });
      await recordClinicalAccess(auth, {
        patientId: a.patient_id,
        unitId: a.unit_id,
        appointmentId: a.id,
        action: "READ",
        resourceIds: requests.map((r) => r.sourceId),
      });
      await c.query("COMMIT");
      return Response.json(
        { data: { requests, canManage, hasMore: found.length > 100, unitName: a.unit_name } },
        { headers },
      );
    }
    if (!canManage) return fail("Profissional não habilitado para registrar esta ação.", 403);
    const source = (
      await c.query(
        body.sourceKind === "DOCUMENT"
          ? `SELECT id,title,status,version FROM inventory_encounter_documents WHERE id=$1 AND appointment_id=$2 AND organization_id=$3 AND unit_id=$4 AND patient_id=$5 AND type IN ('EXAM_REQUEST','REFERRAL') FOR UPDATE`
          : `SELECT id,title,status,version FROM inventory_clinical_plans WHERE id=$1 AND appointment_id=$2 AND organization_id=$3 AND unit_id=$4 AND patient_id=$5 FOR UPDATE`,
        [body.sourceId, a.id, auth.organizationId, a.unit_id, a.patient_id],
      )
    ).rows[0];
    if (!source) return fail("Solicitação não encontrada.", 404);
    const hash = createHash("sha256")
      .update(JSON.stringify({ actor: auth.user.id, input: body }))
      .digest("hex");
    const replay = (
      await c.query(
        "SELECT source_kind,source_id,request_hash,version,status FROM inventory_clinical_request_events WHERE organization_id=$1 AND operation_id=$2",
        [auth.organizationId, body.operationId],
      )
    ).rows[0];
    if (replay) {
      if (replay.request_hash !== hash) return fail("Operação já utilizada com outros dados.", 409);
      await c.query("COMMIT");
      return Response.json(
        { data: { version: replay.version, status: replay.status } },
        { headers },
      );
    }
    if (
      body.sourceKind === "DOCUMENT" &&
      (
        await c.query(
          "SELECT 1 FROM inventory_clinical_document_amendments m JOIN inventory_encounter_documents d ON d.id=m.document_id WHERE m.parent_document_id=$1 AND m.kind='RECTIFICATION' AND d.status='FINAL'",
          [source.id],
        )
      ).rowCount
    )
      return fail("Use a retificação vigente desta solicitação.", 409);
    const last = (
      await c.query(
        "SELECT * FROM inventory_clinical_request_events WHERE organization_id=$1 AND source_kind=$2 AND source_id=$3 ORDER BY version DESC LIMIT 1",
        [auth.organizationId, body.sourceKind, body.sourceId],
      )
    ).rows[0];
    if ((last?.version ?? 0) !== body.version)
      return fail("O acompanhamento mudou. Atualize antes de registrar.", 409);
    const changed = !!last && last.source_version !== source.version;
    if (
      !clinicalRequestActions(source.status, last?.status ?? "NOT_ISSUED", changed).includes(
        body.action,
      )
    )
      return fail(
        "Transição indisponível: finalize o documento ou ative o plano e confira o estado atual.",
        409,
      );
    const version = (last?.version ?? 0) + 1;
    await c.query(
      "INSERT INTO inventory_clinical_request_events(organization_id,unit_id,patient_id,appointment_id,source_kind,source_id,source_version,version,status,actor_user_id,operation_id,request_hash,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        auth.organizationId,
        a.unit_id,
        a.patient_id,
        a.id,
        body.sourceKind,
        body.sourceId,
        source.version,
        version,
        body.action,
        auth.user.id,
        body.operationId,
        hash,
        body.note,
      ],
    );
    await c.query("COMMIT");
    return Response.json({ data: { version, status: body.action } }, { headers });
  } catch {
    return fail("Não foi possível registrar ou consultar a solicitação com segurança.", 503);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}
