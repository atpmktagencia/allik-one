import { z } from "zod";

/** Version-one contracts carry resource references only, never clinical or financial data. */
export const integrationEventAggregateTypes = {
  PRESCRIPTION_FINALIZED: "PRESCRIPTION",
  QUOTE_CREATED: "QUOTE",
  QUOTE_APPROVED: "QUOTE",
  SALE_COMPLETED: "SALE",
  SESSION_SCHEDULED: "SESSION",
  ITEM_ADMINISTERED: "ADMINISTRATION",
  STOCK_CONSUMED: "STOCK_CONSUMPTION",
} as const;

export const integrationEventTypes = [
  "PRESCRIPTION_FINALIZED",
  "QUOTE_CREATED",
  "QUOTE_APPROVED",
  "SALE_COMPLETED",
  "SESSION_SCHEDULED",
  "ITEM_ADMINISTERED",
  "STOCK_CONSUMED",
] as const;

/** Having a contract does not enable a producer for a future workflow. */
export const supportedIntegrationEventProducerTypes = [
  "PRESCRIPTION_FINALIZED",
  "QUOTE_CREATED",
  "ITEM_ADMINISTERED",
  "STOCK_CONSUMED",
] as const;

const versionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const integrationEventEnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    unitId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    eventType: z.enum(integrationEventTypes),
    aggregateType: z.enum([
      "PRESCRIPTION",
      "QUOTE",
      "SALE",
      "SESSION",
      "ADMINISTRATION",
      "STOCK_CONSUMPTION",
    ]),
    aggregateId: z.string().uuid(),
    aggregateVersion: versionSchema,
    schemaVersion: z.literal(1),
    payload: z.object({ resourceId: z.string().uuid(), resourceVersion: versionSchema }).strict(),
  })
  .strict();

function validateReferences(
  event: z.infer<typeof integrationEventEnvelopeSchema> | z.infer<typeof producerEnvelopeSchema>,
  context: z.RefinementCtx,
) {
  // Direct-final prescriptions retain the established document revision zero.
  if (event.aggregateVersion === 0 && event.eventType !== "PRESCRIPTION_FINALIZED") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aggregateVersion"],
      message: "This event requires a positive aggregate version",
    });
  }
  if (event.aggregateType !== integrationEventAggregateTypes[event.eventType]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aggregateType"],
      message: "Aggregate type does not match event type",
    });
  }
  if (event.payload.resourceId !== event.aggregateId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payload", "resourceId"],
      message: "Payload resource must match aggregate",
    });
  }
  if (event.payload.resourceVersion !== event.aggregateVersion) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payload", "resourceVersion"],
      message: "Payload version must match aggregate version",
    });
  }
}

const producerEnvelopeSchema = integrationEventEnvelopeSchema.omit({
  id: true,
  schemaVersion: true,
});
export const integrationEventProducerInputSchema = producerEnvelopeSchema
  .superRefine(validateReferences)
  .superRefine((event, context) => {
    if (!supportedIntegrationEventProducerTypes.some((type) => type === event.eventType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventType"],
        message: "No producer is enabled for this event type",
      });
    }
  });
export const integrationEventInputSchema =
  integrationEventEnvelopeSchema.superRefine(validateReferences);
export type IntegrationEventProducerInput = z.infer<typeof integrationEventProducerInputSchema>;

export type IntegrationEventInput = z.infer<typeof integrationEventInputSchema>;
export type IntegrationEventType = (typeof integrationEventTypes)[number];
export type SupportedIntegrationEventProducerType =
  (typeof supportedIntegrationEventProducerTypes)[number];
