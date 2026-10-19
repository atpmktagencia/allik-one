import type { LaboratoryRow } from "./laboratory-results";

export type LaboratoryEvidenceIssue =
  | "MISSING_EVIDENCE"
  | "NAME_NOT_FOUND"
  | "RESULT_NOT_FOUND"
  | "UNIT_NOT_FOUND"
  | "REFERENCE_NOT_FOUND"
  | "SOURCE_PAGE_MISSING"
  | "EVIDENCE_NOT_IN_SOURCE"
  | "MODEL_UNCERTAINTY";

export type LaboratorySourcePage = { page: number; text: string };
export type LaboratoryEvidenceCheck = {
  /** Literal consistency is not clinical validation or proof of correct row association. */
  status: "attention" | "literal_match";
  basis: "model_evidence" | "source_text";
  issues: LaboratoryEvidenceIssue[];
};

// Only typographic whitespace and Unicode composition are normalized. In particular,
// decimal separators, inequality signs, case-sensitive units and exponents stay intact.
const normalize = (text: string) => text.normalize("NFC").replace(/\s+/gu, " ").trim();
const tokenCharacter = /[\p{L}\p{N}.,+−\-<>≤≥=/%µμ^]/u;

function containsLiteral(haystack: string, needle: string, foldCase = false, result = false) {
  let source = normalize(haystack);
  let target = normalize(needle);
  if (!target) return false;
  if (foldCase) {
    source = source.toLocaleLowerCase("pt-BR");
    target = target.toLocaleLowerCase("pt-BR");
  }
  let offset = 0;
  while (offset <= source.length - target.length) {
    const index = source.indexOf(target, offset);
    if (index < 0) return false;
    const before = source.slice(0, index).trimEnd().at(-1);
    const after = source
      .slice(index + target.length)
      .trimStart()
      .at(0);
    // An immediately adjacent token must never turn 15 into 5, or <5 into 5.
    const adjacentBefore = source[index - 1];
    const adjacentAfter = source[index + target.length];
    const joinedBefore = adjacentBefore && tokenCharacter.test(adjacentBefore);
    const joinedAfter = adjacentAfter && tokenCharacter.test(adjacentAfter);
    const detachedComparator = before && /[<>≤≥=+−-]/u.test(before);
    const detachedExponent = after === "^";
    const negated = result && /(?:^|\s)(?:não|nao|non|not|sem)\s+$/iu.test(source.slice(0, index));
    if (!joinedBefore && !joinedAfter && !detachedComparator && !detachedExponent && !negated)
      return true;
    offset = index + 1;
  }
  return false;
}

/**
 * Checks transcription consistency without changing any row or granting confirmation.
 * Pass independently extracted source pages to check evidence provenance. Omitting
 * them explicitly means the evidence was supplied by the same model as the values.
 * A match cannot prove patient identity, completeness, method compatibility, or that
 * a number belongs to the result rather than another column. Human review remains.
 */
export function checkLaboratoryEvidence(
  row: LaboratoryRow,
  sourcePages?: readonly LaboratorySourcePage[],
): LaboratoryEvidenceCheck {
  const issues: LaboratoryEvidenceIssue[] = [];
  const evidence = normalize(row.evidence ?? "");
  if (!evidence) issues.push("MISSING_EVIDENCE");
  else {
    if (!containsLiteral(evidence, row.name, true)) issues.push("NAME_NOT_FOUND");
    if (!containsLiteral(evidence, row.result, false, true)) issues.push("RESULT_NOT_FOUND");
    if (row.unit && !containsLiteral(evidence, row.unit)) issues.push("UNIT_NOT_FOUND");
    if (row.reference && !containsLiteral(evidence, row.reference))
      issues.push("REFERENCE_NOT_FOUND");
  }
  if (row.uncertainty?.trim()) issues.push("MODEL_UNCERTAINTY");
  if (sourcePages !== undefined) {
    const page = sourcePages.find((candidate) => candidate.page === row.sourcePage);
    if (!page) issues.push("SOURCE_PAGE_MISSING");
    else if (evidence && !normalize(page.text).includes(evidence))
      issues.push("EVIDENCE_NOT_IN_SOURCE");
  }
  return {
    status: issues.length ? "attention" : "literal_match",
    basis: sourcePages === undefined ? "model_evidence" : "source_text",
    issues,
  };
}
