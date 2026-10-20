import type { LaboratoryRow } from "./laboratory-results";
import {
  laboratoryAssociations,
  laboratoryMetadata,
  laboratoryUnitKey,
  normalizeLaboratoryText,
} from "./laboratory-source-association";

export type LaboratoryEvidenceIssue =
  | "MISSING_EVIDENCE"
  | "NAME_NOT_FOUND"
  | "RESULT_NOT_FOUND"
  | "UNIT_NOT_FOUND"
  | "REFERENCE_NOT_FOUND"
  | "SOURCE_PAGE_MISSING"
  | "EVIDENCE_NOT_IN_SOURCE"
  | "MODEL_UNCERTAINTY"
  | "INDEPENDENT_SOURCE_UNAVAILABLE"
  | "ASSOCIATION_UNPROVEN"
  | "DATE_UNSUPPORTED"
  | "DATE_CONTRADICTION"
  | "METADATA_UNSUPPORTED"
  | "METADATA_CONTRADICTION"
  | "FIELD_OMITTED";
export type LaboratorySourcePage = { page: number; text: string };
export type LaboratoryEvidenceField =
  | "name"
  | "result"
  | "unit"
  | "reference"
  | "collectedOn"
  | "reportedOn"
  | "issuedOn"
  | "laboratory"
  | "method"
  | "material";
export type LaboratoryFieldCheck = {
  status: "supported" | "absent" | "insufficient" | "contradictory";
  page?: number;
  line?: number;
};
export type LaboratoryEvidenceCheck = {
  /** Structural text consistency only; never clinical validation or proof of completeness. */
  status: "attention" | "literal_match";
  basis: "model_evidence" | "source_text";
  issues: LaboratoryEvidenceIssue[];
  fields: Record<LaboratoryEvidenceField, LaboratoryFieldCheck>;
};
const keys: LaboratoryEvidenceField[] = [
  "name",
  "result",
  "unit",
  "reference",
  "collectedOn",
  "reportedOn",
  "issuedOn",
  "laboratory",
  "method",
  "material",
];
const fold = (s: string) => normalizeLaboratoryText(s).toLocaleLowerCase("pt-BR");
function sourceDate(s: string) {
  const match = s.match(
    /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})(?:\s+(?:às\s*)?\d{2}:\d{2}(?::\d{2})?)?$/u,
  );
  if (!match) return null;
  const value = match[1]!;
  const iso = value.includes("/") ? value.split("/").reverse().join("-") : value;
  return Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso
    ? iso
    : null;
}
/** Independent source and explicit textual association are required for eligibility.
 * No row changes, fuzzy names, unit conversion, inferred geometry, or publication. */
