/** Offline D.2 consolidation. Never calls a provider, application or database.
 * npx tsx scripts/report-laboratory-stage-d2.ts [saved-capture.json]
 * Historical D/D.1 expenditure remains separate from the six new inferences.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { laboratoryRobustnessCases } from "../src/test/fixtures/laboratory-robustness";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const input = process.argv[2] ?? "docs/benchmarks/laboratory-stage-d2-live-20261020.json";
const currentBytes = await readFile(input);
const current = JSON.parse(currentBytes.toString());
const priorities = [
  "similar-names-distinct-units",
  "scan-degraded",
  "historical-dates-current-result",
  "reference-formats-qualitative",
  "dates-unambiguous-ddmm",
  "dates-iso",
];
assert.equal(current.records.length, 6, "D.2 covers exactly the six authorized PDFs.");
assert.deepEqual(
  new Set(current.records.map((r: { caseId: string }) => r.caseId)),
  new Set(priorities),
);
assert.equal(new Set(current.records.map((r: { documentId: string }) => r.documentId)).size, 6);
assert.equal(new Set(current.records.map((r: { operationId: string }) => r.operationId)).size, 6);
for (const r of current.records) {
  assert.equal(r.phase, "after");
  for (const [key, value] of Object.entries({
    provider: "openai",
    model: "openai/gpt-6-luna",
    pipelineVersion: "lab-pipeline-3",
    promptVersion: "lab-transcription-3",
    verifierVersion: 3,
  }))
    if (r.telemetry?.[key] !== undefined) assert.equal(r.telemetry[key], value);
  if (r.import?.status === "READY_REVIEW") {
    assert.equal(r.evidenceChecks?.version, 3);
    assert.equal(r.telemetry?.pipelineVersion, "lab-pipeline-3");
  }
}
const priorBytes = await readFile("docs/benchmarks/laboratory-stage-d1-evaluation.json");
const prior = JSON.parse(priorBytes.toString());
const priorCaptureBytes = await readFile("docs/benchmarks/laboratory-stage-d1-live-20261020.json");
assert.equal(prior.currentCaptureSha256, sha(priorCaptureBytes));
const historical = [...prior.currentRound.cases, ...prior.carriedForwardV3];
assert(
  !historical.some((c) => priorities.includes(c.caseId)),
  "Do not silently replace a prior trial.",
);
const round = JSON.parse(
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/report-laboratory-stage-d.ts", resolve(input)],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  ),
);
const all = [...historical, ...round.cases];
const knownCost = (items: typeof all) =>
  items.every(
    (c) => typeof c.estimatedTokenCostUsd === "number" && Number.isFinite(c.estimatedTokenCostUsd),
  )
    ? items.reduce((n, c) => n + c.estimatedTokenCostUsd, 0)
    : null;
const coverage = [];
const manifest = JSON.parse(
  await readFile("src/test/fixtures/laboratory-robustness-pdfs/sha256.json", "utf8"),
);
for (const specimen of laboratoryRobustnessCases) {
  const trials = all.filter((c) => c.caseId === specimen.id);
  assert.equal(trials.length, 1, "One trial per PDF; never count rows as documents.");
  const bytes = await readFile(`src/test/fixtures/laboratory-robustness-pdfs/${specimen.id}.pdf`);
  assert.equal(sha(bytes), manifest[specimen.id]);
  const c = trials[0];
  coverage.push({
    caseId: specimen.id,
    format: specimen.format,
    tags: specimen.tags,
    pdfSha256: sha(bytes),
    expectedLegibleResults: specimen.reference.length,
    sourceStage: priorities.includes(specimen.id)
      ? "D.2"
      : specimen.id === "many-pages-repeated-parameters"
        ? "D"
        : "D.1",
    realV3Trials: 1,
    results: c.evaluation,
    inventory: c.inventory ?? null,
    wallMilliseconds: c.wallMilliseconds,
    estimatedTokenCostUsd: c.estimatedTokenCostUsd,
  });
}
const knownOutcomes = current.records.every((r: { import?: { status: string } }) =>
  ["READY_REVIEW", "FAILED"].includes(r.import?.status ?? ""),
);
console.log(
  JSON.stringify(
    {
      stage: "D.2",
      status: knownOutcomes
        ? "technical_round_closed_with_documented_residuals"
        : "outcome_reconciliation_required",
      technicalRoundCompleted: knownOutcomes,
      clinicalHomologationCompleted: false,
      providerCallsPerformedByReporter: 0,
      candidate: current.provenance,
      sourceCaptureSha256: sha(currentBytes),
      sourcePriorEvaluationSha256: sha(priorBytes),
      currentRound: round,
      historicV3: {
        documents: historical.length,
        trials: historical.length,
        readableResultsRecovered: historical.reduce((n, c) => n + c.evaluation.correctResults, 0),
        positiveFieldsCorrect: historical.reduce((n, c) => n + c.evaluation.positiveCorrect, 0),
        estimatedHistoricTokenCostUsd: knownCost(historical),
      },
      cumulativeV3: {
        documents: all.length,
        trials: all.length,
        expectedLegibleResults: all.reduce((n, c) => n + c.evaluation.expectedLegibleRows, 0),
        readableResultsRecovered: all.reduce((n, c) => n + c.evaluation.correctResults, 0),
        expectedPositiveFields: all.reduce((n, c) => n + c.evaluation.positiveExpected, 0),
        positiveFieldsCorrect: all.reduce((n, c) => n + c.evaluation.positiveCorrect, 0),
        estimatedHistoricPlusCurrentTokenCostUsd: knownCost(all),
        independentReplicationsPerPdf: 0,
      },
      coverage,
      pendingInferenceCases: [],
      humanStudy: {
        status: "not_conducted_by_user_decision",
        participantsMeasured: 0,
        performanceMetrics: null,
        timeSavingsEstimate: null,
      },
      limitations: [
        "Technical completion is not clinical validation or approval for automatic publication.",
        "One synthetic trial per PDF; no population accuracy, model stability or human productivity claim.",
        "Unmatched-row inventedPositive means outside the current-result reference; adjudicate source existence before calling it a hallucination.",
        "Historical costs are reused and were not incurred again; only currentRound.allAttemptUsage is D.2 expenditure.",
        "No equivalent v2 runs for the six new PDFs; no before/after extractor gain can be inferred.",
        "Inventory remains offline and cannot prove completeness; scans lack independent text.",
        "Alias model revision is not pinned; token costs are estimates, not an observed invoice.",
      ],
    },
    null,
    2,
  ),
);
