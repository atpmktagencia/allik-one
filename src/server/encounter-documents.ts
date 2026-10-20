import {
  clinicalDocumentArtifact,
  clinicalRendererVersion,
  persistClinicalDocumentArtifact,
} from "./clinical-document-artifacts";
import { appendIntegrationEvent } from "./integration-events";
import { hasPrescriberContact, prescriberPrintDefaults } from "../lib/prescriber-contact";
import { randomUUID } from "node:crypto";
import { verifyClinicalDocumentResponse } from "./clinical-document-verification";
import { documentVerificationCode } from "../lib/clinical-document-identity";
import { patientAllergySummary } from "./patient-allergies";
import { integrityFields, verifiedDocumentIntegrity } from "./clinical-document-integrity";
import { recordClinicalAccess } from "./clinical-access-audit";
import {
  professionalRegistryConflictResponse,
  canWriteClinicalDocument,
  hasClinicalRegistration,
} from "./clinical-professional-policy";
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
  action: z.enum(["SAVE_DRAFT", "FINALIZE", "SAVE_TEMPLATE", "CREATE_AMENDMENT", "DISCARD_DRAFT"]),
  amendmentKind: z.enum(["ADDENDUM", "RECTIFICATION"]).nullable().default(null),
  amendmentReason: z.string().trim().max(2000).default(""),
  appointmentId: uuid,
  documentId: uuid.nullable().default(null),
  creationId: uuid.nullable().default(null),
  type: z.enum(documentTypes),
  title: z.string().trim().min(2).max(200),
  content: z.string().trim().max(30000),
  richContent: richContentSchema.nullable().default(null),
  twoCopies: z.boolean().default(false),
  prescriptionPrintData: prescriptionPrintDataSchema.nullable().default(null),
  prescriptionSource: z
    .object({
      prescriptionId: uuid,
      version: z.number().int().nonnegative(),
      updatedAt: z.string().datetime(),
    })
    .nullable()
    .default(null),
  version: z.number().int().nonnegative().nullable().default(null),
});
const fields = `EXISTS(SELECT 1 FROM inventory_clinical_document_artifacts WHERE document_id=inventory_encounter_documents.id) AS "artifactPreserved",CASE WHEN status='FINAL' THEN jsonb_build_object('patientName',final_snapshot->>'patientName','unitName',final_snapshot->>'unitName','title',final_snapshot->>'title','content',final_snapshot->>'content','authorName',final_snapshot->>'authorName','professionalCouncil',final_snapshot->>'professionalCouncil','councilNumber',final_snapshot->>'councilNumber','councilRegion',final_snapshot->>'councilRegion') END AS "finalPreview",${integrityFields},CASE WHEN final_snapshot->>'documentId'=id::text THEN 'A1-'||upper(id::text) END AS "verificationCode",id,type,title,content,rich_content AS "richContent",two_copies AS "twoCopies",prescription_print_data AS "prescriptionPrintData",status,version,
  CASE WHEN final_snapshot IS NOT NULL THEN final_snapshot->>'authorName' ELSE author_name END AS "authorName",
  CASE WHEN final_snapshot IS NOT NULL THEN final_snapshot->>'professionalCouncil' ELSE professional_council END AS "professionalCouncil",
  CASE WHEN final_snapshot IS NOT NULL THEN final_snapshot->>'councilNumber' ELSE council_number END AS "councilNumber",
  CASE WHEN final_snapshot IS NOT NULL THEN final_snapshot->>'councilRegion' ELSE council_region END AS "councilRegion",prescription_source AS "prescriptionSource",finalized_at AS "finalizedAt",updated_at AS "updatedAt"`;
