/* Read-only Preview visual verification. No upload, extraction or classification requests. */
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const phase = process.argv[2],
  base = process.env.F25_PREVIEW_URL;
assert(["before", "after"].includes(phase));
assert(base?.startsWith("https://allik-") && base.endsWith(".vercel.app"));
assert(!base.includes("cz2dk6vej"));
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage();
    page.setDefaultTimeout(20000);
    let blocked = 0;
    await context.route("**/api/v1/inventory/**", async (route) => {
      if (
        route.request().method() === "POST" &&
        /patient-documents|laboratory-results|document-classifications/.test(route.request().url())
      ) {
        blocked++;
        await route.abort();
      } else await route.continue();
    });
    await page.goto(process.env.F25_ACCESS_URL, { waitUntil: "domcontentloaded" });
    const session = await context.request.get(base + "/api/inventory-session");
    assert.equal(session.status(), 200);
    assert.equal((await session.json()).data.sharedPreviewOperator, true);
    await page.goto(base + "/pacientes/90319847-c7a6-4adc-a08a-47cf5e2aef21#secao=exams", {
      waitUntil: "networkidle",
    });
    const history = page.getByRole("region", { name: "Histórico longitudinal de exames" });
    if (!(await history.isVisible()))
      await page.getByRole("button", { name: "Histórico de resultados", exact: true }).click();
    const table = history.getByRole("table", { name: "Tabela longitudinal de exames" });
    await table.waitFor();
    await history.getByLabel("Buscar parâmetro laboratorial").fill("");
    await history.scrollIntoViewIfNeeded();
    fs.mkdirSync("screenshots", { recursive: true });
    // Region capture keeps the patient header outside the artifact and preserves actual layout.
    await page.screenshot({
      path: "screenshots/" + phase + "-preview.jpg",
      type: "jpeg",
      quality: 45,
    });
    const geometry = await table.locator('tr[data-main-row="true"]').evaluateAll((rows) =>
      rows.map((e) => ({
        biomarker: e.dataset.biomarker,
        height: e.getBoundingClientRect().height,
        text: e.innerText,
      })),
    );
    const snapshot = {
      phase,
      source: base,
      commit: process.env.F25_EXPECTED_SHA,
      geometry,
      blockedPaidOrClinicalWrites: blocked,
    };
    if (phase === "after") {
      assert(geometry.length > 0);
      assert(
        geometry.every((r) => r.height <= 48),
        "Rows must stay within 48px",
      );
      assert.equal(new Set(geometry.map((r) => r.biomarker)).size, geometry.length);
      assert.equal(await table.locator('tr[data-main-row="true"] a').count(), 0);
      const first = table.locator('tr[data-main-row="true"]').first();
      await first.getByRole("button", { name: /Editar Ideal de/ }).click();
      const editor = page.getByRole("dialog", { name: /Meta ideal/ });
      await editor.getByLabel("Mínimo ideal").waitFor();
      await editor.screenshot({
        path: "screenshots/ideal-editor-preview.jpg",
        type: "jpeg",
        quality: 60,
      });
      await editor.getByRole("button", { name: "Cancelar", exact: true }).click();
      const modes = table.getByRole("button", { name: /Modalidades de/ }).first();
      if (await modes.count()) {
        await modes.click();
        snapshot.selectorOptions = await table
          .getByRole("group", { name: /Modalidade principal/ })
          .first()
          .getByRole("button")
          .allTextContents();
        await page.screenshot({
          path: "screenshots/after-modalities-preview.jpg",
          type: "jpeg",
          quality: 45,
        });
      }
    }
    assert.equal(blocked, 0);
    fs.writeFileSync(phase + "-visual.json", JSON.stringify(snapshot, null, 2));
    const parts = [];
    for (const name of fs.readdirSync("screenshots")) {
      const data = fs.readFileSync("screenshots/" + name);
      fs.mkdirSync("parts/" + name, { recursive: true });
      for (let i = 0; i < data.length; i += 1200)
        fs.writeFileSync("parts/" + name + "/" + i, data.subarray(i, i + 1200));
      parts.push({ name, bytes: data.length });
    }
    console.log(
      JSON.stringify({
        phase,
        rows: geometry.length,
        minHeight: Math.min(...geometry.map((r) => r.height)),
        maxHeight: Math.max(...geometry.map((r) => r.height)),
        files: parts,
        blocked,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
