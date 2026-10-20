import { describe, expect, it } from "vitest";
import { checkLaboratoryEvidence } from "@/lib/laboratory-evidence";
import { emptyLaboratoryRow, type LaboratoryRow } from "@/lib/laboratory-results";
const row = (changes: Partial<LaboratoryRow> = {}): LaboratoryRow => ({
  ...emptyLaboratoryRow(),
  name: "TSH",
  result: "<0,1",
  unit: "µUI/mL",
  reference: "0,27 – 4,2",
  sourcePage: 2,
  evidence: "TSH <0,1 µUI/mL Referência: 0,27 – 4,2",
  ...changes,
});
const check = (r: LaboratoryRow, source = r.evidence ?? "") =>
  checkLaboratoryEvidence(r, [{ page: 2, text: source }]);
describe("independent laboratory field evidence", () => {
  it("requires independent source even when model evidence agrees with itself", () => {
    expect(checkLaboratoryEvidence(row())).toMatchObject({
      status: "attention",
      basis: "model_evidence",
      issues: ["INDEPENDENT_SOURCE_UNAVAILABLE"],
    });
    expect(
      check(row(), "Cabeçalho\nTSH  <0,1 µUI/mL Referência: 0,27 – 4,2\nRodapé"),
    ).toMatchObject({ status: "literal_match", basis: "source_text", issues: [] });
    expect(checkLaboratoryEvidence(row(), [{ page: 1, text: row().evidence! }]).issues).toContain(
      "SOURCE_PAGE_MISSING",
    );
    expect(check(row(), "TSH 10 mUI/L").issues).toContain("EVIDENCE_NOT_IN_SOURCE");
  });
  it.each([
    ["5", "15"],
    ["5", "5,8"],
    ["5", "<5"],
    ["5", "< 5"],
    ["5", "−5"],
    ["5", "5^2"],
    ["0,1", "0.1"],
    ["<0,1", "≤0,1"],
    ["Reagente", "Não Reagente"],
  ])("does not trust changed result %s in %s", (result, printed) => {
    const c = check(row({ result, evidence: `TSH ${printed}`, unit: null, reference: null }));
    expect(c.status).toBe("attention");
    expect(c.fields.result.status).not.toBe("supported");
  });
  it("keeps case-sensitive units and exponents distinct and never changes the input", () => {
    const r = row({ unit: "mUI/mL", verified: true }),
      original = structuredClone(r);
    expect(check(r).issues).toContain("UNIT_NOT_FOUND");
    expect(r).toEqual(original);
    expect(check(row({ unit: "µUI/mL^2" })).status).toBe("attention");
    const referenceRow = row({
      name: "Glicose",
      result: "90",
      unit: "mg/dL",
      reference: "70 - 99 Mg/dL",
      evidence: "Glicose: 90 mg/dL; Referência: 70 - 99 mg/dL",
    });
    expect(check(referenceRow).fields.reference.status).toBe("contradictory");
  });
  it("accepts explicit typographic equivalences, whitespace and name case only", () => {
    expect(check(row({ evidence: "tsh\t<0,1  µUI/mL Referência: 0,27 – 4,2" })).status).toBe(
      "literal_match",
    );
    expect(check(row({ unit: "μUI/mL" })).fields.unit.status).toBe("supported");
    expect(check(row({ unit: "µUI/ml" })).fields.unit.status).toBe("supported");
    expect(
      check(
        row({ result: "Não reagente", evidence: "TSH Não reagente", unit: null, reference: null }),
      ).status,
    ).toBe("literal_match");
  });
  it("flags missing source and uncertainty without invented confidence", () => {
    expect(
      checkLaboratoryEvidence(row({ evidence: null, uncertainty: "Texto ilegível" }), []).issues,
    ).toEqual(
      expect.arrayContaining(["MISSING_EVIDENCE", "MODEL_UNCERTAINTY", "SOURCE_PAGE_MISSING"]),
    );
    expect(check(row({ reference: "1 – 2" })).issues).toContain("REFERENCE_NOT_FOUND");
  });
  it("recognizes filling dots without accepting a different parameter", () => {
    const r = row({
      name: "HEMOGLOBINA",
      result: "13,1",
      unit: "g/dL",
      reference: null,
      evidence: "HEMOGLOBINA........: 13,1 g/dL",
    });
    expect(check(r).status).toBe("literal_match");
    expect(check({ ...r, name: "HEMO" }).status).toBe("attention");
    expect(check({ ...r, name: "HEMOGLOBINA GLICADA" }).status).toBe("attention");
    expect(check({ ...r, evidence: "HEMOGLOBINA..TOTAL: 13,1 g/dL" }).status).toBe("attention");
  });
  it.each(["100", "70", "99"])(
    "rejects previous/reference value %s as the current result",
    (result) => {
      const r = row({
        name: "Glicose",
        result,
        unit: "mg/dL",
        reference: "70 - 99",
        evidence: "Glicose: 90 mg/dL; Referência: 70 - 99; Resultado anterior: 100 mg/dL",
      });
      expect(check(r).fields.result.status).toBe("contradictory");
    },
  );
  it("rejects a number that is both a reference endpoint and an extracted result", () => {
    expect(
      check(
        row({
          name: "Glicose",
          result: "90",
          unit: "mg/dL",
          reference: "70 - 90",
          evidence: "Glicose: 85 mg/dL; Referência: 70 - 90",
        }),
      ).status,
    ).toBe("attention");
  });
  it("does not treat a previous-result section as current, even when its row is otherwise literal", () => {
    const r = row({ result: "2", unit: "mUI/L", reference: null, evidence: "TSH: 2 mUI/L" });
    expect(check(r, "Resultados anteriores\n" + r.evidence).status).toBe("attention");
    expect(check(r, "Referências\n" + r.evidence).status).toBe("attention");
    expect(
      check(r, "Resultados anteriores\nT4: 4 ng/dL\nResultados atuais\n" + r.evidence).status,
    ).toBe("literal_match");
  });
  it("uses explicit current/previous/reference columns, independent of their order", () => {
    const text =
      "Exame | Resultado anterior | Referência | Resultado atual\nGlicose | 100 mg/dL | 70 - 99 | 90 mg/dL";
    const r = row({
      name: "Glicose",
      result: "90",
      unit: "mg/dL",
      reference: "70 - 99",
      evidence: text.split("\n")[1]!,
    });
    expect(check(r, text).status).toBe("literal_match");
    expect(check({ ...r, result: "100" }, text).status).toBe("attention");
    expect(check(r, text.split("\n")[1]!).status).toBe("attention");
  });
  it("does not borrow units or numbers from neighboring or similarly named exams", () => {
    const text = "T4 livre: 1,2 ng/dL\nT4 total: 1,2 µg/dL";
    const r = row({
      name: "T4 livre",
      result: "1,2",
      unit: "µg/dL",
      reference: null,
      evidence: text,
    });
    expect(check(r, text).fields.unit.status).toBe("contradictory");
    expect(check({ ...r, name: "T4" }, text).status).toBe("attention");
  });
  it("declines flattened columns, repeats and partially legible results", () => {
    for (const source of [
      "TSH 0,1 0,2 0,4 - 4,0 mUI/L",
      "TSH: 0,1 mUI/L\nTSH: 0,1 mUI/L",
      "TSH: [ilegível] mUI/L",
    ])
      expect(
        check(row({ result: "0,1", unit: "mUI/L", reference: null, evidence: source }), source)
          .status,
      ).toBe("attention");
  });
  it("can verify independent fields even when the model excerpt is absent", () => {
    const c = check(row({ evidence: null }), "TSH: <0,1 µUI/mL Referência: 0,27 – 4,2");
    expect(c.status).toBe("literal_match");
    expect(c.fields.result).toEqual({ status: "supported", page: 2, line: 1 });
    expect(c.fields.collectedOn.status).toBe("absent");
  });
  const source =
    "Formato das datas: DD/MM/AAAA\nLaboratório: Laboratório Fictício\nColeta: 02/01/2026\nData do resultado: 04/01/2026\nEmissão: 05/01/2026\nMétodo: Quimioluminescência\nMaterial: Soro\nTSH: <0,1 µUI/mL Referência: 0,27 – 4,2";
  const dated = () =>
    row({
      collectedOn: "2026-01-02",
      reportedOn: "2026-01-04",
      issuedOn: "2026-01-05",
      laboratory: "Laboratório Fictício",
      method: "Quimioluminescência",
      material: "Soro",
      evidence: null,
    });
  it("verifies each date role and metadata against separate source fields", () => {
    const c = check(dated(), source);
    expect(c.status).toBe("literal_match");
    for (const key of [
      "collectedOn",
      "reportedOn",
      "issuedOn",
      "laboratory",
      "method",
      "material",
    ] as const)
      expect(c.fields[key].status).toBe("supported");
    expect(JSON.stringify(c)).not.toContain("Laboratório Fictício");
  });
  it("distinguishes absent dates, unsupported dates and contradictions", () => {
    expect(check(row()).fields.collectedOn.status).toBe("absent");
    expect(check(row({ collectedOn: "2026-01-02" })).issues).toContain("DATE_UNSUPPORTED");
    expect(check({ ...dated(), collectedOn: "2026-01-06" }, source).issues).toContain(
      "DATE_CONTRADICTION",
    );
    expect(check({ ...dated(), reportedOn: "2026-01-05" }, source).fields.reportedOn.status).toBe(
      "contradictory",
    );
    expect(check(dated(), source.replace("02/01/2026", "02/03/04")).status).toBe("attention");
    expect(check(dated(), source.replace("02/01/2026", "30/02/2026")).status).toBe("attention");
  });
  it("rejects conflicting source dates even when one matches the prediction", () => {
    expect(check(dated(), "Coleta: 03/01/2026\n" + source).fields.collectedOn.status).toBe(
      "contradictory",
    );
  });
  it("rejects invented metadata, missing extraction fields and metadata of a different row", () => {
    expect(check({ ...dated(), material: "Plasma" }, source).issues).toContain(
      "METADATA_CONTRADICTION",
    );
    expect(check(row(), source).issues).toContain("FIELD_OMITTED");
    const text = "Glicose: 90 mg/dL\nMétodo: Método da glicose\nUreia: 30 mg/dL";
    expect(
      check(
        row({
          name: "Ureia",
          result: "30",
          unit: "mg/dL",
          reference: null,
          method: "Método da glicose",
          evidence: null,
        }),
        text,
      ).issues,
    ).toContain("METADATA_UNSUPPORTED");
    const header = "Método: Método da glicose\nGlicose: 90 mg/dL\nUreia: 30 mg/dL";
    expect(
      check(
        row({
          name: "Ureia",
          result: "30",
          unit: "mg/dL",
          reference: null,
          method: "Método da glicose",
          evidence: null,
        }),
        header,
      ).issues,
    ).toContain("METADATA_UNSUPPORTED");
  });
});
