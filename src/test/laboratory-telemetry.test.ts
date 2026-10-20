import { expect, it } from "vitest";
import { createLaboratoryTelemetry, laboratoryPrices } from "@/lib/laboratory-telemetry";
const prices = JSON.stringify({
  provider: "openai",
  model: "openai/synthetic",
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 3,
  cachedInputUsdPerMillion: 0.5,
  asOf: "2026-01-01",
});
it("sums available token usage and configured model-specific cost without double-counting reasoning", () => {
  const t = createLaboratoryTelemetry("openai", "openai/synthetic", prices);
  for (let i = 0; i < 2; i++) {
    t.start();
    t.complete({
      inputTokens: 100,
      outputTokens: 50,
      inputTokenDetails: { cacheReadTokens: 20 },
      outputTokenDetails: { reasoningTokens: 10 },
    });
  }
  expect(t.finish(150, null, 5)).toMatchObject({
    inputTokens: 200,
    outputTokens: 100,
    cachedInputTokens: 40,
    reasoningTokens: 20,
    usageComplete: true,
    estimatedCostUsd: 0.00048,
    extractedRows: 5,
    failures: 0,
    costBasis: "configured_token_rates",
  });
});
it("keeps unknown usage/cost null and marks incomplete attempts, including charged successful siblings", () => {
  const t = createLaboratoryTelemetry("openai", "openai/synthetic", prices);
  t.start();
  t.complete({ inputTokens: 100, outputTokens: 50 });
  t.start();
  expect(t.finish(200, "EXTRACTION_TIMEOUT", 0)).toMatchObject({
    inputTokens: 100,
    completedRequests: 1,
    startedRequests: 2,
    usageComplete: false,
    estimatedCostUsd: null,
    failures: 1,
  });
  const u = createLaboratoryTelemetry("openai", "openai/synthetic");
  u.start();
  u.complete(undefined);
  expect(u.finish(100, null, 1)).toMatchObject({
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    usageComplete: false,
  });
});
it("does not guess prices or carry a previous model's tariff", () => {
  expect(laboratoryPrices(prices, "openai", "openai/other")).toBeNull();
  expect(laboratoryPrices('{"secret":"DO_NOT_LOG"}', "openai", "openai/synthetic")).toBeNull();
  const t = createLaboratoryTelemetry("openai", "openai/synthetic");
  t.start();
  t.complete({ inputTokens: 100, outputTokens: 50 });
  expect(t.finish(100, null, 1).estimatedCostUsd).toBeNull();
});
it("emits only allowlisted technical fields, not provider raw usage or arbitrary identities", () => {
  const t = createLaboratoryTelemetry("provider WITH PRIVATE DATA", "model@patient.invalid");
  t.start();
  t.complete(
    Object.assign(
      { inputTokens: 10, outputTokens: 5 },
      { raw: { name: "PATIENT", token: "SECRET" } },
    ),
  );
  const s = JSON.stringify(t.finish(100, null, 1));
  expect(s).not.toMatch(/PATIENT|SECRET|PRIVATE|patient.invalid/);
  expect(s).toContain('"model":"unknown"');
});
it("uses a labelled standard-rate upper bound when cache pricing is unavailable", () => {
  const t = createLaboratoryTelemetry("openai", "openai/synthetic", prices);
  t.start();
  t.complete({ inputTokens: 100, outputTokens: 50 });
  expect(t.finish(10, null, 1)).toMatchObject({
    estimatedCostUsd: 0.00025,
    costBasis: "configured_standard_token_upper_bound",
  });
});
it("rejects impossible cache usage instead of producing negative cost", () => {
  const t = createLaboratoryTelemetry("openai", "openai/synthetic", prices);
  t.start();
  t.complete({ inputTokens: 10, outputTokens: 5, inputTokenDetails: { cacheReadTokens: 100 } });
  expect(t.finish(10, null, 1)).toMatchObject({ estimatedCostUsd: null, usageComplete: false });
});
