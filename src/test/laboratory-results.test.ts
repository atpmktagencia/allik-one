import { describe, expect, it } from "vitest";
import {
  laboratoryDraft,
  laboratoryValidationProblem,
  emptyLaboratoryRow,
  emptyLaboratoryDraft,
} from "@/lib/laboratory-results";
describe("laboratory review contract", () => {
  it("preserves inequalities, decimal commas and qualitative results without normalization", () => {
    const draft = laboratoryDraft.parse({
      patientConfirmed: true,
      notes: "",
      rows: [
        {
          ...emptyLaboratoryRow(),
          name: "TSH",
          result: "<0,1",
          unit: "µUI/mL",
          reference: "0,27 – 4,2",
          verified: true,
        },
        {
          ...emptyLaboratoryRow(),
          name: "Teste qualitativo",
          result: "Não reagente",
          verified: true,
        },
      ],
    });
    expect(draft.rows[0]?.result).toBe("<0,1");
    expect(draft.rows[1]?.result).toBe("Não reagente");
    expect(laboratoryValidationProblem(draft)).toBeNull();
  });
  it("requires patient confirmation, resolved ambiguity and explicit row confirmation", () => {
    const draft = emptyLaboratoryDraft();
    expect(laboratoryValidationProblem(draft)).toMatch(/paciente/);
    draft.patientConfirmed = true;
    expect(laboratoryValidationProblem(draft)).toMatch(/resultado/);
    draft.rows = [
      {
        ...emptyLaboratoryRow(),
        name: "Exame",
        result: "5",
        uncertainty: "Unidade ilegível",
        verified: true,
      },
    ];
    expect(laboratoryValidationProblem(draft)).toMatch(/pendências/);
    draft.rows[0]!.uncertainty = null;
    draft.rows[0]!.verified = false;
    expect(laboratoryValidationProblem(draft)).toMatch(/confirme/);
    draft.rows[0]!.verified = true;
    expect(laboratoryValidationProblem(draft)).toBeNull();
  });
  it("rejects impossible dates, extra fields and oversized result sets", () => {
    expect(
      laboratoryDraft.safeParse({
        ...emptyLaboratoryDraft(),
        rows: [{ ...emptyLaboratoryRow(), collectedOn: "2026-02-30" }],
      }).success,
    ).toBe(false);
    expect(
      laboratoryDraft.safeParse({ ...emptyLaboratoryDraft(), diagnosis: "inventado" }).success,
    ).toBe(false);
    expect(
      laboratoryDraft.safeParse({
        ...emptyLaboratoryDraft(),
        rows: Array.from({ length: 201 }, emptyLaboratoryRow),
      }).success,
    ).toBe(false);
  });
});
