import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { getPool } from "./db";

/** Shared, atomic counters; raw email addresses and IPs never enter this table. */
export async function consumeAuthRateLimit(
  key: string,
  limit: number,
  period: "hour" | "day" = "hour",
) {
  const result = await getPool().query(
    `INSERT INTO inventory_auth_rate_limits(key,bucket,attempts)
    VALUES($1,date_trunc($2,now()),1) ON CONFLICT(key,bucket)
    DO UPDATE SET attempts=LEAST(inventory_auth_rate_limits.attempts+1,1000000) RETURNING attempts`,
    [createHash("sha256").update(key).digest("hex"), period],
  );
  return result.rows[0].attempts <= limit;
}
