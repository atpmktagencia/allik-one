import { z } from "zod";
import type { LaboratoryRow } from "./laboratory-results";

export const laboratorySourceChecksSchema = z.object({
  version: z.literal(1),
  parserStatus: z.enum(["available", "unavailable"]),
  totalPages: z.number().int().min(0).max(1000),
  rows: z
    .array(
      z.object({
        status: z.enum(["attention", "literal_match"]),
        basis: z.enum(["model_evidence", "source_text"]),
        issues: z.array(z.string().max(64)).max(16),
      }),
    )
    .max(200),
});
export type LaboratorySourceChecks = z.infer<typeof laboratorySourceChecksSchema>;
export function laboratoryRowEvidenceIdentity(row: LaboratoryRow) {
  const values = row;
  // Explicit keys make comparisons independent of JSON object insertion order.
  return JSON.stringify([
    values.name,
    values.result,
    values.unit,
    values.reference,
    values.collectedOn,
    values.reportedOn,
    values.laboratory,
    values.method,
    values.material,
    values.sourcePage,
    values.evidence,
    values.uncertainty,
  ]);
}
export const laboratoryEvidenceIssueLabels: Record<string, string> = {
  MISSING_EVIDENCE: "Trecho de origem ausente",
  NAME_NOT_FOUND: "Nome não localizado no trecho",
  RESULT_NOT_FOUND: "Resultado não localizado no trecho",
  UNIT_NOT_FOUND: "Unidade não localizada no trecho",
  REFERENCE_NOT_FOUND: "Referência não localizada no trecho",
  SOURCE_PAGE_MISSING: "Página de origem não localizada",
  EVIDENCE_NOT_IN_SOURCE: "Trecho não localizado no texto do PDF",
  MODEL_UNCERTAINTY: "Pendência indicada na extração",
};
