/* Paid Preview benchmark runner. Synthetic corpus only; never repeat ambiguous attempts.
 * Phase 1 uploads two files using the real UI. First uses waitUntil; second requests waiting.
 * Phase 2 requires telemetry for both phase-1 docs, then sends ten sequential receipts.
 * ACCESS_URL is temporary access, never written to results or printed.
 */
const fs = require("node:fs");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const phase = process.argv[2];
const folder = "corpus";
const file = "results.json";
const patientId = "90319847-c7a6-4adc-a08a-47cf5e2aef21",
  unitId = "a1100000-0000-4000-8000-000000000101";
const manifest = JSON.parse(fs.readFileSync(`${folder}/manifest.json`));
assert.equal(manifest.classification, "SYNTHETIC_ONLY_NO_REAL_PATIENT_DATA");
assert.equal(manifest.documents.length, 12);
for (const d of manifest.documents)
  assert.equal(
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(`${folder}/${d.filename}`))
      .digest("hex"),
    d.sha256,
  );
const base = process.env.F2_PREVIEW_URL;
assert(base && base.startsWith("https://allik-") && base.endsWith(".vercel.app"));
assert(!base.includes("cz2dk6vej"));
assert(process.env.F2_EXPECTED_SHA);
let result = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file))
  : {
      deploymentSha: process.env.F2_EXPECTED_SHA,
      url: base,
      startedAt: new Date().toISOString(),
      attempts: [],
      records: [],
      checks: [],
      blockedLabWrites: 0,
    };
