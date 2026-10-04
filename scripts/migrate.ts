import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "../src/server/db";
if (!process.env["DATABASE_URL"]) throw new Error("Configure DATABASE_URL no servidor.");
try {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations aplicadas.");
} finally {
  await getPool().end();
}
