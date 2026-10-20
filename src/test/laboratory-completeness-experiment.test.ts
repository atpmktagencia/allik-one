import { expect, it } from "vitest";
import { experimentLaboratoryInventory } from "@/lib/laboratory-completeness-experiment";
import { emptyLaboratoryRow, type LaboratoryRow } from "@/lib/laboratory-results";
const row = (patch: Partial<LaboratoryRow>) => ({ ...emptyLaboratoryRow(), ...patch });
it("independently identifies an omitted recognizable row without claiming whole-document coverage", () => {
  const pages = [{ page: 1, text: "Glicose: 90 mg/dL\nUreia: 30 mg/dL" }];
  const result = experimentLaboratoryInventory(pages, [
    { ...emptyLaboratoryRow(), name: "Glicose", result: "90", sourcePage: 1 },
  ]);
  expect(result).toMatchObject({ recognizableRows: 2, completenessProven: false });
  expect(result.possibleOmissions).toEqual([{ name: "Ureia", result: "30", page: 1, line: 2 }]);
});

it("separates a wrong current value from an actually missing parameter", () => {
  const result = experimentLaboratoryInventory(
    [{ page: 1, text: "Glicose: 90 mg/dL\nUreia: 30 mg/dL" }],
    [row({ name: "Glicose", result: "100", unit: "mg/dL", sourcePage: 1 })],
  );
  expect(result.possibleOmissions.map((source) => source.name)).toEqual(["Ureia"]);
  expect(result.diagnostics.valueMismatches).toEqual([
    {
      source: { name: "Glicose", result: "90", page: 1, line: 1 },
      predictionIndex: 0,
      actual: "100",
    },
  ]);
});

it("reports missing or incorrect provenance without mislabelling it as an omission", () => {
  for (const sourcePage of [null, 4]) {
    const result = experimentLaboratoryInventory(
      [{ page: 1, text: "Glicose: 90 mg/dL" }],
      [row({ name: "Glicose", result: "90", unit: "mg/dL", sourcePage })],
    );
    expect(result.possibleOmissions).toHaveLength(0);
    expect(result.diagnostics.provenanceMissing).toHaveLength(sourcePage === null ? 1 : 0);
    expect(result.diagnostics.pageMismatches).toHaveLength(sourcePage === null ? 0 : 1);
  }
});

it("keeps repeated results on different pages as separate occurrences", () => {
  const pages = [1, 2].map((page) => ({ page, text: "Glicose: 90 mg/dL" }));
  const result = experimentLaboratoryInventory(pages, [
    row({ name: "Glicose", result: "90", unit: "mg/dL", sourcePage: 1 }),
  ]);
  expect(result.recognizableRows).toBe(2);
  expect(result.possibleOmissions).toEqual([{ name: "Glicose", result: "90", page: 2, line: 1 }]);
  expect(result.diagnostics.ambiguousProvenance).toHaveLength(0);
});

it("does not assign a repeated parameter without provenance to an arbitrary page", () => {
  const result = experimentLaboratoryInventory(
    [1, 2].map((page) => ({ page, text: "Glicose: 90 mg/dL" })),
    [row({ name: "Glicose", result: "90", unit: "mg/dL" })],
  );
  expect(result.possibleOmissions).toHaveLength(0);
  expect(result.diagnostics.ambiguousProvenance).toMatchObject([
    { sources: [{ page: 1 }, { page: 2 }], predictionIndexes: [0] },
  ]);
  expect(result.completenessProven).toBe(false);
});

it("does not let a duplicate prediction satisfy two independent parameters", () => {
  const prediction = row({ name: "Glicose", result: "90", unit: "mg/dL", sourcePage: 1 });
  const result = experimentLaboratoryInventory(
    [{ page: 1, text: "Glicose: 90 mg/dL\nUreia: 30 mg/dL" }],
    [prediction, { ...prediction }],
  );
  expect(result.possibleOmissions.map((source) => source.name)).toEqual(["Ureia"]);
  expect(result.diagnostics.unmatchedPredictions).toMatchObject([
    { predictionIndex: 1, name: "Glicose" },
  ]);
});

it("reports unknown source for an extra prediction without asserting hallucination", () => {
  const result = experimentLaboratoryInventory(
    [{ page: 1, text: "Glicose 90 100 70 - 99 mg/dL" }],
    [row({ name: "Glicose", result: "90", unit: "mg/dL", sourcePage: 1 })],
  );
  expect(result.recognizableRows).toBe(0);
  expect(result.diagnostics.unmatchedPredictions[0]?.reason).toBe(
    "no_remaining_recognizable_source",
  );
  expect(result.coverage.pages[0]?.unknownLines).toEqual([
    { line: 1, reason: "unsupported_or_non_observation_text" },
  ]);
});

it("reports unit mismatch without conversion or changing the source value", () => {
  const result = experimentLaboratoryInventory(
    [{ page: 1, text: "T4 total: 1,2 µg/dL" }],
    [row({ name: "T4 total", result: "1,2", unit: "ng/dL", sourcePage: 1 })],
  );
  expect(result.possibleOmissions).toHaveLength(0);
  expect(result.diagnostics.unitMismatches).toMatchObject([{ expected: "μg/dL", actual: "ng/dL" }]);
  expect(result.diagnostics.valueMismatches).toHaveLength(0);
});

it("distinguishes current, historical and reference sections without counting metadata as analytes", () => {
  const result = experimentLaboratoryInventory(
    [
      {
        page: 1,
        text: "Paciente: 123456\nIdade: 53 anos\nColeta: 2026-01-15\nData histórica: 2025-01-15\nResultados anteriores\nGlicose: 100 mg/dL\nValores de referência\nGlicose: 70 mg/dL\nResultados atuais\nGlicose: 90 mg/dL",
      },
    ],
    [],
  );
  expect(result.recognizableRows).toBe(1);
  expect(result.possibleOmissions).toEqual([{ name: "Glicose", result: "90", page: 1, line: 10 }]);
  expect(result.coverage.pages[0]?.sections.map((s) => s.kind)).toEqual([
    "unspecified",
    "historical",
    "reference",
    "current",
  ]);
});

it("tracks missing pages and nontext pages independently of recognized rows", () => {
  const result = experimentLaboratoryInventory(
    [
      { page: 1, text: "Glicose: 90 mg/dL" },
      { page: 3, text: "" },
    ],
    [],
    { expectedPageCount: 3 },
  );
  expect(result.coverage).toMatchObject({
    basis: "supplied_native_text_lines",
    coordinatesAvailable: false,
    missingPages: [2],
    pages: [
      { page: 1, status: "recognized_text_only" },
      { page: 3, status: "no_independent_text" },
    ],
  });
  expect(result.completenessProven).toBe(false);
});

it("distinguishes a textual table from a flattened layout with unknown structure", () => {
  const result = experimentLaboratoryInventory(
    [
      {
        page: 1,
        text: "Exame | Resultado atual | Resultado anterior | Unidade\nGlicose | 90 | 100 | mg/dL\nUreia 30 28 10 - 50 mg/dL",
      },
    ],
    [],
  );
  expect(result.recognizableRows).toBe(1);
  expect(result.coverage.pages[0]).toMatchObject({
    status: "unrecognized_text_present",
    unknownLines: [{ line: 3 }],
  });
});
it("never claims completeness for scanned, flat, unknown or partial layouts", () => {
  for (const text of ["", "Glicose 90 100 70 - 99 mg/dL", "Glicose: ilegível"])
    expect(experimentLaboratoryInventory([{ page: 1, text }], [])).toMatchObject({
      recognizableRows: 0,
      completenessProven: false,
    });
});
