import { describe, expect, it } from "vitest";
import {
  integrationEventAggregateTypes,
  integrationEventInputSchema,
  integrationEventProducerInputSchema,
  integrationEventTypes,
  supportedIntegrationEventProducerTypes,
} from "@/data/integration-event";

const resourceId = "00000000-0000-4000-8000-000000000005";
const event = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  unitId: "00000000-0000-4000-8000-000000000003",
  actorUserId: "00000000-0000-4000-8000-000000000004",
  eventType: "PRESCRIPTION_FINALIZED",
  aggregateType: "PRESCRIPTION",
  aggregateId: resourceId,
  aggregateVersion: 1,
  schemaVersion: 1,
  payload: { resourceId, resourceVersion: 1 },
};

describe("Integration event reference-only contracts", () => {
  it.each(integrationEventTypes)("accepts the exact aggregate for %s", (eventType) => {
    expect(
      integrationEventInputSchema.safeParse({
        ...event,
        eventType,
        aggregateType: integrationEventAggregateTypes[eventType],
      }).success,
    ).toBe(true);
  });

  it("validates producers before server-assigned envelope fields", () => {
    const { id: _id, schemaVersion: _schemaVersion, ...producer } = event;
    expect(integrationEventProducerInputSchema.safeParse(producer).success).toBe(true);
    expect(integrationEventProducerInputSchema.safeParse(event).success).toBe(false);
    expect(
      integrationEventProducerInputSchema.safeParse({ ...producer, aggregateType: "QUOTE" })
        .success,
    ).toBe(false);
    expect(
      integrationEventProducerInputSchema.safeParse({
        ...producer,
        payload: { resourceId, resourceVersion: 2 },
      }).success,
    ).toBe(false);
  });

  it.each(["QUOTE_APPROVED", "SALE_COMPLETED", "SESSION_SCHEDULED"] as const)(
    "rejects reserved producer %s",
    (eventType) => {
      const { id: _id, schemaVersion: _schemaVersion, ...producer } = event;
      expect(
        integrationEventProducerInputSchema.safeParse({
          ...producer,
          eventType,
          aggregateType: integrationEventAggregateTypes[eventType],
        }).success,
      ).toBe(false);
    },
  );

  it("retains actual revision zero for a directly finalized prescription", () => {
    const directFinal = {
      ...event,
      aggregateVersion: 0,
      payload: { resourceId, resourceVersion: 0 },
    };
    expect(integrationEventInputSchema.parse(directFinal).aggregateVersion).toBe(0);
    const { id: _id, schemaVersion: _schemaVersion, ...producer } = directFinal;
    expect(integrationEventProducerInputSchema.parse(producer).payload.resourceVersion).toBe(0);
  });

  it.each(integrationEventTypes.filter((type) => type !== "PRESCRIPTION_FINALIZED"))(
    "requires positive revision for %s",
    (eventType) => {
      expect(
        integrationEventInputSchema.safeParse({
          ...event,
          eventType,
          aggregateType: integrationEventAggregateTypes[eventType],
          aggregateVersion: 0,
          payload: { resourceId, resourceVersion: 0 },
        }).success,
      ).toBe(false);
    },
  );

  it("keeps future contracts separate from currently supported producers", () => {
    expect(supportedIntegrationEventProducerTypes).toEqual([
      "PRESCRIPTION_FINALIZED",
      "QUOTE_CREATED",
      "ITEM_ADMINISTERED",
      "STOCK_CONSUMED",
    ]);
  });

  it.each([
    { aggregateType: "QUOTE" },
    { eventType: "UNKNOWN" },
    { schemaVersion: 2 },
    { id: "not-a-uuid" },
    { organizationId: null },
    { unitId: "" },
    { actorUserId: undefined },
    { aggregateId: "not-a-uuid" },
    { aggregateVersion: 0 },
    { aggregateVersion: -1 },
    { aggregateVersion: -1, payload: { resourceId, resourceVersion: -1 } },
    { aggregateVersion: 1.5 },
    { aggregateVersion: Number.MAX_SAFE_INTEGER + 1 },
    { patientName: "Forbidden" },
    { payload: { resourceId, resourceVersion: 1, dose: "10 mg" } },
    { payload: { resourceId, resourceVersion: 1, cost: "10.00" } },
    { payload: { resourceId, resourceVersion: 1, nested: {} } },
    { payload: { resourceId: event.id, resourceVersion: 1 } },
    { payload: { resourceId, resourceVersion: 2 } },
    { payload: { resourceId, resourceVersion: 0 } },
    { payload: { resourceId, resourceVersion: Number.MAX_SAFE_INTEGER + 1 } },
  ])("rejects malformed, inconsistent, or expanded envelope %j", (change) => {
    expect(integrationEventInputSchema.safeParse({ ...event, ...change }).success).toBe(false);
  });

  it("preserves exact safe integer revisions without coercion", () => {
    expect(
      integrationEventInputSchema.parse({
        ...event,
        aggregateVersion: Number.MAX_SAFE_INTEGER,
        payload: { resourceId, resourceVersion: Number.MAX_SAFE_INTEGER },
      }).aggregateVersion,
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(integrationEventInputSchema.safeParse({ ...event, aggregateVersion: "1" }).success).toBe(
      false,
    );
  });
});
