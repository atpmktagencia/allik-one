import { z } from "zod";
const reason = z.string().trim().min(10).max(500);
const version = z.literal(1);
export const laboratoryAutomationCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("STARTED"),
      payload: z
        .object({
          schemaVersion: version,
          model: z.string().regex(/^[a-zA-Z0-9_./-]{1,120}$/),
          pages: z.array(z.number().int().min(1).max(20)).min(1).max(20),
          independentTotalPages: z.number().int().min(1).max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("READY"),
      payload: z.object({ schemaVersion: version, importId: z.string().uuid() }).strict(),
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
            "SOURCE_INTEGRITY",
            "BUDGET_STOP",
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("CANCELLED"),
      payload: z.object({ schemaVersion: version, reason }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("RETRY_REQUESTED"),
      payload: z.object({ schemaVersion: version, reason }).strict(),
    })
    .strict(),
]);
export const laboratoryAutomationEventWrite = z
  .object({
    requestId: z.string().uuid(),
    operationId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    classificationEventId: z.string().uuid().nullable(),
    attemptId: z.string().uuid().nullable(),
    command: laboratoryAutomationCommand,
  })
  .strict()
  .superRefine((v, ctx) => {
    const execution = ["STARTED", "READY", "FAILED"].includes(v.command.action);
    if (
      execution !== Boolean(v.attemptId && v.classificationEventId) ||
      (!execution && (v.attemptId !== null || v.classificationEventId !== null))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attempt and classification must match event type",
      });
  });
