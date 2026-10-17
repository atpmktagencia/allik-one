import "@tanstack/react-start/server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { hasClinicalRegistration, canWriteClinicalDocument } from "./clinical-professional-policy";
import { composePrescription, prescriptionFormulaSchema } from "../data/prescription-composer";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("PREVIEW"),
      appointmentId: z.string().uuid(),
      formula: prescriptionFormulaSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("SAVE"),
      appointmentId: z.string().uuid(),
      id: z.string().uuid().optional(),
      version: z.number().int().positive().optional(),
      title: z.string().trim().min(2).max(160),
      formula: prescriptionFormulaSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("ARCHIVE"),
      appointmentId: z.string().uuid(),
      id: z.string().uuid(),
      version: z.number().int().positive(),
    })
    .strict(),
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
  let data: z.infer<typeof input> | undefined;
  if (request.method === "POST") {
    try {
      const p = input.safeParse(await request.json());
      if (!p.success) return fail("Confira a composição e as etapas.", 400);
      data = p.data;
    } catch {
      return fail("Requisição inválida.", 400);
    }
  }
  const appointmentId = data?.appointmentId ?? url.searchParams.get("appointmentId");
  if (!z.string().uuid().safeParse(appointmentId).success)
    return fail("Atendimento inválido.", 400);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT a.*,u.professional_council,u.council_number,u.council_region,inventory_professional_registration_state(u.id,a.organization_id) AS registry_state,p.primary_unit_id,p.active AS patient_active FROM inventory_care_appointments a JOIN inventory_users u ON u.id=a.professional_user_id JOIN inventory_patients p ON p.id=a.patient_id AND p.organization_id=a.organization_id WHERE a.id=$1 AND a.organization_id=$2 FOR SHARE OF a,u,p`,
      [appointmentId, auth.organizationId],
    );
    const a = r.rows[0];
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
      ["NO_SHOW", "CANCELED"].includes(a.status)
    )
      return fail("Composição indisponível para este atendimento.", 403);
    if (!data) {
      const templates = await client.query(
        `SELECT id,title,version,formula FROM inventory_prescription_protocols WHERE organization_id=$1 AND author_user_id=$2 AND NOT archived ORDER BY updated_at DESC,id LIMIT 100`,
        [auth.organizationId, auth.user.id],
      );
      await client.query("COMMIT");
      return Response.json({ data: { templates: templates.rows, canCompose: true } }, { headers });
    }
    if (data.action === "PREVIEW") {
      const composition = composePrescription(data.formula);
      await client.query("COMMIT");
      return Response.json({ data: composition }, { headers });
    }
    const id = data.id ?? randomUUID();
    let version = 1;
    if (data.id) {
      const existing = await client.query(
        `SELECT * FROM inventory_prescription_protocols WHERE id=$1 AND organization_id=$2 AND author_user_id=$3 FOR UPDATE`,
        [data.id, auth.organizationId, auth.user.id],
      );
      const t = existing.rows[0];
      if (!t) return fail("Protocolo não encontrado.", 404);
      if (t.version !== data.version) return fail("Protocolo alterado. Atualize a lista.", 409);
      if (t.archived) return fail("Protocolo arquivado.", 409);
      version = t.version + 1;
    }
    if (data.action === "ARCHIVE")
      await client.query(
        `UPDATE inventory_prescription_protocols SET archived=true,version=$2,updated_at=now() WHERE id=$1`,
        [id, version],
      );
    else if (data.id)
      await client.query(
        `UPDATE inventory_prescription_protocols SET title=$2,formula=$3,version=$4,updated_at=now() WHERE id=$1`,
        [id, data.title, JSON.stringify(data.formula), version],
      );
    else
      await client.query(
        `INSERT INTO inventory_prescription_protocols(id,organization_id,author_user_id,title,formula) VALUES($1,$2,$3,$4,$5)`,
        [id, auth.organizationId, auth.user.id, data.title, JSON.stringify(data.formula)],
      );
    await client.query(
      `INSERT INTO inventory_prescription_protocol_versions(protocol_id,organization_id,author_user_id,version,title,formula,archived) SELECT id,organization_id,author_user_id,version,title,formula,archived FROM inventory_prescription_protocols WHERE id=$1`,
      [id],
    );
    await client.query("COMMIT");
    return Response.json({ data: { id, version } }, { headers });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
