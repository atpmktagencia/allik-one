import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { getDb, getPool } from "../src/server/db";
const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
for (let index = 1; index < migrations.length; index++) {
  if (migrations[index]!.folderMillis <= migrations[index - 1]!.folderMillis)
    throw new Error("Migration journal timestamps must remain strictly increasing.");
}
if (!process.env["DATABASE_URL"]) throw new Error("Configure DATABASE_URL no servidor.");
try {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations aplicadas.");
} finally {
  await getPool().end();
}
