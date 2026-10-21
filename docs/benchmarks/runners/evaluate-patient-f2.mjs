import fs from "node:fs";
const [manifestPath, resultPath] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const result = JSON.parse(fs.readFileSync(resultPath));
const categories = [
  "LAB_RESULT",
  "EXAM_REQUEST",
  "IMAGE_REPORT",
  "MEDICAL_PRESCRIPTION",
  "MEDICAL_REPORT",
  "MEDICAL_CERTIFICATE",
  "OTHER",
];
const counts = Object.fromEntries(categories.map((c) => [c, { tp: 0, fp: 0, fn: 0 }]));
const rows = [];
for (const reference of manifest.documents) {
  const observed = result.records.find((r) => r.id === reference.id);
  if (!observed) {
    rows.push({ id: reference.id, missing: true });
    continue;
  }
  const last = observed.events.at(-1),
    prediction = last.payload?.result;
  const predicted = prediction?.categories.map((c) => c.category) ?? [];
  for (const c of categories) {
    const e = reference.expectedCategories.includes(c),
      p = predicted.includes(c);
    if (e && p) counts[c].tp++;
    else if (p) counts[c].fp++;
    else if (e) counts[c].fn++;
  }
  const expectedPairs = reference.expectedPageCategories.flatMap((p) =>
    p.categories.map((c) => `${p.page}:${c}`),
  );
  const predictedPairs = [
    ...new Set(
      (prediction?.categories ?? []).flatMap((c) =>
        c.evidence.map((e) => `${e.page}:${c.category}`),
      ),
    ),
  ];
  rows.push({
    id: reference.id,
    expected: reference.expectedCategories,
    predicted,
    action: last.action,
    abstention: prediction?.abstention ?? null,
    evidenceStatus: last.payload?.evidenceStatus ?? null,
    pagePairsCorrect: predictedPairs.filter((p) => expectedPairs.includes(p)).length,
    pagePairsIncorrect: predictedPairs.filter((p) => !expectedPairs.includes(p)).length,
    pagePairsMissing: expectedPairs.filter((p) => !predictedPairs.includes(p)).length,
    requiredReview: reference.requiresReview,
    reviewed: last.action === "NEEDS_REVIEW",
    telemetry: observed.telemetry,
  });
}
for (const x of Object.values(counts)) {
  x.precision = x.tp + x.fp ? x.tp / (x.tp + x.fp) : null;
  x.recall = x.tp + x.fn ? x.tp / (x.tp + x.fn) : null;
}
const total = Object.values(counts).reduce(
  (a, x) => ({ tp: a.tp + x.tp, fp: a.fp + x.fp, fn: a.fn + x.fn }),
  { tp: 0, fp: 0, fn: 0 },
);
const times = rows
  .flatMap((r) => (r.telemetry ? [r.telemetry.durationMs] : []))
  .sort((a, b) => a - b);
const metrics = {
  documents: result.records.length,
  expectedDocuments: manifest.documents.length,
  counts,
  micro: {
    ...total,
    precision: total.tp / (total.tp + total.fp),
    recall: total.tp / (total.tp + total.fn),
  },
  review: rows.filter((r) => r.reviewed).length,
  unsafeSuggestions: rows.filter((r) => r.requiredReview && r.action === "SUGGESTED").length,
  falseAlerts: rows.filter((r) => !r.requiredReview && r.reviewed).length,
  abstentions: rows.filter((r) => r.abstention && r.abstention !== "NONE").length,
  failed: rows.filter((r) => r.action === "FAILED").length,
  estimatedCostUsd: rows.reduce((n, r) => n + (r.telemetry?.estimatedCostUsd ?? 0), 0),
  inputTokens: rows.reduce((n, r) => n + (r.telemetry?.inputTokens ?? 0), 0),
  outputTokens: rows.reduce((n, r) => n + (r.telemetry?.outputTokens ?? 0), 0),
  latencyMs: {
    median: times.length
      ? (times[Math.floor((times.length - 1) / 2)] + times[Math.ceil((times.length - 1) / 2)]) / 2
      : null,
    min: times[0],
    max: times.at(-1),
  },
  rows,
};
console.log(JSON.stringify(metrics, null, 2));
