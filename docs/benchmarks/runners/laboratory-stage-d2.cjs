const fs = require("node:fs"),
  crypto = require("node:crypto");
const { request } = require("playwright");
const origin = "https://allik-bmdfgi7vj-atp-mkt.vercel.app";
const patientId = "90319847-c7a6-4adc-a08a-47cf5e2aef21",
  unitId = "a1100000-0000-4000-8000-000000000101";
const mode = process.argv[2];
const phase = "after";
if (!["preflight", "live"].includes(mode) || process.env.RUN_LIVE !== "SYNTHETIC_ONLY")
  throw Error("SYNTHETIC_GUARD");
if (mode === "live" && fs.existsSync("live.json")) throw Error("NO_IMPLICIT_RETRY");
const cases = [
  "similar-names-distinct-units",
  "scan-degraded",
  "historical-dates-current-result",
  "reference-formats-qualitative",
  "dates-unambiguous-ddmm",
  "dates-iso",
];
const duplicateIds = {};
const output = {
  phase,
  startedAt: new Date().toISOString(),
  provenance: {
    immutableUrl: origin,
    codeCommit: "3f007de429cecf87f5255adb35e4608233b2dcdb",
    deploymentId: "dpl_9wpUPeCGKMn1iqgXUmt8yLmji6Ay",
    dataClassification: "synthetic",
    pipeline: "lab-pipeline-3",
    maximumImports: 6,
    maxConcurrentImports: 1,
    automaticRetries: 0,
    hourlyDailyQuotasRestored: false,
    budgetScope: "six preselected single-page synthetic PDFs; no additional calls or retries",
  },
  records: [],
};
const save = () => fs.writeFileSync(mode + ".json", JSON.stringify(output, null, 2));
(async () => {
  const ctx = await request.newContext({ extraHTTPHeaders: { Origin: origin }, timeout: 200000 });
  await ctx.get(process.env.PREVIEW_SHARE);
  const s = await ctx.get(origin + "/api/inventory-session");
  if (s.status() !== 200) throw Error("SESSION_" + s.status());
  const actor = (await s.json()).data;
  if (
    actor.role !== "SUPER_ADMIN" ||
    actor.user.email !== "preview-operator@allik.invalid" ||
    !actor.sharedPreviewOperator
  )
    throw Error("WRONG_ACTOR");
  const prior = await ctx.get(
    origin +
      "/api/v1/inventory/laboratory-results?unitId=" +
      unitId +
      "&patientId=" +
      patientId +
      "&documentId=229403eb-22bc-465b-809a-ca8ab5e19f17",
  );
  if (!prior.ok()) throw Error("SCOPED_IMPORT_UNAVAILABLE");
  const priorData = (await prior.json()).data;
  if (
    priorData.import.id !== "000e9544-a584-4a7e-8f68-ef52d6ec92d9" ||
    priorData.evidenceChecks.version !== 3 ||
    !priorData.extractionAvailable
  )
    throw Error("WRONG_DATABASE_OR_VERIFIER");
  output.preflight = {
    at: new Date().toISOString(),
    immutableUrl: origin,
    sessionStatus: s.status(),
    actorEmail: actor.user.email,
    sharedPreviewOperator: true,
    scopedImportId: priorData.import.id,
    verifierVersion: priorData.evidenceChecks.version,
    evidenceOrigin: "previous_v3_import_read_only_plus_verified_deployment_sha",
  };
  save();
  if (mode === "preflight") {
    console.log(JSON.stringify(output.preflight));
    await ctx.dispose();
    return;
  }
  for (const id of cases) {
    const bytes = fs.readFileSync("pdfs/" + id + ".pdf"),
      sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== JSON.parse(fs.readFileSync("pdfs/sha256.json"))[id])
      throw Error("HASH_MISMATCH");
    const rec = {
      phase,
      caseId: id,
      sha256,
      documentId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    };
    output.records.push(rec);
    save();
    const duplicate = duplicateIds[id];
    const form = {
      id: rec.documentId,
      patientId,
      title: "BENCHMARK SINTÉTICO D.2 — " + id,
      categories: '["LAB_RESULT"]',
      intent: "EXAM",
      file: { name: id + ".pdf", mimeType: "application/pdf", buffer: bytes },
      ...(duplicate
        ? {
            duplicateOf: duplicate,
            duplicateReason:
              "Repetição sintética intencional na Etapa D.2 com o mesmo PDF e referência independente.",
          }
        : {}),
    };
    const up = await ctx.post(origin + "/api/v1/inventory/patient-documents?unitId=" + unitId, {
      multipart: form,
    });
    rec.uploadStatus = up.status();
    if (!up.ok()) {
      rec.uploadError = await up.json();
      save();
      break;
    }
    const url = origin + "/api/v1/inventory/laboratory-results?unitId=" + unitId;
    const opened = await ctx.post(url, {
      data: { patientId, documentId: rec.documentId, action: "OPEN" },
    });
    const openedData = await opened.json();
    rec.openStatus = opened.status();
    save();
    if (!opened.ok() || !openedData.data.extractionAvailable) break;
    const t = Date.now();
    try {
      const ex = await ctx.post(url, {
        data: {
          patientId,
          documentId: rec.documentId,
          action: "EXTRACT",
          version: openedData.data.import.version,
          operationId: rec.operationId,
        },
      });
      rec.httpStatus = ex.status();
      const body = await ex.json();
      if (body.data) {
        rec.import = body.data.import;
        rec.evidenceChecks = body.data.evidenceChecks;
      } else rec.error = body;
    } catch (e) {
      rec.transportError = e.name;
    }
    rec.wallMilliseconds = Date.now() - t;
    rec.finishedAt = new Date().toISOString();
    save();
    if (!rec.import) {
      const check = await ctx.get(
        url + "&patientId=" + patientId + "&documentId=" + rec.documentId,
      );
      if (check.ok()) {
        const d = (await check.json()).data;
        rec.import = d.import;
        rec.evidenceChecks = d.evidenceChecks;
        rec.reconciled = true;
        save();
      }
    }
    if (rec.import?.draft?.patientConfirmed || rec.import?.draft?.rows?.some((r) => r.verified))
      throw Error("UNEXPECTED_CONFIRMATION");
    if (rec.import?.status === "READY_REVIEW" && rec.evidenceChecks?.version !== 3)
      throw Error("PIPELINE_VERSION_MISMATCH");
    console.log(
      JSON.stringify({
        phase,
        id,
        status: rec.import?.status,
        rows: rec.import?.draft?.rows?.length,
        version: rec.evidenceChecks?.version,
        ms: rec.wallMilliseconds,
      }),
    );
    if (rec.httpStatus !== 200 || rec.transportError || rec.import?.status !== "READY_REVIEW")
      break;
  }
  await ctx.dispose();
})().catch((e) => {
  save();
  console.log(
    JSON.stringify({
      fatal: e.name,
      code: /^[A-Z_0-9]+$/.test(e.message) ? e.message : "REDACTED",
    }),
  );
  process.exitCode = 1;
});
