import "@tanstack/react-start/server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { hasClinicalRegistration, canWriteClinicalDocument } from "./clinical-professional-policy";
import {
  composePrescription,
  prescriptionFormulaSchema,
  protocolContainsObviousPersonalData,
} from "../data/prescription-composer";
type ProtocolRow = {
  id: string;
  organization_id: string;
  author_user_id: string;
  title: string;
  version: number;
  formula: unknown;
  category: string;
  description: string;
  visibility: string;
  status: string;
  unit_ids: string[];
  archived: boolean;
  author_name?: string;
};
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuid = z.string().uuid(),
  v = z.number().int().positive();
const base = { appointmentId: uuid };
const existing = { ...base, id: uuid, version: v };
const source = { sourceId: uuid.optional(), sourceVersion: v.optional() };
const input = z.discriminatedUnion("action", [
  z
    .object({
      ...base,
      action: z.literal("PREVIEW"),
      formula: prescriptionFormulaSchema,
      protocolId: uuid.optional(),
      protocolVersion: v.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("INSTANTIATE"),
      id: uuid,
      documentId: uuid,
      formula: prescriptionFormulaSchema,
      ...source,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("SAVE"),
      id: uuid.optional(),
      version: v.optional(),
      title: z.string().trim().min(2).max(160),
      formula: prescriptionFormulaSchema,
      category: z.string().trim().max(100).default(""),
      description: z.string().trim().max(2000).default(""),
      visibility: z.enum(["PRIVATE", "ORGANIZATION", "INSTITUTIONAL"]).default("PRIVATE"),
      unitIds: z.array(uuid).max(100).default([]),
      confirmedNoPatientData: z.literal(true),
    })
    .strict(),
  ...(["ARCHIVE", "SUBMIT", "APPROVE", "REJECT"] as const).map((action) =>
    z.object({ ...existing, action: z.literal(action) }).strict(),
  ),
  ...(["GRANT_ACCESS", "REVOKE_ACCESS"] as const).map((action) =>
    z.object({ ...existing, action: z.literal(action), granteeUserId: uuid }).strict(),
  ),
]);
export async function prescriptionComposerResponse(request: Request) {
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para acessar os protocolos.", 401);
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return fail("Use uma conta profissional individual.", 403);
  if (!["GET", "POST"].includes(request.method)) return fail("Método não permitido.", 405);
  const url = new URL(request.url);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return fail("Origem não autorizada.", 403);
  let d: z.infer<typeof input> | undefined;
  if (request.method === "POST") {
    try {
      const p = input.safeParse(await request.json());
      if (!p.success)
        return fail(
          "Confira a composição, os metadados e a confirmação de ausência de dados pessoais.",
          400,
        );
      d = p.data;
    } catch {
      return fail("Requisição inválida.", 400);
    }
  }
  const appointmentId = d?.appointmentId ?? url.searchParams.get("appointmentId");
  if (!uuid.safeParse(appointmentId).success) return fail("Atendimento inválido.", 400);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const a = (
      await client.query(
        `SELECT a.*,u.professional_council,u.council_number,u.council_region,inventory_professional_registration_state(u.id,a.organization_id) AS registry_state,p.primary_unit_id,p.active AS patient_active,p.full_name AS patient_name FROM inventory_care_appointments a JOIN inventory_users u ON u.id=a.professional_user_id JOIN inventory_patients p ON p.id=a.patient_id AND p.organization_id=a.organization_id WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a FOR SHARE OF u,p`,
        [appointmentId, auth.organizationId],
      )
    ).rows[0];
    if (
      !a ||
      !can(auth, "patients.clinical.manage", a.unit_id) ||
      !can(auth, "patients.clinical.manage", a.primary_unit_id)
    )
      return fail("Atendimento não encontrado.", 404);
    if (
      a.professional_user_id !== auth.user.id ||
      !a.patient_active ||
      ["INVALID", "DUPLICATE"].includes(a.registry_state) ||
      !hasClinicalRegistration(a) ||
      !canWriteClinicalDocument(a.professional_council, "PRESCRIPTION") ||
      ["NO_SHOW", "CANCELED", "COMPLETED"].includes(a.status)
    )
      return fail("Composição indisponível para este atendimento.", 403);
    const approver = can(auth, "clinical.templates.approve", a.unit_id);
    const visible = async (t: ProtocolRow) => {
      if (t.organization_id !== auth.organizationId || t.archived) return false;
      if (Array.isArray(t.unit_ids) && t.unit_ids.length && !t.unit_ids.includes(a.unit_id))
        return false;
      if (t.author_user_id === auth.user.id) return true;
      if (t.visibility === "PRIVATE")
        return Boolean(
          (
            await client.query(
              `SELECT 1 FROM inventory_prescription_protocol_grants g JOIN inventory_memberships m ON m.user_id=g.grantee_user_id AND m.organization_id=g.organization_id WHERE g.protocol_id=$1 AND g.organization_id=$2 AND g.grantee_user_id=$3 AND g.active AND m.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN')`,
              [t.id, auth.organizationId, auth.user.id],
            )
          ).rowCount,
        );
      return (
        t.visibility === "ORGANIZATION" ||
        t.status === "APPROVED" ||
        (approver && t.status === "PENDING")
      );
    };
    const dto = (t: ProtocolRow) => ({
      id: t.id,
      title: t.title,
      version: t.version,
      formula: t.formula,
      category: t.category,
      description: t.description,
      visibility: t.visibility,
      status: t.status,
      unitIds: t.unit_ids,
      authorUserId: t.author_user_id,
      authorName: t.author_name,
      canEdit:
        t.author_user_id === auth.user.id &&
        !(t.visibility === "INSTITUTIONAL" && ["APPROVED", "PENDING"].includes(t.status)),
      canSubmit:
        t.author_user_id === auth.user.id &&
        t.visibility === "INSTITUTIONAL" &&
        t.status === "DRAFT",
      canApprove:
        approver &&
        t.author_user_id !== auth.user.id &&
        t.visibility === "INSTITUTIONAL" &&
        t.status === "PENDING",
      canArchive: t.author_user_id === auth.user.id && !t.archived,
      canGrantAccess: t.author_user_id === auth.user.id && t.visibility === "PRIVATE",
    });
    if (!d) {
      const rows = (
        await client.query(
          `SELECT p.*,u.name AS author_name FROM inventory_prescription_protocols p JOIN inventory_users u ON u.id=p.author_user_id WHERE p.organization_id=$1 AND NOT p.archived AND (p.unit_ids='[]'::jsonb OR p.unit_ids ? $3) AND (p.author_user_id=$2 OR (p.visibility='ORGANIZATION' OR (p.visibility='INSTITUTIONAL' AND (p.status='APPROVED' OR ($4::boolean AND p.status='PENDING'))) OR (p.visibility='PRIVATE' AND EXISTS(SELECT 1 FROM inventory_prescription_protocol_grants g JOIN inventory_memberships m ON m.user_id=g.grantee_user_id AND m.organization_id=g.organization_id WHERE g.protocol_id=p.id AND g.grantee_user_id=$2 AND g.active AND m.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN'))))) ORDER BY p.updated_at DESC,p.id LIMIT 100`,
          [auth.organizationId, auth.user.id, a.unit_id, approver],
        )
      ).rows;
      const templates = [];
      for (const t of rows) if (await visible(t)) templates.push(dto(t));
      const units = (
        await client.query(
          `SELECT id,name FROM inventory_units WHERE organization_id=$1 AND active AND ($2::boolean OR id=ANY($3::uuid[])) ORDER BY name LIMIT 100`,
          [auth.organizationId, auth.role === "SUPER_ADMIN", auth.unitIds],
        )
      ).rows;
      const eligibleGrantees = (
        await client.query(
          `SELECT u.id,u.name FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN') ORDER BY u.name,u.id LIMIT 100`,
          [auth.organizationId],
        )
      ).rows;
      await client.query("COMMIT");
      return Response.json(
        {
          data: {
            templates,
            units,
            eligibleGrantees,
            canCompose: true,
            canCreateShared: true,
            canCreateInstitutional: true,
          },
        },
        { headers },
      );
    }
    if (d.action === "PREVIEW" || d.action === "INSTANTIATE") {
      const sourceId = d.action === "PREVIEW" ? d.protocolId : d.sourceId,
        sourceVersion = d.action === "PREVIEW" ? d.protocolVersion : d.sourceVersion;
      if (Boolean(sourceId) !== Boolean(sourceVersion))
        return fail("Informe a revisão de origem completa.", 400);
      if (sourceId) {
        const t = (
          await client.query(
            `SELECT * FROM inventory_prescription_protocols WHERE id=$1 AND organization_id=$2 FOR SHARE`,
            [sourceId, auth.organizationId],
          )
        ).rows[0];
        if (!t || !(await visible(t)) || (t.unit_ids.length && !t.unit_ids.includes(a.unit_id)))
          return fail("Modelo não encontrado.", 404);
        if (t.version !== sourceVersion)
          return fail("O modelo foi alterado. Atualize a lista.", 409);
      }
      const composition = composePrescription(d.formula);
      if (d.action === "PREVIEW") {
        await client.query("COMMIT");
        return Response.json(
          {
            data: {
              ...composition,
              ...(sourceId ? { protocolRevision: { id: sourceId, version: sourceVersion } } : {}),
            },
          },
          { headers },
        );
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [d.id]);
      const old = (
        await client.query(`SELECT * FROM inventory_prescription_protocol_instances WHERE id=$1`, [
          d.id,
        ])
      ).rows[0];
      if (old) {
        if (
          old.organization_id !== auth.organizationId ||
          old.author_user_id !== auth.user.id ||
          old.document_id !== d.documentId ||
          old.appointment_id !== appointmentId ||
          old.source_protocol_id !== (sourceId ?? null) ||
          old.source_version !== (sourceVersion ?? null) ||
          JSON.stringify(prescriptionFormulaSchema.parse(old.formula)) !== JSON.stringify(d.formula)
        )
          return fail("Identificador de instância já utilizado.", 409);
        await client.query("COMMIT");
        return Response.json({ data: { ...composition, instanceId: d.id } }, { headers });
      }
      const doc = (
        await client.query(
          `SELECT id FROM inventory_encounter_documents WHERE id=$1 AND organization_id=$2 AND appointment_id=$3 AND author_user_id=$4 AND type='PRESCRIPTION' AND status='DRAFT' AND discarded_at IS NULL FOR SHARE`,
          [d.documentId, auth.organizationId, appointmentId, auth.user.id],
        )
      ).rows[0];
      if (!doc) return fail("Rascunho de receita não encontrado.", 404);
      await client.query(
        `INSERT INTO inventory_prescription_protocol_instances(id,organization_id,appointment_id,document_id,author_user_id,source_protocol_id,source_version,formula) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          d.id,
          auth.organizationId,
          appointmentId,
          d.documentId,
          auth.user.id,
          sourceId ?? null,
          sourceVersion ?? null,
          JSON.stringify(d.formula),
        ],
      );
      await client.query("COMMIT");
      return Response.json({ data: { ...composition, instanceId: d.id } }, { headers });
    }
    const id = d.id ?? randomUUID();
    const before = d.id
      ? (
          await client.query(
            `SELECT * FROM inventory_prescription_protocols WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
            [d.id, auth.organizationId],
          )
        ).rows[0]
      : null;
    if (d.id && !before) return fail("Protocolo não encontrado.", 404);
    if (before?.archived && before.author_user_id === auth.user.id)
      return fail("Protocolo arquivado.", 409);
    if (before && !(await visible(before))) return fail("Protocolo não encontrado.", 404);
    if (before && before.version !== d.version)
      return fail("Protocolo alterado. Atualize a lista.", 409);
    if (before && before.archived) return fail("Protocolo arquivado.", 409);
    const owner = !before || before.author_user_id === auth.user.id;
    if (!owner && !["APPROVE", "REJECT"].includes(d.action))
      return fail("Somente o autor pode alterar este modelo.", 403);
    const version = (before?.version ?? 0) + 1;
    if (d.action === "SAVE") {
      if (before && before.visibility === "INSTITUTIONAL" && before.status === "APPROVED")
        return fail("Clone o modelo aprovado para editar uma cópia privada.", 409);
      if (before && before.status === "PENDING")
        return fail("Aguarde a revisão antes de editar.", 409);
      if (
        (String(a.patient_name).trim().length >= 5 &&
          JSON.stringify({
            title: d.title,
            category: d.category,
            description: d.description,
            formula: d.formula,
          })
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .includes(
              String(a.patient_name)
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase(),
            )) ||
        protocolContainsObviousPersonalData({
          title: d.title,
          category: d.category,
          description: d.description,
          formula: d.formula,
        })
      )
        return fail("Remova possíveis dados pessoais antes de salvar o modelo reutilizável.", 400);
      if (new Set(d.unitIds).size !== d.unitIds.length) return fail("Unidades repetidas.", 400);
      for (const unitId of d.unitIds) {
        if (
          !can(auth, "patients.clinical.manage", unitId) ||
          !(
            await client.query(
              `SELECT 1 FROM inventory_units WHERE id=$1 AND organization_id=$2 AND active FOR SHARE`,
              [unitId, auth.organizationId],
            )
          ).rowCount
        )
          return fail("Unidade inválida.", 403);
      }
      const values = [
        id,
        auth.organizationId,
        auth.user.id,
        d.title,
        JSON.stringify(d.formula),
        d.category,
        d.description,
        d.visibility,
        JSON.stringify(d.unitIds),
        version,
      ];
      if (before)
        await client.query(
          `UPDATE inventory_prescription_protocols SET title=$4,formula=$5,category=$6,description=$7,visibility=$8,unit_ids=$9,status='DRAFT',version=$10,updated_at=now() WHERE id=$1 AND organization_id=$2 AND author_user_id=$3`,
          values,
        );
      else
        await client.query(
          `INSERT INTO inventory_prescription_protocols(id,organization_id,author_user_id,title,formula,category,description,visibility,unit_ids,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          values,
        );
    } else if (d.action === "GRANT_ACCESS" || d.action === "REVOKE_ACCESS") {
      if (before.visibility !== "PRIVATE")
        return fail("A concessão explícita aplica-se a modelos privados.", 409);
      const target = (
        await client.query(
          `SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2 AND ($3::boolean OR (m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN'))) FOR SHARE OF m,u`,
          [auth.organizationId, d.granteeUserId, d.action === "REVOKE_ACCESS"],
        )
      ).rows[0];
      if (!target) return fail("Administrador elegível não encontrado.", 400);
      await client.query(
        `INSERT INTO inventory_prescription_protocol_grants(organization_id,protocol_id,grantee_user_id,granted_by_user_id,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(protocol_id,grantee_user_id) DO UPDATE SET active=EXCLUDED.active,version=inventory_prescription_protocol_grants.version+1,updated_at=now()`,
        [auth.organizationId, id, d.granteeUserId, auth.user.id, d.action === "GRANT_ACCESS"],
      );
      await client.query(
        `UPDATE inventory_prescription_protocols SET version=$2,updated_at=now() WHERE id=$1`,
        [id, version],
      );
    } else {
      if (
        ["APPROVE", "REJECT"].includes(d.action) &&
        before.unit_ids.some(
          (unitId: string) =>
            !can(auth, "clinical.templates.approve", unitId) ||
            !can(auth, "patients.clinical.manage", unitId),
        )
      )
        return fail("Sem permissão em todas as unidades do modelo.", 403);
      if (
        d.action === "SUBMIT" &&
        (before.visibility !== "INSTITUTIONAL" || before.status !== "DRAFT")
      )
        return fail("Modelo não disponível para submissão.", 409);
      if (["APPROVE", "REJECT"].includes(d.action) && (!approver || owner))
        return fail("A revisão exige outro SUPER_ADMIN prescritor habilitado.", 403);
      if (
        ["APPROVE", "REJECT"].includes(d.action) &&
        (before.visibility !== "INSTITUTIONAL" || before.status !== "PENDING")
      )
        return fail("Modelo não está pendente de revisão.", 409);
      const status =
        d.action === "SUBMIT"
          ? "PENDING"
          : d.action === "APPROVE"
            ? "APPROVED"
            : d.action === "REJECT"
              ? "DRAFT"
              : before.status;
      await client.query(
        `UPDATE inventory_prescription_protocols SET status=$2,archived=CASE WHEN $3='ARCHIVE' THEN true ELSE archived END,version=$4,updated_at=now() WHERE id=$1`,
        [id, status, d.action, version],
      );
    }
    await client.query(
      `INSERT INTO inventory_prescription_protocol_versions(protocol_id,organization_id,author_user_id,version,title,formula,archived,category,description,visibility,status,unit_ids) SELECT id,organization_id,author_user_id,version,title,formula,archived,category,description,visibility,status,unit_ids FROM inventory_prescription_protocols WHERE id=$1`,
      [id],
    );
    await client.query(
      `INSERT INTO inventory_prescription_protocol_events(organization_id,protocol_id,actor_user_id,action,before_data,after_data) SELECT $1,id,$2,$3,$4,to_jsonb(p)||$6::jsonb FROM inventory_prescription_protocols p WHERE id=$5`,
      [
        auth.organizationId,
        auth.user.id,
        d.action,
        before ? JSON.stringify(before) : null,
        id,
        JSON.stringify(
          d.action === "GRANT_ACCESS" || d.action === "REVOKE_ACCESS"
            ? { granteeUserId: d.granteeUserId, grantActive: d.action === "GRANT_ACCESS" }
            : {},
        ),
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: { id, version } }, { headers });
  } catch {
    return fail("Não foi possível processar o modelo.", 500);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
