import { z } from "zod";

/** F2 contract only. No provider calls or clinical writes. */
export const DOCUMENT_CLASSIFIER_VERSION = "document-classifier-1";
export const documentClassificationCategory = z.enum([
  "LAB_RESULT",
  "EXAM_REQUEST",
  "IMAGE_REPORT",
  "MEDICAL_PRESCRIPTION",
  "MEDICAL_REPORT",
  "MEDICAL_CERTIFICATE",
  "OTHER",
]);
export const documentClassificationSuggestion = z
  .object({
    categories: z
      .array(
        z
          .object({
            category: documentClassificationCategory,
            evidence: z
              .array(
                z
                  .object({
                    page: z.number().int().min(1).max(100),
                    quote: z.string().trim().min(1).max(600),
                  })
                  .strict(),
              )
              .min(1)
              .max(20),
          })
          .strict(),
      )
      .max(7),
    abstention: z.enum(["NONE", "ILLEGIBLE", "AMBIGUOUS", "UNRECOGNIZED", "INCOMPLETE"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.categories.map((c) => c.category)).size !== value.categories.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate category" });
    if (!value.categories.length && value.abstention === "NONE")
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Empty classification requires abstention",
      });
  });

export type DocumentClassificationSuggestion = z.infer<typeof documentClassificationSuggestion>;
export type ClassificationEvidenceIssue =
  | "INDEPENDENT_SOURCE_UNAVAILABLE"
  | "PAGE_MISSING"
  | "QUOTE_NOT_FOUND"
  | "IDENTITY_UNRESOLVED"
  | "MODEL_ABSTENTION";

/** Literal provenance is necessary, not sufficient to prove a category's semantics.
 * Identity is checked outside the model, against the already scoped patient.
 * This function never confirms a classification or clinical result.
 */
export function checkDocumentClassificationEvidence(
  suggestion: DocumentClassificationSuggestion,
  sourcePages: readonly { page: number; text: string }[] | null,
  identity: "SUPPORTED" | "UNRESOLVED" | "MISMATCH",
) {
  const parsed = documentClassificationSuggestion.parse(suggestion);
  const issues = new Set<ClassificationEvidenceIssue>();
  const normalize = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (identity !== "SUPPORTED") issues.add("IDENTITY_UNRESOLVED");
  if (parsed.abstention !== "NONE") issues.add("MODEL_ABSTENTION");
  if (!sourcePages?.length) issues.add("INDEPENDENT_SOURCE_UNAVAILABLE");
  for (const category of parsed.categories) {
    for (const evidence of category.evidence) {
      const page = sourcePages?.find((p) => p.page === evidence.page);
      if (!page) {
        issues.add("PAGE_MISSING");
      } else if (!normalize(page.text).includes(normalize(evidence.quote))) {
        issues.add("QUOTE_NOT_FOUND");
      }
    }
  }
  return {
    classifierVersion: DOCUMENT_CLASSIFIER_VERSION,
    provenance: issues.size ? ("NEEDS_REVIEW" as const) : ("LITERAL_SUPPORT_ONLY" as const),
    issues: [...issues],
    // Model suggestions cannot impersonate a clinician's confirmation.
    confirmed: false as const,
    completenessProven: false as const,
  };
}
