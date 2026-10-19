import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { get, put, del } from "@vercel/blob";
import { authenticate, can, type AuthContext } from "./auth";
import { getPool } from "./db";
import { recordClinicalAccess } from "./clinical-access-audit";
import { encounterDocumentsResponse } from "./encounter-documents";
import { prescriptionDownloadResponse } from "./patient-treatments";
import { planQuotesResponse } from "./plan-quotes";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const uuid = z.string().uuid();
export const patientDocumentBuiltins = {
  PRESCRIPTION: "Prescrições",
  MEDICAL_PRESCRIPTION: "Receitas",
  MEDICAL_OPINION: "Laudos",
  EXAM_REQUEST: "Solicitação de exames",
  LAB_RESULT: "Resultado laboratorial",
  IMAGE_REPORT: "Laudo de imagem",
  MEDICAL_CERTIFICATE: "Atestado",
  REFERRAL: "Encaminhamento",
  MEDICAL_REPORT: "Relatórios médicos",
  CONSENT: "Consentimento",
  CLINICAL_PLAN: "Plano clínico",
  QUOTE: "Orçamento",
  QUESTIONNAIRE: "Questionário",
  OTHER: "Outro",
} as const;
export const patientDocumentSourceKinds = [
  "CLINICAL_DOCUMENT",
  "STRUCTURED_PRESCRIPTION",
  "UPLOADED_PRESCRIPTION",
  "PLAN_QUOTE",
  "LEGACY_QUOTE",
  "CLINICAL_PLAN",
  "PRECONSULTATION_RESPONSE",
  "GENERAL_DOCUMENT",
] as const;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !s.startsWith("0000") &&
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
const filters = z
  .object({
    patientId: uuid,
    search: z.string().trim().max(150).optional(),
    category: z.string().max(64).optional(),
    categoryGroup: z.literal("EXAMS").optional(),
    sourceKind: z.enum(patientDocumentSourceKinds).optional(),
    dateFrom: date.optional(),
    dateTo: date.optional(),
    professionalId: uuid.optional(),
    sort: z.enum(["date", "relevance"]).default("date"),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    unitId: uuid.optional(),
  })
  .strict()
  .refine((f) => !f.dateFrom || !f.dateTo || f.dateFrom <= f.dateTo);
const uploadInput = z
  .object({
    id: uuid,
    patientId: uuid,
    title: z.string().trim().min(2).max(200),
    categories: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(8)
      .refine((a) => new Set(a).size === a.length),
    issuedOn: date.nullable(),
  })
  .strict();
