import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function normalizeNewMigrationTimes(previous, next) {
  for (let index = 1; index < previous.length; index++) {
    if (previous[index].when <= previous[index - 1].when)
      throw new Error("Existing migration timestamps are not strictly increasing.");
  }
  if (
    next.length < previous.length ||
    previous.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(next[index]))
  )
    throw new Error("Migration generation changed existing journal entries.");
  let timestamp = previous.at(-1)?.when ?? -1;
  return next.map((entry, index) => {
    if (!Number.isSafeInteger(entry.when) || entry.idx !== index)
      throw new Error("Invalid migration journal entry.");
    if (index < previous.length) return { ...entry };
    timestamp = Math.max(entry.when, timestamp + 1);
    return { ...entry, when: timestamp };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = "drizzle/meta/_journal.json";
  const previous = JSON.parse(await readFile(path, "utf8"));
  normalizeNewMigrationTimes(previous.entries, previous.entries);
  const result = spawnSync(
    process.execPath,
    ["node_modules/drizzle-kit/bin.cjs", "generate", ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const next = JSON.parse(await readFile(path, "utf8"));
  next.entries = normalizeNewMigrationTimes(previous.entries, next.entries);
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
}
