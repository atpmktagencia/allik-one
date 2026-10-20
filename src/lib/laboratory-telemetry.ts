import {
  LABORATORY_PIPELINE_VERSION,
  LABORATORY_PROMPT_VERSION,
  LABORATORY_VERIFIER_VERSION,
} from "./laboratory-pipeline-version";

type Usage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined };
  outputTokenDetails?: { reasoningTokens?: number | undefined };
};
type Prices = {
  provider: string;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  asOf: string;
};
const tokenCount = (n: unknown): number | null =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
const safeId = (s: string) => (/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,119}$/.test(s) ? s : "unknown");
export function laboratoryPrices(
  raw: string | undefined,
  provider: string,
  model: string,
): Prices | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (
      !p ||
      p.provider !== provider ||
      p.model !== model ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.asOf ?? "")
    )
      return null;
    if (
      ![p.inputUsdPerMillion, p.outputUsdPerMillion, p.cachedInputUsdPerMillion ?? 0].every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000000,
      )
    )
      return null;
    return {
      provider,
      model,
      inputUsdPerMillion: p.inputUsdPerMillion,
      outputUsdPerMillion: p.outputUsdPerMillion,
      ...(p.cachedInputUsdPerMillion !== undefined
        ? { cachedInputUsdPerMillion: p.cachedInputUsdPerMillion }
        : {}),
      asOf: p.asOf,
    };
  } catch {
    return null;
  }
}
export function createLaboratoryTelemetry(provider: string, model: string, pricing?: string) {
  const prices = laboratoryPrices(pricing, provider, model);
  const usages: (Usage | undefined)[] = [];
  let started = 0;
  return {
    start: () => {
      started++;
    },
    complete: (usage: Usage | undefined) => {
      usages.push(usage);
    },
    finish: (durationMs: number, failureCode: string | null, rows: number) => {
      const sum = (read: (u: Usage | undefined) => unknown) => {
        const values = usages.map((u) => tokenCount(read(u)));
        return values.length && values.every((n) => n !== null)
          ? values.reduce<number>((a, b) => a + (b ?? 0), 0)
          : null;
      };
      const inputTokens = sum((u) => u?.inputTokens),
        outputTokens = sum((u) => u?.outputTokens);
      const cachedInputTokens = sum((u) => u?.inputTokenDetails?.cacheReadTokens);
      const reasoningTokens = sum((u) => u?.outputTokenDetails?.reasoningTokens);
      const usageComplete =
        !failureCode &&
        started > 0 &&
        usages.length === started &&
        inputTokens !== null &&
        outputTokens !== null &&
        (cachedInputTokens === null || cachedInputTokens <= inputTokens);
      const cachePriced =
        cachedInputTokens !== null && prices?.cachedInputUsdPerMillion !== undefined;
      const estimatedCostUsd =
        usageComplete && prices
          ? ((inputTokens - (cachePriced ? cachedInputTokens! : 0)) * prices.inputUsdPerMillion +
              (cachePriced ? cachedInputTokens! * prices.cachedInputUsdPerMillion! : 0) +
              outputTokens * prices.outputUsdPerMillion) /
            1000000
          : null;
      return {
        pipelineVersion: LABORATORY_PIPELINE_VERSION,
        promptVersion: LABORATORY_PROMPT_VERSION,
        verifierVersion: LABORATORY_VERIFIER_VERSION,
        provider: safeId(provider),
        model: safeId(model),
        durationMs,
        startedRequests: started,
        completedRequests: usages.length,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        reasoningTokens,
        usageComplete,
        estimatedCostUsd,
        costBasis:
          estimatedCostUsd === null
            ? "unavailable"
            : cachePriced
              ? "configured_token_rates"
              : "configured_standard_token_upper_bound",
        pricingAsOf: prices?.asOf ?? null,
        extractedRows: rows,
        failures: failureCode ? 1 : 0,
      };
    },
  };
}
export type LaboratoryExtractionTelemetry = ReturnType<
  ReturnType<typeof createLaboratoryTelemetry>["finish"]
>;
