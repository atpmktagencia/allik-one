import { expect, it } from "vitest";
import { emptyLaboratoryRow } from "@/lib/laboratory-results";
import { buildLaboratoryHistory, type LaboratoryHistoryEntry } from "@/lib/laboratory-history";
import { groupLaboratoryBiomarkers } from "@/lib/laboratory-biomarkers";
import {
  longitudinalModes,
  laboratoryResultColor,
  normalReference,
  laboratoryProvenanceLabel,
  type ApplicableIdealTarget,
} from "@/lib/laboratory-longitudinal-view";
const row = (id: string, lab = "UPA Bom Jardim"): LaboratoryHistoryEntry => ({
  id,
  reviewId: "r",
  documentId: "d",
  documentTitle: "Documento sintético",
  previewUrl: "/original",
  payload: {
    ...emptyLaboratoryRow(),
    name: "Basófilos (%)",
    result: "1",
    unit: "%",
    reference: "0 a 2",
    collectedOn: "2026-10-01",
    laboratory: lab,
    method: "Método A",
    material: "Sangue",
  },
});
const mode = (rows: LaboratoryHistoryEntry[]) =>
  longitudinalModes(groupLaboratoryBiomarkers(buildLaboratoryHistory(rows).groups)[0]!)[0]!;
const ideal: ApplicableIdealTarget = {
  id: "i",
  version: 1,
  authorId: "u",
  persisted: true,
  biomarker: "basofilos",
  modality: "PERCENTAGE",
  unit: "%",
  minimum: 0,
  maximum: 1,
  scope: "PATIENT",
  reason: "Meta sintética para teste",
  effectiveOn: "2026-01-01",
  active: true,
};
it("combines only the read projection while retaining separate exact laboratory series", () => {
  const rows = [row("a"), row("b", "UPA Cristo Redentor")];
  const before = JSON.stringify(rows);
  const m = mode(rows);
  expect(m.label).toBe("Percentual");
  expect(m.series).toHaveLength(2);
  expect(m.entries).toHaveLength(2);
  expect(JSON.stringify(rows)).toBe(before);
});
it("normalizes acronym typography without conflating locations", () => {
  expect(laboratoryProvenanceLabel(" U.P.A.   Bom Jardim ")).toBe("UPA Bom Jardim");
  expect(laboratoryProvenanceLabel("U PA Cristo Redentor")).toBe("UPA Cristo Redentor");
  expect(laboratoryProvenanceLabel("U P A Bom Jardim")).not.toBe(
    laboratoryProvenanceLabel("UPA Cristo Redentor"),
  );
});
it("shows varying reference rather than choosing one range for all collections", () => {
  const a = row("a"),
    b = row("b");
  b.payload.reference = "1 a 3";
  expect(normalReference([a, b])).toBe("Varia por coleta");
  expect(normalReference([a])).toBe("0 a 2");
});
it("normal without ideal remains neutral; abnormal is red even without ideal", () => {
  const a = row("a"),
    m = mode([a]);
  expect(laboratoryResultColor(a, m, "basofilos").color).toBe("neutral");
  const abnormal = { ...a, payload: { ...a.payload, result: "3" } };
  expect(laboratoryResultColor(abnormal, m, "basofilos").color).toBe("red");
  expect(
    laboratoryResultColor({ ...a, payload: { ...a.payload, result: "-1" } }, m, "basofilos").color,
  ).toBe("red");
});
it("green requires both normal and valid ideal, yellow indicates normal outside ideal", () => {
  const a = row("a"),
    m = mode([a]);
  expect(laboratoryResultColor(a, m, "basofilos", ideal).color).toBe("green");
  expect(
    laboratoryResultColor({ ...a, payload: { ...a.payload, result: "1,5" } }, m, "basofilos", ideal)
      .color,
  ).toBe("yellow");
});
it.each([
  { unit: "/mm³" },
  { modality: "ABSOLUTE" },
  { biomarker: "eosinofilos" },
  { effectiveOn: "2027-01-01" },
  { active: false },
  { minimum: 2, maximum: 1 },
])("rejects incompatible or invalid target %j", (change) => {
  const a = row("a");
  expect(laboratoryResultColor(a, mode([a]), "basofilos", { ...ideal, ...change }).color).toBe(
    "neutral",
  );
});
it("does not color missing units, qualitative or missing dates against an ideal", () => {
  const a = row("a"),
    m = mode([a]);
  expect(
    laboratoryResultColor({ ...a, payload: { ...a.payload, unit: null } }, m, "basofilos", ideal)
      .color,
  ).toBe("neutral");
  expect(
    laboratoryResultColor(
      { ...a, payload: { ...a.payload, result: "não reagente" } },
      m,
      "basofilos",
      ideal,
    ).color,
  ).toBe("neutral");
  expect(
    laboratoryResultColor(
      { ...a, payload: { ...a.payload, collectedOn: null } },
      m,
      "basofilos",
      ideal,
    ).color,
  ).toBe("neutral");
});
