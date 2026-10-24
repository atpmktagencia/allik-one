import { expect, it } from "vitest";
import {
  laboratoryAutomationEligibility as eligible,
  laboratoryAutomationTransition as transition,
} from "@/lib/laboratory-automation";
const classification = {
  id: "a1100000-0000-4000-8000-000000000001",
  revision: 3,
  action: "SUGGESTED",
  payload: {
    schemaVersion: 1,
    evidenceStatus: "SUPPORTED",
    result: {
      abstention: "NONE",
      categories: [{ category: "LAB_RESULT", evidence: [{ page: 1, quote: "Glicose 90 mg/dL" }] }],
    },
  },
};
const base = {
  enrolled: true,
  authorized: true,
  sameOriginal: true,
  samePrimaryUnit: true,
  existingImport: false,
  classification,
  independentTotalPages: 1,
};
it("allows only an enrolled, authorized original with supported laboratory scope", () => {
  const before = JSON.stringify(base);
  expect(eligible(base)).toMatchObject({ eligible: true, pages: [1], classificationRevision: 3 });
  expect(JSON.stringify(base)).toBe(before);
});
it.each([
  [{ enrolled: false }, "NOT_ENROLLED"],
  [{ authorized: false }, "ACCESS_REVOKED"],
  [{ sameOriginal: false }, "SOURCE_CHANGED"],
  [{ samePrimaryUnit: false }, "UNIT_CHANGED"],
  [{ existingImport: true }, "EXISTING_IMPORT"],
  [{ independentTotalPages: null }, "PAGE_SCOPE_UNPROVEN"],
  [{ independentTotalPages: 2 }, "PAGE_SCOPE_UNPROVEN"],
  [
    { classification: { ...classification, action: "NEEDS_REVIEW" } },
    "CLASSIFICATION_NOT_SUPPORTED",
  ],
])("blocks unsafe enrollment or execution %#", (patch, reason) =>
  expect(eligible({ ...base, ...patch })).toEqual({ eligible: false, reason }),
);
it("does not send examination requests or mixed/abstained documents for extraction", () => {
  const c = structuredClone(classification);
  c.payload.result.categories[0]!.category = "EXAM_REQUEST";
  expect(eligible({ ...base, classification: c })).toEqual({
    eligible: false,
    reason: "NO_LAB_RESULTS",
  });
  c.payload.result.categories.push(classification.payload.result.categories[0]!);
  expect(eligible({ ...base, classification: c })).toEqual({
    eligible: false,
    reason: "MIXED_DOCUMENT",
  });
  const abstained = structuredClone(classification);
  abstained.payload.result.abstention = "AMBIGUOUS";
  expect(eligible({ ...base, classification: abstained })).toEqual({
    eligible: false,
    reason: "CLASSIFICATION_NOT_SUPPORTED",
  });
});
it("rejects invalid page scope and never invents omitted pages", () => {
  const c = structuredClone(classification);
  c.payload.result.categories[0]!.evidence[0]!.page = 2;
  expect(eligible({ ...base, classification: c })).toEqual({
    eligible: false,
    reason: "PAGE_SCOPE_UNPROVEN",
  });
});
it("rejects late/duplicate completions and requires explicit human retry", () => {
  const b = {
    previous: "STARTED" as const,
    next: "READY" as const,
    actor: "SYSTEM" as const,
    startedAttempts: 1,
    sameClassification: true,
    sameAttempt: true,
  };
  expect(transition(b)).toBe(true);
  expect(transition({ ...b, sameClassification: false })).toBe(false);
  expect(transition({ ...b, sameAttempt: false })).toBe(false);
  expect(transition({ ...b, previous: "READY" })).toBe(false);
  expect(transition({ ...b, previous: "FAILED", next: "RETRY_REQUESTED" })).toBe(false);
  expect(transition({ ...b, previous: "FAILED", next: "RETRY_REQUESTED", actor: "HUMAN" })).toBe(
    true,
  );
  expect(
    transition({
      ...b,
      previous: "FAILED",
      next: "RETRY_REQUESTED",
      actor: "HUMAN",
      startedAttempts: 2,
    }),
  ).toBe(false);
  expect(transition({ ...b, previous: "ENROLLED", next: "STARTED", startedAttempts: 2 })).toBe(
    false,
  );
});
