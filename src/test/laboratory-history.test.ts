import { expect, it } from "vitest";
import { emptyLaboratoryRow } from "@/lib/laboratory-results";
import {
  buildLaboratoryHistory,
  laboratoryHistoryNumber,
  laboratoryHistoryReference,
  laboratoryHistorySeries,
  type LaboratoryHistoryEntry,
} from "@/lib/laboratory-history";
function entry(
  id: string,
  result: string,
  collectedOn: string | null = "2026-01-01",
  extra = {},
): LaboratoryHistoryEntry {
  return {
    id,
    reviewId: "review",
    documentId: "document",
    documentTitle: "PDF",
    previewUrl: "/private",
    payload: {
      ...emptyLaboratoryRow(),
      name: "TSH",
      result,
      unit: "mIU/L",
      method: "Método A",
      material: "Plasma",
      laboratory: "Laboratório A",
      collectedOn,
      ...extra,
    },
  };
}
it("groups names conservatively and separates exact units, methods, material and laboratories", () => {
  const history = buildLaboratoryHistory([
    entry("1", "1"),
    entry("2", "2", null, { name: " tsh  " }),
    entry("3", "3", null, { unit: "miu/l" }),
    entry("4", "4", null, { method: "método A" }),
    entry("5", "5", null, { material: "Soro" }),
    entry("6", "6", null, { laboratory: "Outro" }),
  ]);
  expect(history.groups).toHaveLength(5);
  expect(history.groups.find((g) => g.entries.length === 2)?.entries.map((e) => e.id)).toEqual([
    "1",
    "2",
  ]);
  expect(history.dates).toEqual(["2026-01-01", "undated"]);
});
it("uses collection or result date and never invents a date", () => {
  expect(
    buildLaboratoryHistory([
      entry("1", "2", null, { reportedOn: "2026-02-01" }),
      entry("2", "3", null),
    ]).dates,
  ).toEqual(["2026-02-01", "undated"]);
});
it("preserves numeric points but breaks lines through censored values and duplicate dates", () => {
  const rows = [
    entry("1", "1", "2026-01-01"),
    entry("2", "2", "2026-01-02"),
    entry("3", "<3", "2026-01-03"),
    entry("4", "4", "2026-01-04"),
    entry("5", "5", "2026-01-05"),
    entry("6", "6", "2026-01-05"),
    entry("7", "7", "2026-01-06"),
    entry("8", "8", null),
  ];
  const series = laboratoryHistorySeries(buildLaboratoryHistory(rows).groups[0]!);
  expect(series.points.map((p) => p.id)).toEqual(["1", "2", "4", "5", "6", "7"]);
  expect(series.segments).toEqual([{ from: "1", to: "2" }]);
});
it("only accepts simple numeric literals without conversion", () => {
  expect(laboratoryHistoryNumber("0,25")).toBe(0.25);
  expect(laboratoryHistoryNumber("-1.5")).toBe(-1.5);
  for (const value of ["<0,1", "Não reagente", "1,000.5", "1e3", "", "1 mg", "1.234", "1,234"])
    expect(laboratoryHistoryNumber(value)).toBeNull();
});

it("does not connect points when comparison metadata is unknown", () => {
  const rows = [
    entry("1", "0,955", "2026-01-01", { method: null }),
    entry("2", "0,8", "2026-01-02", { method: null }),
  ];
  const series = laboratoryHistorySeries(buildLaboratoryHistory(rows).groups[0]!);
  expect(series.points).toHaveLength(2);
  expect(series.segments).toEqual([]);
});

it("compares only complete simple laboratory ranges, never clinical targets or ambiguous numbers", () => {
  expect(laboratoryHistoryReference(entry("1", "0,5", null, { reference: "0,2 a 4" }))).toBe(
    "within",
  );
  expect(laboratoryHistoryReference(entry("1", "0,1", null, { reference: "0,2 - 4" }))).toBe("low");
  expect(laboratoryHistoryReference(entry("1", "5", null, { reference: "0,2–4" }))).toBe("high");
  for (const reference of [
    "Adultos 0,2 a 4",
    "0,2 a 4 mg",
    "<4",
    "1,234 a 5",
    "4 a 2",
    "Não reagente",
  ])
    expect(laboratoryHistoryReference(entry("1", "3", null, { reference }))).toBe("unknown");
  expect(laboratoryHistoryReference(entry("1", "<0,1", null, { reference: "0 a 4" }))).toBe(
    "unknown",
  );
});
