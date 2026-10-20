import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync("work", { recursive: true });
const output = resolve(process.env.LAB_BENCHMARK_REPORT || "work/laboratory-benchmark.json");
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--cache=false",
    "--config",
    "vitest.integration.config.ts",
    "src/server/laboratory-benchmark.test.ts",
  ],
  { stdio: "inherit", env: { ...process.env, LAB_BENCHMARK_REPORT: output } },
);
process.exitCode = result.status ?? 1;
