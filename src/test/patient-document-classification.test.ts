import { describe, expect, it } from "vitest";
import {
  checkDocumentClassificationEvidence,
  documentClassificationSuggestion,
  type DocumentClassificationSuggestion,
} from "../lib/patient-document-classification";

const suggestion = (): DocumentClassificationSuggestion => ({
  categories: [{ category: "EXAM_REQUEST", evidence: [{ page: 1, quote: "Solicito hemograma" }] }],
  abstention: "NONE",
});
describe("F2 classification contract (offline, no inference)", () => {
  it("retains mixed category page evidence without creating another original", () => {
    const mixed = suggestion();
    mixed.categories.push({
      category: "IMAGE_REPORT",
      evidence: [{ page: 2, quote: "Laudo ultrassom" }],
    });
    expect(documentClassificationSuggestion.parse(mixed).categories).toHaveLength(2);
  });
  it("does not promote a quotation into confirmed classification", () => {
    const result = checkDocumentClassificationEvidence(
      suggestion(),
      [{ page: 1, text: "Solicito  hemograma" }],
      "SUPPORTED",
    );
    expect(result.provenance).toBe("LITERAL_SUPPORT_ONLY");
    expect(result.confirmed).toBe(false);
    expect(result.completenessProven).toBe(false);
  });
  it("rejects model supplied confidence, confirmations and operational instructions", () => {
    for (const extra of [
      { confidence: 1 },
      { confirmed: true },
      { instruction: "publish results" },
    ])
      expect(
        documentClassificationSuggestion.safeParse({ ...suggestion(), ...extra }).success,
      ).toBe(false);
  });
  it("rejects unsupported categories, repeated categories and out of range pages", () => {
    expect(
      documentClassificationSuggestion.safeParse({
        ...suggestion(),
        categories: [{ category: "DIAGNOSIS", evidence: [] }],
      }).success,
    ).toBe(false);
    const duplicate = suggestion();
    duplicate.categories.push({
      category: "EXAM_REQUEST",
      evidence: [{ page: 1, quote: "Solicito hemograma" }],
    });
    expect(documentClassificationSuggestion.safeParse(duplicate).success).toBe(false);
    const invalidPage = suggestion();
    invalidPage.categories = [
      { category: "EXAM_REQUEST", evidence: [{ page: 0, quote: "Solicito hemograma" }] },
    ];
    expect(documentClassificationSuggestion.safeParse(invalidPage).success).toBe(false);
  });
  it("requires an explicit abstention for unrecognized documents", () => {
    expect(
      documentClassificationSuggestion.safeParse({ categories: [], abstention: "NONE" }).success,
    ).toBe(false);
    expect(
      documentClassificationSuggestion.safeParse({ categories: [], abstention: "ILLEGIBLE" })
        .success,
    ).toBe(true);
  });
  it("does not use visual model output as independent evidence for scans", () => {
    const result = checkDocumentClassificationEvidence(suggestion(), null, "SUPPORTED");
    expect(result.issues).toContain("INDEPENDENT_SOURCE_UNAVAILABLE");
    expect(result.provenance).toBe("NEEDS_REVIEW");
  });
  it("requires the quotation on the claimed page, not another page", () => {
    const result = checkDocumentClassificationEvidence(
      suggestion(),
      [
        { page: 1, text: "Receita" },
        { page: 2, text: "Solicito hemograma" },
      ],
      "SUPPORTED",
    );
    expect(result.issues).toContain("QUOTE_NOT_FOUND");
  });
  it("flags missing pages and never uses filename as evidence", () => {
    expect(
      checkDocumentClassificationEvidence(
        suggestion(),
        [{ page: 2, text: "Solicito hemograma" }],
        "SUPPORTED",
      ).issues,
    ).toContain("PAGE_MISSING");
  });
  it.each(["MISMATCH", "UNRESOLVED"] as const)("requires identity review for %s", (identity) => {
    expect(
      checkDocumentClassificationEvidence(
        suggestion(),
        [{ page: 1, text: "Solicito hemograma" }],
        identity,
      ).issues,
    ).toContain("IDENTITY_UNRESOLVED");
  });
  it("retains uncertainty even with exact source quotation", () => {
    const uncertain = { ...suggestion(), abstention: "AMBIGUOUS" as const };
    expect(
      checkDocumentClassificationEvidence(
        uncertain,
        [{ page: 1, text: "Solicito hemograma" }],
        "SUPPORTED",
      ).issues,
    ).toContain("MODEL_ABSTENTION");
  });
});
