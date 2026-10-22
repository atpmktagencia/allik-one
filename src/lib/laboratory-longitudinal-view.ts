import { laboratoryScaleReview } from "./laboratory-scale";
import { z } from "zod";
import { laboratoryDate } from "./laboratory-results";
import {
  laboratoryHistoryDate,
  laboratoryHistoryNumber,
  laboratoryHistorySeries,
  type LaboratoryHistoryEntry,
  type LaboratoryHistoryGroup,
} from "./laboratory-history";
import type { LaboratoryBiomarker, LaboratoryModality } from "./laboratory-biomarkers";

export type LongitudinalMode = {
  id: string;
  modality: LaboratoryModality["modality"];
  label: string;
  unit: string | null;
  series: LaboratoryHistoryGroup[];
  entries: LaboratoryHistoryEntry[];
};
/** Metadata never determines the main row or mode selector. Exact source series remain intact. */
export function longitudinalModes(biomarker: LaboratoryBiomarker): LongitudinalMode[] {
  const modes = new Map<string, LongitudinalMode>();
  for (const series of biomarker.modalities) {
    const id = JSON.stringify([series.modality, series.unit]);
    let mode = modes.get(id);
    if (!mode) {
      mode = {
        id,
        modality: series.modality,
        label:
          series.modality === "PERCENTAGE"
            ? "Percentual"
            : series.modality === "ABSOLUTE"
              ? "Absoluto"
              : series.modality === "UNRESOLVED"
                ? "Não resolvido"
                : "Resultado",
        unit: series.unit,
        series: [],
        entries: [],
      };
      modes.set(id, mode);
    }
    mode.series.push(series);
    mode.entries.push(...series.entries);
  }
  const result = [...modes.values()];
  return result.map((mode) => ({
    ...mode,
    label:
      result.filter((m) => m.label === mode.label).length > 1
        ? `${mode.label} · ${mode.unit ?? "sem unidade"}`
        : mode.label,
  }));
}
export function normalReference(entries: LaboratoryHistoryEntry[]) {
  const references = new Set(entries.map((e) => e.payload.reference?.trim() || null));
  return references.size > 1 ? "Varia por coleta" : ([...references][0] ?? "Não informada");
}
// Text-only normalization for provenance labels; never a key for numerical compatibility.
export function laboratoryProvenanceLabel(value: string) {
  return value
    .trim()
    .replace(/\bU[\s.]*P[\s.]*A\b\.?/gi, "UPA")
    .replace(/\s+/g, " ");
}
export const idealTargetDraft = z
  .object({
    biomarker: z.string().min(1),
    modality: z.string().min(1),
    unit: z.string().min(1),
    minimum: z.number().finite(),
    maximum: z.number().finite(),
    scope: z.enum(["ORGANIZATION", "PROFESSIONAL", "PATIENT"]),
    reason: z.string().trim().min(10).max(1000),
    effectiveOn: laboratoryDate,
    active: z.boolean(),
  })
  .refine((t) => t.minimum <= t.maximum, { message: "O mínimo não pode superar o máximo." });
export type IdealTargetDraft = z.infer<typeof idealTargetDraft>;
export type ApplicableIdealTarget = IdealTargetDraft & {
  id: string;
  version: number;
  authorId: string;
  persisted: true;
};
const unitText = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/μ/g, "µ")
    .replace(/\s/g, "")
    .replace(/\/(d|m|u|µ)?l$/i, (_, prefix: string | undefined) => `/${prefix ?? ""}L`);
