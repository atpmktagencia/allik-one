import "@tanstack/react-start/server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { recordClinicalAccess } from "./clinical-access-audit";
import { renderClinicalDocumentPdf } from "./clinical-document-pdf";
import {
  createLacunaSignatureSession,
  completeLacunaSignatureSession,
  getLacunaSignatureConfiguration,
  LacunaSignatureError,
} from "./lacuna-signature-provider";
import {
  decryptSignerCpf,
  encryptSignerCpf,
  normalizeSignerCpf,
  signatureHash,
  signatureSecretReady,
  signerCpfHash,
} from "./signature-identity";

const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
  "Referrer-Policy": "no-referrer",
};
const uuid = z.string().uuid();
const input = z.object({
  action: z.enum(["START", "COMPLETE", "CANCEL", "REGISTER_IDENTITY"]),
  documentId: uuid,
  operationId: uuid.optional(),
  attemptId: uuid.optional(),
  cpf: z.string().max(30).optional(),
  signatureSessionId: z.string().max(100).optional(),
  state: z.string().max(200).optional(),
});
const active = ["PREPARING", "AWAITING_SIGNATURE"];
async function event(
  client: PoolClient,
  document: Record<string, unknown>,
  actor: string,
  action: string,
  data: unknown,
  attemptId: string | null = null,
) {
  await client.query(
    `INSERT INTO inventory_document_signature_events(organization_id,document_id,attempt_id,actor_user_id,action,data) VALUES($1,$2,$3,$4,$5,$6)`,
    [document["organization_id"], document["id"], attemptId, actor, action, data],
  );
}
const latestSql =
  "SELECT * FROM inventory_document_signature_attempts WHERE document_id=$1 AND organization_id=$2 ORDER BY CASE WHEN status='SIGNED' THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 1";
