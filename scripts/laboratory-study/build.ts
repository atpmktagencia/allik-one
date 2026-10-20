/** Build an offline, single-file synthetic study. No app server, credentials or AI.
 * npx tsx scripts/laboratory-study/build.ts [output-directory]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { laboratoryDraft, type LaboratoryDraft } from "../../src/lib/laboratory-results";
import type { StudyCase, StudyData } from "./runtime";

const root = resolve(".");
const output = resolve(process.argv[2] ?? "work/laboratory-study");
assert(output.startsWith(root + "/work/"), "Generated study must stay in work/");
await mkdir(output, { recursive: true });
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
type Capture = {
  caseId: string;
  phase?: string;
  sha256: string;
  import: { draft: LaboratoryDraft };
  evidenceChecks: StudyCase["checks"];
};
const d1Path = "docs/benchmarks/laboratory-stage-d1-live-20261020.json";
const dPath = "docs/benchmarks/laboratory-stage-d-live-20261020.json";
const cPath = "docs/benchmarks/laboratory-openai-live-c-20261020.json";
const readCaptures = async (file: string) => {
  const bytes = await readFile(file);
  return {
    hash: sha(bytes),
    records: (JSON.parse(bytes.toString()) as { records: Capture[] }).records,
  };
};
const d1 = await readCaptures(d1Path),
  d = await readCaptures(dPath),
  c = await readCaptures(cPath);
const ids = [
  "dates-explicit-ddmm",
  "dates-ambiguous-no-format",
  "geometric-current-previous",
  "scan-rotated",
  "scan-partially-masked",
  "many-pages-repeated-parameters",
];
const data: StudyData = {
  battery: "real",
  build: {
    candidate: "2b16b12c7f6417ae3e9df6042a4e01f793379b07",
    componentSha256: sha(await readFile("src/components/clinic/laboratory-review.tsx")),
    referenceSha256: sha(await readFile("src/test/fixtures/laboratory-robustness.ts")),
  },
  tasks: {},
  training: null!,
};
const variants: Record<string, { real: StudyCase; controlled: StudyCase }> = {};
const moderator: {
  purpose: string;
  build: StudyData["build"];
  mutations: unknown[];
  variants: unknown[];
  initialDrafts: Record<string, { real: LaboratoryDraft; controlled: LaboratoryDraft }>;
  taskSources: Record<string, { caseId: string; pdfSha256: string; captureSha256: string }>;
  htmlSha256?: Record<string, string>;
} = {
  purpose: "MODERATOR_ONLY_CONTROLLED_MUTATIONS_NOT_REAL_AI_ERRORS",
  build: data.build,
  mutations: [],
  variants: [],
  initialDrafts: {},
  taskSources: {},
};
async function specimen(
  taskId: string,
  capture: Capture,
  captureHash: string,
  legacy = false,
): Promise<StudyCase> {
  const directory = `src/test/fixtures/${legacy ? "laboratory-pdfs" : "laboratory-robustness-pdfs"}`;
  const file = `${directory}/${capture.caseId}.pdf`;
  const bytes = await readFile(file);
  const hashes = JSON.parse(await readFile(directory + "/sha256.json", "utf8"));
  assert.equal(sha(bytes), capture.sha256);
  assert.equal(capture.sha256, hashes[capture.caseId]);
  assert.equal(capture.import.draft.patientConfirmed, false);
  assert(capture.import.draft.rows.every((row) => !row.verified));
  const pageCount = capture.evidenceChecks.totalPages;
  assert(pageCount && pageCount <= 8);
  const pages = [];
  for (let page = 1; page <= pageCount; page++) {
    const prefix = resolve(output, `${taskId}-page-${page}`);
    execFileSync("pdftoppm", [
      "-f",
      String(page),
      "-l",
      String(page),
      "-singlefile",
      "-r",
      "110",
      "-png",
      file,
      prefix,
    ]);
    pages.push("data:image/png;base64," + (await readFile(prefix + ".png")).toString("base64"));
  }
  const draft = laboratoryDraft.parse(capture.import.draft);
  return {
    taskId,
    caseId: capture.caseId,
    pdfSha256: capture.sha256,
    captureSha256: captureHash,
    pages,
    draft,
    checks: structuredClone(capture.evidenceChecks),
    variantSha256: sha(JSON.stringify(draft)),
  };
}
for (const [i, id] of ids.entries()) {
  const origin = id === ids[5] ? d : d1;
  const capture = origin.records.find((r) => r.caseId === id && r.phase === "after");
  assert(capture && capture.evidenceChecks.version === 3);
  const taskId = "D" + (i + 1);
  const real = await specimen(taskId, capture, origin.hash);
  const controlled = structuredClone(real);
  const row = controlled.draft.rows[0]!;
  const before = structuredClone(controlled.draft);
  let field: string,
    rowIndex = 0;
  if (i === 0) {
    field = "collectedOn";
    row.collectedOn = row.issuedOn!;
    const checks = controlled.checks.rows[0] as {
      status: string;
      issues: string[];
      fields: Record<string, { status: string }>;
    };
    checks.status = "attention";
    checks.issues = ["DATE_CONTRADICTION"];
    checks.fields["collectedOn"] = { status: "contradictory" };
  } else if (i === 1) {
    field = "collectedOn";
    row.collectedOn = "2026-03-02";
    row.uncertainty = null;
    controlled.checks.rows[0] = {
      status: "literal_match",
      basis: "source_text",
      issues: [],
      fields: {
        name: { status: "supported" },
        result: { status: "supported" },
        unit: { status: "supported" },
        collectedOn: { status: "supported" },
      },
    };
  } else if (i === 2) {
    field = "result";
    row.result = "109";
  } else if (i === 3) {
    field = "unit";
    row.unit = "ng/mL";
  } else if (i === 4) {
    field = "result";
    rowIndex = 1;
    controlled.draft.rows[1]!.result = "57";
    controlled.draft.rows[1]!.uncertainty = null;
  } else {
    field = "observation";
    rowIndex = 1;
    controlled.draft.rows.splice(1, 1);
    controlled.checks.rows.splice(1, 1);
  }
  controlled.variantSha256 = sha(JSON.stringify(controlled.draft));
  moderator.mutations.push({
    taskId,
    caseId: id,
    rowIndex,
    field,
    before: before.rows[rowIndex],
    after: controlled.draft.rows[rowIndex],
    outputOrigin: "controlled_usability_mutation",
    artificialEligibility: i === 1,
  });
  moderator.variants.push({
    taskId,
    real: real.variantSha256,
    controlled: controlled.variantSha256,
  });
  variants[taskId] = { real, controlled };
  moderator.initialDrafts[taskId] = { real: real.draft, controlled: controlled.draft };
  moderator.taskSources[taskId] = {
    caseId: real.caseId,
    pdfSha256: real.pdfSha256,
    captureSha256: real.captureSha256,
  };
}
const training = c.records.find((r) => r.caseId === "multi-column");
assert(training);
data.training = await specimen("TREINO", training, c.hash, true);

const built = await build({
  configFile: false,
  mode: "production",
  root,
  envDir: false,
  envPrefix: "STUDY_NO_ENV_INJECTION_",
  plugins: [
    react(),
    tailwind(),
    {
      name: "study-only-instrumented-pdf",
      enforce: "pre",
      resolveId(id, importer) {
        if (
          id === "./private-document-preview" &&
          importer?.endsWith("/src/components/clinic/laboratory-review.tsx")
        )
          return resolve("scripts/laboratory-study/viewer.tsx");
        return null;
      },
    },
  ],
  resolve: { alias: { "@": resolve("src") } },
  build: {
    write: false,
    minify: true,
    assetsInlineLimit: 10 * 1024 * 1024,
    rollupOptions: {
      input: resolve("scripts/laboratory-study/main.tsx"),
      output: { format: "iife", inlineDynamicImports: true },
    },
    cssCodeSplit: false,
  },
});
assert(!Array.isArray(built) && "output" in built);
const js = built.output
  .filter((o) => o.type === "chunk")
  .map((o) => o.code)
  .join("\n");
const css = built.output
  .flatMap((o) => (o.type === "asset" && o.fileName.endsWith(".css") ? [o.source] : []))
  .join("\n");
assert(
  !built.output.some((o) => o.type === "asset" && !o.fileName.endsWith(".css")),
  "Study must not depend on external assets",
);
moderator.htmlSha256 = {};
for (const [battery, suffix] of [
  ["real", "1"],
  ["controlled", "2"],
] as const) {
  const payload: StudyData = {
    ...data,
    battery,
    tasks: Object.fromEntries(Object.entries(variants).map(([id, item]) => [id, item[battery]])),
  };
  const script =
    `window.__STUDY_DATA__=${JSON.stringify(payload).replace(/</g, "\\u003c")};\n` + js;
  assert(!/<\/script/i.test(script));
  const csp = `default-src 'none'; script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Allik One — estudo sintético local</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
  const filename = `participante-lote-${suffix}.html`;
  moderator.htmlSha256[filename] = sha(html);
  await writeFile(resolve(output, filename), html);
  console.log(
    JSON.stringify({
      html: resolve(output, filename),
      htmlSha256: sha(html),
      bytes: Buffer.byteLength(html),
      tasks: 6,
      providerCalls: 0,
      clinicalCodeChanged: false,
    }),
  );
}
await writeFile(resolve(output, "moderador.json"), JSON.stringify(moderator, null, 2) + "\n");
