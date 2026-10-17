import { describe, expect, it } from "vitest";
import { composePrescription, prescriptionFormulaSchema } from "@/data/prescription-composer";
const formula = () => ({
  ingredients: [
    {
      medicationName: "Componente sintético A",
      dose: "0,125",
      doseUnit: "mg",
      individualCapsule: false,
    },
    {
      medicationName: "Componente sintético B",
      dose: "2.5",
      doseUnit: "mg",
      individualCapsule: false,
    },
  ],
  route: "Oral",
  presentation: "Cápsula",
  instructions: "Conferência profissional obrigatória",
  phases: [
    { doseUnits: 1, frequencyPerDay: 2, durationDays: 7, maintenance: false },
    { doseUnits: 2, frequencyPerDay: 3, durationDays: 10, maintenance: false },
  ],
});
describe("Prescription composition arithmetic", () => {
  it("sums administration units across phases without multiplying by ingredient count or converting dose", () => {
    const f = formula(),
      result = composePrescription(f);
    expect(result.quantity).toBe(74);
    expect(result.text).toContain("0,125 mg");
    expect(result.text).toContain("2.5 mg");
    expect(result.text).toContain("1 unidade(s) por administração, 2 vez(es) ao dia, por 7 dia(s)");
    expect(result.text).toContain(
      "2 unidade(s) por administração, 3 vez(es) ao dia, por 10 dia(s)",
    );
    expect(result.warnings.join(" ")).toContain("Não há validação clínica automática");
    expect(composePrescription(f)).toEqual(result);
    expect(f).toEqual(formula());
  });
  it("never presents a finite quantity for indefinite maintenance", () => {
    const f = formula();
    f.phases[1]!.maintenance = true;
    const result = composePrescription(f);
    expect(result.quantity).toBeNull();
    expect(result.quantityLabel).toContain("Etapas anteriores: 14");
    expect(result.text).toContain("manutenção, sem prazo definido");
  });
  it("warns that separate capsules require per-component quantity review", () => {
    const f = formula();
    f.ingredients[0]!.individualCapsule = true;
    const result = composePrescription(f);
    expect(result.quantity).toBe(74);
    expect(result.warnings.join(" ")).toContain(
      "não é a quantidade de cápsulas de cada componente",
    );
  });
  it.each([
    "0",
    "-1",
    "1e3",
    "Infinity",
    "NaN",
    "1/2",
    "1.23456",
    "1,2.3",
    "1000000",
    "01",
    "0.0000",
  ])("rejects unsafe or ambiguous component dose %s", (dose) => {
    const f = formula();
    f.ingredients[0]!.dose = dose;
    expect(prescriptionFormulaSchema.safeParse(f).success).toBe(false);
  });
  it.each([0, -1, 1.5, 101, NaN, Infinity])(
    "rejects unsafe administration count %s",
    (doseUnits) => {
      const f = formula();
      f.phases[0]!.doseUnits = doseUnits;
      expect(() => composePrescription(f)).toThrow();
    },
  );
  it("rejects invalid bounds, unknown fields, empty ingredients and maintenance before another phase", () => {
    const f = formula();
    f.phases[0]!.maintenance = true;
    expect(() => composePrescription(f)).toThrow();
    expect(() => composePrescription({ ...formula(), ingredients: [] })).toThrow();
    expect(() => composePrescription({ ...formula(), automaticSignature: true })).toThrow();
    expect(() =>
      composePrescription({
        ...formula(),
        phases: [{ doseUnits: 1, frequencyPerDay: 25, durationDays: 1 }],
      }),
    ).toThrow();
    expect(() =>
      composePrescription({
        ...formula(),
        phases: [{ doseUnits: 1, frequencyPerDay: 1, durationDays: 366 }],
      }),
    ).toThrow();
    expect(() => composePrescription({ ...formula(), route: " " })).toThrow();
  });
  it("keeps the maximum accepted product within exact integer arithmetic", () => {
    const f = formula();
    f.phases = Array.from({ length: 12 }, () => ({
      doseUnits: 100,
      frequencyPerDay: 24,
      durationDays: 365,
      maintenance: false,
    }));
    expect(composePrescription(f).quantity).toBe(10_512_000);
    expect(Number.isSafeInteger(composePrescription(f).quantity)).toBe(true);
  });
});
