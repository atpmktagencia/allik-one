import "@tanstack/react-start/server-only";
import { authenticate, can } from "./auth";
import { getPool } from "./db";

export async function salePricesResponse(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const auth = await authenticate(request);
  if (!auth)
    return Response.json(
      { error: "Entre para acessar os valores de venda." },
      { status: 401, headers },
    );
  if (!can(auth, "inventory.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  try {
    const result = await getPool().query(
      `SELECT id,name,route,supplier,price::float8 AS price,source_file AS "sourceFile"
       FROM inventory_sale_prices WHERE active ORDER BY route,name,supplier`,
    );
    const source = await getPool().query(
      `SELECT price_source_file AS file,price_source_hash AS hash,created_at AS "importedAt",summary
       FROM inventory_import_batches ORDER BY created_at DESC LIMIT 1`,
    );
    return Response.json(
      { data: { prices: result.rows, source: source.rows[0] ?? null } },
      { headers },
    );
  } catch (error) {
    console.error("Sale prices query failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json(
      { error: "Não foi possível consultar os valores de venda." },
      { status: 503, headers },
    );
  }
}
