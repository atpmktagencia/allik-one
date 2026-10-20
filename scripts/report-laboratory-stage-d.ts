/** Offline real-inference evaluator. Never calls a provider, application or database.
 * npx tsx scripts/report-laboratory-stage-d.ts captures.json [baseline.json]
 * Captures use the Stage C shape; add phase before/after for paired trials.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";
import { laboratoryBenchmarkCases } from "../src/test/fixtures/laboratory-benchmark";
import { laboratoryRobustnessCases } from "../src/test/fixtures/laboratory-robustness";
import { experimentLaboratoryInventory } from "../src/lib/laboratory-completeness-experiment";
import {
  evaluateLaboratoryRobustness,
  reconstructPreRecoveryLaboratoryRows,
  laboratoryEvaluationFields,
  emptyLaboratoryFieldCounts,
  type LaboratoryFieldCounts,
  type LaboratoryEvaluationField,
} from "../src/lib/laboratory-robustness-evaluation";
import type { LaboratoryDraft } from "../src/lib/laboratory-results";
import type { LaboratoryEvidenceCheck } from "../src/lib/laboratory-evidence";

type Telemetry = {
  model?: string;
  provider?: string;
  pipelineVersion?: string;
  promptVersion?: string;
  verifierVersion?: number;
  durationMs?: number;
  processingMilliseconds?: number;
  startedRequests?: number;
  completedRequests?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  usageComplete?: boolean;
  dateRecoveries?: unknown[];
};
type Capture = {
  caseId: string;
  documentId?: string;
  phase?: string;
  sha256: string;
  httpStatus?: number;
  wallMilliseconds?: number;
  transportError?: string;
  telemetry?: Telemetry;
  import?: { status: string; draft: LaboratoryDraft; failure_code?: string | null; model?: string };
  evidenceChecks?: { rows: LaboratoryEvidenceCheck[] };
};
const [inputPath, baselinePath] = process.argv.slice(2);
assert(inputPath, "Pass a saved real-inference capture; reporter does not generate observations.");
const input = JSON.parse(await readFile(inputPath, "utf8")) as {
  records: Capture[];
  supplementalRecords?: Capture[];
  provenance?: unknown;
};
assert(Array.isArray(input.records) && input.records.length > 0);
assert(input.supplementalRecords === undefined || Array.isArray(input.supplementalRecords));
const baseline = baselinePath
  ? (JSON.parse(await readFile(baselinePath, "utf8")) as { records: Capture[] })
  : null;
const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : null;
};
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const knownSum = (values: unknown[]) =>
  values.length && values.every(count) ? values.reduce<number>((n, v) => n + v, 0) : null;
const rates = { inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.01, outputUsdPerMillion: 0.5 };
const source = "https://developers.openai.com/api/docs/models/gpt-6-luna";
function estimateTokenCost(t: Telemetry | undefined) {
  if (
    !t?.usageComplete ||
    !count(t.inputTokens) ||
    !count(t.outputTokens) ||
    t.provider !== "openai" ||
    t.model !== "openai/gpt-6-luna"
  )
    return null;
  const cached = count(t.cachedInputTokens) ? t.cachedInputTokens : null;
  if (cached !== null && cached > t.inputTokens) return null;
  return (
    ((t.inputTokens - (cached ?? 0)) * rates.inputUsdPerMillion +
      (cached ?? 0) * rates.cachedInputUsdPerMillion +
      t.outputTokens * rates.outputUsdPerMillion) /
    1_000_000
  );
}
/** Operational accounting includes misrouted/reconciled attempts without relabeling
 * them as candidate quality measurements or pairing them with a different pipeline. */
