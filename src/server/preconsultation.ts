import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { authenticate, can, canAccessAllUnits } from "./auth";
import { getPool } from "./db";
import { consumeAuthRateLimit } from "./auth-rate-limit";
import { recordClinicalListAccess } from "./clinical-access-audit";
import { questions, sanitizePreconsultationAnswers } from "../lib/preconsultation-questions";

const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
  "Referrer-Policy": "no-referrer",
};
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SAVE_FORM"),
    id: z.string().uuid(),
    unitId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).default(""),
    questions,
    version: z.number().int().nonnegative().optional(),
  }),
  z.object({
    action: z.literal("PUBLISH_FORM"),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("INVITE"),
    id: z.string().uuid(),
    patientId: z.string().uuid(),
    appointmentId: z.string().uuid().nullable().default(null),
    formId: z.string().uuid(),
    expiresInDays: z.number().int().min(1).max(14).default(7),
  }),
  z.object({ action: z.literal("REVOKE"), id: z.string().uuid() }),
]);
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 512000) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
export async function preconsultationResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para acessar a pré-consulta.", 401);
  if (auth.integration || !can(auth, "patients.read")) return fail("Acesso negado.", 403);
  const pool = getPool(),
    all = canAccessAllUnits(auth);
  if (request.method === "GET") {
    const parsed = z
      .object({
        unitId: z.string().uuid().optional(),
        patientId: z.string().uuid().optional(),
        appointmentId: z.string().uuid().optional(),
      })
      .refine((f) => !f.appointmentId || !!f.patientId)
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return fail("Filtros inválidos.", 400);
    const f = parsed.data;
    if (f.unitId && !can(auth, "patients.read", f.unitId))
      return fail("Unidade não autorizada.", 403);
    try {
      const units = await pool.query(
        "SELECT id,name FROM inventory_units WHERE organization_id=$1 AND active AND ($2::boolean OR id=ANY($3::uuid[])) ORDER BY name",
        [auth.organizationId, all, auth.unitIds],
      );
      const forms = await pool.query(
        `SELECT f.id,f.unit_id AS "unitId",f.title,f.description,f.questions,f.version,(SELECT v.id FROM inventory_preconsultation_versions v WHERE v.form_id=f.id ORDER BY v.version DESC LIMIT 1) AS "publishedVersionId",(SELECT v.version FROM inventory_preconsultation_versions v WHERE v.form_id=f.id ORDER BY v.version DESC LIMIT 1) AS "publishedVersion",(SELECT v.title FROM inventory_preconsultation_versions v WHERE v.form_id=f.id ORDER BY v.version DESC LIMIT 1) AS "publishedTitle" FROM inventory_preconsultation_forms f WHERE organization_id=$1 AND ($2::boolean OR unit_id=ANY($3::uuid[])) AND ($4::uuid IS NULL OR unit_id=$4) ORDER BY updated_at DESC LIMIT 100`,
        [auth.organizationId, all, auth.unitIds, f.unitId ?? null],
      );
      const canReadAnswers = !!auth.user.id && !auth.preview && can(auth, "patients.private.read");
      const result = await pool.query(
        `SELECT i.id,i.patient_id AS "patientId",p.full_name AS "patientName",i.unit_id AS "unitId",i.appointment_id AS "appointmentId",v.title,i.expires_at AS "expiresAt",i.submitted_at AS "submittedAt",i.revoked_at AS "revokedAt"${canReadAnswers ? ",v.questions,r.answers" : ""} FROM inventory_preconsultation_invitations i JOIN inventory_patients p ON p.id=i.patient_id AND p.organization_id=i.organization_id JOIN inventory_preconsultation_versions v ON v.id=i.version_id ${canReadAnswers ? "LEFT JOIN inventory_preconsultation_responses r ON r.invitation_id=i.id" : ""} WHERE i.organization_id=$1 AND ($2::boolean OR (i.unit_id=ANY($3::uuid[]) AND p.primary_unit_id=ANY($3::uuid[]))) AND ($4::uuid IS NULL OR i.unit_id=$4) AND ($5::uuid IS NULL OR i.patient_id=$5) AND ($6::uuid IS NULL OR i.appointment_id=$6 OR i.appointment_id IS NULL) ORDER BY i.created_at DESC LIMIT 100`,
        [
          auth.organizationId,
          all,
          auth.unitIds,
          f.unitId ?? null,
          f.patientId ?? null,
          f.appointmentId ?? null,
        ],
      );
      await recordClinicalListAccess(
        auth,
        result.rows.map((r) => ({
          unitId: r.unitId,
          patientId: r.patientId,
          ...(r.appointmentId ? { appointmentId: r.appointmentId } : {}),
        })),
      );
      return Response.json(
        {
          data: {
            forms: forms.rows,
            invitations: result.rows,
            units: units.rows,
            canManage: !!auth.user.id && !auth.preview && can(auth, "patients.manage"),
            canReadAnswers,
          },
        },
        { headers },
      );
    } catch {
      return fail("Não foi possível consultar a pré-consulta.", 503);
    }
  }
  if (request.method !== "POST") return fail("Método não permitido.", 405);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return fail("Origem não autorizada.", 403);
  if (!auth.user.id || auth.preview || !can(auth, "patients.manage"))
    return fail("Use uma conta individual autorizada.", 403);
  const parsed = input.safeParse(await body(request));
  if (!parsed.success) return fail("Confira os dados da pré-consulta.", 400);
  const d = parsed.data,
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rollback = async (message: string, status: number) => {
      await client.query("ROLLBACK");
      return fail(message, status);
    };
    if (d.action === "SAVE_FORM") {
      if (!can(auth, "patients.manage", d.unitId))
        return await rollback("Unidade não autorizada.", 403);
      const unit = await client.query(
        "SELECT id FROM inventory_units WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
        [d.unitId, auth.organizationId],
      );
      if (!unit.rowCount) return await rollback("Unidade não encontrada.", 404);
      const old = await client.query(
        "SELECT * FROM inventory_preconsultation_forms WHERE id=$1 FOR UPDATE",
        [d.id],
      );
      if (old.rowCount) {
        const row = old.rows[0];
        if (row.organization_id !== auth.organizationId || row.unit_id !== d.unitId)
          return await rollback("Formulário não encontrado.", 404);
        if (d.version !== row.version)
          return await rollback("O formulário mudou. Atualize a lista.", 409);
        await client.query(
          "UPDATE inventory_preconsultation_forms SET title=$2,description=$3,questions=$4,version=version+1,updated_at=now() WHERE id=$1",
          [d.id, d.title, d.description, JSON.stringify(d.questions)],
        );
      } else
        await client.query(
          "INSERT INTO inventory_preconsultation_forms(id,organization_id,unit_id,title,description,questions,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            d.id,
            auth.organizationId,
            d.unitId,
            d.title,
            d.description,
            JSON.stringify(d.questions),
            auth.user.id,
          ],
        );
    } else if (d.action === "PUBLISH_FORM") {
      const old = await client.query(
        "SELECT * FROM inventory_preconsultation_forms WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [d.id, auth.organizationId],
      );
      const f = old.rows[0];
      if (!f || !can(auth, "patients.manage", f.unit_id))
        return await rollback("Formulário não encontrado.", 404);
      if (d.version !== f.version)
        return await rollback("O formulário mudou. Atualize a lista.", 409);
      if (!questions.safeParse(f.questions).success)
        return await rollback("Confira as perguntas e condições antes de publicar.", 400);
      await client.query(
        "INSERT INTO inventory_preconsultation_versions(form_id,organization_id,unit_id,version,title,description,questions,published_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(form_id,version) DO NOTHING",
        [
          f.id,
          auth.organizationId,
          f.unit_id,
          f.version,
          f.title,
          f.description,
          JSON.stringify(f.questions),
          auth.user.id,
        ],
      );
    } else if (d.action === "INVITE") {
      const p = await client.query(
        "SELECT primary_unit_id FROM inventory_patients WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
        [d.patientId, auth.organizationId],
      );
      const unit = p.rows[0]?.primary_unit_id;
      if (!unit || !can(auth, "patients.manage", unit))
        return await rollback("Paciente não encontrado.", 404);
      if (d.appointmentId) {
        const a = await client.query(
          "SELECT id FROM inventory_care_appointments WHERE id=$1 AND organization_id=$2 AND unit_id=$3 AND patient_id=$4 FOR SHARE",
          [d.appointmentId, auth.organizationId, unit, d.patientId],
        );
        if (!a.rowCount) return await rollback("Atendimento não encontrado.", 404);
      }
      const v = await client.query(
        "SELECT id FROM inventory_preconsultation_versions WHERE form_id=$1 AND organization_id=$2 AND unit_id=$3 ORDER BY version DESC LIMIT 1",
        [d.formId, auth.organizationId, unit],
      );
      if (!v.rowCount) return await rollback("Publique um formulário da unidade do paciente.", 409);
      const token = randomBytes(32).toString("base64url"),
        hash = createHash("sha256").update(token).digest("hex");
      await client.query(
        "INSERT INTO inventory_preconsultation_invitations(id,organization_id,unit_id,patient_id,appointment_id,version_id,token_hash,created_by_user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+make_interval(days=>$9))",
        [
          d.id,
          auth.organizationId,
          unit,
          d.patientId,
          d.appointmentId,
          v.rows[0].id,
          hash,
          auth.user.id,
          d.expiresInDays,
        ],
      );
      await client.query("COMMIT");
      return Response.json(
        { data: { id: d.id, link: `${new URL(request.url).origin}/preconsulta#token=${token}` } },
        { status: 201, headers },
      );
    } else {
      const row = await client.query(
        "SELECT i.*,p.primary_unit_id FROM inventory_preconsultation_invitations i JOIN inventory_patients p ON p.id=i.patient_id AND p.organization_id=i.organization_id WHERE i.id=$1 AND i.organization_id=$2 FOR UPDATE OF i FOR SHARE OF p",
        [d.id, auth.organizationId],
      );
      const i = row.rows[0];
      if (
        !i ||
        !can(auth, "patients.manage", i.unit_id) ||
        !can(auth, "patients.manage", i.primary_unit_id)
      )
        return await rollback("Convite não encontrado.", 404);
      await client.query(
        "UPDATE inventory_preconsultation_invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1",
        [d.id],
      );
    }
    await client.query("COMMIT");
    return Response.json({ data: { id: d.id } }, { headers });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return fail(
      (error as { code?: string }).code === "23505"
        ? "Registro já existente. Atualize a lista."
        : "Não foi possível salvar a pré-consulta.",
      (error as { code?: string }).code === "23505" ? 409 : 503,
    );
  } finally {
    client.release();
  }
}

