import { describe, it, expect } from "vitest";
import {
  computeTreatmentPlan,
  treatmentPlanSchema,
  type TreatmentPlanInput,
} from "@/data/treatment-plan";
const id = "00000000-0000-4000-8000-000000000001";
function plan(): TreatmentPlanInput {
  return {
    startDate: "2028-02-28",
    previewDays: 10,
    items: [
      {
        id,
        kind: "PRESCRIPTION",
        title: "Item sintético",
        productId: null,
        catalogItemId: null,
        administrationUnit: "CAPSULE",
        optional: false,
        patientInstructions: "Conferir instruções",
        stages: [
          {
            doseUnits: "1",
            frequencyPerDay: 2,
            everyDays: 1,
            durationDays: 3,
            weekdays: null,
            times: ["20:00", "08:00"],
          },
        ],
        dispense: null,
        package: null,
      },
    ],
  };
}
const first = (p: unknown) => computeTreatmentPlan(p).items[0]!;
describe("Explicit treatment planning", () => {
  it("uses civil dates across leapdays and neverconsults timezone orchangesinput", () => {
    const p = plan(),
      before = structuredClone(p),
      result = first(p);
    expect(result.schedule.map((e) => e.date)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(result.schedule[0]!.times).toEqual(["08:00", "20:00"]);
    expect(result.administrationQuantity).toBe("6");
    expect(p).toEqual(before);
    expect(computeTreatmentPlan(p)).toEqual(computeTreatmentPlan(p));
  });
  it("starts the next stage ontheday afterthepreviouscalendarperiod evenwhenweekdaysfiltervisits", () => {
    const p = plan();
    p.startDate = "2026-10-19";
    p.items[0]!.stages = [
      {
        doseUnits: "0.125",
        frequencyPerDay: 1,
        everyDays: 1,
        durationDays: 7,
        weekdays: [1, 3, 5],
        times: null,
      },
      {
        doseUnits: "0,25",
        frequencyPerDay: 2,
        everyDays: 2,
        durationDays: 5,
        weekdays: null,
        times: null,
      },
    ];
    const r = first(p);
    expect(r.stages).toEqual([
      { startsOn: "2026-10-19", endsOn: "2026-10-25" },
      { startsOn: "2026-10-26", endsOn: "2026-10-30" },
    ]);
    expect(r.schedule.map((e) => e.date)).toEqual([
      "2026-10-19",
      "2026-10-21",
      "2026-10-23",
      "2026-10-26",
      "2026-10-28",
    ]);
    expect(r.administrationQuantity).toBe("1.875"); // 3*0.125 + 3*2*0.25, including after preview horizon.
  });
  it("preserves unknown dose,frequency,unit,time andindefinitemaintenance ratherthan inventing data", () => {
    const p = plan();
    p.items[0]!.administrationUnit = null;
    p.items[0]!.stages[0] = {
      doseUnits: null,
      frequencyPerDay: null,
      everyDays: 1,
      durationDays: null,
      weekdays: null,
      times: null,
    };
    const r = first(p);
    expect(r.administrationQuantity).toBeNull();
    expect(r.dispenseQuantity).toBeNull();
    expect(r.packagesRequired).toBeNull();
    expect(r.stages[0]!.endsOn).toBeNull();
    expect(r.schedule).toHaveLength(10);
    expect(r.schedule[0]).toMatchObject({ doseUnits: null, administrations: null, times: null });
  });
  it("keeps totalsindefinitewhenfiniteintroisfollowedbymaintenance", () => {
    const p = plan();
    p.items[0]!.stages.push({ ...p.items[0]!.stages[0]!, durationDays: null });
    const r = first(p);
    expect(r.stages[1]!.startsOn).toBe("2028-03-02");
    expect(r.administrationQuantity).toBeNull();
    expect(r.schedule).toHaveLength(10);
  });
  it("computes decimaldispensepackagesbyexactintegerarithmetic notfloatingpoint", () => {
    const p = plan();
    p.items[0]!.administrationUnit = "ML";
    p.items[0]!.stages[0]!.doseUnits = "0.1";
    p.items[0]!.stages[0]!.frequencyPerDay = 3;
    p.items[0]!.stages[0]!.times = null;
    p.items[0]!.dispense = { quantity: "0,9", unit: "ML" };
    p.items[0]!.package = { capacity: "0.3", unit: "ML" };
    const r = first(p);
    expect(r.administrationQuantity).toBe("0.9");
    expect(r.dispenseQuantity).toBe("0.9");
    expect(r.packagesRequired).toBe("3");
    expect(r.warnings.join(" ")).not.toContain("difere");
    p.items[0]!.dispense.quantity = "0.9001";
    expect(first(p).packagesRequired).toBe("4");
  });
  it("requires manualdispense beforepackagecount andneverderivesitfromadministration", () => {
    const p = plan();
    p.items[0]!.package = { capacity: "30", unit: "CAPSULE" };
    expect(() => computeTreatmentPlan(p)).toThrow();
    p.items[0]!.package = null;
    expect(first(p).administrationQuantity).toBe("6");
    expect(first(p).packagesRequired).toBeNull();
  });
  it("doesnotconvert crossunits evenwhenvalueslookconvertible", () => {
    const p = plan();
    p.items[0]!.dispense = { quantity: "6", unit: "G" };
    p.items[0]!.package = { capacity: "1000", unit: "ML" };
    expect(() => computeTreatmentPlan(p)).toThrow();
    p.items[0]!.package = null;
    const r = first(p);
    expect(r.dispenseQuantity).toBe("6");
    expect(r.administrationQuantity).toBe("6");
    expect(r.warnings.join(" ")).toContain("não foi feita conversão");
  });
  it("warns aboutdifferentmanualdispenseonlyinexactlymatchingunit", () => {
    const p = plan();
    p.items[0]!.dispense = { quantity: "5", unit: "CAPSULE" };
    expect(first(p).warnings.join(" ")).toContain("difere");
  });
  it("boundswholeplancalendar to512rows withouttruncatingfinitetotals", () => {
    const p = plan();
    p.previewDays = 366;
    p.items[0]!.stages[0]!.durationDays = 3650;
    p.items.push({ ...structuredClone(p.items[0]!), id: "00000000-0000-4000-8000-000000000002" });
    const r = computeTreatmentPlan(p);
    expect(r.items.flatMap((i) => i.schedule)).toHaveLength(512);
    expect(r.truncated).toBe(true);
    expect(r.items[0]!.administrationQuantity).toBe("7300");
    expect(r.items[1]!.administrationQuantity).toBe("7300");
    expect(r.items[1]!.truncated).toBe(true);
  });
  it.each([
    "2027-02-29",
    "2028-02-30",
    "2026-13-01",
    "2026-01-00",
    "2026-1-01",
    "2026-01-01T00:00:00Z",
  ])("rejectsinvalidcivildate %s", (startDate) =>
    expect(() => computeTreatmentPlan({ ...plan(), startDate })).toThrow(),
  );
  it.each(["0", "-1", "1e3", "NaN", "Infinity", "01", "1.23456", "0.0000", "100000000"])(
    "rejectsambiguousquantity %s",
    (doseUnits) => {
      const p = plan();
      p.items[0]!.stages[0]!.doseUnits = doseUnits;
      expect(() => computeTreatmentPlan(p)).toThrow();
    },
  );
  it("rejectsmismatchedtimes duplicates andinvalidweekdays", () => {
    for (const change of [
      { times: ["08:00"] },
      { times: ["08:00", "08:00"] },
      { times: ["24:00", "12:00"] },
      { frequencyPerDay: null },
      { weekdays: [1, 1] },
      { weekdays: [7] },
      { weekdays: [] },
    ]) {
      const p = plan();
      Object.assign(p.items[0]!.stages[0]!, change);
      expect(() => computeTreatmentPlan(p)).toThrow();
    }
  });
  it("rejectsunknownunits,duplicateids,indefinitenonfinalstage andcalendaroverflow", () => {
    const p = plan();
    expect(() =>
      computeTreatmentPlan({
        ...p,
        items: [{ ...p.items[0], administrationUnit: "inválida\nunidade" }],
      }),
    ).toThrow();
    expect(() => computeTreatmentPlan({ ...p, items: [p.items[0], p.items[0]] })).toThrow();
    p.items[0]!.stages.push({ ...p.items[0]!.stages[0]! });
    p.items[0]!.stages[0]!.durationDays = null;
    expect(() => computeTreatmentPlan(p)).toThrow();
    expect(() => computeTreatmentPlan({ ...plan(), startDate: "9999-12-31" })).toThrow();
  });
  it("enforcesitem/stage/horizonbounds andexclusivecatalogreferences", () => {
    const p = plan();
    expect(() => computeTreatmentPlan({ ...p, previewDays: 367 })).toThrow();
    expect(() => computeTreatmentPlan({ ...p, items: [] })).toThrow();
    p.items[0]!.stages = Array.from({ length: 12 }, () => ({
      ...p.items[0]!.stages[0]!,
      durationDays: 365,
    }));
    expect(() => computeTreatmentPlan(p)).toThrow();
    expect(() =>
      computeTreatmentPlan({
        ...plan(),
        items: [{ ...plan().items[0], productId: id, catalogItemId: id }],
      }),
    ).toThrow();
  });
  it("preservesexplicitoptionalflags,instructions,formulaandrefswithoutinterpretingthemasdosages", () => {
    const p = plan();
    Object.assign(p.items[0]!, {
      optional: true,
      patientInstructions: "Orientação explicitamente informada",
      existingTreatmentId: id,
      prescriptionInstanceId: id,
      appointmentId: id,
    });
    const parsed = treatmentPlanSchema.parse(p);
    expect(parsed.items[0]!.optional).toBe(true);
    expect(parsed.items[0]!.patientInstructions).toBe("Orientação explicitamente informada");
    expect(first(p).administrationQuantity).toBe("6");
  });
});

describe("Safe domain validation", () => {
  it.each(["", "abc", "1e3", "NaN", "0.0000", "1,2.3"])(
    "returns validation failure without throwing for %s",
    (doseUnits) => {
      const p = plan();
      p.items[0]!.stages[0]!.doseUnits = doseUnits;
      expect(() => treatmentPlanSchema.safeParse(p)).not.toThrow();
      expect(treatmentPlanSchema.safeParse(p).success).toBe(false);
    },
  );
  it("preserves explicit custom registered units without case conversions", () => {
    const p = plan();
    p.items[0]!.administrationUnit = "frasco doseado";
    p.items[0]!.dispense = { quantity: "6", unit: "frasco doseado" };
    p.items[0]!.package = { capacity: "2", unit: "frasco doseado" };
    expect(first(p).packagesRequired).toBe("3");
    p.items[0]!.package.unit = "Frasco doseado";
    expect(treatmentPlanSchema.safeParse(p).success).toBe(false);
  });
});
