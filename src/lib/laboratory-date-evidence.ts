import type { LaboratoryRow } from "./laboratory-results";
import type { LaboratorySourcePage } from "./laboratory-evidence";
import {
  laboratoryAssociations,
  laboratoryMetadata,
  laboratoryUnitKey,
  normalizeLaboratoryText,
} from "./laboratory-source-association";

export const laboratoryDateFields = ["collectedOn", "reportedOn", "issuedOn"] as const;
export type LaboratoryDateField = (typeof laboratoryDateFields)[number];
export type LaboratoryDateRecovery = {
  row: number;
  field: LaboratoryDateField;
  page: number;
  line: number;
};
type DateInterpretation =
  { status: "valid"; value: string } | { status: "ambiguous" | "invalid"; value: null };
const validIso = (s: string) =>
  !s.startsWith("0000") &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const dateOrder = (s: string) => {
  const key = s.trim().toUpperCase();
  if (["DD/MM/AAAA", "DD/MM/YYYY"].includes(key)) return "DMY";
  if (["MM/DD/AAAA", "MM/DD/YYYY"].includes(key)) return "MDY";
  return null;
};

/** A Portuguese label, chronology or another ambiguous date does not establish locale.
 * Only exact format declarations in the scoped source are accepted as format evidence. */
export function interpretLaboratoryDate(
  printed: string,
  declaredFormats: readonly string[] = [],
): DateInterpretation {
  const match = printed
    .trim()
    .match(
      /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})(?:\s+(?:às\s*)?(\d{2}):(\d{2})(?::(\d{2}))?)?(?:\s*\((DD\/MM\/(?:AAAA|YYYY)|MM\/DD\/(?:AAAA|YYYY))\))?$/iu,
    );
  if (!match) return { status: "invalid", value: null };
  if (match[2] && (+match[2] > 23 || +match[3]! > 59 || +(match[4] ?? "0") > 59))
    return { status: "invalid", value: null };
  const value = match[1]!;
  if (!value.includes("/"))
    return validIso(value) ? { status: "valid", value } : { status: "invalid", value: null };
  const [first, second, year] = value.split("/") as [string, string, string];
  const dmy = `${year}-${second}-${first}`;
  const mdy = `${year}-${first}-${second}`;
  const declarations = [...declaredFormats, ...(match[5] ? [match[5]] : [])];
  const orders = [...new Set(declarations.map(dateOrder))];
  // Unknown or conflicting declarations never become a guessed convention.
  if (orders.includes(null) || orders.length > 1) return { status: "ambiguous", value: null };
  if (orders.length === 1) {
    const iso = orders[0] === "DMY" ? dmy : mdy;
    return validIso(iso) ? { status: "valid", value: iso } : { status: "invalid", value: null };
  }
  const possible = [...new Set([dmy, mdy].filter(validIso))];
  if (possible.length === 1) return { status: "valid", value: possible[0]! };
  return { status: possible.length ? "ambiguous" : "invalid", value: null };
}

export function laboratoryDatesChronological(row: Pick<LaboratoryRow, LaboratoryDateField>) {
  return !(
    (row.collectedOn && row.reportedOn && row.collectedOn > row.reportedOn) ||
    (row.issuedOn &&
      ((row.reportedOn && row.reportedOn > row.issuedOn) ||
        (row.collectedOn && row.collectedOn > row.issuedOn)))
  );
}

/** Fill missing dates from unique independently parsed evidence only. Never overwrite
 * model data, erase uncertainty, merge pages, inspect model snippets or validate a row. */
export function recoverLaboratoryDates(
  rows: readonly LaboratoryRow[],
  sourcePages?: readonly LaboratorySourcePage[],
) {
  const recoveries: LaboratoryDateRecovery[] = [];
  const recovered = rows.map((row, index) => {
    const page = sourcePages?.find((p) => p.page === row.sourcePage);
    if (!page) return row;
    const lines = page.text.split(/\r?\n/u);
    const associations = laboratoryAssociations(lines, row.name);
    if (associations.length !== 1) return row;
    const association = associations[0]!;
    const resultKey = (s: string) =>
      normalizeLaboratoryText(s)
        .toLocaleLowerCase("pt-BR")
        .replace(/([<>≤≥])\s+/gu, "$1");
    if (
      resultKey(row.result) !== resultKey(association.result) ||
      (row.unit ? laboratoryUnitKey(row.unit) : null) !==
        (association.unit ? laboratoryUnitKey(association.unit) : null)
    )
      return row;
    const metadata = laboratoryMetadata(lines, association);
    if (metadata.scopeAmbiguous) return row;
    const formats = (metadata.dateFormat ?? []).map((item) => item.value);
    const candidates = { ...row };
    const pending: LaboratoryDateRecovery[] = [];
    for (const field of laboratoryDateFields) {
      if (row[field]) continue;
      const sources = metadata[field] ?? [];
      const parsed = sources.map((source) => interpretLaboratoryDate(source.value, formats));
      const unique = [...new Set(parsed.map((date) => date.value))];
      if (!sources.length || parsed.some((date) => date.status !== "valid") || unique.length !== 1)
        continue;
      candidates[field] = unique[0]!;
      pending.push({ row: index, field, page: page.page, line: sources[0]!.line });
    }
    if (!pending.length || !laboratoryDatesChronological(candidates)) return row;
    recoveries.push(...pending);
    return candidates;
  });
  return { rows: recovered, recoveries };
}
