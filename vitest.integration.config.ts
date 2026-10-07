import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/server/**/*.test.ts"],
    pool: "threads",
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
