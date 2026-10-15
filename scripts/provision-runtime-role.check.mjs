import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { provisionRuntimeRole } from "./provision-runtime-role.mjs";

const databaseUrl = process.env.DATABASE_ADMIN_URL;
test(
  "runtime role rejects ownership bypasses while allowing transactional writes",
  { skip: !databaseUrl },
  async () => {
    const url = new URL(databaseUrl);
    assert.ok(
      decodeURIComponent(url.pathname).endsWith("_test"),
      "Disposable _test database required",
    );
    const role = `allik_runtime_${randomBytes(6).toString("hex")}`;
    const password = randomBytes(32).toString("hex");
    const runtime = new URL(url);
    runtime.username = role;
    runtime.password = password;
    const owner = new Client({ connectionString: databaseUrl });
    await owner.connect();
    const table = `inventory_runtime_probe_${randomBytes(6).toString("hex")}`;
    const history = `${table}_history`;
    let app;
    try {
      await owner.query(
        `CREATE TABLE public.${table} (id integer PRIMARY KEY, quantity integer NOT NULL CHECK(quantity>=0))`,
      );
      await owner.query(
        `CREATE TABLE public.${history} (id integer PRIMARY KEY, quantity integer NOT NULL CHECK(quantity>=0))`,
      );
      await owner.query(
        `CREATE TRIGGER probe_history_immutable BEFORE UPDATE OR DELETE ON public.${history} FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change()`,
      );
      const options = {
        adminUrl: databaseUrl,
        runtimeUrl: runtime.href,
        role,
        password,
        environment: "test",
      };
      await provisionRuntimeRole({ ...options, apply: true });
      await provisionRuntimeRole({ ...options, apply: true });
      await provisionRuntimeRole({ ...options, apply: false });
      app = new Client({ connectionString: runtime.href });
      await app.connect();
      await app.query("BEGIN");
      await app.query(`INSERT INTO public.${table} VALUES (1,10)`);
      await app.query(`INSERT INTO public.${history} VALUES (1,10)`);
      await app.query(`UPDATE public.${table} SET quantity=quantity-2 WHERE id=1`);
      await app.query("COMMIT");
      assert.equal((await app.query(`SELECT quantity FROM public.${table}`)).rows[0].quantity, 8);
      for (const sql of [
        `TRUNCATE public.${table}`,
        `ALTER TABLE public.${table} DISABLE TRIGGER ALL`,
        `ALTER TABLE public.${table} ADD COLUMN bypass integer`,
        `CREATE TABLE public.${table}_forbidden(id integer)`,
        `UPDATE public.${history} SET quantity=0`,
        `DELETE FROM public.${history}`,
        "SET session_replication_role=replica",
      ])
        await assert.rejects(app.query(sql), (error) => error.code === "42501");
      await app.query("BEGIN");
      await assert.rejects(
        app.query(`UPDATE public.${table} SET quantity=-1 WHERE id=1`),
        (error) => error.code === "23514",
      );
      await app.query("ROLLBACK");
      assert.equal((await app.query(`SELECT quantity FROM public.${table}`)).rows[0].quantity, 8);
      await owner.query(`GRANT SET ON PARAMETER session_replication_role TO ${role}`);
      await assert.rejects(provisionRuntimeRole({ ...options, apply: false }), /bypass triggers/);
      await owner.query(`REVOKE SET ON PARAMETER session_replication_role FROM ${role}`);
    } finally {
      if (app) await app.end();
      await owner.query(`DROP TABLE IF EXISTS public.${history},public.${table}`);
      await owner.query(`DROP OWNED BY ${role}`).catch(() => {});
      await owner.query(`DROP ROLE IF EXISTS ${role}`);
      await owner.end();
    }
  },
);

test("provisioning refuses ambiguous or unsafe environments before connecting", async () => {
  await assert.rejects(
    provisionRuntimeRole({ environment: "", adminUrl: "invalid", runtimeUrl: "invalid" }),
  );
  await assert.rejects(
    provisionRuntimeRole({
      environment: "test",
      adminUrl: "postgres://owner:secret@localhost/live",
      runtimeUrl: "postgres://allik_runtime:secret@localhost/live",
      apply: true,
      password: "x".repeat(32),
    }),
  );
});
