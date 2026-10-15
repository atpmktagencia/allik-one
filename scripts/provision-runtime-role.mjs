import { Client } from "pg";
import { pathToFileURL } from "node:url";

const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const fail = (message) => {
  throw new Error(message);
};

/** Explicit maintenance command; never called by a build or migration. */
export async function provisionRuntimeRole({
  adminUrl,
  runtimeUrl,
  environment,
  role = "allik_runtime",
  password,
  apply = false,
}) {
  if (!["test", "preview", "pilot", "production"].includes(environment))
    fail("Set an explicit INVENTORY_ENVIRONMENT (test, preview, pilot or production).");
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(role)) fail("Invalid runtime role name.");
  if (!adminUrl || !runtimeUrl || adminUrl === runtimeUrl)
    fail("Distinct DATABASE_ADMIN_URL and DATABASE_URL are required.");
  const admin = new URL(adminUrl),
    runtime = new URL(runtimeUrl);
  if (
    admin.hostname !== runtime.hostname ||
    admin.port !== runtime.port ||
    admin.pathname !== runtime.pathname ||
    admin.username === runtime.username ||
    decodeURIComponent(runtime.username) !== role
  )
    fail(
      "URLs must target the same database with distinct users; DATABASE_URL must use the runtime role.",
    );
  if (environment === "test" && !decodeURIComponent(admin.pathname).endsWith("_test"))
    fail("Test environment requires a database ending in _test.");
  if (apply && (typeof password !== "string" || password.length < 32))
    fail("INVENTORY_RUNTIME_PASSWORD must contain at least 32 characters for apply.");
  if (apply && decodeURIComponent(runtime.password) !== password)
    fail("Runtime URL and supplied password must agree.");
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT current_user AS actor, current_database() AS database",
    );
    const record = await client.query(
      "SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname=$1",
      [role],
    );
    if (!record.rowCount && !apply)
      fail("Runtime role does not exist; run explicit --apply first.");
    if (record.rowCount) {
      const r = record.rows[0];
      if (!r.rolcanlogin) fail("Existing runtime role must allow login.");
      if (r.rolsuper || r.rolcreatedb || r.rolcreaterole || r.rolreplication || r.rolbypassrls)
        fail("Existing runtime role has elevated attributes; resolve manually.");
      const members = await client.query("SELECT 1 FROM pg_auth_members WHERE member=$1 LIMIT 1", [
        r.oid,
      ]);
      if (members.rowCount) fail("Runtime role must not inherit or assume other roles.");
      const owned = await client.query(
        "SELECT 1 FROM pg_class WHERE relowner=$1 UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner=$1 UNION ALL SELECT 1 FROM pg_database WHERE datdba=$1 UNION ALL SELECT 1 FROM pg_proc WHERE proowner=$1 LIMIT 1",
        [r.oid],
      );
      if (owned.rowCount)
        fail("Runtime role owns database objects; transfer ownership administratively first.");
    } else {
      await client.query(
        `CREATE ROLE ${identifier(role)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)}`,
      );
    }
    const tables = await client.query(
      `SELECT c.relname, EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND p.proname='inventory_reject_history_change' AND (t.tgtype::int & 8)<>0 AND (t.tgtype::int & 16)<>0) AS append_only FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'inventory\\_%' ESCAPE '\\'`,
    );
    if (!tables.rowCount) fail("No migrated inventory tables found.");
    if (apply) {
      await client.query(
        `GRANT CONNECT ON DATABASE ${identifier(current.rows[0].database)} TO ${identifier(role)}`,
      );
      await client.query(`GRANT USAGE ON SCHEMA public TO ${identifier(role)}`);
      await client.query(`REVOKE CREATE ON SCHEMA public FROM ${identifier(role)}`);
      for (const table of tables.rows) {
        const name = `public.${identifier(table.relname)}`;
        await client.query(`REVOKE ALL ON TABLE ${name} FROM ${identifier(role)}`);
        await client.query(
          `GRANT ${table.append_only ? "SELECT, INSERT" : "SELECT, INSERT, UPDATE, DELETE"} ON TABLE ${name} TO ${identifier(role)}`,
        );
      }
      const sequences = await client.query(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' AND c.relname LIKE 'inventory\\_%' ESCAPE '\\'",
      );
      for (const sequence of sequences.rows)
        await client.query(
          `GRANT USAGE, SELECT ON SEQUENCE public.${identifier(sequence.relname)} TO ${identifier(role)}`,
        );
    }
    const schema = await client.query(
      "SELECT has_schema_privilege($1,'public','CREATE') AS can_create",
      [role],
    );
    if (schema.rows[0].can_create)
      fail(
        "Runtime can CREATE in public (possibly through PUBLIC). Restrict schema grants administratively; no shared grants were changed.",
      );
    const bypass = await client.query(
      "SELECT has_parameter_privilege($1,'session_replication_role','SET') AS replica, has_database_privilege($1,current_database(),'CREATE') AS database_create",
      [role],
    );
    if (bypass.rows[0].replica || bypass.rows[0].database_create)
      fail(
        "Runtime can bypass triggers or create schemas; resolve parameter/database grants administratively.",
      );
    const definer = await client.query(
      "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND p.prosecdef AND has_function_privilege($1,p.oid,'EXECUTE') LIMIT 1",
      [role],
    );
    if (definer.rowCount)
      fail(
        "Runtime can execute a SECURITY DEFINER function; review/restrict it administratively first.",
      );
    for (const table of tables.rows) {
      const privileges = await client.query(
        "SELECT has_table_privilege($1,$2,'TRUNCATE') AS truncate, has_table_privilege($1,$2,'TRIGGER') AS trigger, has_table_privilege($1,$2,'SELECT') AS read, has_table_privilege($1,$2,'INSERT') AS insert, has_table_privilege($1,$2,'UPDATE') AS update, has_table_privilege($1,$2,'DELETE') AS delete",
        [role, `public.${table.relname}`],
      );
      const p = privileges.rows[0];
      if (
        p.truncate ||
        p.trigger ||
        !p.read ||
        !p.insert ||
        (table.append_only && (p.update || p.delete)) ||
        (!table.append_only && (!p.update || !p.delete))
      )
        fail("Runtime table privileges are unsafe or incomplete.");
    }
    const migration = await client.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname='__drizzle_migrations' AND (has_table_privilege($1,c.oid,'INSERT') OR has_table_privilege($1,c.oid,'UPDATE') OR has_table_privilege($1,c.oid,'DELETE') OR has_table_privilege($1,c.oid,'TRUNCATE')) LIMIT 1",
      [role],
    );
    if (migration.rowCount) fail("Runtime must not write migration history.");
    await client.query("COMMIT");
    return {
      applied: apply,
      tables: tables.rowCount,
      appendOnlyTables: tables.rows.filter((t) => t.append_only).length,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply"),
    check = args.includes("--check");
  const index = args.indexOf("--role");
  if (
    apply === check ||
    args.some(
      (a, i) => !["--apply", "--check", "--role"].includes(a) && !(index >= 0 && i === index + 1),
    )
  ) {
    console.error(
      "Usage: node scripts/provision-runtime-role.mjs --check|--apply [--role allik_runtime]",
    );
    process.exitCode = 1;
  } else {
    provisionRuntimeRole({
      adminUrl: process.env.DATABASE_ADMIN_URL,
      runtimeUrl: process.env.DATABASE_URL,
      environment: process.env.INVENTORY_ENVIRONMENT,
      password: process.env.INVENTORY_RUNTIME_PASSWORD,
      role: index < 0 ? "allik_runtime" : args[index + 1],
      apply,
    })
      .then((result) => console.log(JSON.stringify(result)))
      // Never print pg messages or URL/password-bearing configuration.
      .catch(() => {
        console.error(
          "Runtime provisioning/check failed. Inspect role ownership, membership, schema and table grants using the maintenance account. No credentials were logged.",
        );
        process.exitCode = 1;
      });
  }
}
