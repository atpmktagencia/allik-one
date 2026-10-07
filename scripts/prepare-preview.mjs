import { spawnSync } from "node:child_process";

// An explicit branch-scoped opt-in; local builds and production never initialize data.
if (process.env.INVENTORY_PREPARE_PREVIEW === "true") {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.INVENTORY_ENVIRONMENT !== "preview" ||
    process.env.INVENTORY_ALLOW_SEED !== "true" ||
    !process.env.DATABASE_URL
  ) {
    process.stderr.write(
      "Preview preparation denied: requires an isolated Preview database and explicit seed authorization.\n",
    );
    process.exit(1);
  }
  for (const script of [
    "scripts/migrate.ts",
    "scripts/import-real-inventory.ts",
    "scripts/import-essentia.ts",
    "scripts/import-stin.ts",
  ]) {
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
      encoding: "utf8",
      env: process.env,
    });
    // Do not print database credentials, even if a driver includes them in an error.
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .replaceAll(process.env.DATABASE_URL, "[database credential hidden]")
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database credential hidden]");
    process.stdout.write(output);
    if (result.error || result.status !== 0) {
      console.error("Preview preparation failed; deployment stopped.");
      process.exit(1);
    }
  }
}

if (process.env.INVENTORY_PREPARE_PILOT === "true") {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.INVENTORY_ENVIRONMENT !== "production" ||
    !process.env.DATABASE_URL
  ) {
    process.stderr.write(
      "Pilot preparation denied: requires the isolated production Pilot database.\n",
    );
    process.exit(1);
  }
  for (const script of ["scripts/migrate.ts", "scripts/bootstrap-pilot.ts"]) {
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
      encoding: "utf8",
      env: process.env,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .replaceAll(process.env.DATABASE_URL, "[database credential hidden]")
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database credential hidden]");
    process.stdout.write(output);
    if (result.error || result.status !== 0) {
      console.error("Pilot preparation failed; deployment stopped.");
      process.exit(1);
    }
  }
}

if (process.env.PILOT_RESET_INVITE === "true") {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.INVENTORY_ENVIRONMENT !== "production" ||
    !process.env.DATABASE_URL
  ) {
    process.stderr.write(
      "Pilot invite reset denied outside the isolated production environment.\n",
    );
    process.exit(1);
  }
  const result = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/reset-pilot-invite.ts"],
    { encoding: "utf8", env: process.env },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
    .replaceAll(process.env.DATABASE_URL, "[database credential hidden]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database credential hidden]");
  process.stdout.write(output);
  if (result.error || result.status !== 0) {
    console.error("Pilot invite reset failed; deployment stopped.");
    process.exit(1);
  }
}

if (process.env.IMPORT_FORTALEZA_STIN_ORDER_098059 === "true") {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.INVENTORY_ENVIRONMENT !== "production" ||
    !process.env.DATABASE_URL
  ) {
    process.stderr.write(
      "Fortaleza order import denied outside the isolated production Pilot database.\n",
    );
    process.exit(1);
  }
  const result = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/import-fortaleza-stin-order-098059.ts"],
    { encoding: "utf8", env: process.env },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
    .replaceAll(process.env.DATABASE_URL, "[database credential hidden]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database credential hidden]");
  process.stdout.write(output);
  if (result.error || result.status !== 0) {
    console.error("Fortaleza order import failed; deployment stopped.");
    process.exit(1);
  }
}

if (process.env.INVENTORY_ALLOW_PILOT_CATALOG_IMPORT === "true") {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.INVENTORY_ENVIRONMENT !== "production" ||
    !process.env.DATABASE_URL
  ) {
    process.stderr.write(
      "Pilot catalog repair denied outside the isolated production environment.\n",
    );
    process.exit(1);
  }
  for (const script of ["scripts/import-essentia.ts", "scripts/import-stin.ts"]) {
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
      encoding: "utf8",
      env: process.env,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .replaceAll(process.env.DATABASE_URL, "[database credential hidden]")
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database credential hidden]");
    process.stdout.write(output);
    if (result.error || result.status !== 0) {
      console.error("Pilot catalog repair failed; deployment stopped.");
      process.exit(1);
    }
  }
}
