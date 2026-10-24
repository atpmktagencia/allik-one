import { expect, it } from "vitest";
import { laboratoryAutomationEventWrite } from "@/lib/laboratory-automation-events";
const id = "a1100000-0000-4000-8000-000000000001";
const start = {
  requestId: id,
  operationId: id,
  expectedRevision: 0,
  classificationEventId: id,
  attemptId: id,
  command: {
    action: "STARTED",
    payload: { schemaVersion: 1, model: "openai/synthetic", pages: [1], independentTotalPages: 1 },
  },
};
it("accepts only the operational contract, not clinical publication", () => {
  expect(laboratoryAutomationEventWrite.safeParse(start).success).toBe(true);
  expect(
    laboratoryAutomationEventWrite.safeParse({
      ...start,
      command: { action: "VALIDATED", payload: { schemaVersion: 1 } },
    }).success,
  ).toBe(false);
  expect(laboratoryAutomationEventWrite.safeParse({ ...start, actorKind: "SYSTEM" }).success).toBe(
    false,
  );
});
it.each([
  { model: 42 },
  { pages: ["1"] },
  { independentTotalPages: "1" },
  { schemaVersion: null },
  { schemaVersion: 2 },
  { pages: [0] },
  { pages: [21] },
  { independentTotalPages: 0 },
  { unexpected: "ignore this" },
])("rejects malformed start payload %#", (patch) =>
  expect(
    laboratoryAutomationEventWrite.safeParse({
      ...start,
      command: { ...start.command, payload: { ...start.command.payload, ...patch } },
    }).success,
  ).toBe(false),
);
it("binds execution events to both attempt and classification, leaving manual decisions separate", () => {
  expect(laboratoryAutomationEventWrite.safeParse({ ...start, attemptId: null }).success).toBe(
    false,
  );
  expect(
    laboratoryAutomationEventWrite.safeParse({ ...start, classificationEventId: null }).success,
  ).toBe(false);
  const retry = {
    ...start,
    attemptId: null,
    classificationEventId: null,
    command: {
      action: "RETRY_REQUESTED",
      payload: { schemaVersion: 1, reason: "Conferir novamente o original sintético" },
    },
  };
  expect(laboratoryAutomationEventWrite.safeParse(retry).success).toBe(true);
  expect(laboratoryAutomationEventWrite.safeParse({ ...retry, attemptId: id }).success).toBe(false);
  expect(
    laboratoryAutomationEventWrite.safeParse({
      ...retry,
      command: { ...retry.command, payload: { schemaVersion: 1, reason: "x" } },
    }).success,
  ).toBe(false);
});
