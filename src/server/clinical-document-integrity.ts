import "@tanstack/react-start/server-only";
import { getPool } from "./db";
/** Database-canonical JSONB serialization; distinct from a signed PDF's byte hash. */
export const integrityFields = `(SELECT sealed_at FROM inventory_clinical_document_seals WHERE document_id=inventory_encounter_documents.id) AS "integrityRecordedAt",
(SELECT content_sha256 FROM inventory_clinical_document_seals WHERE document_id=inventory_encounter_documents.id) AS "contentSha256",
(SELECT content_sha256=encode(sha256(convert_to(inventory_encounter_documents.final_snapshot::text,'UTF8')),'hex') FROM inventory_clinical_document_seals WHERE document_id=inventory_encounter_documents.id) AS "integrityVerified",
(SELECT jsonb_build_object('parentDocumentId',a.parent_document_id,'kind',a.kind,'reason',a.reason,'parentSha256',a.parent_sha256) FROM inventory_clinical_document_amendments a WHERE a.document_id=inventory_encounter_documents.id) AS amendment`;
export async function verifiedDocumentIntegrity(documentId: string) {
  const result = await getPool().query(
    `SELECT s.content_sha256=encode(sha256(convert_to(d.final_snapshot::text,'UTF8')),'hex') AS valid
    FROM inventory_encounter_documents d LEFT JOIN inventory_clinical_document_seals s ON s.document_id=d.id WHERE d.id=$1`,
    [documentId],
  );
  return result.rows[0]?.valid === true;
}