function usageSummary(records: Capture[]) {
  const sum = (read: (r: Capture) => unknown) => (records.length ? knownSum(records.map(read)) : 0);
  const costs = records.map((r) => estimateTokenCost(r.telemetry));
  return {
    imports: records.length,
    successfulBackendExtractions: records.filter((r) => r.import?.status === "READY_REVIEW").length,
    failedBackendExtractions: records.filter((r) => r.import?.status === "FAILED").length,
    unknownBackendOutcomes: records.filter(
      (r) => !r.import || !["READY_REVIEW", "FAILED"].includes(r.import.status),
    ).length,
    interruptedClientRequests: records.filter((r) => !!r.transportError).length,
    inputTokens: sum((r) => r.telemetry?.inputTokens),
    outputTokens: sum((r) => r.telemetry?.outputTokens),
    startedRequests: sum((r) => r.telemetry?.startedRequests),
    completedRequests: sum((r) => r.telemetry?.completedRequests),
    usageComplete: records.every((r) => r.telemetry?.usageComplete === true),
    estimatedTokenCostUsd: costs.every((c) => c !== null)
      ? costs.reduce<number>((n, c) => n + c!, 0)
      : null,
    observedInvoiceCostUsd: null,
    costBasis: costs.every((c) => c !== null)
      ? "public_standard_token_rates_not_invoice"
      : "unavailable",
  };
}
const supplementalRecords = input.supplementalRecords ?? [];
const allAttemptRecords = [...input.records, ...supplementalRecords];
const documentIds = allAttemptRecords.flatMap((r) => (r.documentId ? [r.documentId] : []));
assert.equal(
  new Set(documentIds).size,
  documentIds.length,
  "Duplicate import would double-count usage.",
);
const seen = new Set<string>();
type EvaluatedCase = {
  caseId: string;
  phase: string;
  format: "digital" | "scanned";
  tags: string[];
  sha256: string;
  referenceSha256: string;
  referencePolicy: string;
  pageCount: number;
  independentText: boolean;
  extractionSucceeded: boolean;
  failureCode: string | null;
  httpStatus: number | null;
  wallMilliseconds: number | null;
  evaluation: ReturnType<typeof evaluateLaboratoryRobustness>;
  deterministicDateRecoveredFields: number;
  derivedModelOnlyEvaluation: ReturnType<typeof evaluateLaboratoryRobustness> | null;
  inventory: unknown;
  telemetry: Telemetry | null;
  estimatedTokenCostUsd: number | null;
  costBasis: string;
  historicalBaselineSamePdf: boolean | null;
};
const cases: EvaluatedCase[] = [];
for (const record of input.records) {
  const phase = record.phase ?? "unpaired";
  const identity = JSON.stringify([phase, record.caseId]);
  assert(
    !seen.has(identity),
    "Duplicate phase/case; label repeats explicitly rather than silently pooling.",
  );
  seen.add(identity);
  const modern = laboratoryRobustnessCases.find((c) => c.id === record.caseId);
  const legacy = laboratoryBenchmarkCases.find((c) => c.id === record.caseId);
  const fixture = modern ?? legacy;
  assert(fixture, `Unversioned fixture: ${record.caseId}`);
  const directory = modern ? "laboratory-robustness-pdfs" : "laboratory-pdfs";
  const path = new URL(`../src/test/fixtures/${directory}/`, import.meta.url);
  const hashes = JSON.parse(await readFile(new URL("sha256.json", path), "utf8")) as Record<
    string,
    string
  >;
  const bytes = await readFile(new URL(record.caseId + ".pdf", path));
  assert.equal(digest(bytes), hashes[record.caseId], "Versioned original hash changed.");
  assert.equal(
    record.sha256,
    hashes[record.caseId],
    "Captured PDF differs from synthetic reference.",
  );
  const originalRows = fixture.reference.map((r) => ({ ...r.row }));
  let unresolved = modern?.expectedUnresolved ?? [];
  if (!modern && fixture.id === "dates-and-metadata") originalRows[0]!.issuedOn = "2026-01-05";
  const referenceRows = !modern && fixture.id === "partially-legible" ? [] : originalRows;
  if (!modern && fixture.id === "partially-legible")
    unresolved = [{ name: "TSH", sourcePage: 1, reason: "unreadable" }];
  const reference = { rows: referenceRows, unresolved };
  const referenceSha256 = digest(JSON.stringify(reference));
  const rows = record.import?.draft.rows ?? [];
  if (record.import) {
    assert.equal(
      record.import.draft.patientConfirmed,
      false,
      "Benchmark must not confirm patient identity.",
    );
    assert(
      rows.every((r) => r.verified === false),
      "Benchmark must not validate clinical results.",
    );
    assert.notEqual(record.import.status, "VALIDATED", "Do not benchmark validated imports.");
  }
  if (record.evidenceChecks) assert.equal(record.evidenceChecks.rows.length, rows.length);
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const pages: { page: number; text: string }[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n),
        content = await page.getTextContent();
      let text = "";
      for (const item of content.items)
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      pages.push({ page: n, text: text.trim() });
      page.cleanup();
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  const independentText = pages.some((p) => p.text.length > 0);
  const extractionSucceeded = record.httpStatus === 200 && record.import?.status === "READY_REVIEW";
  const evaluation = evaluateLaboratoryRobustness(reference, rows, record.evidenceChecks?.rows, {
    independentText,
  });
  const t = record.telemetry;
  const recoveries = t?.dateRecoveries ?? [];
  const reconstructed = reconstructPreRecoveryLaboratoryRows(rows, recoveries);
  const derivedModelOnlyEvaluation = recoveries.length
    ? evaluateLaboratoryRobustness(reference, reconstructed, undefined, { independentText })
    : null;
  const cost = estimateTokenCost(t);
  const sameCaseBaseline = baseline?.records.find((r) => r.caseId === record.caseId);
  const samePdfBaseline = sameCaseBaseline?.sha256 === record.sha256;
  cases.push({
    caseId: record.caseId,
    phase,
    format: fixture.format,
    tags: modern?.tags ?? ["legacy_c"],
    sha256: record.sha256,
    referenceSha256,
    referencePolicy: modern
      ? "stage_d_explicit_evidence_v1"
      : "stage_c_legacy_ddmm_with_issued_overlay",
    pageCount: pages.length,
    independentText,
    extractionSucceeded,
    failureCode:
      record.import?.failure_code ??
      record.transportError ??
      (extractionSucceeded ? null : "UNKNOWN_FAILURE"),
    httpStatus: record.httpStatus ?? null,
    wallMilliseconds: record.wallMilliseconds ?? null,
    evaluation,
    deterministicDateRecoveredFields: recoveries.length,
    derivedModelOnlyEvaluation,
    inventory: independentText
      ? experimentLaboratoryInventory(pages, rows)
      : {
          scope: "no_independent_text",
          completenessProven: false,
          recognizableRows: null,
          possibleOmissions: null,
        },
    telemetry: t ?? null,
    estimatedTokenCostUsd: cost,
    costBasis: cost === null ? "unavailable" : "public_standard_token_rates_not_invoice",
    historicalBaselineSamePdf: sameCaseBaseline ? samePdfBaseline : null,
  });
}
type Case = (typeof cases)[number];
function aggregate(items: Case[]) {
  const sum = (fn: (c: Case) => number) => items.reduce((n, c) => n + fn(c), 0);
  const fields = Object.fromEntries(
    laboratoryEvaluationFields.map((f) => [f, emptyLaboratoryFieldCounts()]),
  ) as Record<LaboratoryEvaluationField, LaboratoryFieldCounts>;
  for (const item of items)
    for (const f of laboratoryEvaluationFields)
      for (const k of Object.keys(fields[f]) as (keyof LaboratoryFieldCounts)[])
        fields[f][k] += item.evaluation.fields[f][k];
  const expected = sum((c) => c.evaluation.expectedLegibleRows),
    recovered = sum((c) => c.evaluation.correctResults),
    emitted = sum((c) => c.evaluation.emittedRows);
  const attention = knownSum(items.map((c) => c.evaluation.verifier.attentionRows));
  return {
    documents: items.length,
    successfulExtractions: sum((c) => Number(c.extractionSucceeded)),
    failedAttempts: sum((c) => Number(!c.extractionSucceeded)),
    expectedLegibleResults: expected,
    correctResults: recovered,
    resultRecall: expected ? recovered / expected : null,
    emittedRows: emitted,
    completeRows: sum((c) => c.evaluation.completeRows),
    omittedRows: sum((c) => c.evaluation.omittedRows),
    unmatchedRows: sum((c) => c.evaluation.unmatchedRows),
    associationErrors: sum((c) => c.evaluation.associationErrors),
    fields,
    reviewRows: attention,
    reviewFraction: attention === null || !emitted ? null : attention / emitted,
    unsafeLiteralMatches: knownSum(items.map((c) => c.evaluation.verifier.unsafeLiteralMatches)),
    falseAlertCandidates: knownSum(items.map((c) => c.evaluation.verifier.falseAlertCandidates)),
    silentUnresolvedAcceptance: knownSum(
      items.map((c) => c.evaluation.verifier.silentUnresolvedAcceptance),
    ),
    deterministicDateRecoveredFields: sum((c) => c.deterministicDateRecoveredFields),
    medianHttpMilliseconds: median(
      items.flatMap((c) => (typeof c.wallMilliseconds === "number" ? [c.wallMilliseconds] : [])),
    ),
    latencyMeasuredDocuments: items.filter((c) => typeof c.wallMilliseconds === "number").length,
    inputTokens: knownSum(items.map((c) => c.telemetry?.inputTokens)),
    outputTokens: knownSum(items.map((c) => c.telemetry?.outputTokens)),
    startedRequests: knownSum(items.map((c) => c.telemetry?.startedRequests)),
    completedRequests: knownSum(items.map((c) => c.telemetry?.completedRequests)),
    estimatedTokenCostUsd: items.every((c) => c.estimatedTokenCostUsd !== null)
      ? sum((c) => c.estimatedTokenCostUsd!)
      : null,
    observedInvoiceCostUsd: null,
  };
}
const phases = [...new Set(cases.map((c) => c.phase))];
const pairedComparisons = [];
for (const before of cases.filter((c) => c.phase === "before")) {
  const after = cases.find((c) => c.phase === "after" && c.caseId === before.caseId);
  if (!after) continue;
  const samePdf = before.sha256 === after.sha256,
    sameReference = before.referenceSha256 === after.referenceSha256;
  const sameConfiguredModel =
    !!before.telemetry?.model &&
    before.telemetry.model === after.telemetry?.model &&
    before.telemetry.provider === after.telemetry?.provider;
  pairedComparisons.push({
    caseId: before.caseId,
    samePdf,
    sameReference,
    sameConfiguredModel,
    nominallyComparable: samePdf && sameReference && sameConfiguredModel,
    resolvedRevisionKnown: false,
    correctResultsBefore: before.evaluation.correctResults,
    correctResultsAfter: after.evaluation.correctResults,
    fieldCorrectBefore: before.evaluation.positiveCorrect,
    fieldCorrectAfter: after.evaluation.positiveCorrect,
    fieldExpected: before.evaluation.positiveExpected,
    omittedRowsBefore: before.evaluation.omittedRows,
    omittedRowsAfter: after.evaluation.omittedRows,
    unsafeBefore: before.evaluation.verifier.unsafeLiteralMatches,
    unsafeAfter: after.evaluation.verifier.unsafeLiteralMatches,
    beforeHttpMilliseconds: before.wallMilliseconds,
    afterHttpMilliseconds: after.wallMilliseconds,
    limitation:
      "Single trials and a configured alias do not establish causal improvement or model stability.",
  });
}
console.log(
  JSON.stringify(
    {
      benchmark: "stage-d-real-openai",
      evaluation: "offline_reference_v1",
      providerCallsPerformedByReporter: 0,
      sourceCaptureSha256: digest(await readFile(inputPath)),
      sourceProvenance: input.provenance ?? null,
      attemptAccounting: {
        primaryImports: input.records.length,
        supplementalImports: supplementalRecords.length,
        supplementalQualityIncluded: false,
      },
      supplementalUsage: usageSummary(supplementalRecords),
      allAttemptUsage: usageSummary(allAttemptRecords),
      pricing: {
        ...rates,
        asOf: "2026-10-20",
        source,
        basis: "standard_token_estimate_not_invoice",
        excludes: [
          "infrastructure",
          "taxes",
          "service_tier_or_regional_surcharges",
          "cache_writes_if_any",
        ],
      },
      byPhase: Object.fromEntries(
        phases.map((p) => [p, aggregate(cases.filter((c) => c.phase === p))]),
      ),
      byPhaseAndFormat: Object.fromEntries(
        phases.flatMap((p) =>
          ["digital", "scanned"].flatMap((f) => {
            const selected = cases.filter((c) => c.phase === p && c.format === f);
            return selected.length ? [[p + ":" + f, aggregate(selected)]] : [];
          }),
        ),
      ),
      cases,
      pairedComparisons,
      limitations: [
        "Synthetic small selected corpus; no clinical accuracy claim.",
        "Missing or failed attempts remain in denominators; unknown usage/cost never becomes zero.",
        "False-alert candidates need source adjudication; correct-but-unprovable scan/layout warnings remain legitimate.",
        "Stage C legacy ambiguous DD/MM references differ from explicit-evidence Stage D policy; do not claim date improvement from changed truth.",
        "No comparisons between different PDFs establish before/after performance gain.",
        "Supplemental attempts contribute only to operational usage/cost and incidents; they are never relabeled as candidate quality measurements or paired comparisons.",
        "No clinical publication, provider calls, database writes or model routing are performed by this reporter.",
        "derivedModelOnlyEvaluation reverts audited null-to-date recoveries; it is derived attribution, not a captured raw model response. Actual verifier decisions belong only to delivered evaluation.",
      ],
    },
    null,
    2,
  ),
);
