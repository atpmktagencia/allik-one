import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(overrides) {
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "VERCEL_ENV",
    "INVENTORY_ENVIRONMENT",
    "INVENTORY_ALLOW_SEED",
    "INVENTORY_PREPARE_PREVIEW",
    "INVENTORY_ALLOW_PILOT_CATALOG_IMPORT",
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
test("an explicit production opt-in is denied before migration", () => {
  const result = run({
    INVENTORY_PREPARE_PREVIEW: "true",
    VERCEL_ENV: "production",
    INVENTORY_ENVIRONMENT: "preview",
    INVENTORY_ALLOW_SEED: "true",
    DATABASE_URL: "postgres://must-not-connect",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /denied/);
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
test("Pilot catalog repair fails closed outside production", () => {
  const result = run({
    INVENTORY_ALLOW_PILOT_CATALOG_IMPORT: "true",
    VERCEL_ENV: "preview",
    INVENTORY_ENVIRONMENT: "production",
    DATABASE_URL: "postgres://must-not-connect",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /denied/);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-connect/);
});