export async function preconsultationPublicResponse(request: Request) {
  if (request.method !== "POST") return fail("Método não permitido.", 405);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return fail("Origem não autorizada.", 403);
  const parsed = z
    .object({
      action: z.enum(["READ", "SUBMIT"]),
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      answers: z.record(z.string().max(64), z.string().max(4000)).optional(),
    })
    .safeParse(await body(request));
  if (!parsed.success) return fail("Link inválido ou indisponível.", 400);
  const d = parsed.data,
    hash = createHash("sha256").update(d.token).digest("hex");
  let client;
  try {
    const ip =
      process.env["VERCEL"] === "1"
        ? (request.headers.get("x-vercel-forwarded-for") ?? "unknown")
        : "local";
    if (
      !(await consumeAuthRateLimit(`preconsultation-ip:${ip}`, 300)) ||
      !(await consumeAuthRateLimit(`preconsultation:${hash}`, 60))
    )
      return fail("Muitas tentativas. Tente mais tarde.", 429);
    client = await getPool().connect();
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT i.*,v.title,v.description,v.questions FROM inventory_preconsultation_invitations i JOIN inventory_preconsultation_versions v ON v.id=i.version_id JOIN inventory_patients p ON p.id=i.patient_id AND p.organization_id=i.organization_id JOIN inventory_units u ON u.id=i.unit_id JOIN inventory_organizations o ON o.id=i.organization_id WHERE token_hash=$1 AND revoked_at IS NULL AND submitted_at IS NULL AND expires_at>now() AND p.active AND p.primary_unit_id=i.unit_id AND u.active AND o.active FOR UPDATE OF i FOR SHARE OF p,u,o`,
      [hash],
    );
    const i = result.rows[0];
    if (!i) {
      await client.query("ROLLBACK");
      return fail("Link inválido ou indisponível.", 404);
    }
    const questionnaire = questions.safeParse(i.questions);
    if (!questionnaire.success) {
      await client.query("ROLLBACK");
      return fail("Formulário indisponível. Solicite um novo link à clínica.", 409);
    }
    if (d.action === "READ") {
      await client.query("COMMIT");
      return Response.json(
        {
          data: {
            title: i.title,
            description: i.description,
            questions: questionnaire.data,
            expiresAt: i.expires_at,
          },
        },
        { headers },
      );
    }
    let answers: Record<string, string>;
    try {
      answers = sanitizePreconsultationAnswers(questionnaire.data, d.answers ?? {});
    } catch {
      await client.query("ROLLBACK");
      return fail("Confira as respostas.", 400);
    }
    await client.query(
      "INSERT INTO inventory_preconsultation_responses(invitation_id,answers) VALUES($1,$2)",
      [i.id, JSON.stringify(answers)],
    );
    await client.query(
      "UPDATE inventory_preconsultation_invitations SET submitted_at=now() WHERE id=$1",
      [i.id],
    );
    await client.query("COMMIT");
    return Response.json({ data: { submitted: true } }, { headers });
  } catch {
    await client?.query("ROLLBACK").catch(() => {});
    return fail("Não foi possível acessar a pré-consulta.", 503);
  } finally {
    client?.release();
  }
}
