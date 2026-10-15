const quantityScale = 6;
const moneyScale = 4;
const quantityFactor = 10n ** BigInt(quantityScale);
const moneyFactor = 10n ** BigInt(moneyScale);

function fixed(value: string | number, scale: number) {
  const normalized = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match || (match[2]?.length ?? 0) > scale) throw new Error("Número decimal inválido.");
  return BigInt(match[1]!) * 10n ** BigInt(scale) + BigInt((match[2] ?? "").padEnd(scale, "0"));
}

function divideRounded(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error("Divisor inválido.");
  return (numerator + denominator / 2n) / denominator;
}

function format(value: bigint, scale: number) {
  const factor = 10n ** BigInt(scale);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const integer = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

export type DosePricingInput = {
  totalBaseQuantity: string;
  totalVolumeMl: string | null;
  acquisitionCost: string;
  additionalPresentationCost: string;
  technicalLossPercent: string;
  minimumMeasurableVolumeMl: string | null;
  doseQuantity: string;
  salePrice: string;
  materialCost: string;
};

export function calculateDosePricing(input: DosePricingInput) {
  const totalQuantity = fixed(input.totalBaseQuantity, quantityScale);
  const doseQuantity = fixed(input.doseQuantity, quantityScale);
  const lossPercent = fixed(input.technicalLossPercent, 4);
  if (totalQuantity <= 0n || doseQuantity <= 0n || lossPercent >= 1_000_000n)
    throw new Error("Quantidades ou perda técnica inválidas.");

  const usableQuantity = divideRounded(totalQuantity * (1_000_000n - lossPercent), 1_000_000n);
  const dosesPerPresentation = usableQuantity / doseQuantity;
  const probableRemainder = usableQuantity % doseQuantity;
  const acquisitionCost = fixed(input.acquisitionCost, moneyScale);
  const extraCost = fixed(input.additionalPresentationCost, moneyScale);
  const materialCost = fixed(input.materialCost, moneyScale);
  const salePrice = fixed(input.salePrice, 2) * 100n;
  const presentationCost = acquisitionCost + extraCost;
  const allocatedPresentationCost = dosesPerPresentation
    ? divideRounded(presentationCost, dosesPerPresentation)
    : presentationCost;
  const costPerDose = allocatedPresentationCost + materialCost;
  const marginPerDose = salePrice - costPerDose;
  const grossResult = dosesPerPresentation * (salePrice - materialCost) - presentationCost;

  let doseVolumeMl: bigint | null = null;
  let concentrationPerMl: bigint | null = null;
  let measurable: boolean | null = null;
  if (input.totalVolumeMl) {
    const volume = fixed(input.totalVolumeMl, quantityScale);
    if (volume <= 0n) throw new Error("Volume total inválido.");
    doseVolumeMl = divideRounded(doseQuantity * volume, totalQuantity);
    concentrationPerMl = divideRounded(totalQuantity * quantityFactor, volume);
    if (input.minimumMeasurableVolumeMl) {
      const increment = fixed(input.minimumMeasurableVolumeMl, quantityScale);
      measurable = increment > 0n && (doseQuantity * volume) % (totalQuantity * increment) === 0n;
    }
  }

  return {
    usableQuantity: format(usableQuantity, quantityScale),
    dosesPerPresentation: Number(dosesPerPresentation),
    probableRemainder: format(probableRemainder, quantityScale),
    concentrationPerMl:
      concentrationPerMl === null ? null : format(concentrationPerMl, quantityScale),
    doseVolumeMl: doseVolumeMl === null ? null : format(doseVolumeMl, quantityScale),
    measurable,
    presentationCost: format(presentationCost, moneyScale),
    costPerDose: format(costPerDose, moneyScale),
    marginPerDose: format(marginPerDose, moneyScale),
    grossResultPerPresentation: format(grossResult, moneyScale),
  };
}
