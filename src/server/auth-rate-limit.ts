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

/** Return one attempt, so successful logins never count toward an account lockout. */
export async function releaseAuthRateLimit(key: string, period: "hour" | "day" = "hour") {
  const hashed = createHash("sha256").update(key).digest("hex");
  await getPool().query(
    `WITH released AS (UPDATE inventory_auth_rate_limits SET attempts=attempts-1
      WHERE key=$1 AND bucket=date_trunc($2,now()) AND attempts>1 RETURNING 1)
     DELETE FROM inventory_auth_rate_limits WHERE key=$1 AND bucket=date_trunc($2,now()) AND attempts=1
       AND NOT EXISTS(SELECT 1 FROM released)`,
    [hashed, period],
  );
}