/** Explicit same-unit annotations only; no unit conversion or inferred interval. */
export function applicableLaboratoryNumber(value: string, unit: string): number | null {
  const number = laboratoryHistoryNumber(value);
  if (number !== null) return number;
  const match = value.trim().match(/^([+-]?\d+(?:[.,]\d+)?)\s*(.+)$/);
  return match && unitText(match[2]!) === unitText(unit)
    ? laboratoryHistoryNumber(match[1]!)
    : null;
}
/** Derived graph numbers retain the original entry for provenance and never write payloads. */
export function longitudinalGraphSeries(group: LaboratoryHistoryGroup) {
  const originals = new Map(group.entries.map((e) => [e.id, e]));
  const series = laboratoryHistorySeries({
    ...group,
    entries: group.entries.map((entry) => {
      const value = entry.payload.unit
        ? applicableLaboratoryNumber(entry.payload.result, entry.payload.unit)
        : laboratoryHistoryNumber(entry.payload.result);
      return value === null
        ? entry
        : { ...entry, payload: { ...entry.payload, result: String(value) } };
    }),
  });
  return { ...series, points: series.points.map((p) => ({ ...p, entry: originals.get(p.id)! })) };
}
export function applicableLaboratoryReference(
  entry: LaboratoryHistoryEntry,
): "low" | "within" | "high" | "unknown" {
  const unit = entry.payload.unit;
  if (!unit) return "unknown";
  const value = applicableLaboratoryNumber(entry.payload.result, unit);
  if (value === null) return "unknown";
  const ref = entry.payload.reference?.trim() ?? "";
  const range = ref.match(
    /^([+-]?\d+(?:[.,]\d+)?)\s*(?:a|até|–|—|-)\s*([+-]?\d+(?:[.,]\d+)?)\s*(.*?)$/i,
  );
  if (range) {
    const low = laboratoryHistoryNumber(range[1]!),
      high = laboratoryHistoryNumber(range[2]!);
    if (
      low === null ||
      high === null ||
      low > high ||
      (range[3] && unitText(range[3]) !== unitText(unit))
    )
      return "unknown";
    return value < low ? "low" : value > high ? "high" : "within";
  }
  const upper = ref.match(/^(?:até|ate|<=|≤)\s*([+-]?\d+(?:[.,]\d+)?)\s*(.*?)$/i);
  if (upper) {
    const high = laboratoryHistoryNumber(upper[1]!);
    if (high === null || (upper[2] && unitText(upper[2]) !== unitText(unit))) return "unknown";
    return value > high ? "high" : "within";
  }
  return "unknown";
}
export type ResultColor = { color: "green" | "yellow" | "red" | "neutral"; explanation: string };
/** A draft is deliberately not accepted here. Caller must resolve authorized scope first. */
export function laboratoryResultColor(
  entry: LaboratoryHistoryEntry,
  mode: LongitudinalMode,
  biomarker: string,
  target?: ApplicableIdealTarget,
): ResultColor {
  if (mode.modality === "UNRESOLVED" || !entry.payload.unit || entry.payload.unit !== mode.unit)
    return {
      color: "neutral",
      explanation: "Unidade ou modalidade não resolvida; classificação não demonstrável.",
    };
  const scale = laboratoryScaleReview(entry);
  if (scale.needsReview) return { color: "neutral", explanation: scale.reason! };
  const normal = applicableLaboratoryReference(entry);
  if (normal === "low" || normal === "high")
    return {
      color: "red",
      explanation:
        normal === "low"
          ? "Abaixo da referência laboratorial desta coleta."
          : "Acima da referência laboratorial desta coleta.",
    };
  if (normal !== "within")
    return {
      color: "neutral",
      explanation: "Referência laboratorial não comparável automaticamente.",
    };
  const date = laboratoryHistoryDate(entry);
  const valid =
    target?.persisted === true &&
    idealTargetDraft.safeParse(target).success &&
    target.active &&
    target.biomarker === biomarker &&
    target.modality === mode.modality &&
    target.unit === mode.unit &&
    date &&
    target.effectiveOn <= date;
  if (!valid)
    return {
      color: "neutral",
      explanation:
        "Dentro da referência laboratorial; sem meta ideal válida aplicável a esta coleta.",
    };
  const value = applicableLaboratoryNumber(entry.payload.result, mode.unit!)!;
  return value >= target.minimum && value <= target.maximum
    ? { color: "green", explanation: "Dentro da referência laboratorial e da meta ideal válida." }
    : {
        color: "yellow",
        explanation: "Dentro da referência laboratorial, mas fora da meta ideal válida.",
      };
}
