import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import { getDb, getPool } from "./db";

beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});

describe("application function search_path", () => {
  it("pins search_path on every inventory function so pg_temp is searched last", async () => {
    const unpinned = await getPool().query<{ name: string }>(
      `SELECT p.oid::regprocedure::text AS name
       FROM pg_proc p
       WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'inventory\\_%' ESCAPE '\\'
         AND NOT coalesce(p.proconfig,'{}'::text[]) @> ARRAY['search_path=pg_catalog, public, pg_temp']`,
    );
    expect(unpinned.rows).toEqual([]);
  });

  it("keeps ledger audit and balances in public tables even when a session shadows them", async () => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const product = await client.query(
        `INSERT INTO inventory_products(organization_id,name,sku,category,unit)
         VALUES('a1100000-0000-4000-8000-000000000001','Produto sombra',$1,'Material','un') RETURNING id`,
        [randomUUID()],
      );
      const location = await client.query(
        "INSERT INTO inventory_locations(unit_id,name) VALUES('a1100000-0000-4000-8000-000000000101',$1) RETURNING id",
        [`Local sombra ${randomUUID()}`],
      );
      const lot = await client.query(
        `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost)
         VALUES($1,$2,(NOW() AT TIME ZONE 'America/Fortaleza')::date + 90,'Fornecedor sintético',2) RETURNING id`,
        [product.rows[0].id, randomUUID()],
      );
      await client.query(
        "CREATE TEMP TABLE inventory_audit (LIKE public.inventory_audit INCLUDING DEFAULTS) ON COMMIT DROP",
      );
      await client.query(
        "CREATE TEMP TABLE inventory_balances (LIKE public.inventory_balances INCLUDING ALL) ON COMMIT DROP",
      );
      const movement = await client.query(
        `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key)
         VALUES($1,$2,'IN',5,'test-operator','TEST','Teste sintético de sombra',$3) RETURNING id`,
        [lot.rows[0].id, location.rows[0].id, randomUUID()],
      );
      const audit = await client.query(
        `SELECT (SELECT count(*) FROM public.inventory_audit WHERE movement_id=$1)::int AS real,
                (SELECT count(*) FROM pg_temp.inventory_audit WHERE movement_id=$1)::int AS shadow`,
        [movement.rows[0].id],
      );
      const balance = await client.query(
        `SELECT (SELECT count(*) FROM public.inventory_balances WHERE lot_id=$1)::int AS real,
                (SELECT count(*) FROM pg_temp.inventory_balances WHERE lot_id=$1)::int AS shadow`,
        [lot.rows[0].id],
      );
      expect(audit.rows[0]).toEqual({ real: 1, shadow: 0 });
      expect(balance.rows[0]).toEqual({ real: 1, shadow: 0 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
