import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "allik-pg-test-"));
const container = `allik-test-${randomUUID()}`;
const password = randomBytes(24).toString("hex");
const envFile = join(directory, "postgres.env");
await writeFile(
  envFile,
  `POSTGRES_USER=allik\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=allik_test\n`,
  { mode: 0o600 },
);
const dockerEnv = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete dockerEnv[key];

async function run(command, args, env = process.env, inherit = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let output = "";
    if (!inherit) {
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
    }
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(`${command} failed (${code}): ${output.replaceAll(password, "[hidden]")}`),
          ),
    );
  });
}
const docker = (...args) =>
  run("docker", ["--host=unix:///var/run/docker.sock", ...args], dockerEnv);
let pool;
let server;
let serverLog = "";
const e2e = process.argv.includes("--e2e");
const browserCheck = process.argv.includes("--browser-check");
const session = `allik-${randomUUID()}`;
const agent = (...args) =>
  run(
    "npx",
    [
      "--cache",
      join(tmpdir(), "oi-companion-npm-cache"),
      "--yes",
      "agent-browser",
      "--session",
      session,
      ...args,
    ],
    {
      ...process.env,
      AGENT_BROWSER_EXECUTABLE_PATH: chromium.executablePath(),
      AGENT_BROWSER_SOCKET_DIR: join(directory, "browser"),
      AGENT_BROWSER_ARGS: "--no-sandbox,--disable-dev-shm-usage",
    },
  );
try {
  console.log("Iniciando PostgreSQL 16 descartável, exclusivo dos testes.");
  await docker(
    "run",
    "--detach",
    "--name",
    container,
    "--env-file",
    envFile,
    "--publish",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  );
  const address = await docker("port", container, "5432/tcp");
  const port = address.split(":").at(-1);
  const url = `postgres://allik:${password}@127.0.0.1:${port}/allik_test`;
  pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1000, max: 1 });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await pool.query("SELECT 1");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error("PostgreSQL não ficou pronto.");
  const testEnv = {
    ...process.env,
    DATABASE_URL: url,
    INVENTORY_ENVIRONMENT: "test",
    INVENTORY_PREVIEW_PASSWORD: randomBytes(16).toString("hex"),
    INVENTORY_SESSION_SECRET: randomBytes(32).toString("hex"),
    INVENTORY_PREPARE_PREVIEW: "false",
    INVENTORY_ALLOW_SEED: "true",
  };
  if (!e2e) {
    await run("npm", ["run", "test:integration"], testEnv, true);
  } else {
    await run("npm", ["run", "db:migrate"], testEnv, true);
    await run("npm", ["run", "db:seed"], testEnv, true);
    await run(process.execPath, ["--import", "tsx", "scripts/import-essentia.ts"], testEnv, true);
    const baseURL = "http://127.0.0.1:4317";
    server = spawn(
      "npm",
      ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4317", "--strictPort"],
      { env: testEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.on("error", (error) => {
      serverLog += error.message;
    });
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (data) => {
        serverLog = (serverLog + data).slice(-20000);
      });
    let serving = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) break;
      try {
        const response = await fetch(`${baseURL}/estoque/acesso`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          serving = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!serving)
      throw new Error(`Servidor não ficou pronto: ${serverLog.replaceAll(password, "[hidden]")}`);
    if (browserCheck) {
      console.log(await agent("open", `${baseURL}/estoque/acesso`));
      await agent("wait", "--load", "networkidle");
      await agent("screenshot", "/tmp/oi-codex-browser-check.png");
      console.log(await agent("snapshot", "-i"));
      const content = await agent(
        "eval",
        "document.body.innerText.trim().length > 0 ? 'HAS_CONTENT' : 'BLANK'",
      );
      const overlay = await agent(
        "eval",
        "document.querySelector('vite-error-overlay,[data-nextjs-dialog]') ? 'ERROR_OVERLAY' : 'OK'",
      );
      const errors = await agent("errors");
      if (
        !content.includes("HAS_CONTENT") ||
        overlay.includes("ERROR_OVERLAY") ||
        errors.includes("Error:")
      )
        throw new Error("A verificação inicial do navegador falhou.");
      console.log(
        "Navegador verificado: conteúdo e acesso do Preview renderizados, sem overlay de erro.",
      );
      await agent("close");
    }
    await run("npm", ["run", "test:e2e"], { ...testEnv, PLAYWRIGHT_BASE_URL: baseURL }, true);
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message.replaceAll(password, "[hidden]")
      : "Falha nos testes locais.",
  );
  process.exitCode = 1;
} finally {
  if (browserCheck) await agent("close").catch(() => {});
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  if (pool) await pool.end();
  await docker("rm", "--force", container).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
