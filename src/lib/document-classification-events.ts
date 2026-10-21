import { z } from "zod";
import {
  documentClassificationCategory,
  documentClassificationSuggestion,
} from "./patient-document-classification";
const version = z.literal(1);
const reason = z.string().trim().min(10).max(500);
export const classificationCategories = z
  .array(documentClassificationCategory)
  .min(1)
  .max(7)
  .refine((a) => new Set(a).size === a.length);
const decision = {
  schemaVersion: version,
  categories: classificationCategories,
  reason,
  originalReviewed: z.literal(true),
  identityConfirmed: z.literal(true),
};
export const humanClassificationCommand = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("MANUAL_CLASSIFIED"), payload: z.object(decision).strict() })
    .strict(),
  z.object({ action: z.literal("CORRECTED"), payload: z.object(decision).strict() }).strict(),
  z
    .object({
      action: z.literal("CONFIRMED"),
      payload: z.object({ ...decision, resultEventId: z.string().uuid() }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("RETRY_REQUESTED"),
      payload: z.object({ schemaVersion: version, reason }).strict(),
    })
    .strict(),
]);
export const systemClassificationCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("RECEIVED"),
      payload: z.object({ schemaVersion: version }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("STARTED"),
      payload: z
        .object({ schemaVersion: version, model: z.string().regex(/^[a-zA-Z0-9_./-]{1,120}$/) })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("FAILED"),
      payload: z
        .object({
          schemaVersion: version,
          failureCode: z.enum([
            "TIMEOUT",
            "PROVIDER_FAILURE",
            "SOURCE_UNAVAILABLE",
            "AMBIGUOUS_RESPONSE",
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("SUGGESTED"),
      payload: z
        .object({
          schemaVersion: version,
          result: documentClassificationSuggestion.refine(
            (result) => result.abstention === "NONE" && result.categories.length > 0,
          ),
          evidenceStatus: z.literal("SUPPORTED"),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("NEEDS_REVIEW"),
      payload: z
        .object({
          schemaVersion: version,
          result: documentClassificationSuggestion,
          evidenceStatus: z.enum(["UNAVAILABLE", "AMBIGUOUS", "IDENTITY_MISMATCH"]),
        })
        .strict(),
    })
    .strict(),
]);
export const classificationWrite = z
  .object({
    documentId: z.string().uuid(),
    patientId: z.string().uuid(),
    unitId: z.string().uuid(),
    operationId: z.string().uuid(),
    expectedRevision: z.number().int().min(0),
    attemptId: z.string().uuid().nullable(),
    command: z.union([humanClassificationCommand, systemClassificationCommand]),
  })
  .strict();
export type ClassificationWrite = z.infer<typeof classificationWrite>;
