import "@tanstack/react-start/server-only";
import { z } from "zod";
import { authenticate, can } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuid = z.string().uuid();
const input = z.object({
  action: z.enum(["SAVE_DRAFT", "FINALIZE", "SAVE_TEMPLATE"]),
  appointmentId: uuid,
  documentId: uuid.nullable().default(null),
  type: z.enum(["PRESCRIPTION", "EXAM_REQUEST"]),
  title: z.string().trim().min(2).max(200),
  content: z.string().trim().max(30000),
  version: z.number().int().nonnegative().nullable().default(null),
});
const fields = `id,type,title,content,status,version,author_name AS "authorName",
  professional_council AS "professionalCouncil",council_number AS "councilNumber",
  council_region AS "councilRegion",finalized_at AS "finalizedAt",updated_at AS "updatedAt"`;
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export async function encounterDocumentsResponse(request: Request) {
  const auth = await authenticate(request);
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (!auth) return fail("Entre para acessar os documentos clínicos.", 401);
  if (!can(auth, "patients.private.read")) return fail("Acesso negado.", 403);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const documentId = url.searchParams.get("documentId");
    if (url.searchParams.get("print") === "true") {
      if (!uuid.safeParse(documentId).success) return fail("Documento inválido.", 400);
      const result = await getPool().query(
        `SELECT d.*,p.full_name,p.internal_code,u.name AS unit_name
        FROM inventory_encounter_documents d JOIN inventory_patients p ON p.id=d.patient_id
        JOIN inventory_units u ON u.id=d.unit_id WHERE d.id=$1 AND d.organization_id=$2`,
        [documentId, auth.organizationId],
      );
      const doc = result.rows[0];
      if (!doc || !can(auth, "patients.private.read", doc.unit_id))
        return fail("Documento não encontrado.", 404);
      if (doc.status !== "FINAL") return fail("Finalize o documento antes de imprimir.", 409);
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(doc.title)}</title><style>body{font:16px Arial,sans-serif;color:#111;margin:40px auto;max-width:800px;padding:0 24px}header{border-bottom:1px solid #ddd;padding-bottom:20px}article{white-space:pre-wrap;line-height:1.6;margin:32px 0}footer{border-top:1px solid #ddd;padding-top:20px;font-size:13px}@media print{body{margin:0;max-width:none}}</style></head><body><header><p>Allik One · ${escapeHtml(doc.unit_name)}</p><h1>${escapeHtml(doc.title)}</h1><p>Paciente: ${escapeHtml(doc.full_name)} · ${escapeHtml(doc.internal_code)}</p></header><article>${escapeHtml(doc.content)}</article><footer><p>${escapeHtml(doc.author_name)} · ${escapeHtml(doc.professional_council)} ${escapeHtml(doc.council_number)}/${escapeHtml(doc.council_region)}</p><p>Finalizado em ${escapeHtml(new Date(doc.finalized_at).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }))}</p><p>Documento finalizado no sistema. Não possui assinatura eletrônica. A validade da prescrição exige assinatura profissional adequada.</p></footer></body></html>`;
      return new Response(html, {
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    const appointmentId = url.searchParams.get("appointmentId");
    if (!uuid.safeParse(appointmentId).success) return fail("Atendimento inválido.", 400);
    const result = await getPool().query(
      `SELECT a.*,u.professional_council,u.council_number,u.council_region
      FROM inventory_care_appointments a JOIN inventory_users u ON u.id=a.professional_user_id
      WHERE a.id=$1 AND a.organization_id=$2`,
      [appointmentId, auth.organizationId],
    );
    const appointment = result.rows[0];
    if (!appointment || !can(auth, "patients.private.read", appointment.unit_id))
      return fail("Atendimento não encontrado.", 404);
    const [documents, templates] = await Promise.all([
      getPool().query(
        `SELECT ${fields},author_user_id FROM inventory_encounter_documents WHERE appointment_id=$1 AND organization_id=$2 ORDER BY created_at,id`,
        [appointmentId, auth.organizationId],
      ),
      getPool().query(
        `SELECT id,type,title,content FROM inventory_clinical_document_templates WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY lower(title),id`,
        [auth.organizationId, auth.user.id ?? null],
      ),
    ]);
    const canAuthor = Boolean(
      auth.user.id &&
      !auth.preview &&
      !auth.integration &&
      auth.user.id === appointment.professional_user_id &&
      appointment.professional_council &&
      appointment.council_number &&
      appointment.council_region &&
      !["NO_SHOW", "CANCELED"].includes(appointment.status) &&
      can(auth, "patients.clinical.manage", appointment.unit_id),
    );
    return Response.json(
      {
        data: {
          documents: documents.rows.map(({ author_user_id, ...document }) => ({
            ...document,
            canEdit: Boolean(
              canAuthor && author_user_id === auth.user.id && document.status === "DRAFT",
            ),
          })),
          templates: templates.rows,
          canAuthor,
        },
      },
      { headers },
    );
  }
  if (request.method !== "POST") return fail("Método não permitido.", 405);
  if (request.headers.get("origin") && request.headers.get("origin") !== url.origin)
    return fail("Origem não autorizada.", 403);
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return fail("Use uma conta profissional individual para criar documentos.", 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Requisição inválida.", 400);
  }
  const parsed = input.safeParse(body);
  if (!parsed.success) return fail("Confira o título e o conteúdo do documento.", 400);
  const data = parsed.data;
  if (data.action !== "SAVE_DRAFT" && !data.content)
    return fail("Informe o conteúdo antes de finalizar ou salvar um modelo.", 400);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT a.*,u.name AS author_name,u.professional_council,u.council_number,u.council_region
      FROM inventory_care_appointments a JOIN inventory_users u ON u.id=a.professional_user_id
      WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a`,
      [data.appointmentId, auth.organizationId],
    );
    const appointment = result.rows[0];
    if (!appointment || !can(auth, "patients.clinical.manage", appointment.unit_id))
      throw new Error("NOT_FOUND");
    if (appointment.professional_user_id !== auth.user.id) throw new Error("NOT_AUTHOR");
    if (
      !appointment.professional_council ||
      !appointment.council_number ||
      !appointment.council_region
    )
      throw new Error("COUNCIL");
    if (["NO_SHOW", "CANCELED"].includes(appointment.status)) throw new Error("TERMINAL");
    if (data.action === "SAVE_TEMPLATE") {
      const saved = await client.query(
        `INSERT INTO inventory_clinical_document_templates(organization_id,owner_user_id,type,title,content)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [auth.organizationId, auth.user.id, data.type, data.title, data.content],
      );
      await client.query("COMMIT");
      return Response.json({ data: saved.rows[0] }, { status: 201, headers });
    }
    const previous = data.documentId
      ? (
          await client.query(
            `SELECT * FROM inventory_encounter_documents WHERE id=$1 AND appointment_id=$2 AND organization_id=$3 FOR UPDATE`,
            [data.documentId, data.appointmentId, auth.organizationId],
          )
        ).rows[0]
      : null;
    if (data.documentId && !previous) throw new Error("NOT_FOUND");
    if (previous && previous.author_user_id !== auth.user.id) throw new Error("NOT_AUTHOR");
    if (previous?.status === "FINAL") throw new Error("FINAL");
    if ((previous ? Number(previous.version) : null) !== data.version) throw new Error("STALE");
    if (previous && previous.type !== data.type) throw new Error("TYPE");
    const final = data.action === "FINALIZE";
    const saved = previous
      ? await client.query(
          `UPDATE inventory_encounter_documents SET title=$2,content=$3,status=$4,version=version+1,updated_at=now(),finalized_at=CASE WHEN $4='FINAL' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
          [previous.id, data.title, data.content, final ? "FINAL" : "DRAFT"],
        )
      : await client.query(
          `INSERT INTO inventory_encounter_documents(organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status,finalized_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $13='FINAL' THEN now() ELSE NULL END) RETURNING *`,
          [
            auth.organizationId,
            appointment.unit_id,
            data.appointmentId,
            appointment.patient_id,
            auth.user.id,
            appointment.author_name,
            appointment.professional_council,
            appointment.council_number,
            appointment.council_region,
            data.type,
            data.title,
            data.content,
            final ? "FINAL" : "DRAFT",
          ],
        );
    const document = saved.rows[0];
    await client.query(
      `INSERT INTO inventory_encounter_document_changes(organization_id,document_id,action,before_data,after_data,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        auth.organizationId,
        document.id,
        final ? "FINALIZE" : previous ? "UPDATE" : "CREATE",
        previous,
        document,
        auth.user.id,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: document.id, status: document.status, version: document.version } },
      { status: previous ? 200 : 201, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const reason = error instanceof Error ? error.message : "";
    const messages: Record<string, [string, number]> = {
      NOT_FOUND: ["Documento ou atendimento não encontrado.", 404],
      NOT_AUTHOR: ["Somente o profissional responsável pode editar este documento.", 403],
      COUNCIL: ["Complete o conselho profissional antes de criar documentos.", 409],
      TERMINAL: ["Este atendimento não aceita documentos.", 409],
      FINAL: ["O documento finalizado é imutável.", 409],
      STALE: ["O documento mudou em outra sessão. Atualize a página.", 409],
      TYPE: ["O tipo do documento não pode ser alterado.", 409],
    };
    const [message, status] = messages[reason] ?? ["Não foi possível salvar o documento.", 500];
    if (status === 500) console.error("encounter document write failed");
    return fail(message, status);
  } finally {
    client.release();
  }
}
