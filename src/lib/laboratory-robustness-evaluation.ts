import type { LaboratoryRow } from "./laboratory-results";
import type { LaboratoryEvidenceCheck } from "./laboratory-evidence";

/** Offline benchmark only. A reference is authored independently of model output.
 * Never imported by clinical extraction, review or publication routes. */
export const laboratoryEvaluationFields = [
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
  "sourcePage",
] as const;
export type LaboratoryEvaluationField = (typeof laboratoryEvaluationFields)[number];
export type LaboratoryUnresolvedReference = {
  name: string;
  sourcePage: number;
  reason: string;
  fields?: readonly string[];
};
export type LaboratoryEvaluationReference = {
  rows: readonly LaboratoryRow[];
  unresolved?: readonly LaboratoryUnresolvedReference[];
};
export const emptyLaboratoryFieldCounts = () => ({
  expectedPositive: 0,
  emittedPositive: 0,
  correctPositive: 0,
  omittedPositive: 0,
  wrongPositive: 0,
  inventedPositive: 0,
  correctAbsent: 0,
  /** Source contains a date whose interpretation is deliberately unresolved. */
  unresolved: 0,
  preservedUnresolved: 0,
});
export type LaboratoryFieldCounts = ReturnType<typeof emptyLaboratoryFieldCounts>;
const text = (v: string) => v.normalize("NFC").replace(/µ/g, "μ").replace(/\s+/gu, " ").trim();
const nameKey = (v: string) => text(v).toLocaleLowerCase("pt-BR");
const unitKey = (v: string) => text(v).replace(/\/([md]?)l\b/g, "/$1L");
/** Typography only; no concentration conversion or removal of comparators. */
function comparable(row: LaboratoryRow, field: LaboratoryEvaluationField): string | number | null {
  const value = row[field];
  if (value == null) return null;
  if (field === "sourcePage") return Number(value);
  if (field === "name") return nameKey(String(value));
  if (field === "unit") return unitKey(String(value));
  if (field === "reference") {
    let reference = unitKey(String(value));
    const suffix = row.unit ? " " + unitKey(row.unit) : null;
    if (suffix && reference.endsWith(suffix)) reference = reference.slice(0, -suffix.length);
    return reference;
  }
  if (field === "result") {
    const result = text(String(value))
      .replace(/([<>≤≥])\s+/gu, "$1")
      .toLocaleLowerCase("pt-BR");
    // One decimal separator is an unambiguous representation change, not a scale change.
    return /^[<>≤≥]?[+−-]?\d+[.,]\d+$/u.test(result) ? result.replace(",", ".") : result;
  }
  return text(String(value));
}
export type LaboratoryEvaluationError = {
  row: number | null;
  field: LaboratoryEvaluationField | "observation";
  kind:
    | "omittedPositive"
    | "wrongPositive"
    | "inventedPositive"
    | "omittedRow"
    | "unmatchedRow"
    | "unsupportedUnreadableValue"
    | "unresolvedDateAccepted";
  expected: unknown;
  actual: unknown;
  verifierDetectedField: boolean | null;
};
const numeric = /[0-9]/u;
const unreadable = (r: LaboratoryUnresolvedReference) =>
  /ileg|unread|masked|ocult/iu.test(r.reason);

/** Derived reconstruction for benchmark attribution, not a raw model response.
 * Only audited null->date recoveries are reverted; delivered rows are not mutated. */
export function reconstructPreRecoveryLaboratoryRows(
  delivered: readonly LaboratoryRow[],
  rawRecoveries: unknown,
) {
  if (!Array.isArray(rawRecoveries) || rawRecoveries.length > 600)
    throw new Error("INVALID_DATE_RECOVERY_AUDIT");
  const rows = delivered.map((row) => ({ ...row }));
  const seen = new Set<string>();
  for (const raw of rawRecoveries) {
    if (!raw || typeof raw !== "object") throw new Error("INVALID_DATE_RECOVERY_AUDIT");
    const { row, field, page, line } = raw as {
      row?: unknown;
      field?: unknown;
      page?: unknown;
      line?: unknown;
    };
    if (
      !Number.isInteger(row) ||
      Number(row) < 0 ||
      Number(row) >= rows.length ||
      !["collectedOn", "reportedOn", "issuedOn"].includes(String(field)) ||
      !Number.isInteger(page) ||
      Number(page) < 1 ||
      !Number.isInteger(line) ||
      Number(line) < 1
    )
      throw new Error("INVALID_DATE_RECOVERY_AUDIT");
    const key = `${row}:${field}`;
    const target = rows[Number(row)]!;
    const dateField = field as "collectedOn" | "reportedOn" | "issuedOn";
    if (seen.has(key) || !target[dateField] || target.sourcePage !== page)
      throw new Error("INVALID_DATE_RECOVERY_AUDIT");
    seen.add(key);
    target[dateField] = null;
  }
  return rows;
}

/** Counts errors against the reference even when the verifier accepted the output.
 * Incomplete observations remain errors; null/null never inflates positive precision. */
