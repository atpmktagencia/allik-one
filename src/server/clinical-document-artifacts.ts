import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { renderClinicalDocumentPdf } from "./clinical-document-pdf";
import { renderClinicalDocumentPrint } from "./clinical-document-print";

export const clinicalRendererVersion = "allik-clinical-v1";
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
/** Store the distributable bytes in the same transaction that seals the snapshot. */
export async function persistClinicalDocumentArtifact(
  client: PoolClient,
  document: Record<string, unknown>,
  pdf: Buffer,
) {
  const html = renderClinicalDocumentPrint(document);
  await client.query(
    `INSERT INTO inventory_clinical_document_artifacts(document_id,organization_id,renderer_version,pdf,pdf_sha256,html,html_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      document["id"],
      document["organization_id"],
      clinicalRendererVersion,
      pdf,
      hash(pdf),
      html,
      hash(html),
    ],
  );
}
/** No retrospective backfill: legacy output is explicitly identified as regenerated. */
export async function clinicalDocumentArtifact(document: Record<string, unknown>) {
  const result = await getPool().query(
    `SELECT renderer_version,pdf,pdf_sha256,html,html_sha256 FROM inventory_clinical_document_artifacts WHERE document_id=$1 AND organization_id=$2`,
    [document["id"], document["organization_id"]],
  );
  const artifact = result.rows[0];
  if (!artifact) return null;
  if (
    !Buffer.isBuffer(artifact.pdf) ||
    hash(artifact.pdf) !== artifact.pdf_sha256 ||
    typeof artifact.html !== "string" ||
    hash(artifact.html) !== artifact.html_sha256
  )
    throw new Error("STORAGE_INTEGRITY");
  return {
    pdf: artifact.pdf as Buffer,
    html: artifact.html as string,
    rendererVersion: String(artifact.renderer_version),
  };
}
export async function authoritativeClinicalDocumentPdf(document: Record<string, unknown>) {
  const artifact = await clinicalDocumentArtifact(document);
  return artifact?.pdf ?? renderClinicalDocumentPdf(document);
}
