import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function run(overrides) {
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "VERCEL_ENV",
    "INVENTORY_ENVIRONMENT",
    "INVENTORY_ALLOW_SEED",
    "INVENTORY_PREPARE_PREVIEW",
    "INVENTORY_ALLOW_PILOT_CATALOG_IMPORT",
    "INVENTORY_PREPARE_PILOT",
    "PILOT_RESET_INVITE",
    "IMPORT_FORTALEZA_STIN_ORDER_098059",
    "INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS",
  ])
    delete env[key];
  return spawnSync(process.execPath, ["scripts/prepare-preview.mjs"], {
    env: { ...env, ...overrides },
    encoding: "utf8",
  });
}

test("ordinary local and production builds do not access a database", () => {
  assert.equal(run({}).status, 0);
  assert.equal(run({ VERCEL_ENV: "production" }).status, 0);
});
test("production cannot build with full shared Preview access enabled", () => {
  const result = run({
    INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS: "true",
    VERCEL_ENV: "production",
    INVENTORY_ENVIRONMENT: "preview",
    INVENTORY_PREVIEW_DATA_CLASSIFICATION: "synthetic",
    VERCEL_GIT_COMMIT_REF: "feature/allik-patients",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbidden/);
  assert.equal(
    run({
      INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS: "true",
      VERCEL_ENV: "preview",
      INVENTORY_ENVIRONMENT: "preview",
      INVENTORY_PREVIEW_DATA_CLASSIFICATION: "synthetic",
      VERCEL_GIT_COMMIT_REF: "feature/allik-patients",
    }).status,
    0,
  );
});
test("an explicit production opt-in is denied before migration", () => {
  const result = run({
    INVENTORY_PREPARE_PREVIEW: "true",
    VERCEL_ENV: "production",
    INVENTORY_ENVIRONMENT: "preview",
    INVENTORY_ALLOW_SEED: "true",
    DATABASE_URL: "postgres://must-not-connect",
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-connect/);
});
test("Preview fails closed without seed authorization or database", () => {
  const base = {
    INVENTORY_PREPARE_PREVIEW: "true",
    VERCEL_ENV: "preview",
    INVENTORY_ENVIRONMENT: "preview",
  };
  assert.equal(run({ ...base, DATABASE_URL: "postgres://must-not-connect" }).status, 1);
  assert.equal(run({ ...base, INVENTORY_ALLOW_SEED: "true" }).status, 1);
});
test("production maintenance flags never trigger database work during a build", () => {
  const result = run({
    INVENTORY_PREPARE_PILOT: "true",
    PILOT_RESET_INVITE: "true",
    IMPORT_FORTALEZA_STIN_ORDER_098059: "true",
    INVENTORY_ALLOW_PILOT_CATALOG_IMPORT: "true",
    VERCEL_ENV: "production",
    INVENTORY_ENVIRONMENT: "production",
    DATABASE_URL: "postgres://must-not-connect",
  });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-connect/);
});

test("migration journal timestamps remain strictly increasing", async () => {
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  const entries = journal.entries;
  for (let index = 1; index < entries.length; index += 1) {
    assert.ok(
      entries[index].when > entries[index - 1].when,
      `${entries[index].tag} must be newer than ${entries[index - 1].tag}`,
    );
  }
});