export async function encounterDocumentsResponse(request: Request) {
  if (request.method === "GET" && new URL(request.url).searchParams.has("verify"))
    return verifyClinicalDocumentResponse(request);
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
        `SELECT d.*,p.full_name,p.internal_code,p.primary_unit_id AS patient_current_unit_id,u.name AS unit_name,
        (SELECT jsonb_build_object('parentDocumentId',a.parent_document_id,'kind',a.kind,'reason',a.reason,'parentSha256',a.parent_sha256) FROM inventory_clinical_document_amendments a WHERE a.document_id=d.id) AS amendment,
        (SELECT 'A1-'||upper(rchild.id::text) FROM inventory_clinical_document_amendments ra JOIN inventory_encounter_documents rchild ON rchild.id=ra.document_id
          WHERE ra.parent_document_id=d.id AND ra.kind='RECTIFICATION' AND rchild.status='FINAL' ORDER BY rchild.finalized_at DESC,rchild.id DESC LIMIT 1) AS rectified_by
        FROM inventory_encounter_documents d JOIN inventory_patients p ON p.id=d.patient_id AND p.organization_id=d.organization_id
        JOIN inventory_units u ON u.id=d.unit_id WHERE d.id=$1 AND d.organization_id=$2`,
        [documentId, auth.organizationId],
      );
      const doc = result.rows[0];
      if (
        !doc ||
        doc.discarded_at ||
        !can(auth, "patients.private.read", doc.unit_id) ||
        !can(auth, "patients.private.read", doc.patient_current_unit_id)
      )
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
      if (
        doc.status === "FINAL" &&
        doc.final_snapshot &&
        !(await verifiedDocumentIntegrity(doc.id))
      )
        return fail("Não foi possível verificar a integridade deste documento.", 409);
      let artifact;
      try {
        artifact = doc.status === "FINAL" ? await clinicalDocumentArtifact(doc) : null;
      } catch {
        return fail("Não foi possível verificar a integridade do arquivo final.", 409);
      }
      // The immutable original is retained; a supersession warning is a live safety overlay.
      let html = artifact ? artifact.html : renderClinicalDocumentPrint(doc);
      if (doc.rectified_by && artifact) {
        // Only this live administrative warning changes; the stored original stays byte-identical.
        const notice = renderClinicalDocumentPrint(doc).match(
          /<div class="warning superseded">[\s\S]*?<\/div>/,
        )?.[0];
        if (!notice) return fail("Não foi possível identificar a retificação vigente.", 409);
        html = html.replace("<body>", `<body>${notice}`);
      }
      if (doc.status === "FINAL" && !artifact)
        html = html.replace(
          "</footer>",
          '<p class="notice">Documento legado: snapshot preservado; esta apresentação foi regenerada pelo renderizador atual. Os bytes originais não foram arquivados na finalização.</p></footer>',
        );
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
          "X-Allik-Artifact":
            doc.status !== "FINAL"
              ? "draft-preview"
              : artifact
                ? doc.rectified_by
                  ? "preserved-with-supersession-notice"
                  : "preserved"
                : "legacy-regenerated",
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
      `SELECT a.*,u.professional_council,u.council_number,u.council_region,u.prescribing_address,u.prescribing_city,u.prescribing_state,u.prescribing_phone,p.full_name,p.birth_date::text,p.document_number,p.additional_data, p.private_data,p.primary_unit_id AS patient_current_unit_id,n.name AS unit_name
      FROM inventory_care_appointments a JOIN inventory_users u ON u.id=a.professional_user_id
      JOIN inventory_patients p ON p.id=a.patient_id AND p.organization_id=a.organization_id
      JOIN inventory_units n ON n.id=a.unit_id AND n.organization_id=a.organization_id
      WHERE a.id=$1 AND a.organization_id=$2`,
      [appointmentId, auth.organizationId],
    );
    const appointment = result.rows[0];
    if (
      !appointment ||
      !can(auth, "patients.private.read", appointment.unit_id) ||
      !can(auth, "patients.private.read", appointment.patient_current_unit_id)
    )
      return fail("Atendimento não encontrado.", 404);
    const [documents, templates] = await Promise.all([
      getPool().query(
        `SELECT ${fields},author_user_id FROM inventory_encounter_documents WHERE appointment_id=$1 AND organization_id=$2 AND discarded_at IS NULL AND (status='FINAL' OR author_user_id=$3) ORDER BY created_at,id`,
        [appointmentId, auth.organizationId, auth.user.id],
      ),
      getPool().query(
        `SELECT id,type,title,content,rich_content AS "richContent",two_copies AS "twoCopies" FROM inventory_clinical_document_templates WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY lower(title),id`,
        [auth.organizationId, auth.user.id ?? null],
      ),
    ]);
    const allergySummary = await patientAllergySummary(
      auth,
      String(appointment.patient_id),
      String(appointment.unit_id),
    );
    const canOperate = Boolean(
      auth.user.id &&
      !auth.preview &&
      !auth.integration &&
      auth.user.id === appointment.professional_user_id &&
      hasClinicalRegistration(appointment) &&
      !["NO_SHOW", "CANCELED"].includes(appointment.status) &&
      can(auth, "patients.clinical.manage", appointment.unit_id),
    );
    const canAuthor = canOperate && appointment.status !== "COMPLETED";
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
          allowedDocumentTypes: canOperate
            ? documentTypes.filter((t) =>
                canWriteClinicalDocument(appointment.professional_council, t),
              )
            : [],
          documents: documents.rows.map(({ author_user_id, ...document }) => ({
            ...document,
            canShare: Boolean(
              canOperate &&
              author_user_id === auth.user.id &&
              document.status === "FINAL" &&
              document.type === "PRESCRIPTION" &&
              document.integrityVerified,
            ),
            canAmend: Boolean(
              canOperate &&
              author_user_id === auth.user.id &&
              document.status === "FINAL" &&
              document.integrityVerified &&
              !document.amendment &&
              canWriteClinicalDocument(appointment.professional_council, document.type),
            ),
            canEdit: Boolean(
              canOperate &&
              author_user_id === auth.user.id &&
              document.status === "DRAFT" &&
              (appointment.status !== "COMPLETED" || Boolean(document.amendment)) &&
              canWriteClinicalDocument(appointment.professional_council, document.type),
            ),
          })),
          context: {
            patientName: appointment.full_name,
            prescriptionPrintData: {
              ...patientPrintDefaults(appointment),
              ...prescriberPrintDefaults(appointment),
            },
            birthDate: appointment.birth_date,
            unitName: appointment.unit_name,
            allergySummary,
            allergies:
              allergySummary.status === "DENIED"
                ? []
                : allergySummary.allergies.length
                  ? allergySummary.allergies
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
  if (!["SAVE_DRAFT", "CREATE_AMENDMENT", "DISCARD_DRAFT"].includes(data.action) && !data.content)
    return fail("Informe o conteúdo antes de finalizar ou salvar um modelo.", 400);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT a.*,p.primary_unit_id AS patient_current_unit_id,u.name AS author_name,u.professional_council,u.council_number,u.council_region,u.prescribing_address,u.prescribing_city,u.prescribing_state,u.prescribing_phone
      FROM inventory_care_appointments a JOIN inventory_users u ON u.id=a.professional_user_id
      JOIN inventory_patients p ON p.id=a.patient_id AND p.organization_id=a.organization_id
      WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a`,
      [data.appointmentId, auth.organizationId],
    );
    const appointment = result.rows[0];
    if (
      !appointment ||
      !can(auth, "patients.clinical.manage", appointment.unit_id) ||
      !can(auth, "patients.private.read", appointment.patient_current_unit_id)
    )
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
    if (appointment.status === "COMPLETED" && data.action !== "CREATE_AMENDMENT") {
      // A closed encounter accepts only an explicit, independently audited amendment.
      // Ordinary drafts, new documents and template creation stay closed.
      if (!data.documentId || !["SAVE_DRAFT", "FINALIZE"].includes(data.action))
        throw new Error("TERMINAL");
      const linked = await client.query(
        `SELECT 1 FROM inventory_encounter_documents child
         JOIN inventory_clinical_document_amendments a ON a.document_id=child.id
         JOIN inventory_encounter_documents parent ON parent.id=a.parent_document_id
         JOIN inventory_clinical_document_seals s ON s.document_id=parent.id
         WHERE child.id=$1 AND child.appointment_id=$2 AND child.organization_id=$3 AND child.author_user_id=$4 AND child.status='DRAFT'
           AND parent.status='FINAL' AND parent.organization_id=child.organization_id AND parent.appointment_id=child.appointment_id
           AND parent.patient_id=child.patient_id AND parent.unit_id=child.unit_id AND parent.author_user_id=child.author_user_id
           AND s.content_sha256=a.parent_sha256 AND s.content_sha256=encode(sha256(convert_to(parent.final_snapshot::text,'UTF8')),'hex')
         FOR SHARE OF parent`,
        [data.documentId, data.appointmentId, auth.organizationId, auth.user.id],
      );
      if (!linked.rowCount) throw new Error("TERMINAL");
    }
    if (
      data.type === "PRESCRIPTION" &&
      data.action !== "SAVE_TEMPLATE" &&
      data.prescriptionPrintData
    ) {
      const source = prescriberPrintDefaults(appointment);
      if (
        data.action !== "CREATE_AMENDMENT" &&
        Object.entries(source).some(
          ([key, value]) => data.prescriptionPrintData![key as keyof typeof source] !== value,
        )
      )
        throw new Error("PRESCRIBER_IDENTITY_CHANGED");
      data.prescriptionPrintData = { ...data.prescriptionPrintData, ...source };
    }
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
    if (data.creationId && !data.documentId && data.action === "SAVE_DRAFT") {
      const retry = (
        await client.query(
          `SELECT id,organization_id,appointment_id,author_user_id,type,status,version,discarded_at,
            (content=$2 AND rich_content IS NOT DISTINCT FROM $3::jsonb AND two_copies=$4 AND prescription_print_data IS NOT DISTINCT FROM $5::jsonb) AS same_creation
           FROM inventory_encounter_documents WHERE id=$1 FOR UPDATE`,
          [
            data.creationId,
            data.content,
            data.richContent,
            data.twoCopies,
            data.prescriptionPrintData,
          ],
        )
      ).rows[0];
      if (retry) {
        if (
          retry.organization_id !== auth.organizationId ||
          retry.appointment_id !== data.appointmentId ||
          retry.author_user_id !== auth.user.id ||
          retry.type !== data.type
        )
          throw new Error("NOT_FOUND");
        if (retry.discarded_at) throw new Error("DISCARDED");
        if (!retry.same_creation) throw new Error("STALE");
        await client.query("COMMIT");
        return Response.json(
          { data: { id: retry.id, status: retry.status, version: retry.version } },
          { headers },
        );
      }
    }
    let previous = data.documentId
      ? (
          await client.query(
            `SELECT * FROM inventory_encounter_documents WHERE id=$1 AND appointment_id=$2 AND organization_id=$3 FOR UPDATE`,
            [data.documentId, data.appointmentId, auth.organizationId],
          )
        ).rows[0]
      : null;
    if (data.documentId && !previous) throw new Error("NOT_FOUND");
    if (previous && previous.author_user_id !== auth.user.id) throw new Error("NOT_AUTHOR");
    if (data.action === "DISCARD_DRAFT") {
      if (!previous) throw new Error("NOT_FOUND");
      if (previous.status !== "DRAFT") throw new Error("FINAL");
      if (previous.type !== data.type) throw new Error("TYPE");
      if (
        (
          await client.query(
            "SELECT 1 FROM inventory_clinical_document_amendments WHERE document_id=$1",
            [previous.id],
          )
        ).rowCount
      )
        throw new Error("AMENDMENT_DRAFT");
      if (previous.discarded_at && previous.version === (data.version ?? -2) + 1) {
        await client.query("COMMIT");
        return Response.json({ data: { id: previous.id, version: previous.version } }, { headers });
      }
      if (previous.discarded_at) throw new Error("DISCARDED");
      if (previous.version !== data.version) throw new Error("STALE");
      const discarded = (
        await client.query(
          "UPDATE inventory_encounter_documents SET discarded_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [previous.id],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO inventory_encounter_document_changes(organization_id,document_id,action,before_data,after_data,actor_user_id) VALUES($1,$2,'DISCARD',$3,$4,$5)",
        [auth.organizationId, previous.id, previous, discarded, auth.user.id],
      );
      await client.query("COMMIT");
      return Response.json({ data: { id: previous.id, version: discarded.version } }, { headers });
    }
    if (previous?.discarded_at) throw new Error("DISCARDED");

    let amendmentSource: { id: string; hash: string } | null = null;
    if (data.action === "CREATE_AMENDMENT") {
      if (
        !previous ||
        previous.status !== "FINAL" ||
        previous.type !== data.type ||
        previous.version !== data.version ||
        !data.amendmentKind ||
        data.amendmentReason.length < 5
      )
        throw new Error("AMENDMENT");
      const source = await client.query(
        `SELECT s.content_sha256 FROM inventory_clinical_document_seals s WHERE document_id=$1 AND s.content_sha256=encode(sha256(convert_to($2::jsonb::text,'UTF8')),'hex') AND NOT EXISTS(SELECT 1 FROM inventory_clinical_document_amendments WHERE document_id=$1)`,
        [previous.id, previous.final_snapshot],
      );
      if (!source.rowCount) throw new Error("AMENDMENT");
      if (data.amendmentKind === "RECTIFICATION") {
        const sibling = await client.query(
          `SELECT 1 FROM inventory_clinical_document_amendments WHERE parent_document_id=$1 AND kind='RECTIFICATION' LIMIT 1`,
          [previous.id],
        );
        if (sibling.rowCount) throw new Error("RECTIFICATION_EXISTS");
      }
      amendmentSource = { id: previous.id, hash: source.rows[0].content_sha256 };
      previous = null;
      data.version = null;
      data.content = "";
      data.richContent = null;
    }
    if (previous?.status === "FINAL") throw new Error("FINAL");
    if ((previous ? Number(previous.version) : null) !== data.version) throw new Error("STALE");
    if (previous && previous.type !== data.type) throw new Error("TYPE");
    let prescriptionSource = null;
    const priorSource = previous?.prescription_source;
    if (
      data.prescriptionSource &&
      priorSource?.snapshot &&
      priorSource.relationship === "INDEPENDENT_DOCUMENT_REVIEW_REQUIRED" &&
      priorSource.prescriptionId === data.prescriptionSource.prescriptionId &&
      priorSource.version === data.prescriptionSource.version &&
      priorSource.updatedAt === data.prescriptionSource.updatedAt
    ) {
      // Preserve the independently reviewed historical origin; a later therapeutic revision
      // cannot silently synchronize or invalidate this document's canonical source snapshot.
      prescriptionSource = priorSource;
    } else if (data.prescriptionSource) {
      if (data.type !== "PRESCRIPTION") throw new Error("PRESCRIPTION_SOURCE");
      const sourceResult = await client.query(
        `SELECT id,items,general_instructions,status,version,updated_at,author_user_id FROM inventory_encounter_prescriptions WHERE id=$1 AND appointment_id=$2 AND organization_id=$3 AND patient_id=$4 FOR SHARE`,
        [
          data.prescriptionSource.prescriptionId,
          data.appointmentId,
          auth.organizationId,
          appointment.patient_id,
        ],
      );
      const source = sourceResult.rows[0];
      if (
        !source ||
        source.author_user_id !== auth.user.id ||
        source.version !== data.prescriptionSource.version ||
        new Date(source.updated_at).toISOString() !== data.prescriptionSource.updatedAt
      )
        throw new Error("PRESCRIPTION_SOURCE");
      prescriptionSource = {
        ...data.prescriptionSource,
        snapshot: {
          items: source.items,
          generalInstructions: source.general_instructions,
          status: source.status,
        },
        relationship: "INDEPENDENT_DOCUMENT_REVIEW_REQUIRED",
      };
    }
    const documentId =
      previous?.id ??
      (data.action === "SAVE_DRAFT" && !data.documentId ? data.creationId : null) ??
      randomUUID();
    const final = data.action === "FINALIZE";
    let finalSnapshot = null;
    if (final) {
      const identities = await client.query(
        `SELECT p.full_name,p.internal_code,p.document_type,p.document_number,p.birth_date::text,p.additional_data,n.name AS unit_name,u.name AS author_name,
          u.professional_council,u.council_number,u.council_region,u.prescribing_address,u.prescribing_city,u.prescribing_state,u.prescribing_phone,transaction_timestamp() AS finalized_at
         FROM inventory_patients p JOIN inventory_units n ON n.id=$2 AND n.organization_id=$4
         JOIN inventory_users u ON u.id=$3
         WHERE p.id=$1 AND p.organization_id=$4 FOR SHARE OF p,n,u`,
        [appointment.patient_id, appointment.unit_id, auth.user.id, auth.organizationId],
      );
      const identity = identities.rows[0];
      if (!identity) throw new Error("NOT_FOUND");
      if (!identity.professional_council || !identity.council_number || !identity.council_region)
        throw new Error("COUNCIL");
      const amendment = previous
        ? (
            await client.query(
              `SELECT jsonb_build_object('parentDocumentId',parent_document_id,'kind',kind,'reason',reason,'parentSha256',parent_sha256) AS metadata FROM inventory_clinical_document_amendments WHERE document_id=$1`,
              [previous.id],
            )
          ).rows[0]?.metadata
        : undefined;
      if (amendment?.kind === "RECTIFICATION") {
        // All siblings serialize through their original even for legacy drafts.
        await client.query("SELECT id FROM inventory_encounter_documents WHERE id=$1 FOR UPDATE", [
          amendment.parentDocumentId,
        ]);
        const sibling = await client.query(
          `SELECT 1 FROM inventory_clinical_document_amendments a JOIN inventory_encounter_documents d ON d.id=a.document_id WHERE a.parent_document_id=$1 AND a.kind='RECTIFICATION' AND d.id<>$2 AND d.status='FINAL' LIMIT 1`,
          [amendment.parentDocumentId, previous!.id],
        );
        if (sibling.rowCount) throw new Error("RECTIFICATION_EXISTS");
      }
      const canonicalPatient = patientPrintDefaults(identity, identity.finalized_at);
      if (data.type === "PRESCRIPTION") {
        if (!hasPrescriberContact(identity)) throw new Error("PRESCRIBER_CONTACT_REQUIRED");
        const canonicalPrescriber = prescriberPrintDefaults(identity);
        if (
          data.prescriptionPrintData &&
          Object.entries(canonicalPrescriber).some(
            ([key, value]) =>
              data.prescriptionPrintData![key as keyof typeof canonicalPrescriber] !== value,
          )
        )
          throw new Error("PRESCRIBER_IDENTITY_CHANGED");
        if (
          data.prescriptionPrintData &&
          (data.prescriptionPrintData.patientDocument !== canonicalPatient.patientDocument ||
            data.prescriptionPrintData.patientAddress !== canonicalPatient.patientAddress ||
            data.prescriptionPrintData.patientAge !== canonicalPatient.patientAge)
        )
          throw new Error("PATIENT_IDENTITY_CHANGED");
        data.prescriptionPrintData = {
          ...(data.prescriptionPrintData ?? canonicalPatient),
          ...canonicalPrescriber,
          patientDocument: canonicalPatient.patientDocument,
          patientAddress: canonicalPatient.patientAddress,
          patientAge: canonicalPatient.patientAge,
        };
      }
      finalSnapshot = {
        ...(process.env["CLINICAL_SIGNATURE_MODE"] === "MANUSCRIPT"
          ? { signatureMode: "MANUSCRIPT" }
          : {}),
        documentId,
        verificationCode: documentVerificationCode(documentId),
        patientIdentity: {
          documentType: identity.document_type,
          documentNumber: canonicalPatient.patientDocument,
          birthDate: identity.birth_date,
          address: canonicalPatient.patientAddress,
        },
        ...(amendment ? { amendment } : {}),
        snapshotVersion: 1,
        rendererVersion: clinicalRendererVersion,
        ...(prescriptionSource ? { prescriptionSource } : {}),
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
    const finalPdf = finalSnapshot
      ? await renderClinicalDocumentPdf({ status: "FINAL", final_snapshot: finalSnapshot })
      : null;
    const saved = previous
      ? await client.query(
          `UPDATE inventory_encounter_documents SET title=$2,content=$3,status=$4,version=version+1,updated_at=now(),final_snapshot=$5,rich_content=$6,two_copies=$7,prescription_print_data=$8,prescription_source=$9,finalized_at=CASE WHEN $4='FINAL' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
          [
            previous.id,
            data.title,
            data.content,
            final ? "FINAL" : "DRAFT",
            finalSnapshot,
            data.richContent,
            data.twoCopies,
            data.prescriptionPrintData,
            prescriptionSource,
          ],
        )
      : await client.query(
          `INSERT INTO inventory_encounter_documents(organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status,finalized_at,final_snapshot,rich_content,two_copies,prescription_print_data,id,prescription_source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $13='FINAL' THEN now() ELSE NULL END,$14,$15,$16,$17,$18,$19) RETURNING *`,
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
            documentId,
            prescriptionSource,
          ],
        );
    const document = saved.rows[0];
    if (finalPdf) await persistClinicalDocumentArtifact(client, document, finalPdf);
    if (amendmentSource)
      await client.query(
        `INSERT INTO inventory_clinical_document_amendments(document_id,parent_document_id,kind,reason,parent_sha256) VALUES($1,$2,$3,$4,$5)`,
        [
          document.id,
          amendmentSource.id,
          data.amendmentKind,
          data.amendmentReason,
          amendmentSource.hash,
        ],
      );
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
    if (final && data.type === "PRESCRIPTION")
      await appendIntegrationEvent(client, {
        organizationId: auth.organizationId,
        unitId: appointment.unit_id,
        actorUserId: auth.user.id,
        eventType: "PRESCRIPTION_FINALIZED",
        aggregateType: "PRESCRIPTION",
        aggregateId: document.id,
        aggregateVersion: document.version,
        payload: { resourceId: document.id, resourceVersion: document.version },
      });
    await client.query("COMMIT");
    return Response.json(
      { data: { id: document.id, status: document.status, version: document.version } },
      { status: previous ? 200 : 201, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const registrationConflict = professionalRegistryConflictResponse(error, headers);
    if (registrationConflict) return registrationConflict;
    const reason = error instanceof Error ? error.message : "";
    if (
      /^O PDF não suporta o caractere U\+[0-9A-F]+\. Revise o documento antes de assinar\.$/.test(
        reason,
      )
    )
      return fail(reason, 422);
    const messages: Record<string, [string, number]> = {
      PRESCRIBER_CONTACT_REQUIRED: [
        "Complete endereço, cidade, UF e telefone do emissor em Administração → Usuários antes de finalizar a receita.",
        409,
      ],
      PRESCRIBER_IDENTITY_CHANGED: [
        "Os dados do emissor devem corresponder ao cadastro profissional. Recarregue o atendimento e confira os dados da receita.",
        409,
      ],
      PATIENT_IDENTITY_CHANGED: [
        "Os dados de impressão do paciente diferem do cadastro atual. Confira o cadastro, recarregue o atendimento e revise os dados da receita antes de finalizar.",
        409,
      ],
      RECTIFICATION_EXISTS: [
        "Este original já possui uma retificação. Abra a retificação existente; não crie correções paralelas.",
        409,
      ],
      PRESCRIPTION_SOURCE: [
        "O registro terapêutico de origem mudou ou não pertence a este atendimento. Confira e insira novamente os itens antes de salvar a receita.",
        409,
      ],
      AMENDMENT_DRAFT: [
        "Este rascunho está vinculado a uma retificação ou adendo. Preserve a correção vinculada e seu histórico.",
        409,
      ],
      AMENDMENT: [
        "Selecione um documento original finalizado e informe um motivo com pelo menos 5 caracteres.",
        409,
      ],
      PROFESSIONAL_SCOPE: [
        "Este tipo de documento não está disponível para seu registro profissional.",
        403,
      ],
      NOT_FOUND: ["Documento ou atendimento não encontrado.", 404],
      NOT_AUTHOR: ["Somente o profissional responsável pode editar este documento.", 403],
      COUNCIL: ["Complete o conselho profissional antes de criar documentos.", 409],
      TERMINAL: ["Este atendimento não aceita documentos.", 409],
      DISCARDED: [
        "Este rascunho foi descartado e permanece preservado no histórico de auditoria.",
        409,
      ],
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
