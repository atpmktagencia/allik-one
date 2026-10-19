import "@tanstack/react-start/server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { sharedPreviewBoundaryEnabled } from "../lib/preview-operator-policy";

const ownerAliases = [
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NO_SSL",
];

/**
 * Production and the authorized shared synthetic Preview run as the restricted role created by
 * scripts/provision-runtime-role.mjs. Refuse to serve with an owner or
 * maintenance identity, or while owner credentials remain in the environment.
 */
export function runtimeEnvironmentProblem(env: NodeJS.ProcessEnv = process.env) {
  const role = env["INVENTORY_RUNTIME_ROLE"]?.trim();
  if (!role) return "INVENTORY_RUNTIME_ROLE is required in production.";
  if (env["DATABASE_ADMIN_URL"]) return "Maintenance credentials must not be deployed.";
  let user = "";
  try {
    user = decodeURIComponent(new URL(env["DATABASE_URL"] ?? "").username);
  } catch {
    return "DATABASE_URL is invalid.";
  }
  if (user !== role) return "DATABASE_URL must authenticate as the runtime role.";
  for (const name of ownerAliases) {
    const value = env[name];
    if (!value) continue;
    try {
      if (decodeURIComponent(new URL(value).username) !== role)
        return `${name} must not hold another database identity.`;
    } catch {
      return `${name} is invalid.`;
    }
  }
  for (const name of ["PGUSER", "POSTGRES_USER"])
    if (env[name] && env[name] !== role) return `${name} must match the runtime role.`;
  return null;
}

function guardRuntimeIdentity(target: Pool, role: string) {
  const connect = target.connect.bind(target);
  let verified = false;
  let pending: Promise<void> | null = null;
  const verify = async () => {
    if (verified) return;
    pending ??= (async () => {
      // Use the original connector and a client query: Pool.query itself calls
      // connect(callback), which must be guarded just like Promise callers.
      const client = await connect();
      try {
        const result = await client.query(
          `SELECT current_user AS current_name, session_user AS session_name,
           r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication AS elevated,
           has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
           has_database_privilege(current_user,current_database(),'TEMP') AS database_temp,
           has_schema_privilege(current_user,'public','CREATE') AS schema_create,
           EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace
             AND c.relname LIKE 'inventory\\_%' ESCAPE '\\' AND c.relowner=r.oid) AS owns_tables
         FROM pg_roles r WHERE r.rolname=current_user`,
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (
          !row ||
          row["current_name"] !== role ||
          row["session_name"] !== role ||
          row["elevated"] ||
          row["database_create"] ||
          row["database_temp"] ||
          row["schema_create"] ||
          row["owns_tables"]
        ) {
          console.error("Runtime database identity rejected");
          throw new Error("INVENTORY_RUNTIME_ROLE_REJECTED");
        }
        verified = true;
      } finally {
        client.release();
      }
    })().finally(() => {
      pending = null;
    });
    await pending;
  };
  Object.assign(target, {
    // Preserve pg's query overloads, including callback error delivery. Native
    // Pool.query routes through this connector, so it cannot skip verification.
    connect: (callback?: Parameters<Pool["connect"]>[0]) => {
      if (callback) {
        void verify().then(
          () => connect(callback),
          (error: Error) => callback(error, undefined, () => {}),
        );
        return;
      }
      return verify().then(() => connect());
    },
  });
  return target;
}

let pool: Pool | undefined;
let maintenanceIdentity = false;
/**
 * Explicit opt-in for administrative scripts (migrations, bootstrap, audited
 * maintenance) that must connect with the maintenance identity. The deployed
 * application never calls this, so environment variables alone cannot disable
 * the production runtime-role guard.
 */
export function allowMaintenanceIdentity() {
  if (pool) throw new Error("Call allowMaintenanceIdentity() before opening the pool.");
  maintenanceIdentity = true;
}
export function getPool(): Pool {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("INVENTORY_NOT_CONFIGURED");
  if (!pool) {
    const config = {
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 5000,
    };
    if (
      (process.env["INVENTORY_ENVIRONMENT"] === "production" ||
        (process.env["VERCEL_ENV"] === "preview" && sharedPreviewBoundaryEnabled(process.env))) &&
      !maintenanceIdentity
    ) {
      const expectedRole =
        process.env["INVENTORY_RUNTIME_ROLE"]?.trim() ||
        (process.env["VERCEL_ENV"] === "preview" ? "allik_runtime" : "");
      const problem = runtimeEnvironmentProblem({
        ...process.env,
        INVENTORY_RUNTIME_ROLE: expectedRole,
      });
      if (problem) {
        console.error("Runtime database configuration rejected");
        throw new Error("INVENTORY_RUNTIME_ROLE_REJECTED");
      }
      pool = guardRuntimeIdentity(new Pool(config), expectedRole);
    } else pool = new Pool(config);
  }
  return pool;
}
export function getDb() {
  return drizzle(getPool(), { schema });
}