async function context(auth: AuthContext, patientId: string) {
  const patient = (
    await getPool().query(
      "SELECT id,primary_unit_id FROM inventory_patients WHERE id=$1 AND organization_id=$2",
      [patientId, auth.organizationId],
    )
  ).rows[0];
  if (!patient) return null;
  const clinical =
      can(auth, "patients.private.read", patient.primary_unit_id) &&
      can(auth, "patients.clinical.manage", patient.primary_unit_id),
    commercial = can(auth, "quotes.manage", patient.primary_unit_id);
  if (!clinical && !commercial) return null;
  const units = (
    await getPool().query("SELECT id,name FROM inventory_units WHERE organization_id=$1", [
      auth.organizationId,
    ])
  ).rows;
  return {
    patient,
    clinical,
    commercial,
    clinicalUnits: units
      .filter(
        (u) =>
          can(auth, "patients.private.read", u.id) && can(auth, "patients.clinical.manage", u.id),
      )
      .map((u) => u.id),
    commercialUnits: units.filter((u) => can(auth, "quotes.manage", u.id)).map((u) => u.id),
  };
}
async function categories(auth: AuthContext) {
  return [
    ...Object.entries(patientDocumentBuiltins).map(([id, name]) => ({ id, name, builtin: true })),
    ...(
      await getPool().query(
        "SELECT id,name FROM inventory_patient_document_categories WHERE organization_id=$1 ORDER BY lower(name),id",
        [auth.organizationId],
      )
    ).rows.map((r) => ({ id: r.id as string, name: r.name as string, builtin: false })),
  ];
}
const union = `
 SELECT d.id source_id,'CLINICAL_DOCUMENT'::text source_kind,d.version revision,d.title,CASE WHEN d.type='PRESCRIPTION' THEN ARRAY['PRESCRIPTION','MEDICAL_PRESCRIPTION'] ELSE ARRAY[CASE d.type WHEN 'INSTRUCTIONS' THEN 'OTHER' ELSE d.type END] END::text[] categories,coalesce(d.finalized_at,d.updated_at) occurred_at,d.author_user_id professional_id,d.author_name professional_name,d.unit_id,d.status,'text/html'::text content_type,NULL::int size_bytes FROM inventory_encounter_documents d WHERE d.patient_id=$1 AND d.organization_id=$2 AND $4 AND d.unit_id=ANY($6::uuid[]) AND (d.status='FINAL' OR(d.status='DRAFT' AND d.author_user_id=$3))
 UNION ALL SELECT d.id,'STRUCTURED_PRESCRIPTION',d.version,'Prescrição estruturada',ARRAY['PRESCRIPTION'],coalesce(d.finalized_at,d.updated_at),d.author_user_id,d.author_name,d.unit_id,d.status,NULL,NULL FROM inventory_encounter_prescriptions d WHERE d.patient_id=$1 AND d.organization_id=$2 AND $4 AND d.unit_id=ANY($6::uuid[]) AND d.status='FINAL'
 UNION ALL SELECT d.id,'UPLOADED_PRESCRIPTION',d.version,d.original_filename,ARRAY['PRESCRIPTION'],coalesce(d.issued_on::timestamp AT TIME ZONE 'America/Fortaleza',d.uploaded_at),d.uploaded_by_user_id,coalesce(d.prescriber_name,u.name,''),t.unit_id,d.document_status,d.content_type,d.size_bytes FROM inventory_patient_prescriptions d JOIN inventory_patient_treatments t ON t.id=d.treatment_id AND t.organization_id=d.organization_id AND t.patient_id=d.patient_id LEFT JOIN inventory_users u ON u.id=d.uploaded_by_user_id WHERE d.patient_id=$1 AND d.organization_id=$2 AND $4 AND t.unit_id=ANY($6::uuid[])
 UNION ALL SELECT q.id,'PLAN_QUOTE',v.version,'Orçamento do plano · revisão '||v.version,ARRAY['QUOTE'],v.created_at,q.created_by_user_id,u.name,q.unit_id,q.status,'text/html',NULL FROM inventory_plan_quotes q JOIN inventory_plan_quote_versions v ON v.quote_id=q.id AND v.version=q.version AND v.organization_id=q.organization_id AND v.unit_id=q.unit_id JOIN inventory_users u ON u.id=q.created_by_user_id WHERE q.patient_id=$1 AND q.organization_id=$2 AND $5 AND q.unit_id=ANY($7::uuid[])
 UNION ALL SELECT q.id,'LEGACY_QUOTE',q.version,'Orçamento de atendimento',ARRAY['QUOTE'],q.updated_at,NULL::uuid,''::text,q.unit_id,q.status,NULL,NULL FROM inventory_encounter_quotes q WHERE q.patient_id=$1 AND q.organization_id=$2 AND $5 AND q.unit_id=ANY($7::uuid[])
 UNION ALL SELECT d.id,'CLINICAL_PLAN',d.version,d.title,ARRAY['CLINICAL_PLAN'],d.updated_at,d.author_user_id,u.name,d.unit_id,d.status,NULL,NULL FROM inventory_clinical_plans d JOIN inventory_users u ON u.id=d.author_user_id WHERE d.patient_id=$1 AND d.organization_id=$2 AND $4 AND d.unit_id=ANY($6::uuid[])
 UNION ALL SELECT i.id,'PRECONSULTATION_RESPONSE',v.version,v.title,ARRAY['QUESTIONNAIRE'],i.submitted_at,i.created_by_user_id,u.name,i.unit_id,'SUBMITTED',NULL,NULL FROM inventory_preconsultation_invitations i JOIN inventory_preconsultation_versions v ON v.id=i.version_id AND v.organization_id=i.organization_id JOIN inventory_preconsultation_responses r ON r.invitation_id=i.id JOIN inventory_users u ON u.id=i.created_by_user_id WHERE i.patient_id=$1 AND i.organization_id=$2 AND $4 AND i.unit_id=ANY($6::uuid[])
 UNION ALL SELECT d.id,'GENERAL_DOCUMENT',1,d.title,d.categories,coalesce(d.issued_on::timestamp AT TIME ZONE 'America/Fortaleza',d.created_at),d.uploaded_by_user_id,u.name,d.unit_id,'AVAILABLE',d.content_type,d.size_bytes FROM inventory_patient_documents d JOIN inventory_users u ON u.id=d.uploaded_by_user_id WHERE d.patient_id=$1 AND d.organization_id=$2 AND $4 AND d.unit_id=ANY($6::uuid[])
`;
async function audited(
  auth: AuthContext,
  patientId: string,
  unitId: string,
  resourceIds: string[],
  action: "READ" | "PRINT" = "READ",
) {
  await recordClinicalAccess(auth, { patientId, unitId, action, resourceIds });
}
export async function patientDocumentsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para acessar os documentos.", 401);
  if (!auth.user.id || auth.preview || auth.integration)
    return fail("Use uma conta individual autorizada.", 403);
  if (!["GET", "POST"].includes(request.method)) return fail("Método não permitido.", 405);
  const url = new URL(request.url);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return fail("Origem não autorizada.", 403);
  try {
    if (request.method === "POST") {
      if (request.headers.get("content-type")?.startsWith("multipart/form-data"))
        return await upload(request, auth);
      if (!["SUPER_ADMIN", "PARTNER_ADMIN"].includes(auth.role))
        return fail("Somente administradores podem criar categorias.", 403);
      const body = z
        .object({ action: z.literal("CREATE_CATEGORY"), name: z.string().trim().min(2).max(80) })
        .strict()
        .safeParse(await request.json());
      if (!body.success) return fail("Categoria inválida.", 400);
      if (
        Object.values(patientDocumentBuiltins).some(
          (n) => n.toLocaleLowerCase() === body.data.name.toLocaleLowerCase(),
        )
      )
        return fail("Categoria já existente.", 409);
      const row = (
        await getPool().query(
          "INSERT INTO inventory_patient_document_categories(organization_id,name,created_by_user_id) VALUES($1,$2,$3) RETURNING id,name",
          [auth.organizationId, body.data.name, auth.user.id],
        )
      ).rows[0];
      return Response.json({ data: { ...row, builtin: false } }, { status: 201, headers });
    }
    const parsed = filters.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return fail("Filtros inválidos.", 400);
    const f = parsed.data,
      c = await context(auth, f.patientId);
    if (!c) return fail("Paciente não encontrado.", 404);
    if (f.unitId && !c.clinicalUnits.includes(f.unitId) && !c.commercialUnits.includes(f.unitId))
      return fail("Unidade não autorizada.", 403);
    const pattern = f.search ? `%${f.search.replace(/[\\%_]/g, "\\$&")}%` : null;
    const params = [
      f.patientId,
      auth.organizationId,
      auth.user.id,
      c.clinical,
      c.commercial,
      c.clinicalUnits,
      c.commercialUnits,
      pattern,
      f.category ?? null,
      f.dateFrom ?? null,
      f.dateTo ?? null,
      f.professionalId ?? null,
      f.sourceKind ?? null,
      f.limit + 1,
      f.offset,
      f.sort,
      f.categoryGroup ?? null,
      f.search ?? "",
    ];
    const matching = `($8::text IS NULL OR s.title ILIKE $8 OR s.professional_name ILIKE $8) AND ($9::text IS NULL OR $9=ANY(s.categories)) AND ($10::date IS NULL OR (s.occurred_at AT TIME ZONE 'America/Fortaleza')::date >= $10::date) AND ($11::date IS NULL OR (s.occurred_at AT TIME ZONE 'America/Fortaleza')::date <= $11::date) AND ($12::uuid IS NULL OR s.professional_id=$12) AND ($13::text IS NULL OR s.source_kind=$13) AND ($17::text IS NULL OR s.categories&&ARRAY['EXAM_REQUEST','LAB_RESULT','IMAGE_REPORT'])`;
    const rows = (
      await getPool().query(
        `WITH sources AS (${union}), matching AS(SELECT s.* FROM sources s WHERE ${matching}) SELECT s.*,u.name unit_name,(SELECT q.appointment_id FROM inventory_encounter_quotes q WHERE s.source_kind='LEGACY_QUOTE' AND q.id=s.source_id AND q.organization_id=$2) origin_appointment,count(*) OVER()::int total FROM matching s JOIN inventory_units u ON u.id=s.unit_id AND u.organization_id=$2 ORDER BY CASE WHEN $16='relevance' THEN CASE WHEN lower(s.title)=lower($18) THEN 0 WHEN lower(left(s.title,length($18)))=lower($18) THEN 1 ELSE 2 END ELSE 0 END,s.occurred_at DESC,s.source_kind,s.source_id DESC,s.revision DESC LIMIT $14 OFFSET $15`,
        params,
      )
    ).rows;
    const records = rows.slice(0, f.limit),
      documents = records.map((r) => {
        const fileUrl = `/api/v1/inventory/patient-document-file?patientId=${f.patientId}&sourceKind=${r.source_kind}&sourceId=${r.source_id}&revision=${r.revision}`;
        const preview = [
            "CLINICAL_DOCUMENT",
            "PLAN_QUOTE",
            "GENERAL_DOCUMENT",
            "UPLOADED_PRESCRIPTION",
          ].includes(r.source_kind),
          binary = ["GENERAL_DOCUMENT", "UPLOADED_PRESCRIPTION"].includes(r.source_kind);
        return {
          id: `${r.source_kind}:${r.source_id}:${r.revision}`,
          sourceKind: r.source_kind,
          sourceId: r.source_id,
          revision: r.revision,
          title: r.title,
          categories: r.categories,
          occurredAt: r.occurred_at,
          professionalId: r.professional_id,
          professionalName: r.professional_name,
          unitName: r.unit_name,
          status: r.status,
          contentType: r.content_type,
          sizeBytes: r.size_bytes,
          previewUrl: preview ? fileUrl : null,
          downloadUrl: binary ? `${fileUrl}&download=true` : null,
          originUrl:
            r.source_kind === "PLAN_QUOTE"
              ? "/orcamentos-planos"
              : r.source_kind === "LEGACY_QUOTE"
                ? `/atendimentos/${r.origin_appointment}`
                : `/pacientes/${f.patientId}/prontuario`,
        };
      });
    await audited(
      auth,
      f.patientId,
      c.patient.primary_unit_id,
      records.map((r) => r.source_id),
    );
    const people = (
      await getPool().query(
        `WITH sources AS(${union}) SELECT DISTINCT professional_id id,professional_name name FROM sources WHERE professional_id IS NOT NULL ORDER BY name,id LIMIT 100`,
        params.slice(0, 7),
      )
    ).rows;
    const count = (
      await getPool().query(
        `WITH sources AS(${union}) SELECT count(*)::int total FROM sources s WHERE ${matching} AND $14::int>0 AND $15::int>=0 AND $16::text IS NOT NULL AND $18::text IS NOT NULL`,
        params,
      )
    ).rows[0].total;
    return Response.json(
      {
        data: {
          documents,
          categories: c.clinical
            ? await categories(auth)
            : [{ id: "QUOTE", name: patientDocumentBuiltins.QUOTE, builtin: true }],
          professionals: people,
          total: count,
          limit: f.limit,
          offset: f.offset,
          hasMore: rows.length > f.limit,
          canUpload: c.clinical,
          canManageCategories: ["SUPER_ADMIN", "PARTNER_ADMIN"].includes(auth.role),
        },
      },
      { headers },
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    return fail(
      code === "23505" ? "Registro já existente." : "Não foi possível carregar os documentos.",
      code === "23505" ? 409 : 503,
    );
  }
}
async function upload(request: Request, auth: AuthContext) {
  const max = 10 * 1024 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > max + 65536)
    return fail("Envie arquivo de até 10 MB.", 400);
  const reader = request.body?.getReader();
  if (!reader) return fail("Arquivo ausente.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max + 65536) {
        await reader.cancel();
        return fail("Envie arquivo de até 10 MB.", 400);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  const form = await new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("content-type")! },
    body,
  }).formData();
  let cats: unknown;
  try {
    cats = JSON.parse(String(form.get("categories") ?? "[]"));
  } catch {
    return fail("Categorias inválidas.", 400);
  }
  const parsed = uploadInput.safeParse({
      id: form.get("id"),
      patientId: form.get("patientId"),
      title: form.get("title"),
      categories: cats,
      issuedOn: form.get("issuedOn") || null,
    }),
    file = form.get("file");
  if (!parsed.success || !(file instanceof File) || file.size < 1 || file.size > max)
    return fail("Confira o arquivo e seus dados (até 10 MB).", 400);
  const d = parsed.data,
    c = await context(auth, d.patientId);
  if (!c || !c.clinical) return fail("Paciente não autorizado para envio.", 403);
  const known = await categories(auth);
  if (d.categories.some((id) => !known.some((k) => k.id === id)))
    return fail("Categoria não pertence a esta organização.", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  let type: string | null = null,
    ext = "";
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    type = "application/pdf";
    ext = "pdf";
  } else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    type = "image/png";
    ext = "png";
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    type = "image/jpeg";
    ext = "jpg";
  }
  if (!type || file.type !== type)
    return fail("O conteúdo deve corresponder a PDF, JPEG ou PNG.", 400);
  const id = d.id,
    pathname = `patient-documents/${auth.organizationId}/${d.patientId}/${id}.${ext}`,
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const client = await getPool().connect();
  let createdPath: string | null = null;
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${auth.organizationId}:patient-document:${id}`,
    ]);
    const previous = (
      await client.query(
        "SELECT *,issued_on::text AS issued_on FROM inventory_patient_documents WHERE id=$1 AND organization_id=$2",
        [id, auth.organizationId],
      )
    ).rows[0];
    if (previous) {
      const equal =
        previous.patient_id === d.patientId &&
        previous.uploaded_by_user_id === auth.user.id &&
        c.clinicalUnits.includes(previous.unit_id) &&
        previous.title === d.title &&
        JSON.stringify(previous.categories) === JSON.stringify(d.categories) &&
        String(previous.issued_on ?? "").slice(0, 10) === String(d.issuedOn ?? "") &&
        previous.original_filename === file.name.slice(0, 180) &&
        previous.sha256 === sha256 &&
        previous.content_type === type &&
        previous.size_bytes === bytes.length;
      if (!equal) {
        await client.query("ROLLBACK");
        return fail("Identificador reutilizado com outro arquivo ou dados.", 409);
      }
      commitAttempted = true;
      await client.query("COMMIT");
      return Response.json({ data: { id } }, { headers });
    }
    const blob = await put(pathname, bytes, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: type,
    });
    createdPath = blob.pathname;
    await client
      .query(
        "SELECT id FROM inventory_patients WHERE id=$1 AND organization_id=$2 AND primary_unit_id=$3 FOR SHARE",
        [d.patientId, auth.organizationId, c.patient.primary_unit_id],
      )
      .then((r) => {
        if (!r.rowCount) throw new Error("Patient scope changed");
      });
    await client.query(
      "INSERT INTO inventory_patient_documents(id,organization_id,unit_id,patient_id,title,categories,issued_on,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        id,
        auth.organizationId,
        c.patient.primary_unit_id,
        d.patientId,
        d.title,
        d.categories,
        d.issuedOn,
        blob.pathname,
        file.name.slice(0, 180),
        type,
        bytes.length,
        sha256,
        auth.user.id,
      ],
    );
    await client.query(
      "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
      [auth.organizationId, c.patient.primary_unit_id, id, auth.user.id],
    );
    commitAttempted = true;
    await client.query("COMMIT");
    return Response.json({ data: { id } }, { status: 201, headers });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // A COMMIT acknowledgement can fail after persistence. Retain the original on ambiguity.
    if (createdPath && !commitAttempted) await del(createdPath).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function patientDocumentFileResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para acessar o arquivo.", 401);
  if (!auth.user.id || auth.preview || auth.integration)
    return fail("Use uma conta individual autorizada.", 403);
  if (request.method !== "GET") return fail("Método não permitido.", 405);
  const parsed = z
    .object({
      patientId: uuid,
      sourceKind: z.enum(patientDocumentSourceKinds),
      sourceId: uuid,
      revision: z.coerce.number().int().nonnegative().optional(),
      download: z.literal("true").optional(),
      unitId: uuid.optional(),
    })
    .strict()
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return fail("Documento inválido.", 400);
  const f = parsed.data;
  try {
    const c = await context(auth, f.patientId);
    if (!c) return fail("Documento não encontrado.", 404);
    if (f.unitId && !c.clinicalUnits.includes(f.unitId) && !c.commercialUnits.includes(f.unitId))
      return fail("Unidade não autorizada.", 403);
    const row = (
      await getPool().query(
        `WITH sources AS(${union}) SELECT * FROM sources WHERE source_kind=$8 AND source_id=$9 AND ($10::int IS NULL OR revision=$10)`,
        [
          f.patientId,
          auth.organizationId,
          auth.user.id,
          c.clinical,
          c.commercial,
          c.clinicalUnits,
          c.commercialUnits,
          f.sourceKind,
          f.sourceId,
          f.revision ?? null,
        ],
      )
    ).rows[0];
    // Historical saved quote revisions have the same source scopes but need not be the current head.
    if (!row && f.sourceKind !== "PLAN_QUOTE") return fail("Documento não encontrado.", 404);
    if (f.sourceKind === "PLAN_QUOTE") {
      const q = (
        await getPool().query(
          "SELECT q.plan_id FROM inventory_plan_quotes q JOIN inventory_plan_quote_versions v ON v.quote_id=q.id AND v.organization_id=q.organization_id AND v.unit_id=q.unit_id WHERE q.id=$1 AND q.organization_id=$2 AND q.patient_id=$3 AND q.unit_id=ANY($4::uuid[]) AND ($5::int IS NULL OR v.version=$5)",
          [f.sourceId, auth.organizationId, f.patientId, c.commercialUnits, f.revision ?? null],
        )
      ).rows[0];
      if (!c.commercial || !q) return fail("Documento não encontrado.", 404);
      return sameOriginPreview(
        await planQuotesResponse(
          new Request(
            `${new URL(request.url).origin}/api/v1/inventory/plan-quotes?planId=${q.plan_id}&patientId=${f.patientId}&quoteId=${f.sourceId}${f.revision ? `&revision=${f.revision}` : ""}&format=proposal`,
            { headers: request.headers },
          ),
        ),
      );
    }
    if (f.sourceKind === "CLINICAL_DOCUMENT")
      return sameOriginPreview(
        await encounterDocumentsResponse(
          new Request(
            `${new URL(request.url).origin}/api/v1/inventory/encounter-documents?documentId=${f.sourceId}&print=true${row.status === "DRAFT" ? "&preview=true" : ""}`,
            { headers: request.headers },
          ),
        ),
      );
    if (f.sourceKind === "UPLOADED_PRESCRIPTION") {
      const response = await prescriptionDownloadResponse(request, f.sourceId);
      if (!response.ok || !f.download) return response;
      const h = new Headers(response.headers);
      h.set(
        "Content-Disposition",
        (h.get("Content-Disposition") ?? "inline").replace(/^inline/, "attachment"),
      );
      return new Response(response.body, { status: response.status, headers: h });
    }
    if (f.sourceKind !== "GENERAL_DOCUMENT")
      return fail("Consulte este registro na sua origem.", 409);
    const doc = (
      await getPool().query(
        "SELECT * FROM inventory_patient_documents WHERE id=$1 AND organization_id=$2 AND patient_id=$3",
        [f.sourceId, auth.organizationId, f.patientId],
      )
    ).rows[0];
    if (!doc) return fail("Documento não encontrado.", 404);
    const blob = await get(doc.blob_pathname, { access: "private" });
    if (!blob || blob.statusCode !== 200) return fail("Arquivo indisponível.", 404);
    await audited(auth, f.patientId, doc.unit_id, [doc.id]);
    const name = String(doc.original_filename).replace(/["\\\r\n]/g, "_");
    return new Response(blob.stream, {
      headers: {
        ...headers,
        "Content-Type": doc.content_type,
        "Content-Disposition": `${f.download ? "attachment" : "inline"}; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'self'",
      },
    });
  } catch {
    return fail("Não foi possível acessar o documento.", 503);
  }
}

function sameOriginPreview(response: Response) {
  if (!response.headers.get("Content-Type")?.includes("text/html")) return response;
  const h = new Headers(response.headers);
  const csp = h.get("Content-Security-Policy");
  if (csp)
    h.set(
      "Content-Security-Policy",
      csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
    );
  return new Response(response.body, { status: response.status, headers: h });
}
