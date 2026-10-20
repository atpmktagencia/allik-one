import type { LaboratoryRow } from "./laboratory-results";

export type LaboratoryReference = { id: string; row: LaboratoryRow };
const identity = (r: LaboratoryRow) =>
  JSON.stringify([r.name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase(), r.sourcePage]);
const fields = [
  "result",
  "unit",
  "collectedOn",
  "reportedOn",
  "reference",
  "laboratory",
  "method",
  "material",
] as const;
type Field = (typeof fields)[number];
const equal = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Offline literal reference evaluation, never a diagnosis or a model confidence score.
 * One-to-one matching prevents duplicate predictions from increasing recall. */
export function evaluateLaboratoryExtraction(
  reference: LaboratoryReference[],
  predicted: LaboratoryRow[],
) {
  const remaining = new Set(reference.map((_, i) => i));
  const measurements = Object.fromEntries(
    fields.map((key) => [key, { correct: 0, compared: 0 }]),
  ) as Record<Field, { correct: number; compared: number }>;
  let matched = 0,
    correctRows = 0,
    associationCorrect = 0,
    invented = 0;
  for (const row of predicted) {
    const candidates = [...remaining].filter((i) => identity(reference[i]!.row) === identity(row));
    candidates.sort(
      (a, b) =>
        fields.filter((key) => equal(row[key], reference[b]!.row[key])).length -
        fields.filter((key) => equal(row[key], reference[a]!.row[key])).length,
    );
    const index = candidates[0];
    if (index === undefined) {
      invented++;
      continue;
    }
    remaining.delete(index);
    const expected = reference[index]!.row;
    matched++;
    if (fields.every((key) => equal(row[key], expected[key]))) correctRows++;
    if (equal(row.result, expected.result)) associationCorrect++;
    for (const key of fields) {
      if (row[key] == null && expected[key] == null) continue;
      measurements[key].compared++;
      if (equal(row[key], expected[key])) measurements[key].correct++;
    }
  }
  return {
    expected: reference.length,
    predicted: predicted.length,
    matched,
    correctRows,
    omitted: remaining.size,
    invented,
    associationCorrect,
    fields: measurements,
  };
}
