import "@tanstack/react-start/server-only";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { recordClinicalAccess } from "./clinical-access-audit";
import { parseDocumentVerificationCode } from "../lib/clinical-document-identity";

/** Verification is internal, scoped and audited; a printed code is not a bearer credential. */
export async function verifyClinicalDocumentResponse(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para verificar o documento.", 401);
  if (!can(auth, "patients.private.read")) return fail("Acesso negado.", 403);
  const documentId = parseDocumentVerificationCode(
    new URL(request.url).searchParams.get("verify") ?? "",
  );
  if (!documentId) return fail("Código de verificação inválido.", 400);
  const result = await getPool().query(
    `SELECT d.id,d.unit_id,d.patient_id,d.appointment_id,d.final_snapshot,
      s.content_sha256,s.sealed_at,
      s.content_sha256=encode(sha256(convert_to(d.final_snapshot::text,'UTF8')),'hex') AS verified,
      (SELECT jsonb_agg(jsonb_build_object('kind',a.kind,'documentId',a.document_id) ORDER BY child.finalized_at,a.document_id)
        FROM inventory_clinical_document_amendments a JOIN inventory_encounter_documents child ON child.id=a.document_id
        WHERE a.parent_document_id=d.id AND child.status='FINAL' AND child.organization_id=d.organization_id AND child.unit_id=d.unit_id) AS amendments
     FROM inventory_encounter_documents d LEFT JOIN inventory_clinical_document_seals s ON s.document_id=d.id
     WHERE d.id=$1 AND d.organization_id=$2 AND d.status='FINAL'`,
    [documentId, auth.organizationId],
  );
  const document = result.rows[0];
  if (!document || !can(auth, "patients.private.read", document.unit_id))
    return fail("Documento não encontrado.", 404);
  // Legacy records have no newly printed code. Do not invent retrospective identifiers.
  const snapshot = document.final_snapshot;
  if (!snapshot || snapshot.documentId !== document.id)
    return fail("Documento sem identificador de verificação preservado.", 409);
  try {
    await recordClinicalAccess(auth, {
      unitId: document.unit_id,
      patientId: document.patient_id,
      appointmentId: document.appointment_id,
      documentId: document.id,
      action: "READ",
    });
  } catch {
    console.error("CLINICAL_DOCUMENT_VERIFICATION_AUDIT_FAILED");
    return fail("Não foi possível verificar o documento. Tente novamente.", 503);
  }
  if (document.verified !== true)
    return fail(
      "Não foi possível confirmar a integridade do documento. Não utilize esta via sem revisão.",
      409,
    );
  return Response.json(
    {
      data: {
        documentId: document.id,
        appointmentId: document.appointment_id,
        title: snapshot.title,
        patientName: snapshot.patientName,
        patientCode: snapshot.patientCode,
        unitName: snapshot.unitName,
        authorName: snapshot.authorName,
        professionalCouncil: snapshot.professionalCouncil,
        councilNumber: snapshot.councilNumber,
        councilRegion: snapshot.councilRegion,
        finalizedAt: snapshot.finalizedAt,
        contentSha256: document.content_sha256,
        sealedAt: document.sealed_at,
        integrityVerified: true,
        amendments: document.amendments ?? [],
        notice:
          "Verificação do registro interno. Não comprova assinatura digital, habilitação profissional ou validade clínica/legal.",
      },
    },
    { headers },
  );
}
