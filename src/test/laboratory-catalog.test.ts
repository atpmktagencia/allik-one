import { expect, it } from "vitest";
import { laboratoryCatalog, resolveLaboratoryCatalog } from "@/lib/laboratory-catalog";
import { laboratoryDisplayGroup } from "@/lib/laboratory-display-groups";
import { projectLaboratoryObservations } from "@/lib/laboratory-observations";
import { laboratoryScaleReview } from "@/lib/laboratory-scale";
import { emptyLaboratoryRow } from "@/lib/laboratory-results";
import { buildLaboratoryHistory, type LaboratoryHistoryEntry } from "@/lib/laboratory-history";
import { groupLaboratoryBiomarkers } from "@/lib/laboratory-biomarkers";
import {
  applicableLaboratoryReference,
  laboratoryResultColor,
  longitudinalModes,
  longitudinalGraphSeries,
} from "@/lib/laboratory-longitudinal-view";
function row(id: string, name: string, result = "1", date = "2026-01-01"): LaboratoryHistoryEntry {
  return {
    id,
    documentId: "d",
    reviewId: "r",
    documentTitle: "Sintético",
    previewUrl: "/original",
    payload: { ...emptyLaboratoryRow(), name, result, unit: "%", sourcePage: 2, collectedOn: date },
  };
}
it.each([
  "Hemácias",
  "CHCM",
  "HCM",
  "Blastos",
  "Células atípicas",
  "Mielócitos",
  "Metamielócitos",
  "Bastonetes",
  "Segmentados",
])("classifies %s in hematology", (name) =>
  expect(laboratoryDisplayGroup(name)).toBe("Hematologia"),
);
it.each([
  "INR",
  "RNI",
  "Atividade de protrombina",
  "TP",
  "Tempo de protrombina",
  "TTPa",
  "Fibrinogênio",
])("classifies %s in coagulation", (name) =>
  expect(laboratoryDisplayGroup(name)).toBe("Coagulação / Coagulograma"),
);
it.each(["Potássio", "K", "Na", "Cloreto", "Cálcio", "Magnésio", "Fósforo"])(
  "classifies %s as electrolyte/mineral",
  (name) => expect(laboratoryDisplayGroup(name)).toBe("Eletrólitos e minerais"),
);
it("resolves explicit aliases without merging distinct analytes or legitimate numbers", () => {
  expect(resolveLaboratoryCatalog("PROTEINA C REATIVA")?.name).toBe("Proteína C-reativa (PCR)");
  expect(resolveLaboratoryCatalog("PCR")?.id).toBe("pcr");
  expect(resolveLaboratoryCatalog("PCR ultrassensível")?.id).not.toBe("pcr");
  expect(resolveLaboratoryCatalog("Proteína C reativa 2")).toBeUndefined();
  // The inspected original itself says PCR 1: its suffix is NOT proven spurious.
  expect(resolveLaboratoryCatalog("PROTEINA C REATIVA 1")).toBeUndefined();
  expect(resolveLaboratoryCatalog("T3 livre")?.name).toBe("T3 Livre");
  expect(resolveLaboratoryCatalog("T4 total")?.name).toBe("T4 Total");
  expect(resolveLaboratoryCatalog("Vitamina B12")?.name).toBe("Vitamina B12");
  expect(resolveLaboratoryCatalog("HbA1c")?.name).toBe("HbA1c");
  expect(new Set(laboratoryCatalog.map((x) => x.id)).size).toBe(laboratoryCatalog.length);
});
it("groups synonyms while preserving distinct modalities and source payloads", () => {
  const rows = [row("a", "Eritrócitos"), row("b", "Hemácias")];
  rows[1]!.payload.unit = "/mm³";
  const before = JSON.stringify(rows);
  const groups = groupLaboratoryBiomarkers(buildLaboratoryHistory(rows).groups);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.name).toBe("Hemácias");
  expect(groups[0]!.modalities).toHaveLength(2);
  expect(JSON.stringify(rows)).toBe(before);
});
it("keeps narrative observations literal and separated by document/date/page", () => {
  const rows = [
    row("h", "Hemácias"),
    row("o", "Obs", "Hemácias normocíticas e normocrômicas. Linfócitos sem atipias."),
    row("p", "Obs", "Plaquetas normais em números.", "2026-02-01"),
    row("other", "Observações", "Conferir original"),
  ];
  rows[3]!.documentId = "another";
  const before = JSON.stringify(rows),
    projection = projectLaboratoryObservations(rows);
  expect(projection.results.map((x) => x.id)).toEqual(["h"]);
  expect(projection.observations.map((x) => x.group)).toEqual(["Hematologia", null, null]);
  expect(projection.observations[1]!.entry.payload.collectedOn).toBe("2026-02-01");
  expect(JSON.stringify(rows)).toBe(before);
});
it("does not guess an observation group on a mixed page or missing page", () => {
  const rows = [row("h", "Hemácias"), row("k", "Potássio"), row("o", "Obs", "Conferir original")];
  expect(projectLaboratoryObservations(rows).observations[0]!.group).toBeNull();
  rows[2]!.payload.sourcePage = null;
  expect(projectLaboratoryObservations(rows).observations[0]!.group).toBeNull();
});
it("keeps ambiguous erythrocyte values neutral, unconverted and out of numerical graphs", () => {
  const entry = row("h", "Hemácias", "4,630");
  entry.payload.unit = "/mm3";
  entry.payload.reference = "3.800.000 A 4.800.000/mm3";
  const before = JSON.stringify(entry),
    bio = groupLaboratoryBiomarkers(buildLaboratoryHistory([entry]).groups)[0]!,
    mode = longitudinalModes(bio)[0]!;
  expect(laboratoryScaleReview(entry)).toMatchObject({
    originalValue: "4,630",
    originalUnit: "/mm3",
    explicitScale: null,
    normalizedValue: null,
    conversionRule: null,
    needsReview: true,
  });
  expect(applicableLaboratoryReference(entry)).toBe("unknown");
  expect(laboratoryResultColor(entry, mode, bio.id).color).toBe("neutral");
  expect(longitudinalGraphSeries(mode.series[0]!).points).toHaveLength(0);
  expect(JSON.stringify(entry)).toBe(before);
  entry.payload.unit = "10⁶/µL";
  expect(laboratoryScaleReview(entry).explicitScale).toBe("10^6");
});
it("does not compare a reference expressed in a different unit", () => {
  const entry = row("k", "Potássio", "4,2");
  entry.payload.unit = "mmol/L";
  entry.payload.reference = "3 a 5 mg/dL";
  expect(applicableLaboratoryReference(entry)).toBe("unknown");
});
