import { describe, expect, it } from "vitest";
import { buildTreatmentCadence, type CadencePrescription } from "@/data/treatment-cadence";

const weekly: CadencePrescription = {
  frequencyEvery: 1,
  frequencyUnit: "WEEK",
  durationAmount: 4,
  durationUnit: "WEEK",
  continuousUse: false,
  plannedAdministrations: 4,
};

describe("therapeutic cadence", () => {
  it("retains the original month-end day across short months and leap years", () => {
    const monthly = { ...weekly, frequencyUnit: "MONTH", durationUnit: "MONTH" };
    expect(buildTreatmentCadence("2027-01-31", monthly, 4)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
    expect(buildTreatmentCadence("2028-01-31", monthly, 4)).toEqual([
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
      "2028-04-30",
    ]);
  });

  it("places only purchased administrations and excludes the duration end date", () => {
    expect(buildTreatmentCadence("2027-01-01", weekly, 2)).toEqual(["2027-01-01", "2027-01-08"]);
    expect(() =>
      buildTreatmentCadence("2027-01-01", { ...weekly, plannedAdministrations: null }, 5),
    ).toThrow(/duração/);
    expect(() => buildTreatmentCadence("2027-01-01", weekly, 5)).toThrow(/prescrito/);
    expect(
      buildTreatmentCadence(
        "2027-01-01",
        {
          ...weekly,
          continuousUse: true,
          durationAmount: null,
          durationUnit: null,
          plannedAdministrations: null,
        },
        5,
      ),
    ).toHaveLength(5);
  });

  it("rejects invalid calendar dates, hourly cadence and unstructured legacy prescriptions", () => {
    expect(() => buildTreatmentCadence("2027-02-29", weekly, 1)).toThrow(/data válida/);
    expect(() => buildTreatmentCadence("2028-02-30", weekly, 1)).toThrow(/data válida/);
    expect(() =>
      buildTreatmentCadence("2027-01-01", { ...weekly, frequencyUnit: "HOUR" }, 1),
    ).toThrow(/horário/);
    expect(() => buildTreatmentCadence("2027-01-01", {} as CadencePrescription, 1)).toThrow(
      /frequência estruturada/,
    );
    expect(() =>
      buildTreatmentCadence("2027-01-01", { ...weekly, durationAmount: null }, 1),
    ).toThrow(/duração estruturada/);
  });
});
