import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { getDb, getPool, allowMaintenanceIdentity } from "../src/server/db";
allowMaintenanceIdentity();

const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
for (let index = 1; index < migrations.length; index++) {
  if (migrations[index]!.folderMillis <= migrations[index - 1]!.folderMillis)
    throw new Error("Migration journal timestamps must remain strictly increasing.");
}
const url = process.env["DATABASE_URL"];
if (!url) throw new Error("Configure DATABASE_URL no servidor.");
const production = process.env["INVENTORY_ENVIRONMENT"] === "production";
// Fail fast instead of queueing behind application locks during a maintenance window.
process.env["PGOPTIONS"] ??= "-c lock_timeout=5000 -c statement_timeout=900000";

const target = new URL(url);
console.log(`Migration target: ${target.hostname}${target.pathname} (credentials hidden).`);
const lock = await getPool().connect();
try {
  await lock.query("SELECT pg_advisory_lock(hashtextextended('allik-inventory-migrate',0))");
  const exists = await lock.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok",
  );
  const applied = exists.rows[0]?.ok
    ? (
        await lock.query<{ hash: string; created_at: string }>(
          "SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at",
        )
      ).rows
    : [];
  const byMillis = new Map(migrations.map((entry) => [entry.folderMillis, entry]));
  const edited: number[] = [];
  for (const row of applied) {
    const file = byMillis.get(Number(row.created_at));
    if (!file) throw new Error("The database records a migration that is not in this repository.");
    if (file.hash !== row.hash) edited.push(file.folderMillis);
  }
  if (edited.length && production)
    throw new Error(`${edited.length} applied migration(s) differ from the repository; stop.`);
  if (edited.length)
    console.warn(`${edited.length} applied migration(s) differ from the repository.`);
  const last = applied.length ? Math.max(...applied.map((row) => Number(row.created_at))) : -1;
  const appliedMillis = new Set(applied.map((row) => Number(row.created_at)));
  const skipped = migrations.filter(
    (entry) => entry.folderMillis <= last && !appliedMillis.has(entry.folderMillis),
  );
  if (skipped.length)
    throw new Error(`${skipped.length} migration(s) would be skipped silently; stop.`);
  const pending = migrations.filter((entry) => entry.folderMillis > last);
  console.log(`Applied: ${applied.length}. Pending: ${pending.length}.`);
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations aplicadas.");
} finally {
  await lock.query("SELECT pg_advisory_unlock_all()").catch(() => {});
  lock.release();
  await getPool().end();
}
