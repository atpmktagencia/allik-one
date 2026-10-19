import { describe, expect, it } from "vitest";
import { administrationCountCheck } from "@/data/encounter-prescription";
const item = {
  frequencyEvery: 1,
  frequencyUnit: "WEEK",
  durationAmount: 4,
  durationUnit: "WEEK",
  continuousUse: false,
  plannedAdministrations: 4,
};
describe("administration quantity consistency, without therapeutic inference", () => {
  it("checks one administration at each interval including the start", () => {
    expect(administrationCountCheck(item)).toEqual({ expected: 4, needsReason: false });
    expect(administrationCountCheck({ ...item, plannedAdministrations: 8 })).toEqual({
      expected: 4,
      needsReason: true,
    });
    expect(
      administrationCountCheck({
        ...item,
        frequencyEvery: 8,
        frequencyUnit: "HOUR",
        durationAmount: 2,
        durationUnit: "DAY",
        plannedAdministrations: 6,
      }),
    ).toEqual({ expected: 6, needsReason: false });
  });
  it("never treats a month as 30 days or predicts continuous-use totals", () => {
    expect(administrationCountCheck({ ...item, durationUnit: "MONTH" })).toEqual({
      expected: null,
      needsReason: true,
    });
    expect(
      administrationCountCheck({
        ...item,
        continuousUse: true,
        durationAmount: null,
        durationUnit: null,
      }),
    ).toEqual({ expected: null, needsReason: true });
    expect(
      administrationCountCheck({
        ...item,
        frequencyUnit: "MONTH",
        durationUnit: "MONTH",
        durationAmount: 4,
      }),
    ).toEqual({ expected: 4, needsReason: false });
  });
  it("does not fill an optional count or derive it from dose quantity", () => {
    expect(administrationCountCheck({ ...item, plannedAdministrations: null })).toEqual({
      expected: 4,
      needsReason: false,
    });
    expect(administrationCountCheck({ ...item, frequencyEvery: null })).toEqual({
      expected: null,
      needsReason: true,
    });
  });
});
