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
