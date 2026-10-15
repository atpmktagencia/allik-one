import { describe, expect, it } from "vitest";
import { calculateDosePricing } from "@/data/dose-pricing";

const tirzepatide = {
  totalBaseQuantity: "20",
  totalVolumeMl: "0.8",
  acquisitionCost: "591.40",
  additionalPresentationCost: "0",
  technicalLossPercent: "0",
  minimumMeasurableVolumeMl: "0.01",
  materialCost: "0",
};

describe("fractional dose pricing", () => {
  it("calculates the 2.5 mg and 5 mg Tirzepatide offers exactly", () => {
    expect(
      calculateDosePricing({ ...tirzepatide, doseQuantity: "2.5", salePrice: "250" }),
    ).toMatchObject({
      concentrationPerMl: "25",
      doseVolumeMl: "0.1",
      dosesPerPresentation: 8,
      probableRemainder: "0",
      measurable: true,
      costPerDose: "73.925",
      marginPerDose: "176.075",
      grossResultPerPresentation: "1408.6",
    });
    expect(
      calculateDosePricing({ ...tirzepatide, doseQuantity: "5", salePrice: "500" }),
    ).toMatchObject({ doseVolumeMl: "0.2", dosesPerPresentation: 4, measurable: true });
  });

  it("distinguishes numeric precision from physical measurability", () => {
    expect(
      calculateDosePricing({ ...tirzepatide, doseQuantity: "2.4", salePrice: "250" }),
    ).toMatchObject({ doseVolumeMl: "0.096", measurable: false });
    expect(
      calculateDosePricing({
        ...tirzepatide,
        minimumMeasurableVolumeMl: "0.001",
        doseQuantity: "2.4",
        salePrice: "250",
      }),
    ).toMatchObject({ doseVolumeMl: "0.096", measurable: true });
  });

  it("applies technical loss before calculating yield and remainder", () => {
    expect(
      calculateDosePricing({
        ...tirzepatide,
        technicalLossPercent: "4",
        doseQuantity: "5",
        salePrice: "500",
      }),
    ).toMatchObject({ usableQuantity: "19.2", dosesPerPresentation: 3, probableRemainder: "4.2" });
  });
});
