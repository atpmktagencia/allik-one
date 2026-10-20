import { emptyLaboratoryRow, type LaboratoryRow } from "../../lib/laboratory-results";
import type { LaboratoryReference } from "../../lib/laboratory-benchmark";

const row = (patch: Partial<LaboratoryRow>): LaboratoryRow => ({
  ...emptyLaboratoryRow(),
  sourcePage: 1,
  ...patch,
});
export type LaboratoryBenchmarkCase = {
  id: string;
  format: "digital" | "scanned";
  pages: string[];
  reference: LaboratoryReference[];
  predictions: LaboratoryRow[];
  /** Expected evidence eligibility, independently specified for each controlled prediction. */
  trust: boolean[];
};
function sample(
  id: string,
  pages: string[],
  expected: LaboratoryRow[],
  predicted = expected,
  trust = predicted.map(() => true),
  format: "digital" | "scanned" = "digital",
): LaboratoryBenchmarkCase {
  return {
    id,
    pages,
    format,
    reference: expected.map((r, i) => ({ id: `${id}:${i + 1}`, row: r })),
    predictions: predicted.map((r) => ({ ...r, verified: false })),
    trust,
  };
}
const hb = row({
  name: "HEMOGLOBINA",
  result: "13,1",
  unit: "g/dL",
  reference: "12,0 - 16,0",
  evidence: "HEMOGLOBINA........: 13,1 g/dL Referência: 12,0 - 16,0",
});
const glucose = row({
  name: "Glicose",
  result: "90",
  unit: "mg/dL",
  reference: "70 - 99",
  evidence: "Glicose: 90 mg/dL; Referência: 70 - 99; Resultado anterior: 100 mg/dL",
});
const tsh = row({
  name: "TSH",
  result: "<0,1",
  unit: "mUI/L",
  reference: "0,4 - 4,0",
  evidence: "TSH: <0,1 mUI/L; Referência: 0,4 - 4,0",
});
const qualitative = row({
  name: "Anti-HCV",
  result: "Não reagente",
  evidence: "Anti-HCV: Não reagente",
});
const dates = row({
  name: "Ferritina",
  result: "45.5",
  unit: "ng/mL",
  collectedOn: "2026-01-02",
  reportedOn: "2026-01-04",
  laboratory: "Laboratório Sintético Alfa",
  method: "Quimioluminescência",
  material: "Soro",
  evidence: "Ferritina: 45.5 ng/mL",
});
const datePage =
  "Laboratório: Laboratório Sintético Alfa\nColeta: 02/01/2026\nData do resultado: 04/01/2026\nEmissão: 05/01/2026\nMétodo: Quimioluminescência\nMaterial: Soro\n" +
  dates.evidence;
const table =
  "Exame | Resultado atual | Resultado anterior | Referência\nGlicose | 90 mg/dL | 100 mg/dL | 70 - 99 mg/dL\nUreia | 30 mg/dL | 28 mg/dL | 10 - 50 mg/dL";
const tableRows = [
  row({ ...glucose, evidence: table.split("\n")[1]! }),
  row({
    name: "Ureia",
    result: "30",
    unit: "mg/dL",
    reference: "10 - 50 mg/dL",
    evidence: table.split("\n")[2]!,
  }),
];
const similar = [
  row({ name: "T4 livre", result: "1,2", unit: "ng/dL", evidence: "T4 livre: 1,2 ng/dL" }),
  row({ name: "T4 total", result: "1,2", unit: "µg/dL", evidence: "T4 total: 1,2 µg/dL" }),
];
const flat = "Glicose 90 100 70 - 99 mg/dL";
export const laboratoryBenchmarkCases: LaboratoryBenchmarkCase[] = [
  sample("dotted-names", [hb.evidence!], [hb]),
  sample("current-and-previous", [glucose.evidence!], [glucose]),
  sample(
    "previous-as-current",
    [glucose.evidence!],
    [glucose],
    [{ ...glucose, result: "100" }],
    [false],
  ),
  sample(
    "reference-as-current",
    [glucose.evidence!],
    [glucose],
    [{ ...glucose, result: "99" }],
    [false],
  ),
  sample("multi-column", [table], tableRows),
  sample(
    "multi-column-swapped",
    [table],
    tableRows,
    [{ ...tableRows[0]!, result: "100" }, tableRows[1]!],
    [false, true],
  ),
  sample("similar-names-equal-values", [similar.map((r) => r.evidence).join("\n")], similar),
  sample(
    "wrong-unit",
    [similar.map((r) => r.evidence).join("\n")],
    similar,
    [
      { ...similar[0]!, unit: "µg/dL", evidence: similar.map((r) => r.evidence).join("\n") },
      similar[1]!,
    ],
    [false, true],
  ),
  sample(
    "comparator-and-qualitative",
    [tsh.evidence! + "\n" + qualitative.evidence],
    [tsh, qualitative],
  ),
  sample("lost-comparator", [tsh.evidence!], [tsh], [{ ...tsh, result: "0,1" }], [false]),
  sample("dates-and-metadata", [datePage], [dates]),
  sample(
    "contradictory-dates",
    [datePage],
    [dates],
    [{ ...dates, collectedOn: "2026-01-06" }],
    [false],
  ),
  sample(
    "unsupported-metadata",
    [datePage],
    [dates],
    [{ ...dates, method: "Método inventado" }],
    [false],
  ),
  sample("absent-information", [qualitative.evidence!], [qualitative]),
  sample(
    "unsupported-date",
    [qualitative.evidence!],
    [qualitative],
    [{ ...qualitative, reportedOn: "2026-01-04" }],
    [false],
  ),
  sample(
    "multiple-pages",
    [tsh.evidence!, qualitative.evidence!],
    [tsh, { ...qualitative, sourcePage: 2 }],
  ),
  sample("deliberate-omission", [similar.map((r) => r.evidence).join("\n")], similar, [
    similar[0]!,
  ]),
  sample(
    "invented-result",
    [qualitative.evidence!],
    [qualitative],
    [
      qualitative,
      row({ name: "Vitamina inexistente", result: "50", evidence: "Vitamina inexistente: 50" }),
    ],
    [true, false],
  ),
  sample(
    "ambiguous-flattened-table",
    [flat],
    [row({ ...glucose, evidence: flat })],
    [row({ ...glucose, evidence: flat })],
    [false],
  ),
  sample(
    "partially-legible",
    ["TSH: [ilegível] mUI/L"],
    [tsh],
    [{ ...tsh, evidence: "TSH: [ilegível] mUI/L" }],
    [false],
  ),
  sample(
    "scanned",
    ["Laboratório Sintético - documento sem camada textual\n" + tsh.evidence],
    [tsh],
    [tsh],
    [false],
    "scanned",
  ),
];
