import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { chromium } from "playwright";
import { provisionRuntimeRole } from "./provision-runtime-role.mjs";
import { checkRuntimeAccess } from "./check-runtime-access.mjs";

// This runner never consumes an external database URL or service credential.
// The child serves the actual Vercel build with production authentication.
if (process.argv.includes("--serve")) {
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.pathname, "/allik_beta_test");
  assert.equal(database.username, "allik_runtime");
  assert.equal(process.env.INVENTORY_ENVIRONMENT, "production");
  assert.equal(process.env.DATABASE_ADMIN_URL, undefined);
  const app = (await import("../.vercel/output/functions/__server.func/index.mjs")).default;
  const assets = resolve(".vercel/output/static");
  const server = createServer(async (req, res) => {
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico") {
        const filename = resolve(assets, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${assets}/`)) throw new Error("Invalid asset path");
        const types = {
          ".js": "text/javascript",
          ".css": "text/css",
          ".woff2": "font/woff2",
          ".ico": "image/x-icon",
        };
        res.setHeader("Content-Type", types[extname(filename)] ?? "application/octet-stream");
        res.end(await readFile(filename));
        return;
      }
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : Readable.toWeb(req);
      const response = await app.fetch(
        new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(body ? { body, duplex: "half" } : {}),
        }),
        { waitUntil: () => {} },
      );
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") res.setHeader(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("set-cookie", cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.statusCode = 500;
      res.end("Beta verification server failed");
    }
  });
  server.listen(0, "127.0.0.1", () => console.log(`BETA_READY:${server.address().port}`));
} else {
  const directory = await mkdtemp(join(tmpdir(), "allik-beta-"));
  const container = `allik-beta-${randomUUID()}`;
  const ownerPassword = randomBytes(32).toString("hex");
  const runtimePassword = randomBytes(32).toString("hex");
  const loginPassword = randomBytes(24).toString("hex");
  const baseEnv = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "DOCKER_CONFIG",
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  let pool, browser, server;
  const redact = (value) =>
    String(value)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[connection hidden]")
      .replaceAll(ownerPassword, "[hidden]")
      .replaceAll(runtimePassword, "[hidden]")
      .replaceAll(loginPassword, "[hidden]");
  async function run(command, args, env = baseEnv) {
    return new Promise((resolveRun, reject) => {
      const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolveRun(output.trim())
          : reject(new Error(redact(`${command} failed: ${output}`))),
      );
    });
  }
  const docker = (...args) => run("docker", ["--host=unix:///var/run/docker.sock", ...args]);
  try {
    await run("npm", ["run", "build"], {
      ...baseEnv,
      INVENTORY_PREPARE_PREVIEW: "false",
      INVENTORY_ALLOW_SEED: "false",
    });
    console.log("Current production build generated without database or sending credentials.");
    const envFile = join(directory, "postgres.env");
    await writeFile(
      envFile,
      `POSTGRES_USER=allik\nPOSTGRES_PASSWORD=${ownerPassword}\nPOSTGRES_DB=allik_beta_test\n`,
      { mode: 0o600 },
    );
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
    const port = (await docker("port", container, "5432/tcp")).split(":").at(-1);
    const ownerUrl = `postgres://allik:${ownerPassword}@127.0.0.1:${port}/allik_beta_test`;
    const runtimeUrl = `postgres://allik_runtime:${runtimePassword}@127.0.0.1:${port}/allik_beta_test`;
    pool = new Pool({ connectionString: ownerUrl, connectionTimeoutMillis: 1000 });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await pool.query("SELECT 1");
        ready = true;
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 250));
      }
    }
    assert.ok(ready, "Disposable database must be ready");
    const maintenanceEnv = {
      ...baseEnv,
      DATABASE_URL: ownerUrl,
      INVENTORY_ENVIRONMENT: "test",
      INVENTORY_ALLOW_SEED: "true",
      INVENTORY_PREPARE_PREVIEW: "false",
    };
    // Rehearse the official Pilot's observed 0012 -> current migration path
    // with synthetic ledger data, never a copy of production records.
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const legacyFolder = join(directory, "legacy-drizzle");
    await mkdir(join(legacyFolder, "meta"), { recursive: true });
    await writeFile(
      join(legacyFolder, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 13) }),
    );
    for (const entry of journal.entries.slice(0, 13))
      await copyFile(`drizzle/${entry.tag}.sql`, join(legacyFolder, `${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: legacyFolder });
    await run(process.execPath, ["--import", "tsx", "scripts/seed-inventory.ts"], maintenanceEnv);
    const ledger = async () => ({
      balances: (
        await pool.query(
          "SELECT id,lot_id,location_id,quantity::float8 AS quantity FROM inventory_balances ORDER BY id",
        )
      ).rows,
      movements: (
        await pool.query(
          "SELECT id,lot_id,location_id,type,delta::float8 AS delta,reference,actor FROM inventory_movements ORDER BY id",
        )
      ).rows,
    });
    const legacyLedger = await ledger();
    assert.ok(legacyLedger.movements.length > 0);
    await run(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], maintenanceEnv);
    assert.deepEqual(await ledger(), legacyLedger);
    console.log(
      "PASS: synthetic migration 0012 -> current preserves existing ledger and balances.",
    );
    const org = "a1100000-0000-4000-8000-000000000001";
    const unit = "a1100000-0000-4000-8000-000000000101";
    const otherUnit = "a1100000-0000-4000-8000-000000000102";
    const salt = randomBytes(16);
    const hash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(loginPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url")}`;
    const actors = {};
    for (const [key, role, scope] of [
      ["doctor", "CLINICIAN", unit],
      ["colleague", "CLINICIAN", unit],
      ["foreignUnit", "CLINICIAN", otherUnit],
      ["admin", "SUPER_ADMIN", unit],
    ]) {
      const id = randomUUID(),
        membership = randomUUID();
      actors[key] = { id, email: `${key}@beta.example.test` };
      await pool.query(
        "INSERT INTO inventory_users(id,name,email,password_hash,professional_council,council_number,council_region,prescribing_address,prescribing_city,prescribing_state,prescribing_phone) VALUES($1,$2,$3,$4,'CRM',$5,'CE','Synthetic clinic','Fortaleza','CE','+5585999999999')",
        [id, `Beta ${key}`, actors[key].email, hash, String(10000 + Object.keys(actors).length)],
      );
      await pool.query(
        "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
        [membership, id, org, role],
      );
      await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
        membership,
        scope,
      ]);
    }
    const patient = randomUUID(),
      appointment = randomUUID();
    await pool.query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name,document_type,document_number,birth_date,additional_data) VALUES($1,$2,$3,'BETA-SYNTHETIC','Synthetic beta patient','PASSPORT','SYNTH-BETA','1990-01-01','{\"address\":\"Synthetic street\"}')",
      [patient, org, unit],
    );
    await pool.query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION','2031-02-12T10:00:00Z','2031-02-12T11:00:00Z','Beta test room')",
      [appointment, org, unit, patient, actors.doctor.id],
    );
    await provisionRuntimeRole({
      adminUrl: ownerUrl,
      runtimeUrl,
      environment: "test",
      password: runtimePassword,
      apply: true,
    });
    await provisionRuntimeRole({ adminUrl: ownerUrl, runtimeUrl, environment: "test" });
    console.log(
      JSON.stringify(
        await checkRuntimeAccess({
          runtimeUrl,
          environment: "test",
          expectedRole: "allik_runtime",
        }),
      ),
    );
    // The app receives no inherited live credentials, no owner URL and no provider sending keys.
    server = spawn(process.execPath, ["scripts/test-beta-local.mjs", "--serve"], {
      env: {
        ...baseEnv,
        NODE_ENV: "production",
        DATABASE_URL: runtimeUrl,
        INVENTORY_ENVIRONMENT: "production",
        INVENTORY_RUNTIME_ROLE: "allik_runtime",
        INVENTORY_PREPARE_PREVIEW: "false",
        INVENTORY_ALLOW_SEED: "false",
        AUTH_RECOVERY_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const baseURL = await new Promise((resolveServer, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Production build server startup timed out")),
        30000,
      );
      server.stdout.on("data", (data) => {
        const match = String(data).match(/BETA_READY:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolveServer(`http://127.0.0.1:${match[1]}`);
        }
      });
      server.on("error", reject);
      server.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("Production build server exited"));
      });
    });
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync(chromium.executablePath()) ? chromium.executablePath() : "/usr/bin/chromium"),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/estoque/acesso");
    await page.getByLabel("E-mail", { exact: true }).fill(actors.doctor.email);
    await page.getByLabel("Senha", { exact: true }).fill(loginPassword);
    await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
    await page.waitForURL("**/estoque");
    const api = context.request;
    const post = (path, data, client = api) =>
      client.post(path, { data, headers: { origin: baseURL } });
    assert.equal((await api.get("/api/inventory-session")).status(), 200);
    const identity = (await (await api.get("/api/inventory-session")).json()).data;
    assert.equal(identity.user.id, actors.doctor.id);
    assert.equal(identity.preview, false);
    assert.deepEqual(
      identity.units.map((value) => value.id),
      [unit],
    );
    const anonymous = await browser.newContext({ baseURL });
    assert.equal((await anonymous.request.get("/api/inventory-session")).status(), 401);
    assert.equal(
      (
        await post("/api/inventory-session", { password: loginPassword }, anonymous.request)
      ).status(),
      401,
    );
    const documents = "/api/v1/inventory/encounter-documents";
    const draftInput = {
      action: "SAVE_DRAFT",
      appointmentId: appointment,
      type: "PRESCRIPTION",
      title: "Synthetic beta prescription",
      content: "Synthetic instructions only",
      twoCopies: true,
    };
    let response = await post(documents, draftInput);
    assert.equal(response.status(), 201, "Restricted-runtime draft creation");
    const draft = (await response.json()).data;
    const colleague = await browser.newContext({ baseURL });
    assert.equal(
      (
        await post(
          "/api/inventory-session",
          { ...actors.colleague, password: loginPassword },
          colleague.request,
        )
      ).status(),
      200,
    );
    assert.deepEqual(
      (await (await colleague.request.get(`${documents}?appointmentId=${appointment}`)).json()).data
        .documents,
      [],
    );
    const foreign = await browser.newContext({ baseURL });
    assert.equal(
      (
        await post(
          "/api/inventory-session",
          { ...actors.foreignUnit, password: loginPassword },
          foreign.request,
        )
      ).status(),
      200,
    );
    assert.equal(
      (await foreign.request.get(`${documents}?appointmentId=${appointment}`)).status(),
      404,
    );
    response = await post(documents, {
      ...draftInput,
      action: "FINALIZE",
      documentId: draft.id,
      version: draft.version,
    });
    assert.equal(response.status(), 200, "Restricted-runtime finalization");
    const final = (await response.json()).data;
    const finalRow = (
      await pool.query("SELECT final_snapshot FROM inventory_encounter_documents WHERE id=$1", [
        draft.id,
      ])
    ).rows[0].final_snapshot;
    const printed = await api.get(`${documents}?documentId=${draft.id}&print=true`);
    assert.equal(printed.status(), 200);
    assert.ok((await printed.text()).includes("Synthetic beta patient"));
    const sourcePath = `/api/v1/inventory/document-signatures?documentId=${draft.id}&source=true`;
    const pdf = await api.get(sourcePath);
    assert.equal(pdf.status(), 200);
    const originalPdf = await pdf.body();
    assert.equal(originalPdf.subarray(0, 5).toString(), "%PDF-");
    const admin = await browser.newContext({ baseURL });
    assert.equal(
      (
        await post(
          "/api/inventory-session",
          { email: actors.admin.email, password: loginPassword },
          admin.request,
        )
      ).status(),
      200,
    );
    const editDoctor = {
      action: "UPDATE",
      userId: actors.doctor.id,
      name: "Beta doctor revised",
      email: actors.doctor.email,
      profession: "Médico",
      professionalCouncil: "CRM",
      councilNumber: "10001",
      councilRegion: "CE",
      role: "CLINICIAN",
      unitIds: [unit],
      prescribingAddress: "Synthetic clinic revised",
      prescribingCity: "Fortaleza",
      prescribingState: "CE",
      prescribingPhone: "+5585999999999",
    };
    assert.equal(
      (
        await post(
          "/api/v1/inventory/users",
          { ...editDoctor, councilNumber: "10002" },
          admin.request,
        )
      ).status(),
      409,
      "Duplicate professional registration denied",
    );
    assert.equal(
      (await post("/api/v1/inventory/users", editDoctor, admin.request)).status(),
      200,
      "Audited user edit using runtime account",
    );
    assert.deepEqual(
      await (await api.get(sourcePath)).body(),
      originalPdf,
      "Finalized PDF preserves original issuer after profile edits",
    );
    assert.equal(
      (await foreign.request.get(`${documents}?documentId=${draft.id}&print=true`)).status(),
      404,
    );
    assert.equal((await foreign.request.get(sourcePath)).status(), 404);
    assert.equal((await api.get(`${documents}?verify=${finalRow.verificationCode}`)).status(), 200);
    assert.equal(
      (
        await post(documents, {
          ...draftInput,
          documentId: draft.id,
          version: final.version,
          content: "Unauthorized rewrite",
        })
      ).status(),
      409,
    );
    await page.goto(`/atendimentos/${appointment}`);
    await page.getByText("Synthetic beta patient", { exact: false }).first().waitFor();
    assert.deepEqual(pageErrors, [], "Production build must render without browser errors");
    response = await post("/api/v1/inventory/password-security", {
      action: "CHANGE_PASSWORD",
      currentPassword: loginPassword,
      newPassword: `${loginPassword}-changed`,
    });
    assert.equal(response.status(), 200);
    assert.equal((await api.get("/api/inventory-session")).status(), 401);
    assert.equal(
      (
        await post("/api/inventory-session", {
          email: actors.doctor.email,
          password: loginPassword,
        })
      ).status(),
      401,
    );
    assert.equal(
      (
        await post("/api/inventory-session", {
          email: actors.doctor.email,
          password: `${loginPassword}-changed`,
        })
      ).status(),
      200,
    );
    assert.equal(
      (await api.delete("/api/inventory-session", { headers: { origin: baseURL } })).status(),
      200,
    );
    assert.equal((await api.get("/api/inventory-session")).status(), 401);
    console.log(
      "PASS: individual browser login; shared login denied; own-unit scope; other-author draft hidden; foreign-unit read/print/PDF denied; draft/final/print/verification; final rewrite denied; duplicate registration denied; audited profile edit; frozen PDF unchanged; password/session revocation; logout.",
    );
    // Exercise real backup/restore only on this local disposable database.
    await docker(
      "exec",
      container,
      "pg_dump",
      "-U",
      "allik",
      "-d",
      "allik_beta_test",
      "-Fc",
      "-f",
      "/tmp/beta.dump",
    );
    await docker("exec", container, "createdb", "-U", "allik", "allik_beta_restored_test");
    await docker(
      "exec",
      container,
      "pg_restore",
      "-U",
      "allik",
      "-d",
      "allik_beta_restored_test",
      "/tmp/beta.dump",
    );
    const restored = new Pool({
      connectionString: ownerUrl.replace("/allik_beta_test", "/allik_beta_restored_test"),
    });
    try {
      assert.deepEqual(
        (
          await restored.query(
            "SELECT final_snapshot FROM inventory_encounter_documents WHERE id=$1",
            [draft.id],
          )
        ).rows[0].final_snapshot,
        finalRow,
      );
      assert.equal(
        (await restored.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"))
          .rows[0].count,
        60,
      );
    } finally {
      await restored.end();
    }
    console.log(
      "PASS: disposable backup restored with identical finalized snapshot and migration checkpoint. This is not evidence of provider/production recovery.",
    );
  } catch (error) {
    console.error(redact(error instanceof Error ? error.stack : error));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
    if (pool) await pool.end();
    await docker("rm", "--force", container).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
