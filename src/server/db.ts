import "@tanstack/react-start/server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
let pool: Pool | undefined;
export function getPool() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("INVENTORY_NOT_CONFIGURED");
  pool ??= new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 5000,
  });
  return pool;
}
export function getDb() {
  return drizzle(getPool(), { schema });
}
