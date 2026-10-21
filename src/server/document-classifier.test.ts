import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reviewClassification,
  classificationBoundary,
  classifierEnabled,
  classificationConfiguration,
} from "./document-classifier";
import type { DocumentClassificationSuggestion } from "../lib/patient-document-classification";
const patient = "Paciente Sintetico";
const request: DocumentClassificationSuggestion = {
  categories: [{ category: "EXAM_REQUEST", evidence: [{ page: 1, quote: "Solicito hemograma" }] }],
  abstention: "NONE",
};
const page = {
  page: 1,
  text: "Paciente: Paciente Sintetico\nPedido de exames\nSolicito hemograma",
};
afterEach(() => vi.unstubAllEnvs());
describe("F2 evidence and boundary, deterministic controls only", () => {
  it("supports a literal request without a model confidence score", () =>
    expect(reviewClassification(request, [page], patient).action).toBe("SUGGESTED"));
  it("never treats a request-only page as a supported lab result", () => {
    const result = {
      ...request,
      categories: [{ ...request.categories[0]!, category: "LAB_RESULT" as const }],
    };
    expect(reviewClassification(result, [page], patient).action).toBe("NEEDS_REVIEW");
  });
  it("does not promote the model transcription into independent scan evidence", () =>
    expect(reviewClassification(request, null, patient).payload.evidenceStatus).toBe(
      "UNAVAILABLE",
    ));
  it("retains identity divergence without changing the patient", () =>
    expect(reviewClassification(request, [page], "Outro paciente").payload.evidenceStatus).toBe(
      "IDENTITY_MISMATCH",
    ));
  it("requires review if identity cannot be independently associated", () =>
    expect(
      reviewClassification(request, [{ ...page, text: "Solicito hemograma" }], patient).action,
    ).toBe("NEEDS_REVIEW"));
  it("flags invented quote even on a real page", () =>
    expect(
      reviewClassification(
        {
          ...request,
          categories: [
            { category: "EXAM_REQUEST", evidence: [{ page: 1, quote: "Solicito ressonancia" }] },
          ],
        },
        [page],
        patient,
      ).action,
    ).toBe("NEEDS_REVIEW"));
  it("flags wrong page even if quote exists elsewhere", () =>
    expect(
      reviewClassification(
        {
          ...request,
          categories: [
            { category: "EXAM_REQUEST", evidence: [{ page: 2, quote: "Solicito hemograma" }] },
          ],
        },
        [page],
        patient,
      ).action,
    ).toBe("NEEDS_REVIEW"));
  it("preserves multi-category page mapping", () => {
    const result = {
      ...request,
      categories: [
        ...request.categories,
        {
          category: "IMAGE_REPORT" as const,
          evidence: [{ page: 2, quote: "Ultrassonografia abdominal" }],
        },
      ],
    };
    expect(
      reviewClassification(
        result,
        [page, { page: 2, text: "Laudo de imagem\nUltrassonografia abdominal" }],
        patient,
      ).action,
    ).toBe("SUGGESTED");
  });
  it("retains an explicit abstention", () =>
    expect(
      reviewClassification({ categories: [], abstention: "ILLEGIBLE" }, [page], patient).action,
    ).toBe("NEEDS_REVIEW"));
  it("denies production even if Preview flags were copied", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    vi.stubEnv("DOCUMENT_CLASSIFICATION_ENABLED", "true");
    expect(classificationBoundary()).toBe(false);
    expect(classifierEnabled()).toBe(false);
  });
  it("requires an explicit activation flag inside the synthetic boundary", () => {
    vi.stubEnv("INVENTORY_ENVIRONMENT", "test");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    vi.stubEnv("DOCUMENT_CLASSIFICATION_ENABLED", "false");
    expect(classifierEnabled()).toBe(false);
  });
  it("does not silently route to other models or providers", () => {
    vi.stubEnv("LAB_EXTRACTION_PROVIDER", "openrouter");
    vi.stubEnv("LAB_EXTRACTION_MODEL", "other/provider");
    expect(classificationConfiguration().ready).toBe(false);
  });
});
