import type { LaboratoryRow } from "./laboratory-results";

export type LaboratoryHistoryEntry = {
  id: string;
  reviewId: string;
  documentId: string;
  documentTitle: string;
  previewUrl: string;
  payload: LaboratoryRow;
};
export type LaboratoryHistoryGroup = {
  id: string;
  name: string;
  unit: string | null;
  method: string | null;
  material: string | null;
  laboratory: string | null;
  entries: LaboratoryHistoryEntry[];
};
export const laboratoryHistoryDate = (entry: LaboratoryHistoryEntry) =>
  entry.payload.collectedOn ?? entry.payload.reportedOn;

/** Literal values only: no conversions, censored values, scientific notation or inferred ranges. */
export function laboratoryHistoryNumber(value: string): number | null {
  const literal = value.trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(literal)) return null;
  if (/^[+-]?[1-9]\d{0,2}[.,]\d{3}$/.test(literal)) return null;
  const number = Number(literal.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function buildLaboratoryHistory(rows: LaboratoryHistoryEntry[]) {
  const groups = new Map<string, LaboratoryHistoryGroup>();
  const dates = new Set<string>();
  for (const entry of rows) {
    const p = entry.payload;
    // Unit, method, material and laboratory remain exact; no alias or clinical normalization.
    const id = JSON.stringify([
      p.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"),
      p.unit,
      p.method,
      p.material,
      p.laboratory,
    ]);
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name: p.name,
        unit: p.unit,
        method: p.method,
        material: p.material,
        laboratory: p.laboratory,
        entries: [],
      };
      groups.set(id, group);
    }
    group.entries.push(entry);
    dates.add(laboratoryHistoryDate(entry) ?? "undated");
  }
  return {
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    dates: [...dates].sort((a, b) =>
      a === "undated" ? 1 : b === "undated" ? -1 : a.localeCompare(b),
    ),
  };
}

/** Gaps and duplicates break lines; duplicates still retain every numeric point. */
export function laboratoryHistorySeries(group: LaboratoryHistoryGroup) {
  const byDate = new Map<string, LaboratoryHistoryEntry[]>();
  for (const entry of group.entries) {
    const date = laboratoryHistoryDate(entry);
    if (date) byDate.set(date, [...(byDate.get(date) ?? []), entry]);
  }
  const points: { id: string; date: string; value: number; entry: LaboratoryHistoryEntry }[] = [];
  const segments: { from: string; to: string }[] = [];
  let previous: string | null = null;
  for (const [date, entries] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const numeric = entries.flatMap((entry) => {
      const value = laboratoryHistoryNumber(entry.payload.result);
      return value === null ? [] : [{ id: entry.id, date, value, entry }];
    });
    points.push(...numeric);
    if (entries.length !== 1 || numeric.length !== 1) {
      previous = null;
      continue;
    }
    const point = numeric[0]!;
    if (previous && group.unit && group.method && group.material && group.laboratory)
      segments.push({ from: previous, to: point.id });
    previous = point.id;
  }
  return { points, segments };
}

export function laboratoryHistoryReference(
  entry: LaboratoryHistoryEntry,
): "low" | "within" | "high" | "unknown" {
  const value = laboratoryHistoryNumber(entry.payload.result);
  const match = entry.payload.reference
    ?.trim()
    .match(/^([+-]?\d+(?:[.,]\d+)?)\s*(?:a|até|–|—|-)\s*([+-]?\d+(?:[.,]\d+)?)$/);
  if (value === null || !match) return "unknown";
  const low = laboratoryHistoryNumber(match[1]!),
    high = laboratoryHistoryNumber(match[2]!);
  if (low === null || high === null || low > high) return "unknown";
  return value < low ? "low" : value > high ? "high" : "within";
}
