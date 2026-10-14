import { recordClinicalAccess } from "./clinical-access-audit";
import { canWriteClinicalDocument, hasClinicalRegistration } from "./clinical-professional-policy";
import { renderClinicalDocumentPdf } from "./clinical-document-pdf";
import "@tanstack/react-start/server-only";
import { z } from "zod";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import {
  documentTypes,
  richContentSchema,
  richContentText,
} from "../lib/clinical-document-content";

import { prescriptionPrintDataSchema, patientPrintDefaults } from "../lib/prescription-print-data";
import { renderClinicalDocumentPrint } from "./clinical-document-print";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuid = z.string().uuid();
const input = z.object({
  action: z.enum(["SAVE_DRAFT", "FINALIZE", "SAVE_TEMPLATE"]),
  appointmentId: uuid,
  documentId: uuid.nullable().default(null),
  type: z.enum(documentTypes),
  title: z.string().trim().min(2).max(200),
  content: z.string().trim().max(30000),
  richContent: richContentSchema.nullable().default(null),
  twoCopies: z.boolean().default(false),
  prescriptionPrintData: prescriptionPrintDataSchema.nullable().default(null),
  version: z.number().int().nonnegative().nullable().default(null),
});
const fields = `id,type,title,content,rich_content AS "richContent",two_copies AS "twoCopies",prescription_print_data AS "prescriptionPrintData",status,version,
  CASE WHEN final_snapshot IS NOT NULL THEN final_snapshot->>'authorName' ELSE author_name END AS "authorName",
  CASE WHEN final_snapshot IS NOT NULL THEN final_snapshot->>'professionalCouncil' ELSE professional_council END AS "professionalCouncil",
  CASE WHEN final_snapshot IS NOT NULL THEN final_snapshot->>'councilNumber' ELSE council_number END AS "councilNumber",
  CASE WHEN final_snapshot IS NOT NULL THEN final_snapshot->>'councilRegion' ELSE council_region END AS "councilRegion",finalized_at AS "finalizedAt",updated_at AS "updatedAt"`;
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
      if (
        doc.status !== "FINAL" &&
        !(
          url.searchParams.get("preview") === "true" &&
          auth.user.id === doc.author_user_id &&
          !auth.preview &&
          !auth.integration
        )
      )
        return fail("Finalize o documento antes de imprimir.", 409);
      const html = renderClinicalDocumentPrint(doc);
      await recordClinicalAccess(auth, {
        unitId: doc.unit_id,
        patientId: doc.patient_id,
        appointmentId: doc.appointment_id,
        documentId: doc.id,
        action: "PRINT",
      });
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
      `SELECT a.*,u.professional_council,u.council_number,u.council_region,p.full_name,p.birth_date::text,p.document_number,p.additional_data, p.private_data,n.name AS unit_name
      FROM inventory_care_appointments a JOIN inventory_users u ON u.id=a.professional_user_id
      JOIN inventory_patients p ON p.id=a.patient_id AND p.organization_id=a.organization_id
      JOIN inventory_units n ON n.id=a.unit_id AND n.organization_id=a.organization_id
      WHERE a.id=$1 AND a.organization_id=$2`,
      [appointmentId, auth.organizationId],
    );
    const appointment = result.rows[0];
    if (!appointment || !can(auth, "patients.private.read", appointment.unit_id))
      return fail("Atendimento não encontrado.", 404);
    const [documents, templates] = await Promise.all([
      getPool().query(
        `SELECT ${fields},author_user_id FROM inventory_encounter_documents WHERE appointment_id=$1 AND organization_id=$2 AND (status='FINAL' OR author_user_id=$3) ORDER BY created_at,id`,
        [appointmentId, auth.organizationId, auth.user.id],
      ),
      getPool().query(
        `SELECT id,type,title,content,rich_content AS "richContent",two_copies AS "twoCopies" FROM inventory_clinical_document_templates WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY lower(title),id`,
        [auth.organizationId, auth.user.id ?? null],
      ),
    ]);
    const canAuthor = Boolean(
      auth.user.id &&
      !auth.preview &&
      !auth.integration &&
      auth.user.id === appointment.professional_user_id &&
      hasClinicalRegistration(appointment) &&
      !["NO_SHOW", "CANCELED"].includes(appointment.status) &&
      can(auth, "patients.clinical.manage", appointment.unit_id),
    );
    await recordClinicalAccess(auth, {
      unitId: appointment.unit_id,
      patientId: appointment.patient_id,
      appointmentId: appointment.id,
      action: "READ",
      resourceIds: documents.rows.map((d) => d.id),
    });
    return Response.json(
      {
        data: {
          allowedDocumentTypes: canAuthor
            ? documentTypes.filter((t) =>
                canWriteClinicalDocument(appointment.professional_council, t),
              )
            : [],
          documents: documents.rows.map(({ author_user_id, ...document }) => ({
            ...document,
            canEdit: Boolean(
              canAuthor &&
              author_user_id === auth.user.id &&
              document.status === "DRAFT" &&
              canWriteClinicalDocument(appointment.professional_council, document.type),
            ),
          })),
          context: {
            patientName: appointment.full_name,
            prescriptionPrintData: patientPrintDefaults(appointment),
            birthDate: appointment.birth_date,
            unitName: appointment.unit_name,
            allergies:
              Array.isArray(appointment.private_data?.allergies) &&
              appointment.private_data.allergies.length
                ? appointment.private_data.allergies
                : null,
          },
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
  if (data.twoCopies && data.type !== "PRESCRIPTION")
    return fail("Duas vias estão disponíveis somente para receitas.", 400);
  if (data.prescriptionPrintData && data.type !== "PRESCRIPTION")
    return fail("Dados de receita estão disponíveis somente para receitas.", 400);
  if (data.prescriptionPrintData && data.prescriptionPrintData.kind !== "SIMPLE")
    data.twoCopies = true;
  if (data.richContent) data.content = richContentText(data.richContent).trim();
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
    if (
      !hasClinicalRegistration(appointment) ||
      !canWriteClinicalDocument(appointment.professional_council, data.type)
    )
      throw new Error("PROFESSIONAL_SCOPE");
    if (["NO_SHOW", "CANCELED"].includes(appointment.status)) throw new Error("TERMINAL");
    if (data.action === "SAVE_TEMPLATE") {
      const saved = await client.query(
        `INSERT INTO inventory_clinical_document_templates(organization_id,owner_user_id,type,title,content,rich_content,two_copies)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          auth.organizationId,
          auth.user.id,
          data.type,
          data.title,
          data.content,
          data.richContent,
          data.twoCopies,
        ],
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
    let finalSnapshot = null;
    if (final) {
      const identities = await client.query(
        `SELECT p.full_name,p.internal_code,n.name AS unit_name,u.name AS author_name,
          u.professional_council,u.council_number,u.council_region,transaction_timestamp() AS finalized_at
         FROM inventory_patients p JOIN inventory_units n ON n.id=$2 AND n.organization_id=$4
         JOIN inventory_users u ON u.id=$3
         WHERE p.id=$1 AND p.organization_id=$4 FOR SHARE OF p,n,u`,
        [appointment.patient_id, appointment.unit_id, auth.user.id, auth.organizationId],
      );
      const identity = identities.rows[0];
      if (!identity) throw new Error("NOT_FOUND");
      if (!identity.professional_council || !identity.council_number || !identity.council_region)
        throw new Error("COUNCIL");
      finalSnapshot = {
        snapshotVersion: 1,
        patientName: identity.full_name,
        patientCode: identity.internal_code,
        unitName: identity.unit_name,
        authorName: identity.author_name,
        professionalCouncil: identity.professional_council,
        councilNumber: identity.council_number,
        councilRegion: identity.council_region,
        title: data.title,
        type: data.type,
        content: data.content,
        richContent: data.richContent,
        twoCopies: data.twoCopies,
        prescriptionPrintData: data.prescriptionPrintData,
        finalizedAt: identity.finalized_at.toISOString(),
      };
    }
    // Fail before making an unrenderable document immutable.
    if (finalSnapshot)
      await renderClinicalDocumentPdf({ status: "FINAL", final_snapshot: finalSnapshot });
    const saved = previous
      ? await client.query(
          `UPDATE inventory_encounter_documents SET title=$2,content=$3,status=$4,version=version+1,updated_at=now(),final_snapshot=$5,rich_content=$6,two_copies=$7,prescription_print_data=$8,finalized_at=CASE WHEN $4='FINAL' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
          [
            previous.id,
            data.title,
            data.content,
            final ? "FINAL" : "DRAFT",
            finalSnapshot,
            data.richContent,
            data.twoCopies,
            data.prescriptionPrintData,
          ],
        )
      : await client.query(
          `INSERT INTO inventory_encounter_documents(organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status,finalized_at,final_snapshot,rich_content,two_copies,prescription_print_data)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $13='FINAL' THEN now() ELSE NULL END,$14,$15,$16,$17) RETURNING *`,
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
            finalSnapshot,
            data.richContent,
            data.twoCopies,
            data.prescriptionPrintData,
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
    if (
      /^O PDF não suporta o caractere U\+[0-9A-F]+\. Revise o documento antes de assinar\.$/.test(
        reason,
      )
    )
      return fail(reason, 422);
    const messages: Record<string, [string, number]> = {
      PROFESSIONAL_SCOPE: [
        "Este tipo de documento não está disponível para seu registro profissional.",
        403,
      ],
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
