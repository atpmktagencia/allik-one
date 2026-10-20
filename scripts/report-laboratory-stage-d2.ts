/** Offline coverage ledger. Does not create calls, forecasts or synthetic outcomes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { laboratoryRobustnessCases } from "../src/test/fixtures/laboratory-robustness";
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const source = "docs/benchmarks/laboratory-stage-d1-evaluation.json";
const bytes = await readFile(source);
const prior = JSON.parse(bytes.toString());
const currentCapture = await readFile("docs/benchmarks/laboratory-stage-d1-live-20261020.json");
assert.equal(prior.currentCaptureSha256, sha(currentCapture));
const historic = [...prior.currentRound.cases, ...prior.carriedForwardV3];
const priority = [
  "similar-names-distinct-units",
  "scan-degraded",
  "historical-dates-current-result",
  "reference-formats-qualitative",
  "dates-unambiguous-ddmm",
  "dates-iso",
];
const coverage = [];
for (const specimen of laboratoryRobustnessCases) {
  const previous = historic.filter((c) => c.caseId === specimen.id);
  const pdf = await readFile(`src/test/fixtures/laboratory-robustness-pdfs/${specimen.id}.pdf`);
  const manifest = JSON.parse(
    await readFile("src/test/fixtures/laboratory-robustness-pdfs/sha256.json", "utf8"),
  );
  assert.equal(sha(pdf), manifest[specimen.id]);
  const c = previous[0];
  coverage.push({
    caseId: specimen.id,
    format: specimen.format,
    tags: specimen.tags,
    pdfSha256: sha(pdf),
    expectedLegibleResults: specimen.reference.length,
    realV3Documents: c ? 1 : 0,
    realV3Trials: previous.length,
    newD2Trials: 0,
    newD2Outcome: null,
    status: c ? "historical_real_v3_single_trial_only" : "pending_daily_quota",
    historicalSource: c ? (specimen.id === "many-pages-repeated-parameters" ? "D" : "D.1") : null,
    historicalResult: c
      ? {
          readableRecovered: c.evaluation.correctResults,
          positiveCorrect: c.evaluation.positiveCorrect,
          positiveExpected: c.evaluation.positiveExpected,
          omittedRows: c.evaluation.omittedRows,
          associationErrors: c.evaluation.associationErrors,
          errors: c.evaluation.errors,
          verifier: c.evaluation.verifier,
          httpMilliseconds: c.wallMilliseconds,
          estimatedTokenCostUsd: c.estimatedTokenCostUsd,
        }
      : null,
  });
}
console.log(
  JSON.stringify(
    {
      stage: "D.2",
      candidate: "2b16b12c7f6417ae3e9df6042a4e01f793379b07",
      sourceEvaluationSha256: sha(bytes),
      sourceCaptureSha256: sha(currentCapture),
      providerCallsPerformedByReporter: 0,
      currentRound: {
        realInferences: 0,
        providerRequests: 0,
        inferredDocuments: 0,
        observedNewResultAccuracy: null,
        modelLatencyMilliseconds: null,
        newModelTokenCostUsd: 0,
        humanPerformance: null,
        reason: "daily_quota_20_of_20_no_attempts_made",
      },
      historicV3: {
        documents: coverage.filter((c) => c.realV3Documents).length,
        trials: historic.length,
        readableResultsRecovered: historic.reduce((n, c) => n + c.evaluation.correctResults, 0),
        positiveFieldsCorrect: historic.reduce((n, c) => n + c.evaluation.positiveCorrect, 0),
        estimatedHistoricTokenCostUsd: historic.reduce((n, c) => n + c.estimatedTokenCostUsd, 0),
        independentDocumentReplications: 0,
      },
      coverage,
      pendingPriorities: priority,
      repetitionPlan: {
        scheduled: false,
        increaseQuota: false,
        initialMissingPdfs: 6,
        subsequentReplicatesPerPdf: 2,
        totalPlannedImports: 18,
        minimumHourlyWindows: 3,
        grouping: "per_pdf_hash_trial_index_and_hour_not_independent_documents",
        precondition: "fresh_deployment_scope_quota_budget_preflight_before_each_window",
      },
      completeHomologation: false,
      limitations: [
        "D.2 did not execute a new inference; pending is not a zero-error result.",
        "All real measurements are explicitly historical D/D.1, not D.2 observations.",
        "Model revision behind the alias is not fixed; future repeats need fresh provenance.",
        "Controlled study mutations and browser smoke tests are never provider inference.",
        "Human authorization/availability does not establish measured human outcomes.",
      ],
    },
    null,
    2,
  ),
);
