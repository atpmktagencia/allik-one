/** Offline D.1 aggregation. Reuses the Stage D evaluator without changing it.
 * npx tsx scripts/report-laboratory-stage-d1.ts captures-d1.json
 * Never calls a provider, application or database. Historical costs remain separate.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { laboratoryRobustnessCases } from "../src/test/fixtures/laboratory-robustness";

const inputPath = process.argv[2];
assert(inputPath, "Supply saved D.1 real captures; no inference is generated here.");
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const bytes = await readFile(inputPath);
const current = JSON.parse(bytes.toString());
const historicalPath = "docs/benchmarks/laboratory-stage-d-live-20261020.json";
const oldBytes = await readFile(historicalPath);
const historical = JSON.parse(oldBytes.toString());
assert(Array.isArray(current.records) && current.records.length > 0);
assert(current.records.length <= 5, "D.1 may not exceed the five remaining daily imports.");
for (const r of current.records) {
  assert.equal(r.phase, "after");
  // Failures and unknown outcomes must remain in denominators. Missing telemetry
  // is unknown, never an invented success or a reason to silently drop a case.
  for (const [key, expected] of Object.entries({
    provider: "openai",
    model: "openai/gpt-6-luna",
    pipelineVersion: "lab-pipeline-3",
    promptVersion: "lab-transcription-3",
    verifierVersion: 3,
  })) {
    if (r.telemetry?.[key] !== undefined) assert.equal(r.telemetry[key], expected);
  }
  if (r.evidenceChecks) assert.equal(r.evidenceChecks.version, 3);
  if (r.import?.status === "READY_REVIEW") {
    assert.equal(r.telemetry?.pipelineVersion, "lab-pipeline-3");
    assert.equal(r.telemetry?.verifierVersion, 3);
    assert.equal(r.evidenceChecks?.version, 3);
  }
}
const existingIds = new Set(historical.records.map((r: { documentId: string }) => r.documentId));
assert(current.records.every((r: { documentId: string }) => !existingIds.has(r.documentId)));
const afterIds = new Set(current.records.map((r: { caseId: string }) => r.caseId));
const carried = historical.records.filter(
  (r: { phase: string; caseId: string }) => r.phase === "after" && !afterIds.has(r.caseId),
);
const directory = await mkdtemp(join(tmpdir(), "allik-d1-offline-"));
try {
  const mergedPath = join(directory, "paired.json");
  await writeFile(
    mergedPath,
    JSON.stringify({
      provenance: { purpose: "offline_pairing_only_historical_calls_not_repeated" },
      records: [
        ...historical.records.filter((r: { phase: string }) => r.phase === "before"),
        ...carried,
        ...current.records,
      ],
    }),
  );
  const evaluate = (path: string) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "scripts/report-laboratory-stage-d.ts", resolve(path)],
        { maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
      ),
    );
  const round = evaluate(inputPath);
  const merged = evaluate(mergedPath);
  console.log(
    JSON.stringify(
      {
        benchmark: "stage-d1-real-openai",
        providerCallsPerformedByReporter: 0,
        currentCaptureSha256: sha(bytes),
        historicalCaptureSha256: sha(oldBytes),
        currentRound: round,
        carriedForwardV3: merged.cases.filter(
          (c: { phase: string; caseId: string }) => c.phase === "after" && !afterIds.has(c.caseId),
        ),
        pairedComparisons: merged.pairedComparisons,
        coverage: laboratoryRobustnessCases.map((c) => ({
          caseId: c.id,
          tags: c.tags,
          status: afterIds.has(c.id)
            ? current.records.find((r: { caseId: string }) => r.caseId === c.id)?.import?.status ===
              "READY_REVIEW"
              ? "new_real_v3_inference_d1"
              : "attempted_without_successful_v3_output"
            : carried.some((r: { caseId: string }) => r.caseId === c.id)
              ? "historical_real_v3_inference_stage_d_same_candidate"
              : "no_real_v3_inference",
        })),
        limitations: [
          "Only currentRound.allAttemptUsage belongs to new D.1 expenditure.",
          "Historical before/after outputs are reused, not paid again; do not sum them into D.1 usage.",
          "One configured model alias, no fixed resolved revision and no replicated trials.",
          "Distinct results within one document are not independent document replications.",
          "No human usability outcomes are measured by this evaluator.",
          "No clinical publication or changes to the pipeline are performed here.",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
