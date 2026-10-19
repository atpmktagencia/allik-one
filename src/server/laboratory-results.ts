import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { authenticate, can, type AuthContext } from "./auth";
import { getPool } from "./db";
import { consumeAuthRateLimit } from "./auth-rate-limit";
import { recordClinicalAccess } from "./clinical-access-audit";
import { patientDocumentFileResponse } from "./patient-document-center";
import { PATIENT_DOCUMENT_MAX_BYTES } from "../data/patient-document-upload";
import {
  laboratoryDraft,
  laboratoryValidationProblem,
  emptyLaboratoryDraft,
} from "../lib/laboratory-results";
import {
  extractLaboratoryPdf,
  laboratoryExtractionConfiguration,
  laboratoryModels,
} from "./laboratory-extraction";

type Actor = AuthContext & { user: AuthContext["user"] & { id: string } };
type Job = {
  id: string;
  organization_id: string;
  unit_id: string;
  patient_id: string;
  document_id: string;
  status: string;
  version: number;
  draft: import("../lib/laboratory-results").LaboratoryDraft;
  attempt_id: string | null;
  processing_started_at: string | null;
  model: string | null;
  failure_code: string | null;
  latest_review_id: string | null;
};
type Source = {
  id: string;
  organization_id: string;
  unit_id: string;
  patient_id: string;
  primary_unit_id: string;
  sha256: string;
  title: string;
  size_bytes: number;
};
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const uuid = z.string().uuid();
const input = z
  .object({
    patientId: uuid,
    documentId: uuid,
    action: z.enum(["OPEN", "SAVE", "VALIDATE", "REOPEN", "EXTRACT"]),
    version: z.number().int().nonnegative().optional(),
    operationId: uuid.optional(),
    draft: laboratoryDraft.optional(),
  })
  .strict();
