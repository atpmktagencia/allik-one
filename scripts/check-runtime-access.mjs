import { Client } from "pg";
import { pathToFileURL } from "node:url";

const fail = (message) => {
  throw new Error(message);
};

/** Read-only verification using the application credential, never the maintenance owner. */
export async function checkRuntimeAccess({ runtimeUrl, environment, expectedRole }) {
  if (!["test", "preview", "pilot", "production"].includes(environment))
    fail("Set an explicit inventory environment.");
  if (!runtimeUrl) fail("Application DATABASE_URL is required.");
  const url = new URL(runtimeUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail("PostgreSQL URL required.");
  if (
    !expectedRole ||
    !/^[a-z][a-z0-9_]{2,62}$/.test(expectedRole) ||
    decodeURIComponent(url.username) !== expectedRole
  )
    fail("Set the expected application role explicitly; it must match DATABASE_URL.");
  if (environment === "test" && !decodeURIComponent(url.pathname).endsWith("_test"))
    fail("Test environment requires a dedicated _test database.");
  const client = new Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout=5000");
    const identity = await client.query(
      `SELECT current_user AS actor, session_user AS login, r.oid,
       r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS elevated,
       r.rolcanlogin FROM pg_roles r WHERE r.rolname=current_user`,
    );
    const role = identity.rows[0];
    if (
      !role ||
      role.actor !== expectedRole ||
      role.login !== expectedRole ||
      role.elevated ||
      !role.rolcanlogin
    )
      fail("Unexpected or elevated database identity.");
    const memberships = await client.query(
      "SELECT 1 FROM pg_auth_members WHERE member=$1 LIMIT 1",
      [role.oid],
    );
    if (memberships.rowCount) fail("Application role must not assume other roles.");
    const ownership = await client.query(
      "SELECT 1 FROM pg_class WHERE relowner=$1 UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner=$1 UNION ALL SELECT 1 FROM pg_database WHERE datdba=$1 UNION ALL SELECT 1 FROM pg_proc WHERE proowner=$1 LIMIT 1",
      [role.oid],
    );
    if (ownership.rowCount) fail("Application role owns database objects.");
    const bypass = await client.query(
      "SELECT has_schema_privilege(current_user,'public','CREATE') AS schema_create, has_schema_privilege(current_user,'public','USAGE') AS schema_usage, has_database_privilege(current_user,current_database(),'CREATE') AS database_create, has_parameter_privilege(current_user,'session_replication_role','SET') AS replica, has_database_privilege(current_user,current_database(),'TEMP') AS database_temp",
    );
    if (
      !bypass.rows[0].schema_usage ||
      bypass.rows[0].schema_create ||
      bypass.rows[0].database_create ||
      bypass.rows[0].replica ||
      bypass.rows[0].database_temp
    )
      fail("Application can bypass database protections or lacks schema access.");
    const definer = await client.query(
      "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE') LIMIT 1",
    );
    if (definer.rowCount) fail("Application can execute an unreviewed SECURITY DEFINER function.");
    const unpinned = await client.query(
      "SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'inventory\\_%' ESCAPE '\\' AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(proconfig,'{}'::text[])) AS setting WHERE setting LIKE 'search\\_path=%' ESCAPE '\\' AND setting NOT LIKE 'search\\_path=pg\\_temp%' ESCAPE '\\') LIMIT 1",
    );
    if (unpinned.rowCount) fail("An application function runs without a fixed search_path.");
    const tables = await client.query(
      `SELECT c.oid, EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND p.proname='inventory_reject_history_change' AND (t.tgtype::int & 8)<>0 AND (t.tgtype::int & 16)<>0) AS append_only,
       has_table_privilege(current_user,c.oid,'SELECT') AS read, has_table_privilege(current_user,c.oid,'INSERT') AS insert,
       has_table_privilege(current_user,c.oid,'UPDATE') AS update, has_table_privilege(current_user,c.oid,'DELETE') AS delete,
       has_table_privilege(current_user,c.oid,'TRUNCATE') AS truncate, has_table_privilege(current_user,c.oid,'TRIGGER') AS trigger
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'inventory\\_%' ESCAPE '\\'`,
    );
    if (!tables.rowCount) fail("No migrated inventory tables found.");
    if (
      tables.rows.some(
        (t) =>
          t.truncate ||
          t.trigger ||
          !t.read ||
          !t.insert ||
          (t.append_only ? t.update || t.delete : !t.update || !t.delete),
      )
    )
      fail("Application table privileges are unsafe or incomplete.");
    const sequences = await client.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' AND c.relname LIKE 'inventory\\_%' ESCAPE '\\' AND (NOT has_sequence_privilege(current_user,c.oid,'USAGE') OR NOT has_sequence_privilege(current_user,c.oid,'SELECT')) LIMIT 1`,
    );
    if (sequences.rowCount) fail("Application sequence privileges are incomplete.");
    const migration = await client.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname='__drizzle_migrations' AND (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE')) LIMIT 1",
    );
    if (migration.rowCount) fail("Application can modify migration history.");
    await client.query("COMMIT");
    return {
      verified: true,
      environment,
      tables: tables.rowCount,
      appendOnlyTables: tables.rows.filter((t) => t.append_only).length,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkRuntimeAccess({
    runtimeUrl: process.env.DATABASE_URL,
    environment: process.env.INVENTORY_ENVIRONMENT,
    expectedRole: process.env.INVENTORY_RUNTIME_ROLE,
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        "Runtime access verification failed. Check identity, ownership, role membership and grants using the maintenance process. No credentials were logged.",
      );
      process.exitCode = 1;
    });
}
