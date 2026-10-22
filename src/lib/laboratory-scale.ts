import type { LaboratoryHistoryEntry } from "./laboratory-history";
import { laboratoryHistoryNumber } from "./laboratory-history";
/** No conversion from magnitude. This projection only identifies explicitly written scales. */
export function laboratoryScaleReview(entry: LaboratoryHistoryEntry) {
  const { result, unit, evidence } = entry.payload;
  const explicitScale = unit && /(?:10\^?6|10⁶|milh[oõ]es)/i.test(unit) ? "10^6" : null;
  const ambiguousNumber =
    /^[+-]?\d{1,3}[.,]\d{3}$/.test(result.trim()) && laboratoryHistoryNumber(result) === null;
  return {
    originalValue: result,
    originalUnit: unit,
    explicitScale,
    normalizedValue: null,
    conversionRule: null,
    evidence,
    needsReview: ambiguousNumber,
    reason: ambiguousNumber
      ? "Separador e escala não demonstrados; conferir o valor e a unidade no original. Nenhuma conversão aplicada."
      : null,
  };
}