assert.equal(result.url, base);
assert.equal(result.deploymentSha, process.env.F2_EXPECTED_SHA);
const save = () => fs.writeFileSync(file, JSON.stringify(result, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await context.route("**/api/v1/inventory/laboratory-results**", async (route) => {
    if (route.request().method() === "POST") {
      result.blockedLabWrites++;
      save();
      await route.abort();
    } else await route.continue();
  });
  await page.goto(process.env.F2_ACCESS_URL, { waitUntil: "domcontentloaded" });
  const session = await context.request.get(base + "/api/inventory-session");
  assert.equal(session.status(), 200);
  const auth = (await session.json()).data;
  assert.equal(auth.user.email, "preview-operator@allik.invalid");
  assert.equal(auth.organizationId, "a1100000-0000-4000-8000-000000000001");
  assert.equal(auth.sharedPreviewOperator, true);
  const endpoint = (id) =>
    `${base}/api/v1/inventory/document-classifications?${new URLSearchParams({ patientId, unitId, documentId: id })}`;
  const read = async (id) => {
    const r = await context.request.get(endpoint(id));
    assert.equal(r.status(), 200);
    const b = await r.json();
    assert.equal(b.data.configuration.enabled, true);
    assert.equal(b.data.configuration.ready, true);
    assert.equal(b.data.configuration.model, "openai/gpt-6-luna");
    return b.data.events;
  };
  const terminal = async (id) => {
    for (let n = 0; n < 100; n++) {
      const events = await read(id);
      const last = events.at(-1);
      if (last && ["SUGGESTED", "NEEDS_REVIEW", "FAILED"].includes(last.action)) return events;
      await sleep(1000);
    }
    throw Error("Ambiguous timeout: do not resubmit");
  };
  const totalCost = () =>
    result.records.reduce((n, r) => n + (r.telemetry?.estimatedCostUsd ?? 0), 0);
  const validateSpend = (r) => {
    assert(r.telemetry, "Missing telemetry; resolve logs before further paid calls");
    assert.equal(r.telemetry.requests, 1);
    assert(Number.isFinite(r.telemetry.estimatedCostUsd));
    assert(r.telemetry.estimatedCostUsd <= 0.04);
    assert(!r.telemetry.failureCode);
    assert(totalCost() <= 0.5);
  };
  await page.goto(`${base}/pacientes/${patientId}#secao=documents`, { waitUntil: "networkidle" });
  fs.mkdirSync("screenshots", { recursive: true });
  if (phase === "1") {
    assert.equal(result.attempts.length, 0, "Already attempted: no automatic repeat");
    result.attempts.push(
      ...manifest.documents.slice(0, 2).map((d) => ({
        id: d.id,
        filename: d.filename,
        attemptedAt: new Date().toISOString(),
        state: "UI_SELECTED",
      })),
    );
    save();
    const uploads = [];
    await context.route("**/api/v1/inventory/patient-documents**", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.continue();
      const body = request.postDataBuffer()?.toString("latin1") ?? "";
      const d = manifest.documents
        .slice(0, 2)
        .find((x) => body.includes(`filename="${x.filename}"`));
      assert(d, "Unexpected upload");
      const op = body.match(/name="id"\r\n\r\n([0-9a-f-]+)/i)?.[1];
      const attempt = result.attempts.find((x) => x.id === d.id);
      attempt.operationId = op;
      attempt.state = "SENT";
      save();
      if (d.id === "lab-qualitative")
        await route.continue({ headers: { ...request.headers(), prefer: "wait=classification" } });
      else await route.continue();
    });
    page.on("response", async (response) => {
      if (!response.url().includes("/patient-documents") || response.request().method() !== "POST")
        return;
      try {
        const body = await response.json();
        uploads.push({ status: response.status(), body });
      } catch {
        uploads.push({ status: response.status(), invalidJson: true });
      }
    });
    await page
      .getByLabel("Selecionar documentos", { exact: true })
      .setInputFiles(manifest.documents.slice(0, 2).map((d) => `${folder}/${d.filename}`));
    for (let n = 0; n < 150 && uploads.length < 2; n++) await sleep(1000);
    assert.equal(uploads.length, 2, "Ambiguous upload; do not retry");
    for (let i = 0; i < 2; i++) {
      const d = manifest.documents[i],
        attempt = result.attempts.find((x) => x.id === d.id);
      const upload = uploads.find((x) => x.body?.data?.id === attempt.operationId);
      assert(upload);
      assert.equal(upload.status, 201);
      const events = await terminal(attempt.operationId);
      const last = events.at(-1);
      assert.notEqual(last.action, "FAILED");
      result.records.push({
        id: d.id,
        documentId: attempt.operationId,
        uploadStatus: upload.status,
        events,
        telemetry: upload.body.classificationTelemetry ?? null,
      });
      attempt.state = "COMPLETED";
      save();
    }
    await page.screenshot({
      path: "screenshots/01-recebimento-multiplo.jpg",
      type: "jpeg",
      quality: 70,
      fullPage: false,
    });
    result.checks.push(
      "Real multi-file UI receipt; first uses waitUntil; terminal classification observed",
    );
    save();
  } else if (phase === "2") {
    assert.equal(result.records.length, 2, "Phase 2 only after phase 1");
    for (const r of result.records) validateSpend(r);
    for (const d of manifest.documents.slice(2)) {
      assert(!result.attempts.some((x) => x.id === d.id));
      assert(totalCost() + 0.04 <= 0.5);
      const documentId = crypto.randomUUID();
      const attempt = {
        id: d.id,
        filename: d.filename,
        operationId: documentId,
        attemptedAt: new Date().toISOString(),
        state: "SENT",
      };
      result.attempts.push(attempt);
      save();
      const started = Date.now();
      const upload = await context.request.post(
        base + "/api/v1/inventory/patient-documents?unitId=" + unitId,
        {
          headers: { Origin: base, prefer: "wait=classification" },
          timeout: 180000,
          multipart: {
            id: documentId,
            patientId,
            title: d.filename,
            categories: JSON.stringify(["OTHER"]),
            intent: "RECEIPT",
            file: {
              name: d.filename,
              mimeType: "application/pdf",
              buffer: fs.readFileSync(`${folder}/${d.filename}`),
            },
          },
        },
      );
      assert.equal(upload.status(), 201, "Upload failed; stop, do not retry");
      const body = await upload.json();
      const events = await terminal(documentId);
      const r = {
        id: d.id,
        documentId,
        uploadStatus: upload.status(),
        httpMs: Date.now() - started,
        events,
        telemetry: body.classificationTelemetry ?? null,
      };
      result.records.push(r);
      attempt.state = "COMPLETED";
      save();
      validateSpend(r);
      assert.notEqual(events.at(-1).action, "FAILED");
    }
    assert.equal(result.attempts.length, 12);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByLabel("Buscar documentos", { exact: true }).fill("documento-f2");
    await sleep(1500);
    await page.screenshot({
      path: "screenshots/02-central-classificada.jpg",
      type: "jpeg",
      quality: 70,
    });
    const mixed = result.records.find((r) => r.id === "mixed");
    await page
      .getByRole("button", { name: /documento-f2-09.pdf/ })
      .first()
      .click();
    await page.getByRole("region", { name: "Classificação do documento" }).waitFor();
    await page.screenshot({
      path: "screenshots/03-documento-misto.jpg",
      type: "jpeg",
      quality: 70,
    });
    const correct = result.records.find((r) => r.id === "scan");
    await page
      .getByRole("button", { name: /documento-f2-10.pdf/ })
      .first()
      .click();
    await page.getByText(/Sem evidência textual independente/).waitFor();
    await page.screenshot({
      path: "screenshots/04-revisao-necessaria.jpg",
      type: "jpeg",
      quality: 70,
    });
    await page.getByText("Corrigir categoria", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Laudo de imagem", exact: true }).check();
    await page.getByRole("checkbox", { name: /Conferi o original/ }).check();
    await page.getByRole("button", { name: "Salvar categoria", exact: true }).click();
    await page.getByText("Categoria confirmada", { exact: true }).first().waitFor();
    result.manualCorrection = {
      documentId: correct.documentId,
      events: await read(correct.documentId),
    };
    save();
    await page.screenshot({
      path: "screenshots/05-correcao-auditada.jpg",
      type: "jpeg",
      quality: 70,
    });
    const confirm = result.records.find((r) => r.events.at(-1).action === "SUGGESTED");
    assert(confirm);
    const index = manifest.documents.findIndex((d) => d.id === confirm.id) + 1;
    await page
      .getByRole("button", {
        name: new RegExp(`documento-f2-${String(index).padStart(2, "0")}.pdf`),
      })
      .first()
      .click();
    await page.getByRole("checkbox", { name: /Conferi o original/ }).check();
    await page.getByRole("button", { name: "Aceitar sugestão", exact: true }).click();
    await page.getByText("Categoria confirmada", { exact: true }).first().waitFor();
    result.humanConfirmation = {
      documentId: confirm.documentId,
      events: await read(confirm.documentId),
    };
    save();
    const original = await context.request.get(
      `${base}/api/v1/inventory/patient-document-file?patientId=${patientId}&sourceKind=GENERAL_DOCUMENT&sourceId=${mixed.documentId}&unitId=${unitId}&download=true`,
    );
    assert.equal(original.status(), 200);
    assert.equal(
      crypto
        .createHash("sha256")
        .update(await original.body())
        .digest("hex"),
      manifest.documents.find((d) => d.id === "mixed").sha256,
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    result.checks.push(
      "12 documents, no retries",
      "Mixed original SHA-256 verified",
      "Human correction and confirmation through actual UI",
      "Reload only reads; no processing requests",
      "No automatic laboratory write",
    );
    result.completedAt = new Date().toISOString();
    assert.equal(result.blockedLabWrites, 0);
    save();
  } else throw Error("Expected phase 1 or 2");
  console.log(
    JSON.stringify({
      phase,
      records: result.records.length,
      attempts: result.attempts.length,
      estimatedCostUsd: totalCost(),
      completed: !!result.completedAt,
    }),
  );
})()
  .catch((error) => {
    result.failure = { phase, message: error.message };
    save();
    console.error("F2 benchmark stopped: " + error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
