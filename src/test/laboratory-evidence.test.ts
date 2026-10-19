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

describe("laboratory literal evidence checks", () => {
  it("distinguishes model consistency from independently located source text", () => {
    expect(checkLaboratoryEvidence(row())).toEqual({
      status: "literal_match",
      basis: "model_evidence",
      issues: [],
    });
    expect(
      checkLaboratoryEvidence(row(), [
        { page: 2, text: "Cabeçalho\nTSH  <0,1 µUI/mL Referência: 0,27 – 4,2\nRodapé" },
      ]),
    ).toEqual({ status: "literal_match", basis: "source_text", issues: [] });
    expect(checkLaboratoryEvidence(row(), [{ page: 1, text: row().evidence! }]).issues).toEqual([
      "SOURCE_PAGE_MISSING",
    ]);
    expect(checkLaboratoryEvidence(row(), [{ page: 2, text: "TSH 10 mUI/L" }]).issues).toEqual([
      "EVIDENCE_NOT_IN_SOURCE",
    ]);
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
  ])("does not silently accept changed result %s in %s", (result, printed) => {
    // Qualitative negation needs whole-result handling rather than token matching.
    const check = checkLaboratoryEvidence(
      row({ result, evidence: `TSH ${printed}`, unit: null, reference: null }),
    );
    expect(check.issues).toContain("RESULT_NOT_FOUND");
  });

  it("keeps unit case and exponent differences visible and preserves the input", () => {
    const original = row({ unit: "mUI/mL", verified: true });
    const snapshot = structuredClone(original);
    expect(checkLaboratoryEvidence(original).issues).toContain("UNIT_NOT_FOUND");
    expect(original).toEqual(snapshot);
    expect(original.verified).toBe(true);
  });

  it("allows whitespace and name case differences without converting values", () => {
    expect(
      checkLaboratoryEvidence(row({ evidence: "tsh\t<0,1\nµUI/mL Referência: 0,27 – 4,2" })).status,
    ).toBe("literal_match");
    expect(
      checkLaboratoryEvidence(
        row({ result: "Não reagente", evidence: "TSH Não reagente", unit: null, reference: null }),
      ).status,
    ).toBe("literal_match");
  });

  it("flags absent evidence and unresolved uncertainty instead of inventing confidence", () => {
    expect(
      checkLaboratoryEvidence(row({ evidence: null, uncertainty: "Texto ilegível" }), []).issues,
    ).toEqual(["MISSING_EVIDENCE", "MODEL_UNCERTAINTY", "SOURCE_PAGE_MISSING"]);
    expect(checkLaboratoryEvidence(row({ reference: "1 – 2" })).issues).toContain(
      "REFERENCE_NOT_FOUND",
    );
  });
});
