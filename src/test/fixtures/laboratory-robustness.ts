import { emptyLaboratoryRow, type LaboratoryRow } from "../../lib/laboratory-results";
import type { LaboratoryReference } from "../../lib/laboratory-benchmark";

/** Hand-authored synthetic truth, independent of any extractor/model output.
 * Rendered source text below is intentionally separate from these references.
 * Null dates in the ambiguous case mean unresolved source semantics, not known absence.
 */
export type LaboratoryRobustnessCase = {
  id: string;
  format: "digital" | "scanned";
  tags: string[];
  pages: string[];
  reference: LaboratoryReference[];
  notes: string;
  rendering?: "geometric-table" | "raster";
  raster?: string;
  expectedUnresolved?: {
    name: string;
    sourcePage: number;
    reason: "unreadable" | "ambiguous_date";
    fields?: ("collectedOn" | "reportedOn" | "issuedOn")[];
  }[];
};
const row = (patch: Partial<LaboratoryRow>): LaboratoryRow => ({
  ...emptyLaboratoryRow(),
  issuedOn: null,
  sourcePage: 1,
  ...patch,
});
const specimen = (
  id: string,
  tags: string[],
  pages: string[],
  expected: Partial<LaboratoryRow>[],
  notes: string,
  extra: Partial<LaboratoryRobustnessCase> = {},
): LaboratoryRobustnessCase => ({
  id,
  format: "digital",
  tags,
  pages,
  reference: expected.map((item, index) => ({ id: `${id}:${index + 1}`, row: row(item) })),
  notes,
  ...extra,
});
const notice = "DOCUMENTO SINTÉTICO — SOMENTE TESTE — SEM PACIENTE REAL";
export const laboratoryRobustnessCases: LaboratoryRobustnessCase[] = [
  specimen(
    "geometric-current-previous",
    ["geometric_table", "multiple_columns", "current_previous", "different_units"],
    [
      `${notice}\nTabela visual com cinco colunas. A coluna Resultado atual é a transcrição válida.\nExame    Resultado atual    Resultado anterior    Unidade    Referência\nGlicose    91    109    mg/dL    70 - 99\nUreia    32    41    mg/dL    10 - 50\nT4 livre    1,3    1,1    ng/dL    0,8 - 1,8`,
    ],
    [
      { name: "Glicose", result: "91", unit: "mg/dL", reference: "70 - 99" },
      { name: "Ureia", result: "32", unit: "mg/dL", reference: "10 - 50" },
      { name: "T4 livre", result: "1,3", unit: "ng/dL", reference: "0,8 - 1,8" },
    ],
    "PDF positions each cell independently; plain text separators do not encode table geometry. Prior values are not additional current observations.",
    { rendering: "geometric-table" },
  ),
  specimen(
    "many-pages-repeated-parameters",
    ["many_pages", "native_text_batches", "repeated_parameters", "iso_dates"],
    Array.from({ length: 8 }, (_, index) =>
      [
        notice,
        `Página ${index + 1} de 8 — cada página contém resultados atuais de uma coleta distinta.`,
        `Coleta: 2026-02-${String(index + 13).padStart(2, "0")}`,
        `Data do resultado: 2026-02-${String(index + 13).padStart(2, "0")}`,
        `TSH: ${["0,5", "0,7", "0,9", "1,1", "1,3", "1,5", "1,7", "1,9"][index]} mUI/L; Referência: 0,4 - 4,0; Resultado anterior: 2,9 mUI/L`,
        `T4 livre: ${["1,0", "1,1", "1,2", "1,3", "1,4", "1,5", "1,6", "1,7"][index]} ng/dL; Referência: 0,8 - 1,8`,
        "Anti-HCV: Não reagente; Referência: Não reagente",
      ].join("\n"),
    ),
    [
      ["0,5", "1,0", "2026-02-13"],
      ["0,7", "1,1", "2026-02-14"],
      ["0,9", "1,2", "2026-02-15"],
      ["1,1", "1,3", "2026-02-16"],
      ["1,3", "1,4", "2026-02-17"],
      ["1,5", "1,5", "2026-02-18"],
      ["1,7", "1,6", "2026-02-19"],
      ["1,9", "1,7", "2026-02-20"],
    ].flatMap(([tsh, t4, date], index) => [
      {
        name: "TSH",
        result: tsh!,
        unit: "mUI/L",
        reference: "0,4 - 4,0",
        collectedOn: date!,
        reportedOn: date!,
        sourcePage: index + 1,
      },
      {
        name: "T4 livre",
        result: t4!,
        unit: "ng/dL",
        reference: "0,8 - 1,8",
        collectedOn: date!,
        reportedOn: date!,
        sourcePage: index + 1,
      },
      {
        name: "Anti-HCV",
        result: "Não reagente",
        reference: "Não reagente",
        collectedOn: date!,
        reportedOn: date!,
        sourcePage: index + 1,
      },
    ]),
    "Twenty-four distinct observations: same analyte on another source page/date must not be silently deduplicated. All eight pages exceed the native-text batching threshold. Previous TSH values are not current results; Anti-HCV provides a repeated qualitative observation.",
  ),
  specimen(
    "scan-degraded",
    ["scanned", "degraded", "visual_extraction", "qualitative"],
    ["Raster-only synthetic source; see scan-degraded.png and raster-spec.json."],
    [
      { name: "TSH", result: "0,55", unit: "mUI/L", reference: "0,4 - 4,0" },
      { name: "Anti-HCV", result: "Não reagente", reference: "Não reagente" },
    ],
    "Deterministic downsample, blur, contrast loss and seeded pixel noise. Legibility requires inspecting raster; no text layer is provided to verifier.",
    { format: "scanned", rendering: "raster", raster: "scan-degraded.png" },
  ),
  specimen(
    "scan-rotated",
    ["scanned", "degraded", "rotated_90_degrees", "visual_extraction", "qualitative"],
    ["Raster-only synthetic source; see scan-rotated.png and raster-spec.json."],
    [
      { name: "TSH", result: "0,55", unit: "mUI/L", reference: "0,4 - 4,0" },
      { name: "Anti-HCV", result: "Não reagente", reference: "Não reagente" },
    ],
    "Degraded raster rotated by 90 degrees, embedded without orientation repair; no independent OCR is simulated.",
    { format: "scanned", rendering: "raster", raster: "scan-rotated.png" },
  ),
  specimen(
    "dates-explicit-ddmm",
    ["dates", "explicit_format", "numeric_ambiguity_resolved"],
    [
      `${notice}\nLaboratório: Laboratório Sintético Beta\nFormato das datas: DD/MM/AAAA\nColeta: 02/01/2026\nData do resultado: 04/01/2026\nEmissão: 05/01/2026\nMétodo: Quimioluminescência\nMaterial: Soro\nFerritina: 45.5 ng/mL`,
    ],
    [
      {
        name: "Ferritina",
        result: "45.5",
        unit: "ng/mL",
        collectedOn: "2026-01-02",
        reportedOn: "2026-01-04",
        issuedOn: "2026-01-05",
        laboratory: "Laboratório Sintético Beta",
        method: "Quimioluminescência",
        material: "Soro",
      },
    ],
    "Same numeric dates as Stage C but format is explicitly declared; expected interpretation is not inferred from language.",
  ),
  specimen(
    "dates-unambiguous-ddmm",
    ["dates", "day_greater_than_12", "explicit_roles"],
    [
      `${notice}\nColeta: 22/03/2026\nData do resultado: 23/03/2026\nEmissão: 24/03/2026\nFerritina: 46 ng/mL`,
    ],
    [
      {
        name: "Ferritina",
        result: "46",
        unit: "ng/mL",
        collectedOn: "2026-03-22",
        reportedOn: "2026-03-23",
        issuedOn: "2026-03-24",
      },
    ],
    "All day components exceed twelve, ruling out MM/DD without a locale assumption.",
  ),
  specimen(
    "dates-iso",
    ["dates", "iso", "explicit_roles"],
    [
      `${notice}\nColeta: 2026-03-22\nData do resultado: 2026-03-23\nEmissão: 2026-03-24\nVitamina B12: 480 pg/mL`,
    ],
    [
      {
        name: "Vitamina B12",
        result: "480",
        unit: "pg/mL",
        collectedOn: "2026-03-22",
        reportedOn: "2026-03-23",
        issuedOn: "2026-03-24",
      },
    ],
    "Unambiguous ISO source dates and distinct date roles.",
  ),
  specimen(
    "dates-ambiguous-no-format",
    ["dates", "ambiguous", "must_abstain"],
    [
      `${notice}\nColeta: 02/03/2026\nData do resultado: 04/03/2026\nEmissão: 05/03/2026\nDocumento sem convenção de formato de datas declarada.\nFerritina: 47 ng/mL`,
    ],
    [{ name: "Ferritina", result: "47", unit: "ng/mL" }],
    "Date values are present but both DD/MM and MM/DD are possible. Null structured dates plus uncertainty is expected; these are not genuinely absent fields.",
    {
      expectedUnresolved: [
        {
          name: "Ferritina",
          sourcePage: 1,
          reason: "ambiguous_date",
          fields: ["collectedOn", "reportedOn", "issuedOn"],
        },
      ],
    },
  ),
  specimen(
    "historical-dates-current-result",
    ["dates", "historical_date", "current_previous"],
    [
      `${notice}\nColeta: 2026-03-22\nData do resultado: 2026-03-23\nEmissão: 2026-03-24\nGlicose: 90 mg/dL; Referência: 70 - 99; Resultado anterior: 120 mg/dL\nHistórico de resultados\nData histórica: 2024-12-12\nGlicose: 120 mg/dL`,
    ],
    [
      {
        name: "Glicose",
        result: "90",
        unit: "mg/dL",
        reference: "70 - 99",
        collectedOn: "2026-03-22",
        reportedOn: "2026-03-23",
        issuedOn: "2026-03-24",
      },
    ],
    "The clearly labeled historical section is context only, not a second current observation or date source for the current row.",
  ),
  specimen(
    "reference-formats-qualitative",
    ["qualitative", "comparators", "reference_formats", "multiline_reference"],
    [
      `${notice}\nAnti-HCV: Não reagente; Referência: Não reagente\nProteína C reativa: <1 mg/L; Referência: <5 mg/L\nFerritina: 42 ng/mL\nReferência: Adultos: 20 - 250 ng/mL; Crianças: 7 - 140 ng/mL`,
    ],
    [
      { name: "Anti-HCV", result: "Não reagente", reference: "Não reagente" },
      { name: "Proteína C reativa", result: "<1", unit: "mg/L", reference: "<5 mg/L" },
      {
        name: "Ferritina",
        result: "42",
        unit: "ng/mL",
        reference: "Adultos: 20 - 250 ng/mL; Crianças: 7 - 140 ng/mL",
      },
    ],
    "Preserve full labeled reference text without selecting a population or inventing a universal ideal interval. Last reference is on the following line.",
  ),
  specimen(
    "similar-names-distinct-units",
    ["similar_names", "different_units", "no_unit_conversion"],
    [
      `${notice}\nT3 livre: 3,0 pg/mL\nT3 total: 120 ng/dL\nT4 livre: 1,2 ng/dL\nT4 total: 8,1 µg/dL`,
    ],
    [
      { name: "T3 livre", result: "3,0", unit: "pg/mL" },
      { name: "T3 total", result: "120", unit: "ng/dL" },
      { name: "T4 livre", result: "1,2", unit: "ng/dL" },
      { name: "T4 total", result: "8,1", unit: "µg/dL" },
    ],
    "Distinct named parameters and units; no prefix matching, unit scaling or cross-parameter normalization is authorized.",
  ),
  specimen(
    "scan-partially-masked",
    ["scanned", "partially_illegible", "masked_result", "must_abstain"],
    ["Raster-only source; Ferritina value permanently masked, no hidden PDF text."],
    [{ name: "TSH", result: "0,55", unit: "mUI/L", reference: "0,4 - 4,0" }],
    "Ferritina name and ng/mL unit remain visible but its value is genuinely covered in the raster. Do not score a hidden original number as a legible omission; any numeric Ferritina output is unsupported.",
    {
      format: "scanned",
      rendering: "raster",
      raster: "scan-partially-masked.png",
      expectedUnresolved: [{ name: "Ferritina", sourcePage: 1, reason: "unreadable" }],
    },
  ),
];
