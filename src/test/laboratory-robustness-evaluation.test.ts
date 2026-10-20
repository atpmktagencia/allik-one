import { describe, expect, it } from "vitest";
import {
  evaluateLaboratoryRobustness,
  reconstructPreRecoveryLaboratoryRows,
} from "../lib/laboratory-robustness-evaluation";
import { emptyLaboratoryRow, type LaboratoryRow } from "../lib/laboratory-results";
import type { LaboratoryEvidenceCheck } from "../lib/laboratory-evidence";

const row = (patch: Partial<LaboratoryRow> = {}): LaboratoryRow => ({
  ...emptyLaboratoryRow(),
  name: "Glicose",
  result: "90",
  unit: "mg/dL",
  sourcePage: 1,
  ...patch,
});
const check = (
  status: "literal_match" | "attention" = "literal_match",
): LaboratoryEvidenceCheck => ({
  status,
  basis: "source_text",
  issues: [],
  fields: {
    name: { status: "supported" },
    result: { status: "supported" },
    unit: { status: "supported" },
    reference: { status: "absent" },
    collectedOn: { status: "absent" },
    reportedOn: { status: "absent" },
    issuedOn: { status: "absent" },
    laboratory: { status: "absent" },
    method: { status: "absent" },
    material: { status: "absent" },
  },
});
describe("independent offline robustness evaluation", () => {
  it("counts all missing observations and fields instead of rewarding all-null or partial output", () => {
    const expected = [row({ collectedOn: "2026-02-13" }), row({ name: "Ureia", result: "30" })];
    const result = evaluateLaboratoryRobustness({ rows: expected }, [row()], [check()], {
      independentText: true,
    });
    expect(result).toMatchObject({
      expectedLegibleRows: 2,
      correctResults: 1,
      omittedRows: 1,
      resultRecall: 0.5,
      completeRows: 0,
    });
    expect(result.fields.collectedOn).toMatchObject({
      expectedPositive: 1,
      correctPositive: 0,
      omittedPositive: 1,
      emittedPositive: 0,
    });
    expect(result.fields.name).toMatchObject({ expectedPositive: 2, correctPositive: 1 });
    expect(result.verifier.unsafeLiteralMatches).toBe(1);
  });
  it("identifies an accepted wrong current result independently of generic verifier warnings", () => {
    const warning = check("attention");
    warning.issues = ["MODEL_UNCERTAINTY"];
    const result = evaluateLaboratoryRobustness(
      { rows: [row()] },
      [row({ result: "100" })],
      [warning],
      { independentText: true },
    );
    expect(result.associationErrors).toBe(1);
    expect(result.errors.find((e) => e.field === "result")).toMatchObject({
      kind: "wrongPositive",
      verifierDetectedField: false,
    });
    expect(result.verifier.sensitivityToWrongResults).toBe(0);
    const accepted = evaluateLaboratoryRobustness(
      { rows: [row()] },
      [row({ result: "100" })],
      [check()],
    );
    expect(accepted.verifier.unsafeLiteralMatches).toBe(1);
  });
  it("does not deduplicate repeated parameters from independent source pages", () => {
    const rows = [row(), row({ sourcePage: 2, result: "92" })];
    const result = evaluateLaboratoryRobustness({ rows }, [rows[1]!, rows[0]!], [check(), check()]);
    expect(result).toMatchObject({
      matchedRows: 2,
      correctResults: 2,
      omittedRows: 0,
      unmatchedRows: 0,
    });
    const duplicate = evaluateLaboratoryRobustness(
      { rows },
      [rows[0]!, rows[0]!],
      [check(), check()],
    );
    expect(duplicate.completeRows).toBe(1);
    expect(duplicate.correctResults).toBe(1);
    expect(duplicate.verifier.unsafeLiteralMatches).toBe(1);
  });
  it("accepts micro-sign typography but never normalizes concentration scale or loses comparator", () => {
    const expected = row({ name: "T4 total", result: "<1,2", unit: "µg/dL" });
    const typography = evaluateLaboratoryRobustness(
      { rows: [expected] },
      [{ ...expected, result: "< 1.2", unit: "μg/dL" }],
      [check()],
    );
    expect(typography.completeRows).toBe(1);
    const wrong = evaluateLaboratoryRobustness(
      { rows: [expected] },
      [{ ...expected, result: "1,2", unit: "ng/dL" }],
      [check()],
    );
    expect(wrong.fields.result.wrongPositive).toBe(1);
    expect(wrong.fields.unit.wrongPositive).toBe(1);
    expect(wrong.verifier.unsafeLiteralMatches).toBe(1);
  });
  it("does not penalize safe abstention on unreadable values or inflate clinical recall", () => {
    const unresolved = [{ name: "Ferritina", sourcePage: 1, reason: "unreadable" }];
    const safe = evaluateLaboratoryRobustness(
      { rows: [], unresolved },
      [row({ name: "Ferritina", result: "[ilegível]", uncertainty: "Fonte ilegível" })],
      [check("attention")],
    );
    expect(safe).toMatchObject({ expectedLegibleRows: 0, resultRecall: null, unmatchedRows: 0 });
    expect(safe.unreadable.correctlyFlaggedUnreadable).toBe(1);
    const invented = evaluateLaboratoryRobustness(
      { rows: [], unresolved },
      [row({ name: "Ferritina", result: "45", uncertainty: "Fonte ilegível" })],
      [check()],
    );
    expect(invented.errors[0]?.kind).toBe("unsupportedUnreadableValue");
    expect(invented.verifier.unsafeLiteralMatches).toBe(1);
  });
  it("treats unresolved ambiguous dates as null truth while flagging invented resolutions", () => {
    const expected = row(),
      unresolved = [
        { name: "Glicose", sourcePage: 1, reason: "ambiguous_date", fields: ["collectedOn"] },
      ];
    const safe = evaluateLaboratoryRobustness(
      { rows: [expected], unresolved },
      [row({ uncertainty: "Coleta ambígua" })],
      [check("attention")],
      { independentText: true },
    );
    expect(safe.completeRows).toBe(1);
    expect(safe.fields.collectedOn).toMatchObject({
      expectedPositive: 0,
      correctAbsent: 0,
      unresolved: 1,
      preservedUnresolved: 1,
    });
    expect(safe.unresolvedDates).toMatchObject({
      fields: 1,
      preservedUnresolved: 1,
      signaledRows: 1,
    });
    expect(safe.verifier.falseAlertCandidates).toBe(0);
    const resolved = evaluateLaboratoryRobustness(
      { rows: [expected], unresolved },
      [row({ collectedOn: "2026-02-01" })],
      [check()],
    );
    expect(resolved.fields.collectedOn.inventedPositive).toBe(1);
    expect(resolved.verifier.unsafeLiteralMatches).toBe(1);
  });
  it("does not silently trust unknown date semantics as if null meant known absence", () => {
    const unresolved = [
      {
        name: "Glicose",
        sourcePage: 1,
        reason: "ambiguous_date",
        fields: ["collectedOn", "reportedOn", "issuedOn"],
      },
    ];
    const silent = evaluateLaboratoryRobustness({ rows: [row()], unresolved }, [row()], [check()], {
      independentText: true,
    });
    expect(silent.completeRows).toBe(1); // Correct extraction abstention, unsafe eligibility.
    expect(silent.positivePrecision).toBe(1);
    expect(silent.unresolvedDates).toEqual({
      rows: 1,
      fields: 3,
      preservedUnresolved: 3,
      signaledRows: 0,
    });
    expect(silent.verifier).toMatchObject({
      silentUnresolvedAcceptance: 1,
      unsafeLiteralMatches: 1,
      incorrectRowsObserved: 0,
    });
    expect(silent.fields.collectedOn.correctAbsent).toBe(0);
    expect(silent.errors).toEqual([expect.objectContaining({ kind: "unresolvedDateAccepted" })]);
  });
  it("keeps legitimate absence-of-source and layout warnings separate from false-alert candidates", () => {
    const scan = check("attention");
    scan.basis = "model_evidence";
    scan.issues = ["INDEPENDENT_SOURCE_UNAVAILABLE"];
    const result = evaluateLaboratoryRobustness({ rows: [row()] }, [row()], [scan], {
      independentText: false,
    });
    expect(result.verifier).toMatchObject({
      correctButUnprovableRows: 1,
      falseAlertCandidates: 0,
      unsafeLiteralMatches: 0,
      sensitivityToWrongResults: null,
    });
    const layout = check("attention");
    layout.issues = ["ASSOCIATION_UNPROVEN"];
    expect(
      evaluateLaboratoryRobustness({ rows: [row()] }, [row()], [layout], { independentText: true })
        .verifier.correctButUnprovableRows,
    ).toBe(1);
  });
  it("keeps unrecorded verifier decisions unknown", () => {
    const result = evaluateLaboratoryRobustness({ rows: [row()] }, [row({ result: "100" })]);
    expect(result.verifier).toMatchObject({
      eligibleRows: null,
      attentionRows: null,
      unsafeLiteralMatches: null,
      falseAlertCandidates: null,
    });
    expect(result.errors.find((e) => e.field === "result")?.verifierDetectedField).toBeNull();
  });
  it("separates delivered dates from audited deterministic recovery without mutating evidence", () => {
    const delivered = [row({ collectedOn: "2026-02-13", reportedOn: "2026-02-14" })];
    const modelOnly = reconstructPreRecoveryLaboratoryRows(delivered, [
      { row: 0, field: "collectedOn", page: 1, line: 2 },
    ]);
    expect(modelOnly[0]).toMatchObject({
      collectedOn: null,
      reportedOn: "2026-02-14",
      verified: false,
    });
    expect(delivered[0]?.collectedOn).toBe("2026-02-13");
    for (const bad of [
      [{ row: 1, field: "collectedOn", page: 1, line: 2 }],
      [{ row: 0, field: "result", page: 1, line: 2 }],
      [{ row: 0, field: "collectedOn", page: 2, line: 2 }],
      [{ row: 0, field: "collectedOn", page: 1, line: 0 }],
      [
        { row: 0, field: "collectedOn", page: 1, line: 2 },
        { row: 0, field: "collectedOn", page: 1, line: 2 },
      ],
    ])
      expect(() => reconstructPreRecoveryLaboratoryRows(delivered, bad)).toThrow(
        "INVALID_DATE_RECOVERY_AUDIT",
      );
  });
});