export async function documentSignaturesResponse(request: Request) {
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  const auth = await authenticate(request);
  if (!auth) return fail("Entre com sua conta para acessar assinaturas.", 401);
  if (!can(auth, "patients.private.read")) return fail("Acesso negado.", 403);
  const url = new URL(request.url);
  try {
    let data: z.infer<typeof input> | null = null;
    let documentId = url.searchParams.get("documentId");
    if (request.method === "POST") {
      if (request.headers.get("origin") && request.headers.get("origin") !== url.origin)
        return fail("Origem não autorizada.", 403);
      if (!auth.user.id || auth.preview || auth.integration)
        return fail("Use uma conta individual para assinar.", 403);
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return fail("Requisição inválida.", 400);
      }
      const parsed = input.safeParse(raw);
      if (!parsed.success) return fail("Confira os dados da assinatura.", 400);
      data = parsed.data;
      documentId = data.documentId;
    } else if (request.method !== "GET") return fail("Método não permitido.", 405);
    if (!uuid.safeParse(documentId).success) return fail("Documento inválido.", 400);
    const pool = getPool();
    const document = (
      await pool.query(
        `SELECT d.*,u.name AS current_author_name,u.active AS author_active,u.professional_council AS current_council,u.council_number AS current_council_number,u.council_region AS current_council_region
      FROM inventory_encounter_documents d JOIN inventory_users u ON u.id=d.author_user_id WHERE d.id=$1 AND d.organization_id=$2`,
        [documentId, auth.organizationId],
      )
    ).rows[0];
    if (!document || !can(auth, "patients.private.read", document.unit_id))
      return fail("Documento não encontrado.", 404);
    if (document.status !== "FINAL" || !document.final_snapshot)
      return fail("A assinatura exige um documento finalizado com identificação preservada.", 409);
    const author = Boolean(
      auth.user.id &&
      !auth.preview &&
      !auth.integration &&
      auth.user.id === document.author_user_id &&
      document.author_active &&
      can(auth, "patients.clinical.manage", document.unit_id),
    );
    const canManageIdentity = Boolean(
      auth.user.id && !auth.preview && !auth.integration && can(auth, "users.manage"),
    );
    const identity = (
      await pool.query(
        "SELECT * FROM inventory_signing_identities WHERE user_id=$1 AND organization_id=$2",
        [document.author_user_id, auth.organizationId],
      )
    ).rows[0];
    let identityReady = false,
      identityMaskedCpf: string | undefined;
    if (identity && signatureSecretReady())
      try {
        const cpf = decryptSignerCpf(identity.cpf_encrypted);
        identityReady = true;
        if (author || canManageIdentity) identityMaskedCpf = `***.***.${cpf.slice(6, 9)}-**`;
      } catch {
        /* Secret rotation or corrupted identity must fail closed. */
      }
    const configuration = getLacunaSignatureConfiguration();
    const configured = configuration.configured && signatureSecretReady();
    let configurationReason =
      configuration.reason ??
      (!signatureSecretReady()
        ? "A chave de proteção de assinaturas ainda não foi configurada."
        : null);
    const canonicalOrigin = process.env["SIGNATURE_PUBLIC_ORIGIN"];
    const originMatches = Boolean(
      configuration.configured && canonicalOrigin && new URL(canonicalOrigin).origin === url.origin,
    );
    if (configured && !originMatches)
      configurationReason = "Acesse a URL cadastrada para assinatura para iniciar o procedimento.";
    const latest = (await pool.query(latestSql, [documentId, auth.organizationId])).rows[0];
    if (request.method === "GET") {
      if (url.searchParams.get("download") === "true") {
        if (!latest || latest.status !== "SIGNED")
          return fail("Nenhum PDF assinado disponível.", 404);
        if (signatureHash(latest.signed_pdf) !== latest.signed_sha256)
          throw new Error("STORAGE_INTEGRITY");
        await recordClinicalAccess(auth, {
          unitId: document.unit_id,
          patientId: document.patient_id,
          appointmentId: document.appointment_id,
          documentId: document.id,
          action: "SIGNED_DOWNLOAD",
        });
        return new Response(new Uint8Array(latest.signed_pdf), {
          headers: {
            ...headers,
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="documento-assinado-${documentId}.pdf"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (url.searchParams.get("source") === "true") {
        const bytes =
          latest && (active.includes(latest.status) || latest.status === "SIGNED")
            ? latest.source_pdf
            : await renderClinicalDocumentPdf(document);
        if (
          latest &&
          (active.includes(latest.status) || latest.status === "SIGNED") &&
          signatureHash(bytes) !== latest.source_sha256
        )
          throw new Error("STORAGE_INTEGRITY");
        await recordClinicalAccess(auth, {
          unitId: document.unit_id,
          patientId: document.patient_id,
          appointmentId: document.appointment_id,
          documentId: document.id,
          action: "PDF_SOURCE",
        });
        return new Response(new Uint8Array(bytes), {
          headers: {
            ...headers,
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="documento-para-assinatura-${documentId}.pdf"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const expired =
        latest &&
        active.includes(latest.status) &&
        new Date(latest.expires_at).getTime() <= Date.now();
      return Response.json(
        {
          data: {
            configured: configured && originMatches,
            configurationReason,
            canSign: author,
            canManageIdentity: canManageIdentity && signatureSecretReady(),
            identityReady,
            identityMaskedCpf,
            signerName: document.final_snapshot.authorName,
            attempt: latest
              ? {
                  id: latest.id,
                  status: expired ? "EXPIRED" : latest.status,
                  expiresAt: latest.expires_at,
                  signedAt: latest.signed_at,
                  certificateSubject: String(latest.certificate?.subjectName ?? "").replace(
                    /\d{11}/g,
                    "***",
                  ),
                  canResume: author && !expired && latest.status === "AWAITING_SIGNATURE",
                  redirectUrl:
                    author && !expired && latest.status === "AWAITING_SIGNATURE"
                      ? latest.redirect_url
                      : undefined,
                }
              : null,
          },
        },
        { headers },
      );
    }
    if (!data) return fail("Requisição inválida.", 400);
    if (data.action === "REGISTER_IDENTITY") {
      if (!canManageIdentity)
        return fail("Somente a administração pode conferir a identidade de assinatura.", 403);
      if (!signatureSecretReady())
        return fail(
          "Configure a chave de proteção de assinaturas antes de cadastrar a identidade.",
          503,
        );
      if (!data.cpf) return fail("Informe o CPF do profissional.", 400);
      const cpf = normalizeSignerCpf(data.cpf),
        encrypted = encryptSignerCpf(cpf),
        hash = signerCpfHash(cpf);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Lock the same document used by START so revocation cannot race creation.
        await client.query("SELECT id FROM inventory_encounter_documents WHERE id=$1 FOR UPDATE", [
          documentId,
        ]);
        await client.query(
          `INSERT INTO inventory_signing_identities(organization_id,user_id,cpf_encrypted,cpf_hash,verified_by_user_id) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(organization_id,user_id) DO UPDATE SET cpf_encrypted=EXCLUDED.cpf_encrypted,cpf_hash=EXCLUDED.cpf_hash,verified_by_user_id=EXCLUDED.verified_by_user_id,verified_at=now(),version=inventory_signing_identities.version+1`,
          [auth.organizationId, document.author_user_id, encrypted, hash, auth.user.id],
        );
        const cancelled = await client.query(
          `UPDATE inventory_document_signature_attempts SET status='CANCELED',updated_at=now() WHERE actor_user_id=$1 AND organization_id=$2 AND status IN ('PREPARING','AWAITING_SIGNATURE') RETURNING id,document_id`,
          [document.author_user_id, auth.organizationId],
        );
        for (const row of cancelled.rows)
          await event(
            client,
            { organization_id: auth.organizationId, id: row.document_id },
            auth.user.id!,
            "IDENTITY_CHANGED_ATTEMPT_CANCELED",
            {},
            row.id,
          );
        await event(client, document, auth.user.id!, "IDENTITY_VERIFIED", {
          userId: document.author_user_id,
        });
        await client.query("COMMIT");
        return Response.json({ data: { registered: true } }, { headers });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    if (!author)
      return fail(
        "Somente o autor individual do documento pode iniciar ou conferir a assinatura.",
        403,
      );
    if (data.action === "START") {
      if (!configured)
        return fail(
          configurationReason ?? "A integração de assinatura ainda não está configurada.",
          503,
        );
      if (!originMatches) return fail(configurationReason!, 409);
      if (!identityReady)
        return fail("A administração precisa conferir o CPF do autor antes da assinatura.", 409);
      if (!data.operationId) return fail("Identificador de envio inválido.", 400);
      const pdf = await renderClinicalDocumentPdf(document),
        id = randomUUID(),
        state = randomBytes(32).toString("base64url");
      const client = await pool.connect();
      let row;
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM inventory_encounter_documents WHERE id=$1 FOR UPDATE", [
          documentId,
        ]);
        const currentIdentity = (
          await client.query("SELECT * FROM inventory_signing_identities WHERE id=$1 FOR SHARE", [
            identity.id,
          ])
        ).rows[0];
        if (!currentIdentity || currentIdentity.version !== identity.version)
          throw new Error("IDENTITY_CHANGED");
        const previous = (
          await client.query(
            "SELECT * FROM inventory_document_signature_attempts WHERE organization_id=$1 AND operation_id=$2",
            [auth.organizationId, data.operationId],
          )
        ).rows[0];
        if (previous) {
          if (previous.document_id !== documentId || previous.actor_user_id !== auth.user.id)
            throw new Error("OPERATION_CONFLICT");
          await client.query("COMMIT");
          return Response.json(
            {
              data: {
                id: previous.id,
                status: previous.status,
                redirectUrl:
                  previous.status === "AWAITING_SIGNATURE" ? previous.redirect_url : undefined,
              },
            },
            { headers },
          );
        }
        const expiredRows = await client.query(
          `UPDATE inventory_document_signature_attempts SET status='EXPIRED',updated_at=now() WHERE document_id=$1 AND status IN ('PREPARING','AWAITING_SIGNATURE') AND expires_at<=now() RETURNING id`,
          [documentId],
        );
        for (const expiredRow of expiredRows.rows)
          await event(client, document, auth.user.id!, "EXPIRED", {}, expiredRow.id);
        const existing = (await client.query(latestSql, [documentId, auth.organizationId])).rows[0];
        if (existing && (active.includes(existing.status) || existing.status === "SIGNED"))
          throw new Error("ATTEMPT_EXISTS");
        row = (
          await client.query(
            `INSERT INTO inventory_document_signature_attempts(id,organization_id,unit_id,document_id,actor_user_id,identity_id,identity_version,cpf_encrypted,operation_id,source_pdf,source_sha256,state_hash,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '30 minutes') RETURNING *`,
            [
              id,
              auth.organizationId,
              document.unit_id,
              documentId,
              auth.user.id,
              identity.id,
              identity.version,
              identity.cpf_encrypted,
              data.operationId,
              pdf,
              signatureHash(pdf),
              signatureHash(state),
            ],
          )
        ).rows[0];
        await event(
          client,
          document,
          auth.user.id!,
          "STARTED",
          { sourceSha256: row.source_sha256 },
          id,
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      const returnUrl = new URL(`/atendimentos/${document.appointment_id}`, canonicalOrigin);
      returnUrl.searchParams.set("signatureDocumentId", documentId!);
      returnUrl.searchParams.set("signatureAttempt", row.id);
      returnUrl.searchParams.set("state", state);
      try {
        const remote = await createLacunaSignatureSession({
          pdfBytes: row.source_pdf,
          expectedSignerCpf: decryptSignerCpf(row.cpf_encrypted),
          returnUrl: returnUrl.href,
          callbackArgument: row.id,
        });
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const updated = await client.query(
            `UPDATE inventory_document_signature_attempts SET status='AWAITING_SIGNATURE',provider_session_id=$2,redirect_url=$3,updated_at=now() WHERE id=$1 AND status='PREPARING' RETURNING id`,
            [row.id, remote.sessionId, remote.redirectUrl],
          );
          if (!updated.rowCount) throw new Error("ATTEMPT_CLOSED");
          await event(client, document, auth.user.id!, "PROVIDER_SESSION_CREATED", {}, row.id);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
        return Response.json(
          { data: { id: row.id, redirectUrl: remote.redirectUrl } },
          { status: 201, headers },
        );
      } catch (e) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const changed = await client.query(
            `UPDATE inventory_document_signature_attempts SET status='FAILED',failure_code='provider_start',updated_at=now() WHERE id=$1 AND status='PREPARING' RETURNING id`,
            [row.id],
          );
          if (changed.rowCount)
            await event(
              client,
              document,
              auth.user.id!,
              "FAILED",
              { code: "provider_start" },
              row.id,
            );
          await client.query("COMMIT");
        } catch {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
        throw e;
      }
    }
    if (!data.attemptId) return fail("Tentativa inválida.", 400);
    const attempt = (
      await pool.query(
        "SELECT * FROM inventory_document_signature_attempts WHERE id=$1 AND document_id=$2 AND organization_id=$3 AND actor_user_id=$4",
        [data.attemptId, documentId, auth.organizationId, auth.user.id],
      )
    ).rows[0];
    if (!attempt) return fail("Tentativa não encontrada.", 404);
    if (data.action === "COMPLETE" && (data.state || data.signatureSessionId)) {
      if (
        !data.state ||
        !data.signatureSessionId ||
        signatureHash(data.state) !== attempt.state_hash ||
        data.signatureSessionId !== attempt.provider_session_id
      )
        return fail("Retorno de assinatura inválido.", 400);
    }
    if (attempt.status === "SIGNED")
      return Response.json({ data: { id: attempt.id, status: "SIGNED" } }, { headers });
    if (!active.includes(attempt.status))
      return fail("Esta tentativa já foi encerrada. Inicie uma nova assinatura.", 409);
    const update = async (status: string, extra: Record<string, unknown> = {}) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = (
          await client.query(
            "SELECT * FROM inventory_document_signature_attempts WHERE id=$1 FOR UPDATE",
            [attempt.id],
          )
        ).rows[0];
        if (!active.includes(current.status)) {
          await client.query("COMMIT");
          return current.status;
        }
        const result = await client.query(
          `UPDATE inventory_document_signature_attempts SET status=$2,signed_pdf=$3,signed_sha256=$4,signed_at=$5,certificate=$6,validation_evidence=$7,provider_document_id=$8,updated_at=now() WHERE id=$1 RETURNING status`,
          [
            attempt.id,
            status,
            extra["pdfBytes"] ?? null,
            extra["signedSha256"] ?? null,
            extra["signedAt"] ?? null,
            extra["certificate"] ?? null,
            extra["validationEvidence"] ?? null,
            extra["providerDocumentId"] ?? null,
          ],
        );
        await event(
          client,
          document,
          auth.user.id!,
          status,
          {
            ...(status === "SIGNED"
              ? { sourceSha256: attempt.source_sha256, signedSha256: extra["signedSha256"] }
              : {}),
          },
          attempt.id,
        );
        await client.query("COMMIT");
        return result.rows[0].status;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    };
    if (data.action === "CANCEL")
      return Response.json(
        { data: { id: attempt.id, status: await update("CANCELED") } },
        { headers },
      );
    if (new Date(attempt.expires_at).getTime() <= Date.now())
      return Response.json(
        { data: { id: attempt.id, status: await update("EXPIRED") } },
        { headers },
      );
    if (attempt.status === "PREPARING" || !attempt.provider_session_id)
      return fail("A sessão ainda está sendo preparada. Tente novamente.", 409);
    if (!configured) return fail("A integração de assinatura está indisponível.", 503);
    if (
      !identity ||
      identity.version !== attempt.identity_version ||
      identity.id !== attempt.identity_id
    )
      return fail("A identidade do signatário foi alterada. Inicie uma nova assinatura.", 409);
    if (signatureHash(attempt.source_pdf) !== attempt.source_sha256)
      throw new Error("STORAGE_INTEGRITY");
    const completed = await completeLacunaSignatureSession({
      sessionId: attempt.provider_session_id,
      expectedSignerCpf: decryptSignerCpf(attempt.cpf_encrypted),
      expectedOriginalSha256: attempt.source_sha256,
      callbackArgument: attempt.id,
    });
    if (completed.status === "pending")
      return Response.json({ data: { id: attempt.id, status: "AWAITING_SIGNATURE" } }, { headers });
    if (completed.status === "cancelled" || completed.status === "expired")
      return Response.json(
        {
          data: {
            id: attempt.id,
            status: await update(completed.status === "cancelled" ? "CANCELED" : "EXPIRED"),
          },
        },
        { headers },
      );
    if (completed.status !== "completed")
      return fail("Não foi possível validar a assinatura.", 422);
    const status = await update("SIGNED", {
      ...completed,
      signedSha256: signatureHash(completed.pdfBytes),
    });
    return Response.json({ data: { id: attempt.id, status } }, { headers });
  } catch (error) {
    if (error instanceof LacunaSignatureError)
      return fail(error.message, error.code === "validation_failed" ? 422 : 503);
    const code = error instanceof Error ? error.message : "";
    if (
      /^O PDF não suporta o caractere U\+[0-9A-F]+\. Revise o documento antes de assinar\.$/.test(
        code,
      )
    )
      return fail(code, 422);
    const messages: Record<string, [string, number]> = {
      CPF_INVALID: ["Confira o CPF do profissional.", 400],
      IDENTITY_CHANGED: ["A identidade mudou. Confira os dados antes de assinar.", 409],
      OPERATION_CONFLICT: ["Este identificador pertence a outra operação.", 409],
      ATTEMPT_EXISTS: [
        "Já existe uma assinatura ou tentativa em andamento para este documento.",
        409,
      ],
      ATTEMPT_CLOSED: ["Esta tentativa foi encerrada.", 409],
    };
    if (messages[code]) return fail(...messages[code]);
    if (typeof error === "object" && error && "code" in error && error.code === "23505")
      return fail("O CPF ou a tentativa já está associado a outro registro.", 409);
    console.error("document signature operation failed");
    return fail("Não foi possível concluir a operação de assinatura. Tente novamente.", 500);
  }
}