async function scope(a: Actor, p: string, d: string, c?: PoolClient) {
  const s = (
    await (c ?? getPool()).query(
      "SELECT d.id,d.organization_id,d.unit_id,d.patient_id,d.sha256,d.title,d.size_bytes,p.primary_unit_id FROM inventory_patient_documents d JOIN inventory_patients p ON p.id=d.patient_id AND p.organization_id=d.organization_id WHERE d.id=$1 AND d.patient_id=$2 AND d.organization_id=$3 AND d.content_type='application/pdf'" +
        (c ? " FOR SHARE OF p" : ""),
      [d, p, a.organizationId],
    )
  ).rows[0] as Source | undefined;
  return s &&
    [s.unit_id, s.primary_unit_id].every(
      (u) => can(a, "patients.private.read", u) && can(a, "patients.clinical.manage", u),
    )
    ? s
    : null;
}
async function bounded(stream: ReadableStream<Uint8Array> | null, max: number) {
  if (!stream) throw Error("EMPTY_BODY");
  const r = stream.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      length += value.length;
      if (length > max) {
        await r.cancel();
        throw Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    r.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function event(c: PoolClient, a: Actor, j: Job, action: string) {
  await c.query(
    "INSERT INTO inventory_laboratory_import_events(import_id,organization_id,unit_id,patient_id,actor_user_id,action,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      j.id,
      j.organization_id,
      j.unit_id,
      j.patient_id,
      a.user.id,
      action,
      {
        importVersion: j.version,
        model: j.model ?? null,
        attemptId: j.attempt_id ?? null,
        failureCode: j.failure_code ?? null,
      },
    ],
  );
}
async function change(
  c: PoolClient,
  a: Actor,
  j: Job,
  status: string,
  draft: unknown,
  action: string,
  options: {
    attempt?: string;
    model?: string;
    failure?: string | null;
    extracted?: unknown;
    review?: string;
  } = {},
) {
  const next = (
    await c.query(
      "UPDATE inventory_laboratory_imports SET status=$2,draft=$3,version=version+1,updated_by_user_id=$4,updated_at=now(),attempt_id=coalesce($5::uuid,attempt_id),model=coalesce($6::text,model),failure_code=$7,latest_review_id=coalesce($8::uuid,latest_review_id),extracted_payload=coalesce(extracted_payload,$9::jsonb),processing_started_at=CASE WHEN $2='PROCESSING' THEN now() ELSE processing_started_at END WHERE id=$1 RETURNING *",
      [
        j.id,
        status,
        draft,
        a.user.id,
        options.attempt ?? null,
        options.model ?? null,
        options.failure ?? null,
        options.review ?? null,
        options.extracted ?? null,
      ],
    )
  ).rows[0];
  await event(c, a, next, action);
  return next as Job;
}
async function view(a: Actor, s: Source, reviewId?: string) {
  const j =
    (
      await getPool().query(
        "SELECT id,status,version,draft,processing_started_at,failure_code,model,extracted_payload,latest_review_id,updated_at FROM inventory_laboratory_imports WHERE document_id=$1 AND organization_id=$2",
        [s.id, a.organizationId],
      )
    ).rows[0] ?? null;
  const versions = j
    ? (
        await getPool().query(
          "SELECT v.id,v.version,v.created_at,u.name AS reviewer_name FROM inventory_laboratory_review_versions v JOIN inventory_users u ON u.id=v.reviewed_by_user_id WHERE v.import_id=$1 AND v.organization_id=$2 ORDER BY v.version DESC LIMIT 20",
          [j.id, a.organizationId],
        )
      ).rows
    : [];
  const events = j
    ? (
        await getPool().query(
          "SELECT e.action,e.created_at,u.name AS actor_name FROM inventory_laboratory_import_events e JOIN inventory_users u ON u.id=e.actor_user_id WHERE e.import_id=$1 AND e.organization_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 30",
          [j.id, a.organizationId],
        )
      ).rows
    : [];
  await recordClinicalAccess(a, {
    patientId: s.patient_id,
    unitId: s.unit_id,
    action: "READ",
    resourceIds: [s.id, ...(j ? [j.id] : [])],
  });
  const historicalReview =
    reviewId && j
      ? (
          await getPool().query(
            "SELECT id,version,snapshot FROM inventory_laboratory_review_versions WHERE id=$1 AND import_id=$2 AND organization_id=$3",
            [reviewId, j.id, a.organizationId],
          )
        ).rows[0]
      : null;
  if (reviewId && !historicalReview) return fail("Versão não encontrada.", 404);
  const config = laboratoryExtractionConfiguration();
  return Response.json(
    {
      data: {
        source: {
          id: s.id,
          title: s.title,
          sha256: s.sha256,
          sizeBytes: s.size_bytes,
          previewUrl:
            "/api/v1/inventory/patient-document-file?patientId=" +
            s.patient_id +
            "&sourceKind=GENERAL_DOCUMENT&sourceId=" +
            s.id,
        },
        import: j,
        versions,
        historicalReview,
        events,
        extractionAvailable:
          config.enabled && !!config.model && s.size_bytes <= PATIENT_DOCUMENT_MAX_BYTES,
        extractionMessage:
          !config.enabled || !config.model
            ? "Extração por IA ainda não configurada. A conferência manual está disponível."
            : s.size_bytes > PATIENT_DOCUMENT_MAX_BYTES
              ? "Este PDF excede o limite de 4 MB para extração."
              : null,
      },
    },
    { headers },
  );
}
async function finishExtraction(
  request: Request,
  a: Actor,
  s: Source,
  j: Job,
  attempt: string,
  model: string,
) {
  let draft = emptyLaboratoryDraft(),
    failure: string | null = null;
  try {
    const original = await patientDocumentFileResponse(
      new Request(
        new URL(
          "/api/v1/inventory/patient-document-file?patientId=" +
            s.patient_id +
            "&sourceKind=GENERAL_DOCUMENT&sourceId=" +
            s.id,
          request.url,
        ),
        { headers: request.headers },
      ),
    );
    if (!original.ok) throw Error("SOURCE_UNAVAILABLE");
    const bytes = await bounded(original.body, PATIENT_DOCUMENT_MAX_BYTES);
    if (
      createHash("sha256").update(bytes).digest("hex") !== s.sha256 ||
      new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
    )
      throw Error("SOURCE_INTEGRITY");
    draft = laboratoryDraft.parse(await extractLaboratoryPdf(bytes, model));
    draft.patientConfirmed = false;
    draft.rows = draft.rows.map((r) => ({ ...r, verified: false }));
  } catch (e) {
    failure =
      e instanceof Error &&
      ["NO_RESULTS", "EXTRACTION_TIMEOUT", "SOURCE_INTEGRITY"].includes(e.message)
        ? e.message
        : "EXTRACTION_FAILED";
  }
  const fresh = await authenticate(request);
  if (!fresh || fresh.user.id !== a.user.id || fresh.organizationId !== a.organizationId)
    return fail("Seu acesso mudou durante o processamento.", 403);
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    if (!(await scope(fresh as Actor, s.patient_id, s.id, c))) {
      await c.query("ROLLBACK");
      return fail("Acesso ao documento alterado.", 403);
    }
    const current = (
      await c.query(
        "SELECT * FROM inventory_laboratory_imports WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [j.id, a.organizationId],
      )
    ).rows[0];
    if (current.status !== "PROCESSING" || current.attempt_id !== attempt) {
      await c.query("ROLLBACK");
      return fail("Tentativa substituída. Atualize a conferência.", 409);
    }
    await change(
      c,
      a,
      current,
      failure ? "FAILED" : "READY_REVIEW",
      draft,
      failure ? "EXTRACTION_FAILED" : "EXTRACTION_READY",
      { failure, extracted: failure ? null : draft },
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return await view(a, s);
}
export async function laboratoryResultsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para acessar os exames.", 401);
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return fail("Acesso clínico necessário.", 403);
  const a = auth as Actor,
    url = new URL(request.url);
  try {
    if (request.method === "GET") {
      if (url.searchParams.get("models") === "true") {
        if (a.role !== "SUPER_ADMIN" || process.env["VERCEL_ENV"] !== "preview")
          return fail("Acesso negado.", 403);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return Response.json(
            {
              data: await Promise.race([
                laboratoryModels(),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(Error("MODEL_CATALOG_TIMEOUT")), 8000);
                }),
              ]),
            },
            { headers },
          );
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      const p = z
        .object({
          patientId: uuid,
          documentId: uuid,
          unitId: uuid.optional(),
          reviewId: uuid.optional(),
        })
        .strict()
        .safeParse(Object.fromEntries(url.searchParams));
      if (!p.success) return fail("Exame inválido.", 400);
      const s = await scope(a, p.data.patientId, p.data.documentId);
      if (!s) return fail("Exame não encontrado.", 404);
      if (p.data.unitId && !can(a, "patients.clinical.manage", p.data.unitId))
        return fail("Unidade não autorizada.", 403);
      return await view(a, s, p.data.reviewId);
    }
    if (request.method !== "POST") return fail("Método não permitido.", 405);
    if (request.headers.get("origin") !== url.origin) return fail("Origem não autorizada.", 403);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(await bounded(request.body, 524288)));
    } catch {
      return fail("Requisição inválida ou muito grande.", 400);
    }
    const p = input.safeParse(body);
    if (!p.success) return fail("Confira os resultados e seus campos.", 400);
    const d = p.data;
    if (d.action !== "OPEN" && d.version === undefined) return fail("Informe a versão atual.", 400);
    if (["VALIDATE", "EXTRACT"].includes(d.action) && !d.operationId)
      return fail("Identificador da operação ausente.", 400);
    if (d.action === "SAVE" && !d.draft) return fail("Rascunho ausente.", 400);
    const c = await getPool().connect();
    let s: Source | null = null,
      j: Job | null = null,
      model: string | null = null;
    try {
      await c.query("BEGIN");
      s = await scope(a, d.patientId, d.documentId, c);
      if (!s) {
        await c.query("ROLLBACK");
        return fail("Exame não encontrado.", 404);
      }
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "lab:" + a.organizationId + ":" + s.id,
      ]);
      j =
        (
          await c.query(
            "SELECT * FROM inventory_laboratory_imports WHERE document_id=$1 AND organization_id=$2 FOR UPDATE",
            [s.id, a.organizationId],
          )
        ).rows[0] ?? null;
      if (d.action === "OPEN") {
        if (!j) {
          if (s.unit_id !== s.primary_unit_id) {
            await c.query("ROLLBACK");
            return fail("Anexe o PDF na unidade atual para iniciar uma nova importação.", 409);
          }
          j = (
            await c.query(
              "INSERT INTO inventory_laboratory_imports(id,organization_id,unit_id,patient_id,document_id,source_sha256,draft,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *",
              [
                randomUUID(),
                a.organizationId,
                s.unit_id,
                s.patient_id,
                s.id,
                s.sha256,
                emptyLaboratoryDraft(),
                a.user.id,
              ],
            )
          ).rows[0];
          await event(c, a, j!, "OPENED");
        }
      } else {
        if (!j) {
          await c.query("ROLLBACK");
          return fail("Inicie a conferência primeiro.", 409);
        }
        if (d.action === "VALIDATE") {
          const previous = (
            await c.query(
              "SELECT import_id,reviewed_by_user_id FROM inventory_laboratory_review_versions WHERE id=$1",
              [d.operationId],
            )
          ).rows[0];
          if (previous) {
            await c.query("ROLLBACK");
            return previous.import_id === j.id && previous.reviewed_by_user_id === a.user.id
              ? await view(a, s)
              : fail("Identificador já utilizado.", 409);
          }
        }
        if (d.action === "EXTRACT" && j.attempt_id === d.operationId) {
          await c.query("ROLLBACK");
          return await view(a, s);
        }
        if (j.version !== d.version) {
          await c.query("ROLLBACK");
          return fail("A conferência foi alterada. Atualize antes de salvar.", 409);
        }
        if (d.action === "SAVE") {
          if (!["WAITING", "FAILED", "READY_REVIEW"].includes(j.status)) {
            await c.query("ROLLBACK");
            return fail("Exame não está aberto para edição.", 409);
          }
          j = await change(c, a, j, "READY_REVIEW", d.draft, "DRAFT_SAVED");
        } else if (d.action === "REOPEN") {
          if (j.status !== "VALIDATED") {
            await c.query("ROLLBACK");
            return fail("Somente uma versão validada pode ser corrigida.", 409);
          }
          const draft = laboratoryDraft.parse(j.draft);
          draft.patientConfirmed = false;
          draft.rows = draft.rows.map((r) => ({ ...r, verified: false }));
          j = await change(c, a, j, "READY_REVIEW", draft, "REOPENED");
        } else if (d.action === "VALIDATE") {
          const draft = laboratoryDraft.parse(j.draft),
            problem = laboratoryValidationProblem(draft);
          if (j.status !== "READY_REVIEW" || problem) {
            await c.query("ROLLBACK");
            return fail(problem ?? "Salve a conferência antes de confirmar.", 409);
          }
          const revision = Number(
            (
              await c.query(
                "SELECT coalesce(max(version),0)+1 version FROM inventory_laboratory_review_versions WHERE import_id=$1",
                [j.id],
              )
            ).rows[0].version,
          );
          await c.query(
            "INSERT INTO inventory_laboratory_review_versions(id,import_id,organization_id,unit_id,patient_id,version,source_sha256,snapshot,reviewed_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              d.operationId,
              j.id,
              a.organizationId,
              s.unit_id,
              s.patient_id,
              revision,
              s.sha256,
              draft,
              a.user.id,
            ],
          );
          await c.query(
            "INSERT INTO inventory_laboratory_results(review_id,import_id,organization_id,unit_id,patient_id,ordinal,payload) SELECT $1,$2,$3,$4,$5,(ordinality-1)::int,value FROM jsonb_array_elements($6::jsonb) WITH ORDINALITY",
            [
              d.operationId,
              j.id,
              a.organizationId,
              s.unit_id,
              s.patient_id,
              JSON.stringify(draft.rows),
            ],
          );
          j = await change(c, a, j, "VALIDATED", draft, "VALIDATED", { review: d.operationId! });
        } else if (d.action === "EXTRACT") {
          const config = laboratoryExtractionConfiguration();
          if (!config.enabled || !config.model) {
            await c.query("ROLLBACK");
            return fail("Extração por IA ainda não configurada.", 503);
          }
          const stale =
            j.status === "PROCESSING" &&
            Date.now() - new Date(j.processing_started_at ?? 0).getTime() > 90000;
          if (
            (!["WAITING", "FAILED"].includes(j.status) && !stale) ||
            j.draft.rows.length ||
            s.size_bytes > PATIENT_DOCUMENT_MAX_BYTES
          ) {
            await c.query("ROLLBACK");
            return fail(
              "Não é possível substituir uma conferência editada. Use a revisão manual.",
              409,
            );
          }
          model = config.model;
          if (
            !(await consumeAuthRateLimit("lab-extraction-hour:" + a.organizationId, 6)) ||
            !(await consumeAuthRateLimit("lab-extraction-day:" + a.organizationId, 20, "day"))
          ) {
            await c.query("ROLLBACK");
            return fail(
              "Limite de extrações atingido. A conferência manual continua disponível.",
              429,
            );
          }
          j = await change(c, a, j, "PROCESSING", j.draft, "PROCESSING_STARTED", {
            attempt: d.operationId!,
            model,
          });
        }
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    return await (model && s && j
      ? finishExtraction(request, a, s, j, d.operationId!, model)
      : view(a, s!));
  } catch {
    return fail("Não foi possível concluir a conferência. Atualize e tente novamente.", 503);
  }
}