export function checkLaboratoryEvidence(
  row: LaboratoryRow,
  sourcePages?: readonly LaboratorySourcePage[],
): LaboratoryEvidenceCheck {
  const issues: LaboratoryEvidenceIssue[] = [];
  const fields = Object.fromEntries(
    keys.map((key) => [key, { status: row[key] ? "insufficient" : "absent" }]),
  ) as Record<LaboratoryEvidenceField, LaboratoryFieldCheck>;
  const page = sourcePages?.find((p) => p.page === row.sourcePage);
  const add = (issue: LaboratoryEvidenceIssue) => {
    if (!issues.includes(issue)) issues.push(issue);
  };
  if (row.uncertainty?.trim()) add("MODEL_UNCERTAINTY");
  if (!sourcePages) add("INDEPENDENT_SOURCE_UNAVAILABLE");
  if (!page) {
    if (sourcePages) add("SOURCE_PAGE_MISSING");
    if (!row.evidence?.trim()) add("MISSING_EVIDENCE");
    return {
      status: "attention",
      basis: sourcePages ? "source_text" : "model_evidence",
      issues,
      fields,
    };
  }
  const lines = page.text.split(/\r?\n/u);
  const associations = laboratoryAssociations(lines, row.name);
  const association = associations.length === 1 ? associations[0] : undefined;
  if (!association) {
    add("ASSOCIATION_UNPROVEN");
    fields.name = { status: "insufficient" };
  } else {
    const location = { page: page.page, line: association.line };
    fields.name = { status: "supported", ...location };
    const valueMatches =
      fold(row.result).replace(/([<>≤≥])\s+/gu, "$1") === fold(association.result);
    fields.result = { status: valueMatches ? "supported" : "contradictory", ...location };
    if (!valueMatches) add("RESULT_NOT_FOUND");
    const unitMatches =
      row.unit &&
      association.unit &&
      laboratoryUnitKey(row.unit) === laboratoryUnitKey(association.unit);
    fields.unit = {
      status:
        !row.unit && !association.unit
          ? "absent"
          : unitMatches
            ? "supported"
            : row.unit && association.unit
              ? "contradictory"
              : "insufficient",
      ...location,
    };
    if (fields.unit.status === "contradictory" || fields.unit.status === "insufficient")
      add(row.unit ? "UNIT_NOT_FOUND" : "FIELD_OMITTED");
    let sourceReference = association.reference;
    if (
      sourceReference &&
      row.reference &&
      row.unit &&
      laboratoryUnitKey(sourceReference) !== laboratoryUnitKey(row.reference)
    ) {
      const ending = sourceReference.match(/\s+(\S+)$/u);
      if (ending && laboratoryUnitKey(ending[1]!) === laboratoryUnitKey(row.unit))
        sourceReference = sourceReference.slice(0, ending.index).trim();
    }
    const referenceMatches =
      row.reference &&
      sourceReference &&
      laboratoryUnitKey(row.reference) === laboratoryUnitKey(sourceReference);
    fields.reference = {
      status:
        !row.reference && !sourceReference
          ? "absent"
          : referenceMatches
            ? "supported"
            : row.reference && sourceReference
              ? "contradictory"
              : "insufficient",
      ...location,
    };
    if (["contradictory", "insufficient"].includes(fields.reference.status))
      add(row.reference ? "REFERENCE_NOT_FOUND" : "FIELD_OMITTED");
  }
  const metadata = laboratoryMetadata(lines, association);
  for (const key of [
    "collectedOn",
    "reportedOn",
    "issuedOn",
    "laboratory",
    "method",
    "material",
  ] as const) {
    if (key === "issuedOn" && !(key in row)) continue;
    const values = metadata[key] ?? [];
    const isDate = key.endsWith("On");
    const normalized = values.map((v) => (isDate ? sourceDate(v.value) : fold(v.value)));
    const unique = [...new Set(normalized)];
    const actual = row[key];
    if (!actual && !values.length) continue;
    if (!actual) {
      fields[key] = { status: "insufficient" };
      add("FIELD_OMITTED");
      continue;
    }
    const match =
      unique.length === 1 && unique[0] !== null && unique[0] === (isDate ? actual : fold(actual));
    fields[key] = {
      status: match ? "supported" : values.length ? "contradictory" : "insufficient",
      ...(values.length === 1 ? { page: page.page, line: values[0]!.line } : {}),
    };
    if (!match)
      add(
        isDate
          ? values.length
            ? "DATE_CONTRADICTION"
            : "DATE_UNSUPPORTED"
          : values.length
            ? "METADATA_CONTRADICTION"
            : "METADATA_UNSUPPORTED",
      );
  }
  if (
    (row.collectedOn && row.reportedOn && row.collectedOn > row.reportedOn) ||
    (row.issuedOn &&
      ((row.reportedOn && row.reportedOn > row.issuedOn) ||
        (row.collectedOn && row.collectedOn > row.issuedOn)))
  ) {
    add("DATE_CONTRADICTION");
    for (const key of ["collectedOn", "reportedOn", "issuedOn"] as const)
      if (row[key]) fields[key] = { status: "contradictory" };
  }
  if (
    row.evidence?.trim() &&
    !normalizeLaboratoryText(page.text).includes(normalizeLaboratoryText(row.evidence))
  )
    add("EVIDENCE_NOT_IN_SOURCE");
  return {
    status: issues.length ? "attention" : "literal_match",
    basis: "source_text",
    issues,
    fields,
  };
}