export function evaluateLaboratoryRobustness(
  reference: LaboratoryEvaluationReference,
  predicted: readonly LaboratoryRow[],
  checks?: readonly LaboratoryEvidenceCheck[],
  options: { independentText: boolean } = { independentText: false },
) {
  const fields = Object.fromEntries(
    laboratoryEvaluationFields.map((f) => [f, emptyLaboratoryFieldCounts()]),
  ) as Record<LaboratoryEvaluationField, LaboratoryFieldCounts>;
  const errors: LaboratoryEvaluationError[] = [];
  const remaining = new Set(predicted.map((_, i) => i));
  const unsafe = new Set<number>();
  let matchedRows = 0,
    completeRows = 0,
    correctResults = 0,
    associationErrors = 0;
  let omittedRows = 0,
    unmatchedRows = 0,
    correctlyFlaggedUnreadable = 0,
    omittedUnreadableMentions = 0;
  let falseAlertCandidates = 0,
    correctButUnprovableRows = 0;
  let unresolvedDateRows = 0,
    signaledUnresolvedDateRows = 0,
    silentUnresolvedAcceptance = 0;
  const observedWrongRows = new Set<number>();
  const detected = (index: number | undefined, field: LaboratoryEvaluationField) => {
    if (index === undefined || !checks?.[index] || field === "sourcePage") return null;
    const check = checks[index]!.fields[field];
    return !!check && ["insufficient", "contradictory"].includes(check.status);
  };
  for (const expected of reference.rows) {
    const candidates = [...remaining].filter(
      (i) => nameKey(predicted[i]!.name) === nameKey(expected.name),
    );
    // Exact original page first. A wrong page remains a measurable field error.
    const index =
      candidates.find((i) => predicted[i]!.sourcePage === expected.sourcePage) ?? candidates[0];
    const actual = index === undefined ? null : predicted[index]!;
    if (index === undefined) {
      omittedRows++;
      errors.push({
        row: null,
        field: "observation",
        kind: "omittedRow",
        expected: expected.name,
        actual: null,
        verifierDetectedField: null,
      });
    } else {
      remaining.delete(index);
      matchedRows++;
    }
    let complete = actual !== null;
    const unresolvedDateFields = new Set(
      reference.unresolved
        ?.filter(
          (u) =>
            u.reason === "ambiguous_date" &&
            nameKey(u.name) === nameKey(expected.name) &&
            u.sourcePage === expected.sourcePage,
        )
        .flatMap((u) => u.fields ?? ["collectedOn", "reportedOn", "issuedOn"]) ?? [],
    );
    for (const field of laboratoryEvaluationFields) {
      const a = actual ? comparable(actual, field) : null,
        b = comparable(expected, field),
        count = fields[field];
      if (a !== null) count.emittedPositive++;
      if (b !== null) count.expectedPositive++;
      const sourceUnresolved = b === null && unresolvedDateFields.has(field);
      if (sourceUnresolved) count.unresolved++;
      if (a === b) {
        if (b !== null) count.correctPositive++;
        else if (actual) {
          if (sourceUnresolved) count.preservedUnresolved++;
          else count.correctAbsent++;
        }
      } else {
        complete = false;
        const kind =
          a === null ? "omittedPositive" : b === null ? "inventedPositive" : "wrongPositive";
        count[kind]++;
        errors.push({
          row: index ?? null,
          field,
          kind,
          expected: b,
          actual: a,
          verifierDetectedField: detected(index, field),
        });
        if (index !== undefined) observedWrongRows.add(index);
      }
    }
    if (
      actual &&
      comparable(actual, "result") === comparable(expected, "result") &&
      actual.sourcePage === expected.sourcePage
    )
      correctResults++;
    else if (actual) associationErrors++;
    if (complete) completeRows++;
    const eligible = index !== undefined && checks?.[index]?.status === "literal_match";
    if (index !== undefined && !complete && eligible) unsafe.add(index);
    if (unresolvedDateFields.size > 0) {
      unresolvedDateRows++;
      if (index !== undefined && actual) {
        const check = checks?.[index];
        const ambiguitySignaled =
          !!actual.uncertainty ||
          (check?.status === "attention" &&
            (check.issues.some((issue) => /DATE_|MODEL_UNCERTAINTY/u.test(issue)) ||
              [...unresolvedDateFields].some((field) => {
                const value = check.fields[field as keyof typeof check.fields];
                return value && ["insufficient", "contradictory"].includes(value.status);
              })));
        if (ambiguitySignaled) signaledUnresolvedDateRows++;
        // Correct nulls are safe extraction abstention, but must not silently become
        // eligible as if the source date were known to be absent.
        const retainsUnresolved = [...unresolvedDateFields].some(
          (field) => actual[field as LaboratoryEvaluationField] == null,
        );
        if (eligible && retainsUnresolved) {
          unsafe.add(index);
          if (!ambiguitySignaled) silentUnresolvedAcceptance++;
          errors.push({
            row: index,
            field: "observation",
            kind: "unresolvedDateAccepted",
            expected: "explicit review for unresolved source dates",
            actual: "literal_match",
            verifierDetectedField: false,
          });
        }
      }
    }
    if (index !== undefined && complete && checks?.[index]?.status === "attention") {
      const check = checks[index]!;
      const unprovable =
        !options.independentText ||
        check.issues.some((issue) =>
          [
            "INDEPENDENT_SOURCE_UNAVAILABLE",
            "ASSOCIATION_UNPROVEN",
            "SOURCE_PAGE_MISSING",
          ].includes(issue),
        );
      const unresolved = reference.unresolved?.some(
        (u) => nameKey(u.name) === nameKey(actual!.name) && u.sourcePage === actual!.sourcePage,
      );
      if (unprovable || unresolved) correctButUnprovableRows++;
      else if (!actual!.uncertainty) falseAlertCandidates++;
    }
  }
  for (const expected of reference.unresolved?.filter(unreadable) ?? []) {
    const indices = [...remaining].filter(
      (i) =>
        nameKey(predicted[i]!.name) === nameKey(expected.name) &&
        predicted[i]!.sourcePage === expected.sourcePage,
    );
    if (!indices.length) omittedUnreadableMentions++;
    for (const index of indices) {
      const actual = predicted[index]!;
      remaining.delete(index);
      const safelyMarked =
        !numeric.test(actual.result) &&
        !!actual.uncertainty &&
        checks?.[index]?.status !== "literal_match";
      if (safelyMarked) correctlyFlaggedUnreadable++;
      else {
        observedWrongRows.add(index);
        errors.push({
          row: index,
          field: "observation",
          kind: "unsupportedUnreadableValue",
          expected: "no clinical value is readable",
          actual: actual.result,
          verifierDetectedField: checks?.[index] ? checks[index]!.status === "attention" : null,
        });
        if (checks?.[index]?.status === "literal_match") unsafe.add(index);
      }
    }
  }
  for (const index of remaining) {
    const actual = predicted[index]!;
    unmatchedRows++;
    observedWrongRows.add(index);
    if (checks?.[index]?.status === "literal_match") unsafe.add(index);
    for (const field of laboratoryEvaluationFields)
      if (comparable(actual, field) !== null) {
        fields[field].emittedPositive++;
        fields[field].inventedPositive++;
      }
    errors.push({
      row: index,
      field: "observation",
      kind: "unmatchedRow",
      expected: null,
      actual: actual.name,
      verifierDetectedField: checks?.[index] ? checks[index]!.status === "attention" : null,
    });
  }
  const eligibleRows = checks?.filter((c) => c.status === "literal_match").length ?? null;
  const attentionRows = checks?.filter((c) => c.status === "attention").length ?? null;
  const positiveExpected = Object.values(fields).reduce((n, c) => n + c.expectedPositive, 0);
  const positiveEmitted = Object.values(fields).reduce((n, c) => n + c.emittedPositive, 0);
  const positiveCorrect = Object.values(fields).reduce((n, c) => n + c.correctPositive, 0);
  return {
    expectedLegibleRows: reference.rows.length,
    emittedRows: predicted.length,
    matchedRows,
    completeRows,
    correctResults,
    omittedRows,
    unmatchedRows,
    associationErrors,
    resultRecall: reference.rows.length ? correctResults / reference.rows.length : null,
    fields,
    positiveExpected,
    positiveEmitted,
    positiveCorrect,
    positivePrecision: positiveEmitted ? positiveCorrect / positiveEmitted : null,
    positiveRecall: positiveExpected ? positiveCorrect / positiveExpected : null,
    unreadable: {
      expectedMentions: reference.unresolved?.filter(unreadable).length ?? 0,
      correctlyFlaggedUnreadable,
      omittedUnreadableMentions,
    },
    unresolvedDates: {
      rows: unresolvedDateRows,
      fields: Object.values(fields).reduce((n, c) => n + c.unresolved, 0),
      preservedUnresolved: Object.values(fields).reduce((n, c) => n + c.preservedUnresolved, 0),
      signaledRows: signaledUnresolvedDateRows,
    },
    verifier: {
      eligibleRows,
      attentionRows,
      reviewFraction:
        attentionRows === null || !predicted.length ? null : attentionRows / predicted.length,
      incorrectRowsObserved: observedWrongRows.size,
      unsafeLiteralMatches: checks ? unsafe.size : null,
      falseAlertCandidates: checks ? falseAlertCandidates : null,
      correctButUnprovableRows: checks ? correctButUnprovableRows : null,
      silentUnresolvedAcceptance: checks ? silentUnresolvedAcceptance : null,
      // Candidate counts require source/PDF adjudication, not automatic verdicts.
      sensitivityToWrongResults: errors.some(
        (e) => e.field === "result" && e.kind === "wrongPositive",
      )
        ? errors.filter(
            (e) => e.field === "result" && e.kind === "wrongPositive" && e.verifierDetectedField,
          ).length / errors.filter((e) => e.field === "result" && e.kind === "wrongPositive").length
        : null,
    },
    errors,
  };
}
