import { expect, it } from "vitest";
import {
  buildLaboratoryHistory,
  laboratoryHistorySeries,
  type LaboratoryHistoryEntry,
} from "@/lib/laboratory-history";
import { groupLaboratoryBiomarkers } from "@/lib/laboratory-biomarkers";
import { emptyLaboratoryRow } from "@/lib/laboratory-results";

function entry(
  id: string,
  name: string,
  unit: string | null,
  result = "1",
): LaboratoryHistoryEntry {
  return {
    id,
    reviewId: "r",
    documentId: "d",
    documentTitle: "Sintético",
    previewUrl: "/original",
    payload: {
      ...emptyLaboratoryRow(),
      name,
      unit,
      result,
      collectedOn: "2026-01-01",
      method: "M",
      material: "Sangue",
      laboratory: "Lab sintético",
      reference: "0 a 2",
    },
  };
}
const group = (rows: LaboratoryHistoryEntry[]) =>
  groupLaboratoryBiomarkers(buildLaboratoryHistory(rows).groups);

it.each(["Basófilos", "Eosinófilos", "Neutrófilos", "Linfócitos", "Monócitos"])(
  "presents %s once, percentage first, without guessing missing units",
  (name) => {
    const rows = [
      entry("a", `${name} (absoluto)`, "/mm³", "80"),
      entry("p", `${name} (%)`, "%"),
      entry("u", `${name} com unidade não informada`, null, "0,5"),
    ];
    const snapshot = JSON.stringify(rows);
    const biomarkers = group(rows);
    expect(biomarkers).toHaveLength(1);
    expect(biomarkers[0]!.name).toBe(name);
    expect(biomarkers[0]!.modalities.map((m) => m.modality)).toEqual([
      "PERCENTAGE",
      "ABSOLUTE",
      "UNRESOLVED",
    ]);
    expect(JSON.stringify(rows)).toBe(snapshot);
  },
);
it("keeps conflicting name/unit unresolved even with a plausible numerical value", () => {
  const b = group([
    entry("a", "Basófilos (absoluto)", "%", "0,1"),
    entry("p", "Basófilos (%)", "/mm³", "100"),
    entry("u", "Basófilos (%)", null),
  ])[0]!;
  expect(b.modalities.every((m) => m.modality === "UNRESOLVED")).toBe(true);
});
it("shares display identity across aliases but keeps units, methods and labs exact", () => {
  const rows = [
    entry("p1", "Basófilos", "%"),
    entry("p2", "basofilos (%)", "%"),
    entry("a1", "Basófilos (contagem)", "/mm³"),
    entry("a2", "Basófilos", "/µL"),
  ];
  rows.push({
    ...entry("m", "Basófilos", "%"),
    payload: { ...rows[0]!.payload, method: "Outro método" },
  });
  const b = group(rows)[0]!;
  expect(b.modalities).toHaveLength(4);
  expect(
    b.modalities
      .find((m) => m.entries.length === 2)
      ?.entries.map((e) => e.id)
      .sort(),
  ).toEqual(["p1", "p2"]);
  const abs = b.modalities.filter((m) => m.modality === "ABSOLUTE");
  expect(abs.map((m) => m.unit).sort()).toEqual(["/mm³", "/µL"].sort());
});
it("does not conflate clinically different qualifiers or similar analytes", () => {
  expect(
    group([
      entry("a", "T3 livre", "pg/mL"),
      entry("b", "T3 total", "ng/dL"),
      entry("c", "Neutrófilos imaturos", "%"),
      entry("d", "Neutrófilos", "%"),
    ]),
  ).toHaveLength(4);
});
it("builds a graph only from the chosen exact modality, preserving dates and original IDs", () => {
  const rows = [
    entry("p1", "Basófilos (%)", "%", "1"),
    entry("p2", "Basófilos", "%", "2"),
    entry("a1", "Basófilos (absoluto)", "/mm³", "80"),
  ];
  rows[1]!.payload.collectedOn = "2026-02-01";
  const b = group(rows)[0]!;
  const series = laboratoryHistorySeries(b.modalities[0]!);
  expect(series.points.map((p) => p.value)).toEqual([1, 2]);
  expect(series.points.map((p) => p.entry.documentId)).toEqual(["d", "d"]);
  expect(series.segments).toHaveLength(1);
});

it.each(["Linfócitos atípicos", "Plaquetas"])(
  "groups %s display suffixes without losing the clinical base",
  (name) => {
    const b = group([
      entry("a", name, "/mm³"),
      entry("b", name + " (contagem)", "/mm³"),
      entry("p", name + " (percentual)", "%"),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]!.name).toBe(name);
    expect(b[0]!.modalities).toHaveLength(2);
    expect(b[0]!.modalities.find((m) => m.modality === "ABSOLUTE")!.entries).toHaveLength(2);
  },
);
it("keeps platelet unit scales separate inside one visual biomarker", () => {
  const b = group([entry("a", "PLAQUETAS", "/mm3"), entry("b", "Plaquetas - contagem", "10^9/L")]);
  expect(b).toHaveLength(1);
  expect(b[0]!.modalities).toHaveLength(2);
  expect(b[0]!.modalities.map((m) => m.unit)).toEqual(expect.arrayContaining(["/mm3", "10^9/L"]));
});

it("rejects a count-unit name paired with a percentage unit", () => {
  expect(group([entry("x", "Basófilos (/mm³)", "%")])[0]!.modalities[0]!.modality).toBe(
    "UNRESOLVED",
  );
});
