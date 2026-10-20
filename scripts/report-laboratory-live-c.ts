/** Offline Stage C report. No provider, application API or database calls.
 * Usage: npx tsx scripts/report-laboratory-live-c.ts live.json [telemetry.json]
 * A combined input may instead attach the original telemetry to records[].telemetry.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";
import { laboratoryBenchmarkCases } from "../src/test/fixtures/laboratory-benchmark";
import type { LaboratoryRow } from "../src/lib/laboratory-results";
import type { LaboratoryEvidenceCheck } from "../src/lib/laboratory-evidence";
import { experimentLaboratoryInventory } from "../src/lib/laboratory-completeness-experiment";

type Telemetry = Record<string, unknown>;
type RecordInput = {
  caseId: string;
  sha256: string;
  documentId?: string;
  wallMilliseconds: number;
  httpStatus: number;
  telemetry?: Telemetry;
  import: {
    status: string;
    draft: { rows: LaboratoryRow[]; patientConfirmed: boolean };
    latest_review_id?: string | null;
    failure_code: string | null;
    model: string;
  };
  evidenceChecks: { rows: LaboratoryEvidenceCheck[] };
};
const fields = [
  "name",
  "result",
  "unit",
  "reference",
  "collectedOn",
  "reportedOn",
  "issuedOn",
  "laboratory",
  "method",
  "material",
  "sourcePage",
] as const;
type Field = (typeof fields)[number];
const normalize = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFC").replace(/µ/g, "μ").replace(/\s+/gu, " ").trim()
    : (value ?? null);
const unit = (value: string) =>
  normalize(value)!
    .toString()
    .replace(/\/([md]?)l\b/g, "/$1L");
const comparable = (row: LaboratoryRow, field: Field) => {
  const value = row[field];
  if (value == null) return null;
  if (field === "unit") return unit(String(value));
  if (field === "reference" && row.unit) {
    const reference = unit(String(value));
    const suffix = " " + unit(row.unit);
    return reference.endsWith(suffix) ? reference.slice(0, -suffix.length) : reference;
  }
  if (field === "result") return String(normalize(value)).replace(/([<>≤≥])\s+/gu, "$1");
  return normalize(value);
};
const [requestedPath, telemetryPath] = process.argv.slice(2);
const inputPath =
  requestedPath ??
  new URL("../docs/benchmarks/laboratory-openai-live-c-20261020.json", import.meta.url);
const input = JSON.parse(await readFile(inputPath, "utf8")) as { records: RecordInput[] };
assert(Array.isArray(input.records) && input.records.length > 0, "Missing real records.");
const externalTelemetry = telemetryPath
  ? (JSON.parse(await readFile(telemetryPath, "utf8")) as {
      document_id: string;
      telemetry: Telemetry;
    }[])
  : [];
const hashes = JSON.parse(
  await readFile(
    new URL("../src/test/fixtures/laboratory-pdfs/sha256.json", import.meta.url),
    "utf8",
  ),
) as Record<string, string>;
const seen = new Set<string>();
const counts = () => ({
  expectedPositive: 0,
  emittedPositive: 0,
  correctPositive: 0,
  omittedPositive: 0,
  wrongPositive: 0,
  inventedPositive: 0,
  correctAbsent: 0,
});
const aggregate = Object.fromEntries(fields.map((field) => [field, counts()])) as Record<
  Field,
  ReturnType<typeof counts>
>;
const cases = [];
for (const record of input.records) {
  assert(!seen.has(record.caseId), "Duplicate case: do not silently pool repeat trials.");
  seen.add(record.caseId);
  const fixture = laboratoryBenchmarkCases.find((item) => item.id === record.caseId);
  assert(fixture, "Input must be a versioned synthetic fixture.");
  const bytes = await readFile(
    new URL(`../src/test/fixtures/laboratory-pdfs/${fixture.id}.pdf`, import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    hashes[fixture.id],
    "Corpus hash changed.",
  );
  assert.equal(record.sha256, hashes[fixture.id], "Uploaded original differs from corpus.");
  assert.equal(record.httpStatus, 200, "Adjudicate failed attempts separately; do not omit them.");
  assert.equal(record.import.status, "READY_REVIEW");
  assert.equal(record.import.latest_review_id ?? null, null);
  assert.equal(record.import.draft.patientConfirmed, false);
  const rows = record.import.draft.rows;
  assert(
    rows.every((row) => row.verified === false),
    "Clinical verification must remain false.",
  );
  assert.equal(record.evidenceChecks.rows.length, rows.length);
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items)
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      pages.push({ page: pageNumber, text: text.trim() });
      page.cleanup();
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  const independentText = pages.some((page) => page.text.length > 0);
  const inventory = independentText
    ? experimentLaboratoryInventory(pages, rows)
    : {
        scope: "no_independent_text",
        completenessProven: false,
        recognizableRows: null,
        possibleOmissions: null,
      };
  const expected = fixture.reference.map(({ row }) => ({ ...row }));
  if (fixture.id === "dates-and-metadata") expected[0]!.issuedOn = "2026-01-05";
  const errors: {
    row: number | null;
    field: Field | "observation";
    kind: string;
    expected: unknown;
    actual: unknown;
  }[] = [];
  const eligibility = record.evidenceChecks.rows.map((check) => check.status === "literal_match");
  let matched = 0,
    completeRows = 0,
    omittedRows = 0,
    inventedRows = 0,
    unsafeLiteralMatches = 0,
    falseAlertCandidates = 0;
  let unreadable: { mentions: number; safelyMarked: boolean } | null = null;
  if (fixture.id === "partially-legible") {
    const safelyMarked =
      rows.length === 1 &&
      rows[0]!.name === "TSH" &&
      rows[0]!.result === "[ilegível]" &&
      !!rows[0]!.uncertainty;
    unreadable = { mentions: rows.length, safelyMarked };
    unsafeLiteralMatches = eligibility.filter(Boolean).length;
    if (!safelyMarked)
      errors.push({
        row: 0,
        field: "observation",
        kind: "unreadable_requires_manual_adjudication",
        expected: "no fabricated numeric value",
        actual: rows,
      });
  } else {
    const remaining = new Set(rows.map((_, index) => index));
    for (const reference of expected) {
      const index =
        [...remaining].find(
          (i) =>
            normalize(rows[i]!.name)?.toString().toLowerCase() ===
              normalize(reference.name)?.toString().toLowerCase() &&
            rows[i]!.sourcePage === reference.sourcePage,
        ) ??
        [...remaining].find(
          (i) =>
            normalize(rows[i]!.name)?.toString().toLowerCase() ===
            normalize(reference.name)?.toString().toLowerCase(),
        );
      const actual = index === undefined ? null : rows[index]!;
      if (index === undefined) omittedRows++;
      else {
        matched++;
        remaining.delete(index);
      }
      let complete = actual !== null;
      for (const field of fields) {
        const metric = aggregate[field];
        const a = actual ? comparable(actual, field) : null,
          b = comparable(reference, field);
        if (b !== null) metric.expectedPositive++;
        if (a !== null) metric.emittedPositive++;
        if (a === b) {
          if (b !== null) metric.correctPositive++;
          else if (actual) metric.correctAbsent++;
        } else {
          complete = false;
          const kind =
            a === null ? "omittedPositive" : b === null ? "inventedPositive" : "wrongPositive";
          metric[kind]++;
          errors.push({ row: index ?? null, field, kind, expected: b, actual: a });
        }
      }
      if (complete) completeRows++;
      if (index !== undefined && eligibility[index] && !complete) unsafeLiteralMatches++;
      if (
        index !== undefined &&
        complete &&
        !eligibility[index] &&
        independentText &&
        !actual!.uncertainty
      )
        falseAlertCandidates++;
    }
    for (const index of remaining) {
      inventedRows++;
      if (eligibility[index]) unsafeLiteralMatches++;
      for (const field of fields)
        if (comparable(rows[index]!, field) !== null) {
          aggregate[field].emittedPositive++;
          aggregate[field].inventedPositive++;
        }
      errors.push({
        row: index,
        field: "observation",
        kind: "unmatched_requires_manual_adjudication",
        expected: null,
        actual: rows[index],
      });
    }
  }
  const telemetry =
    record.telemetry ??
    externalTelemetry.find((event) => event.document_id === record.documentId)?.telemetry ??
    null;
  cases.push({
    caseId: fixture.id,
    format: fixture.format,
    pages: pages.length,
    inferencePathExpectedFromSource: pages.every(
      (page) => page.text.length >= 80 && page.text.length <= 12000,
    )
      ? "native_text"
      : "original_pdf",
    expectedLegibleObservations: unreadable ? 0 : expected.length,
    emittedRows: rows.length,
    matched,
    completeRows,
    omittedRows,
    inventedRows,
    errors,
    unreadable,
    verifier: {
      eligible: eligibility.filter(Boolean).length,
      attention: eligibility.filter((v) => !v).length,
      unsafeLiteralMatches,
      falseAlertCandidates,
      issues: record.evidenceChecks.rows.map((check) => check.issues),
    },
    inventory,
    wallMilliseconds: record.wallMilliseconds,
    telemetry,
  });
}
const sum = (
  key:
    | "expectedLegibleObservations"
    | "emittedRows"
    | "matched"
    | "completeRows"
    | "omittedRows"
    | "inventedRows",
) => cases.reduce((n, item) => n + item[key], 0);
console.log(
  JSON.stringify(
    {
      benchmark: "stage-c-real-openai",
      evaluation: "offline_adjudicated_reference_v1",
      providerCallsPerformedByReporter: 0,
      adjudications: [
        "Use live rows only; fixture.predictions and fixture.trust are never evaluated.",
        "Add issuedOn=2026-01-05 to dates-and-metadata reference; existing golden predates this field.",
        "Allow redundant reference unit only when identical to the same row unit; preserve comparator, value and scale.",
        "Exclude deliberately unreadable value from legible clinical recall; count safe abstention separately.",
        "Scanned result manually checked against scan.png; source-unavailable caution is legitimate, not a false alert.",
        "Date omissions are relative to corpus DD/MM convention; prompt does not explicitly declare locale, so abstention is conservative, not a proven unsafe date misreading.",
      ],
      summary: Object.fromEntries(
        [
          "expectedLegibleObservations",
          "emittedRows",
          "matched",
          "completeRows",
          "omittedRows",
          "inventedRows",
        ].map((key) => [key, sum(key as Parameters<typeof sum>[0])]),
      ),
      fields: aggregate,
      cases,
      limitations: [
        "Small synthetic single-trial sample; not clinical accuracy validation.",
        "Zero observed unsafe matches does not establish verifier sensitivity: no incorrect numeric/unit outputs occurred.",
        "Inventory shares conservative textual recognizers; zero divergence never proves completeness.",
        "No measured human review time or observed invoice cost; runtime telemetry cost may remain null.",
      ],
    },
    null,
    2,
  ),
);
