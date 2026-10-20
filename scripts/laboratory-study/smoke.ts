/** Technical browser rehearsal only. Never records results as human outcomes. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createStudyServer } from "./serve";

const output = resolve(process.argv[2] ?? "work/laboratory-study");
const { server, counts } = createStudyServer(output);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] ?? "/usr/bin/chromium",
  headless: true,
});
const checks: string[] = [];
const forbiddenRequests: string[] = [];
try {
  for (const group of [1, 2]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });
    await context.route(/^https?:/, (route) => {
      if (
        route.request().isNavigationRequest() &&
        route
          .request()
          .url()
          .startsWith(origin + "/participante-lote-")
      )
        return route.continue();
      forbiddenRequests.push(new URL(route.request().url()).origin);
      return route.abort();
    });
    const page = await context.newPage();
    await page.clock.install();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + `/participante-lote-${group}.html?smoke=1`);
    await page.getByText("TESTE AUTOMATIZADO — NÃO É PARTICIPANTE HUMANO").waitFor();
    assert(await page.getByRole("button", { name: "Iniciar treino" }).isDisabled());
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Iniciar treino" }).click();
    for (let task = -1; task < 6; task++) {
      console.log(JSON.stringify({ technicalSmoke: true, group, task }));
      await page.getByRole("button", { name: "Conferir resultados laboratoriais" }).click();
      await page.getByRole("button", { name: "Terminar tarefa" }).waitFor();
      await page.waitForFunction(
        () =>
          !(
            [...document.querySelectorAll<HTMLButtonElement>("button")].find(
              (b) => b.textContent === "Terminar tarefa",
            )?.disabled ?? true
          ),
      );
      if (task === 0) {
        const blocked = await page.evaluate(async () => {
          const endpoint = "/api/v1/inventory/laboratory-results?unitId=study-unit";
          const status = [];
          for (const action of ["EXTRACT", "VALIDATE", "REOPEN"]) {
            status.push(
              (
                await fetch(endpoint, {
                  method: "POST",
                  body: JSON.stringify({
                    action,
                    patientId: "study-patient",
                    documentId: "study-document",
                    version: 1,
                  }),
                })
              ).status,
            );
          }
          status.push((await fetch("https://api.openai.com/v1/responses")).status);
          status.push((await fetch("/api/v1/inventory/patients")).status);
          status.push(
            (
              await fetch(
                "/api/v1/inventory/laboratory-results?unitId=other&patientId=study-patient&documentId=study-document",
              )
            ).status,
          );
          status.push(
            (
              await fetch(endpoint, {
                method: "POST",
                body: JSON.stringify({
                  action: "SAVE",
                  patientId: "other",
                  documentId: "study-document",
                  version: 1,
                }),
              })
            ).status,
          );
          return status;
        });
        assert(blocked.every((status) => status === 403));
        if (group === 1) {
          // Raw browser source avoids tsx's Node-only function-name helper.
          const cspEnforced = await page.evaluate<boolean>(`new Promise(resolve => {
            const violation = event => {
              if (event.effectiveDirective === 'connect-src' && event.disposition === 'enforce') {
                document.removeEventListener('securitypolicyviolation', violation); resolve(true);
              }
            };
            document.addEventListener('securitypolicyviolation', violation);
            const xhr = new XMLHttpRequest();
            try { xhr.open('GET','https://study-network-denial.invalid/probe'); xhr.send(); } catch {}
            setTimeout(() => { document.removeEventListener('securitypolicyviolation',violation); resolve(false); },1000);
          })`);
          assert(cspEnforced, "Native XHR must be blocked independently of the fetch fixture.");
          checks.push("csp_blocks_native_xhr_independently_of_fixture_fetch");
        }
        checks.push(`group_${group}_extract_validate_reopen_external_unknown_scope_blocked`);
        if (group === 1)
          await page.getByRole("button", { name: "Conferi as", exact: false }).click();
        assert(
          !(await page
            .getByRole("checkbox", { name: "Conferir linha 1", exact: true })
            .isChecked()),
        );
        checks.push(
          group === 1
            ? "individual_condition_blocks_eligible_bulk_action"
            : "controlled_group_initial_unconfirmed_state_preserved",
        );
        await page.getByLabel("Resultado da linha 1", { exact: true }).fill("46");
        await page.getByRole("checkbox", { name: "Conferir linha 1", exact: true }).check();
        await page.getByRole("button", { name: "Localizei a evidência" }).click();
        await page.getByRole("button", { name: "Marcar problema" }).click();
      }
      if (group === 1 && task === 0)
        await page.screenshot({ path: resolve(output, "technical-smoke.png") });
      if (group === 1 && task === 3) {
        await page.getByRole("button", { name: "Girar", exact: true }).click();
        await page.getByRole("button", { name: "Aumentar zoom do original" }).click();
        await page.getByRole("button", { name: "Diminuir zoom do original" }).click();
        const fits = await page.locator("aside img").evaluate((image) => {
          const actual = image.getBoundingClientRect(),
            frame = image.parentElement!.getBoundingClientRect();
          return (
            actual.left >= frame.left - 1 &&
            actual.top >= frame.top - 1 &&
            actual.right <= frame.right + 1 &&
            actual.bottom <= frame.bottom + 1
          );
        });
        assert(fits, "Rotated original must remain inside the scrollable evidence surface.");
        checks.push("rotation_zoom_preserve_original_geometry");
      }
      if (group === 1 && task === 5) {
        await page.getByRole("button", { name: "Próxima", exact: true }).click();
        await page.getByText("Página 2/8", { exact: false }).waitFor();
        await page.getByRole("button", { name: "Anterior", exact: true }).click();
        await page.clock.fastForward(8 * 60 * 1000);
      } else await page.getByRole("button", { name: "Terminar tarefa" }).click();
      await page.getByLabel("Dificuldade", { exact: true }).selectOption("1");
      await page.getByLabel("Confiança", { exact: true }).selectOption("1");
      await page.getByRole("button", { name: "Continuar", exact: true }).click();
    }
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar registro anônimo" }).click();
    const download = await downloading;
    const path = resolve(output, `SMOKE-lote-${group}.json`);
    await download.saveAs(path);
    const data = JSON.parse(await readFile(path, "utf8"));
    assert.equal(data.participantKind, "automated_smoke");
    assert.equal(data.tasks.length, 6);
    assert.equal(data.clinicalRequestsSent, 0);
    assert.equal(data.tasks[0].finalDraft.rows[0].result, "46");
    assert(
      data.tasks[0].events.some((event: { event: string }) => event.event === "problem_perceived"),
    );
    assert(
      data.tasks[0].events.some((event: { event: string }) => event.event === "evidence_located"),
    );
    assert(data.tasks[0].events.some((event: { event: string }) => event.event === "field_edit"));
    if (group === 1) assert.equal(data.tasks[5].censored, true);
    assert.deepEqual(errors, []);
    checks.push(`group_${group}_six_tasks_memory_snapshot_events_export_and_reset`);
    await context.close();
  }
  assert.deepEqual(forbiddenRequests, []);
  checks.push("zero_non_document_http_requests_issued_by_both_offline_documents");
  assert.equal(counts.documents, 2);
  assert.equal(counts.denied, 0);
  assert.equal(
    (await fetch(origin + "/api/v1/inventory/laboratory-results", { method: "POST" })).status,
    403,
  );
  checks.push("loopback_static_server_rejects_api_without_application_handlers");
  let rejected = false;
  try {
    execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/laboratory-study/report.ts",
        "--human-authorized",
        resolve(output, "moderador.json"),
        resolve(output, "SMOKE-lote-1.json"),
      ],
      { stdio: "pipe" },
    );
  } catch (error) {
    rejected =
      !!error &&
      typeof error === "object" &&
      "stderr" in error &&
      String(error.stderr).includes("AUTOMATED_OR_UNVERIFIED_PARTICIPANT_REJECTED");
  }
  assert(rejected);
  checks.push("moderator_scoring_rejects_automated_exports_even_with_authorization_flag");
  const htmlSha256 = Object.fromEntries(
    await Promise.all(
      [1, 2].map(async (group) => {
        const name = `participante-lote-${group}.html`;
        return [
          name,
          createHash("sha256")
            .update(await readFile(resolve(output, name)))
            .digest("hex"),
        ];
      }),
    ),
  );
  await writeFile(
    resolve(output, "technical-validation.json"),
    JSON.stringify(
      {
        purpose: "AUTOMATED_SMOKE_NOT_HUMAN_USABILITY",
        htmlSha256,
        checks,
        initialLoopbackDocuments: 2,
        assetApiOrExternalHttpRequests: 0,
        humanParticipantsMeasured: 0,
        clinicalRequests: 0,
        providerCalls: 0,
        viewport: { width: 1440, height: 900 },
        browser: browser.version(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ checks: checks.length, passed: true, humanParticipantsMeasured: 0 }),
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
