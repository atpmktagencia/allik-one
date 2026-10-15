import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticate, can, hashToken } from "./auth";
import { getPool } from "./db";
import { documentSignaturesResponse } from "./document-signatures";
import { recordClinicalAccess } from "./clinical-access-audit";
const input = z.object({
  action: z.enum(["SEND_EMAIL", "PREPARE_WHATSAPP"]),
  documentId: z.string().uuid(),
  operationId: z.string().uuid(),
  confirmedRecipient: z.string().trim().max(254),
  allowUnsigned: z.boolean().default(false),
  confirmAmendments: z.boolean().default(false),
});
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const phone = (value: unknown) => {
  const raw = String(value ?? "").trim(),
    digits = raw.replace(/\D/g, "");
  return !raw.startsWith("+") && (digits.length === 10 || digits.length === 11)
    ? "55" + digits
    : digits;
};
function emailConfig() {
  const key = process.env["RESEND_API_KEY"],
    from = process.env["AUTH_EMAIL_FROM"];
  return key && from && !/[\r\n]/.test(from) ? { key, from } : null;
}
export async function documentDeliveryResponse(request: Request) {
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para enviar o documento.", 401);
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return fail("Use a conta profissional responsável para enviar a receita.", 403);
  const url = new URL(request.url);
  if (!["GET", "POST"].includes(request.method)) return fail("Método não permitido.", 405);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return fail("Origem não autorizada.", 403);
  let data: z.infer<typeof input> | null = null;
  if (request.method === "POST") {
    try {
      const parsed = input.safeParse(await request.json());
      if (!parsed.success) return fail("Confira os dados do envio.", 400);
      data = parsed.data;
    } catch {
      return fail("Requisição inválida.", 400);
    }
  }
  const documentId = data?.documentId ?? url.searchParams.get("documentId");
  if (!z.string().uuid().safeParse(documentId).success) return fail("Documento inválido.", 400);
  try {
    const result = await getPool().query(
      `SELECT d.id,d.organization_id,d.unit_id,d.patient_id,d.appointment_id,d.author_user_id,p.email,p.phone,
 EXISTS(SELECT 1 FROM inventory_clinical_document_amendments a JOIN inventory_encounter_documents child ON child.id=a.document_id WHERE a.parent_document_id=d.id AND child.status='FINAL') AS has_amendments,
 EXISTS(SELECT 1 FROM inventory_clinical_document_amendments ra JOIN inventory_encounter_documents rchild ON rchild.id=ra.document_id WHERE ra.parent_document_id=d.id AND ra.kind='RECTIFICATION' AND rchild.status='FINAL') AS rectified,p.consent_status,
 EXISTS(SELECT 1 FROM inventory_document_signature_attempts s WHERE s.document_id=d.id AND s.organization_id=d.organization_id AND s.status='SIGNED') AS signed
 FROM inventory_encounter_documents d JOIN inventory_patients p ON p.id=d.patient_id AND p.organization_id=d.organization_id
 WHERE d.id=$1 AND d.organization_id=$2 AND d.type='PRESCRIPTION' AND d.status='FINAL'`,
      [documentId, auth.organizationId],
    );
    const doc = result.rows[0];
    if (
      !doc ||
      doc.author_user_id !== auth.user.id ||
      !can(auth, "patients.private.read", doc.unit_id) ||
      !can(auth, "patients.clinical.manage", doc.unit_id)
    )
      return fail("Receita não encontrada ou envio não autorizado.", 404);
    const email = String(doc.email ?? "")
        .trim()
        .toLowerCase(),
      number = phone(doc.phone);
    if (request.method === "GET") {
      await recordClinicalAccess(auth, {
        unitId: doc.unit_id,
        patientId: doc.patient_id,
        appointmentId: doc.appointment_id,
        documentId: doc.id,
        action: "READ",
      });
      return Response.json(
        {
          data: {
            email,
            phone: number,
            emailAvailable: Boolean(emailConfig()),
            signed: doc.signed,
            hasAmendments: doc.has_amendments,
          },
        },
        { headers },
      );
    }
    if (!data) return fail("Requisição inválida.", 400);
    const recipient = data.action === "SEND_EMAIL" ? email : number;
    const confirmed =
      data.action === "SEND_EMAIL"
        ? data.confirmedRecipient.toLowerCase()
        : data.confirmedRecipient.replace(/\D/g, "");
    if (!recipient || confirmed !== recipient)
      return fail("O contato do paciente mudou. Confira o cadastro e abra o envio novamente.", 409);
    if (data.action === "SEND_EMAIL" && !z.string().email().safeParse(email).success)
      return fail("Cadastre um e-mail válido para o paciente.", 409);
    if (data.action === "PREPARE_WHATSAPP" && !/^\d{10,15}$/.test(number))
      return fail("Cadastre um telefone válido com DDD e código do país.", 409);
    if (doc.consent_status === "REVOKED")
      return fail("O paciente revogou o consentimento. Documentos não podem ser enviados.", 409);
    if (doc.rectified)
      return fail("Este documento foi substituído por uma retificação. Envie a retificação.", 409);
    if (doc.has_amendments && !data.confirmAmendments)
      return fail("Confira os adendos e retificações antes de enviar esta via.", 409);
    if (data.action === "SEND_EMAIL" && !emailConfig())
      return fail("O serviço de e-mail ainda não está configurado.", 503);
    const pdfUrl = new URL("/api/v1/inventory/document-signatures", url);
    pdfUrl.searchParams.set("documentId", doc.id);
    pdfUrl.searchParams.set("download", "true");
    let pdf = await documentSignaturesResponse(new Request(pdfUrl, { headers: request.headers }));
    let signed = true;
    if (pdf.status === 404) {
      signed = false;
      pdfUrl.searchParams.delete("download");
      pdfUrl.searchParams.set("source", "true");
      pdf = await documentSignaturesResponse(new Request(pdfUrl, { headers: request.headers }));
    }
    if (!pdf.ok) return fail("Não foi possível obter um PDF íntegro para envio.", 409);
    if (!signed && !data.allowUnsigned)
      return fail(
        "Este PDF não possui assinatura digital. Confirme o envio sem assinatura ou assine antes.",
        409,
      );
    const bytes = Buffer.from(await pdf.arrayBuffer()),
      pdfHash = createHash("sha256").update(bytes).digest("hex"),
      recipientHash = hashToken(recipient);
    const event = async (action: string, providerId: string | null = null) => {
      const inserted = await getPool().query(
        `INSERT INTO inventory_document_delivery_events(organization_id,unit_id,patient_id,document_id,actor_user_id,operation_id,action,recipient_hash,pdf_sha256,signed,provider_message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(operation_id,action) DO NOTHING RETURNING id`,
        [
          auth.organizationId,
          doc.unit_id,
          doc.patient_id,
          doc.id,
          auth.user.id,
          data!.operationId,
          action,
          recipientHash,
          pdfHash,
          signed,
          providerId,
        ],
      );
      if (!inserted.rowCount) {
        const stored = await getPool().query(
          "SELECT document_id,actor_user_id,recipient_hash,pdf_sha256 FROM inventory_document_delivery_events WHERE operation_id=$1 AND action=$2",
          [data!.operationId, action],
        );
        const prior = stored.rows[0];
        if (
          !prior ||
          prior.document_id !== doc.id ||
          prior.actor_user_id !== auth.user.id ||
          prior.recipient_hash !== recipientHash ||
          prior.pdf_sha256 !== pdfHash
        )
          throw new Error("DELIVERY_OPERATION_MISMATCH");
      }
    };
    if (data.action === "PREPARE_WHATSAPP") {
      await event("WHATSAPP_PREPARED");
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...headers,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="receita-${doc.id}.pdf"`,
          "X-Allik-Pdf-Signed": String(signed),
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    // Reserve one immutable intent before contacting the provider; never resend an ambiguous operation.
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        auth.organizationId + ":" + auth.user.id,
      ]);
      const previous = await client.query(
        "SELECT * FROM inventory_document_delivery_events WHERE operation_id=$1 ORDER BY created_at",
        [data.operationId],
      );
      if (previous.rowCount) {
        await client.query("ROLLBACK");
        if (
          previous.rows.every(
            (row) =>
              row.document_id === doc.id &&
              row.actor_user_id === auth.user.id &&
              row.recipient_hash === recipientHash &&
              row.pdf_sha256 === pdfHash,
          ) &&
          previous.rows.some((row) => row.action === "EMAIL_ACCEPTED")
        )
          return Response.json({ data: { status: "ACCEPTED", replayed: true } }, { headers });
        return fail(
          "Esta solicitação já foi registrada. Não repetimos um envio sem confirmação do resultado.",
          409,
        );
      }
      const duplicate = await client.query(
        "SELECT id FROM inventory_document_delivery_events WHERE document_id=$1 AND recipient_hash=$2 AND action='EMAIL_REQUESTED' AND created_at>now()-interval '2 minutes' AND NOT EXISTS(SELECT 1 FROM inventory_document_delivery_events failed WHERE failed.operation_id=inventory_document_delivery_events.operation_id AND failed.action='EMAIL_FAILED') LIMIT 1",
        [doc.id, recipientHash],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return fail(
          "Há uma solicitação recente para esta receita. Confira o resultado antes de reenviar.",
          429,
        );
      }
      const recent = await client.query(
        "SELECT count(*) FROM inventory_document_delivery_events WHERE organization_id=$1 AND actor_user_id=$2 AND action='EMAIL_REQUESTED' AND created_at>now()-interval '1 hour'",
        [auth.organizationId, auth.user.id],
      );
      if (Number(recent.rows[0].count) >= 10) {
        await client.query("ROLLBACK");
        return fail("Limite de envios atingido. Tente novamente mais tarde.", 429);
      }
      await client.query(
        `INSERT INTO inventory_document_delivery_events(organization_id,unit_id,patient_id,document_id,actor_user_id,operation_id,action,recipient_hash,pdf_sha256,signed) VALUES($1,$2,$3,$4,$5,$6,'EMAIL_REQUESTED',$7,$8,$9)`,
        [
          auth.organizationId,
          doc.unit_id,
          doc.patient_id,
          doc.id,
          auth.user.id,
          data.operationId,
          recipientHash,
          pdfHash,
          signed,
        ],
      );
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error("DELIVERY_RESERVATION_FAILED");
    } finally {
      client.release();
    }
    const config = emailConfig()!;
    let outcome = "EMAIL_UNCONFIRMED",
      providerId: string | null = null;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `clinical-document/${data.operationId}`,
        },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          from: config.from,
          to: [email],
          subject: signed
            ? "Documento do seu atendimento — Allik One"
            : "Documento sem assinatura digital — Allik One",
          text: signed
            ? "O documento do seu atendimento está anexado em PDF. Confira a assinatura no arquivo."
            : "O documento está anexado em PDF, ainda sem assinatura digital. A finalização no sistema não equivale a assinatura profissional.",
          attachments: [{ filename: `receita-${doc.id}.pdf`, content: bytes.toString("base64") }],
        }),
      });
      if (response.ok) {
        const body = await response.json();
        if (typeof body.id === "string" && body.id.length > 0 && body.id.length <= 200) {
          outcome = "EMAIL_ACCEPTED";
          providerId = body.id;
        }
      } else if (response.status < 500) outcome = "EMAIL_FAILED";
    } catch {
      /* No raw provider errors, tokens, recipient or PDF in logs. */
    }
    await event(outcome, providerId);
    return outcome === "EMAIL_ACCEPTED"
      ? Response.json({ data: { status: "ACCEPTED" } }, { headers })
      : fail(
          outcome === "EMAIL_FAILED"
            ? "O serviço recusou o envio. Confira os dados e reabra esta janela para uma nova tentativa."
            : "Não foi possível confirmar o envio. Não repetimos automaticamente esta solicitação.",
          503,
        );
  } catch {
    console.error("CLINICAL_DOCUMENT_DELIVERY_FAILED");
    return fail(
      "Não foi possível concluir o envio. Confira o resultado antes de tentar novamente.",
      503,
    );
  }
}
