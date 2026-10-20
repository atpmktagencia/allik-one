import { afterAll, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { laboratoryBenchmarkCases } from "../test/fixtures/laboratory-benchmark";
import { evaluateLaboratoryExtraction } from "../lib/laboratory-benchmark";
import { laboratoryRow } from "../lib/laboratory-results";
import { checkLaboratoryEvidence } from "../lib/laboratory-evidence";
import {
  LABORATORY_PIPELINE_VERSION,
  LABORATORY_PROMPT_VERSION,
  LABORATORY_VERIFIER_VERSION,
} from "../lib/laboratory-pipeline-version";
import { extractLaboratoryPdfText } from "./laboratory-pdf-text";
import { experimentLaboratoryInventory } from "../lib/laboratory-completeness-experiment";

const directory = new URL("../test/fixtures/laboratory-pdfs/", import.meta.url);
const hashes = JSON.parse(await readFile(new URL("sha256.json", directory), "utf8"));
const supplied = process.env["LAB_BENCHMARK_CANDIDATES"]
  ? JSON.parse(await readFile(process.env["LAB_BENCHMARK_CANDIDATES"], "utf8"))
  : null;
const report: Record<string, unknown>[] = [];
it.each(laboratoryBenchmarkCases)("evaluates a verified synthetic original: $id", async (item) => {
  const bytes = new Uint8Array(await readFile(new URL(`${item.id}.pdf`, directory)));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(hashes[item.id]);
  const started = performance.now();
  const source = await extractLaboratoryPdfText(bytes);
  expect(source.status).toBe(item.format === "scanned" ? "unavailable" : "available");
  if (source.status === "available") expect(source.totalPages).toBe(item.pages.length);
  const predictions = supplied ? laboratoryRow.array().parse(supplied[item.id]) : item.predictions;
  const extraction = evaluateLaboratoryExtraction(item.reference, predictions);
  const checks = predictions.map((r) =>
    checkLaboratoryEvidence(r, source.status === "available" ? source.pages : undefined),
  );
  const trusted = checks.map((c) => c.basis === "source_text" && c.status === "literal_match");
  // The v2 fixture treated Portuguese labels as an implicit DD/MM convention.
  // V3 explicitly requires an unambiguous date or a printed format declaration.
  // Preserve the original fixture/report while labeling this new safety policy.
  const expectedTrust = item.id === "dates-and-metadata" ? [false] : item.trust;
  if (!supplied) expect(trusted).toEqual(expectedTrust);
  const inventory = experimentLaboratoryInventory(
    source.status === "available" ? source.pages : [],
    predictions,
  );
  report.push({
    id: item.id,
    format: item.format,
    sourceSha256: hashes[item.id],
    extraction,
    experimentalInventory: {
      scope: inventory.scope,
      completenessProven: inventory.completenessProven,
      recognizableRows: inventory.recognizableRows,
      possibleOmissions: inventory.possibleOmissions.length,
    },
    verifier: supplied
      ? { trusted: trusted.filter(Boolean).length, falseAlerts: null, unsafeTrusted: null }
      : {
          trusted: trusted.filter(Boolean).length,
          falseAlerts: trusted.filter((v, i) => !v && expectedTrust[i]).length,
          unsafeTrusted: trusted.filter((v, i) => v && !expectedTrust[i]).length,
        },
    trustReferencePolicy: "v3-explicit-date-format; original-v2-fixtures-unchanged",
    localProcessingMilliseconds: performance.now() - started,
    inferenceMilliseconds: null,
    costUsd: null,
    tokens: null,
  });
});
it("measures deliberate omissions, hallucinations and duplicate predictions separately", () => {
  const omitted = laboratoryBenchmarkCases.find((c) => c.id === "deliberate-omission")!;
  expect(evaluateLaboratoryExtraction(omitted.reference, omitted.predictions).omitted).toBe(1);
  const invented = laboratoryBenchmarkCases.find((c) => c.id === "invented-result")!;
  expect(evaluateLaboratoryExtraction(invented.reference, invented.predictions).invented).toBe(1);
  expect(
    evaluateLaboratoryExtraction(omitted.reference, [
      omitted.predictions[0]!,
      omitted.predictions[0]!,
    ]),
  ).toMatchObject({ invented: 1, omitted: 1 });
});
afterAll(async () => {
  if (!process.env["LAB_BENCHMARK_REPORT"]) return;
  const totals = report.reduce<{
    expected: number;
    predicted: number;
    correctRows: number;
    omitted: number;
    invented: number;
    associationCorrect: number;
    trusted: number;
    falseAlerts: number;
    unsafeTrusted: number;
  }>(
    (a, r) => {
      const extraction = r["extraction"] as ReturnType<typeof evaluateLaboratoryExtraction>;
      const verifier = r["verifier"] as {
        trusted: number;
        falseAlerts: number | null;
        unsafeTrusted: number | null;
      };
      for (const k of [
        "expected",
        "predicted",
        "correctRows",
        "omitted",
        "invented",
        "associationCorrect",
      ] as const)
        a[k] += extraction[k];
      a.trusted += verifier.trusted;
      a.falseAlerts += verifier.falseAlerts ?? 0;
      a.unsafeTrusted += verifier.unsafeTrusted ?? 0;
      return a;
    },
    {
      expected: 0,
      predicted: 0,
      correctRows: 0,
      omitted: 0,
      invented: 0,
      associationCorrect: 0,
      trusted: 0,
      falseAlerts: 0,
      unsafeTrusted: 0,
    },
  );
  await writeFile(
    process.env["LAB_BENCHMARK_REPORT"],
    JSON.stringify(
      {
        pipelineVersion: LABORATORY_PIPELINE_VERSION,
        promptVersion: LABORATORY_PROMPT_VERSION,
        verifierVersion: LABORATORY_VERIFIER_VERSION,
        sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        sourceWorkingTreeDirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        referenceSha256: createHash("sha256")
          .update(JSON.stringify(laboratoryBenchmarkCases))
          .digest("hex"),
        implementationSha256: createHash("sha256")
          .update(
            JSON.stringify(
              await Promise.all(
                [
                  "../lib/laboratory-evidence.ts",
                  "../lib/laboratory-source-association.ts",
                  "../lib/laboratory-results.ts",
                  "./laboratory-pdf-text.ts",
                  "./laboratory-extraction.ts",
                ].map(async (p) => ({
                  path: p,
                  source: await readFile(new URL(p, import.meta.url), "utf8").catch(() => null),
                })),
              ),
            ),
          )
          .digest("hex"),
        outputOrigin: supplied
          ? "supplied-candidates-not-live-inference"
          : "synthetic-controlled-not-live-inference",
        documents: report.length,
        totals: {
          ...totals,
          falseAlerts: supplied ? null : totals.falseAlerts,
          unsafeTrusted: supplied ? null : totals.unsafeTrusted,
        },
        cases: report,
      },
      null,
      2,
    ) + "\n",
  );
});
