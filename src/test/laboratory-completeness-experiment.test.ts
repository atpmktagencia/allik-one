import { expect, it } from "vitest";
import { experimentLaboratoryInventory } from "@/lib/laboratory-completeness-experiment";
import { emptyLaboratoryRow } from "@/lib/laboratory-results";
it("independently identifies an omitted recognizable row without claiming whole-document coverage", () => {
  const pages = [{ page: 1, text: "Glicose: 90 mg/dL\nUreia: 30 mg/dL" }];
  const result = experimentLaboratoryInventory(pages, [
    { ...emptyLaboratoryRow(), name: "Glicose", result: "90", sourcePage: 1 },
  ]);
  expect(result).toMatchObject({ recognizableRows: 2, completenessProven: false });
  expect(result.possibleOmissions).toEqual([{ name: "Ureia", result: "30", page: 1, line: 2 }]);
});
it("never claims completeness for scanned, flat, unknown or partial layouts", () => {
  for (const text of ["", "Glicose 90 100 70 - 99 mg/dL", "Glicose: ilegível"])
    expect(experimentLaboratoryInventory([{ page: 1, text }], [])).toMatchObject({
      recognizableRows: 0,
      completenessProven: false,
    });
});
