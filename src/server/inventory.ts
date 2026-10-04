import "@tanstack/react-start/server-only";
import { getPool } from "./db";
import { hasPreviewSession } from "./auth";
import { z } from "zod";
const filters = z.object({
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  search: z.string().max(100).default(""),
});
export async function inventoryResponse(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!hasPreviewSession(request))
    return Response.json(
      { error: "Entre para acessar o estoque de demonstração." },
      { status: 401, headers },
    );
  const url = new URL(request.url);
  const parsed = filters.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success)
    return Response.json({ error: "Filtros inválidos." }, { status: 400, headers });
  const path = url.pathname.replace(/^\/api\/v1\/inventory\//, "").replace(/\/$/, "");
  const detailId = path.startsWith("products/") ? path.slice("products/".length) : undefined;
  if (detailId && !z.string().uuid().safeParse(detailId).success)
    return Response.json({ error: "Produto não encontrado." }, { status: 404, headers });
  if (!["products", "locations", "lots", "stock", "movements"].includes(path) && !detailId)
    return Response.json({ error: "Recurso não encontrado." }, { status: 404, headers });
  try {
    const pool = getPool();
    if (path === "locations") {
      const result = await pool.query(
        "SELECT id, name FROM inventory_locations WHERE active ORDER BY name",
      );
      return Response.json({ data: result.rows }, { headers });
    }
    if (path === "products" || detailId) {
      const result = await pool.query(
        'SELECT id, name, sku, category, unit, active, stock_controlled AS "stockControlled", minimum::float8 AS minimum FROM inventory_products WHERE ($1::uuid IS NULL OR id = $1) AND name ILIKE $2 ORDER BY name',
        [detailId ?? null, `%${parsed.data.search}%`],
      );
      if (detailId && !result.rows.length)
        return Response.json({ error: "Produto não encontrado." }, { status: 404, headers });
      return Response.json({ data: detailId ? result.rows[0] : result.rows }, { headers });
    }
    const params = [
      parsed.data.productId ?? null,
      parsed.data.locationId ?? null,
      `%${parsed.data.search}%`,
    ];
    if (path === "movements") {
      const result = await pool.query(
        `SELECT m.id, m.lot_id AS "lotId", p.id AS "productId", m.created_at AS date, m.type, p.name AS product, l.number AS lot,
        loc.name AS location, m.delta::float8 AS quantity, m.actor AS responsible, m.reference, m.reason,
        o.id AS "operationId", source.name AS origin, destination.name AS destination
        FROM inventory_movements m JOIN inventory_lots l ON l.id=m.lot_id JOIN inventory_products p ON p.id=l.product_id JOIN inventory_locations loc ON loc.id=m.location_id
        LEFT JOIN inventory_operation_movements om ON om.movement_id=m.id LEFT JOIN inventory_operations o ON o.id=om.operation_id
        LEFT JOIN inventory_locations source ON source.id=o.source_id LEFT JOIN inventory_locations destination ON destination.id=o.destination_id
        WHERE ($1::uuid IS NULL OR p.id=$1) AND ($2::uuid IS NULL OR loc.id=$2)
        AND (p.name ILIKE $3 OR l.number ILIKE $3 OR m.reference ILIKE $3 OR m.actor ILIKE $3 OR m.reason ILIKE $3)
        ORDER BY m.created_at DESC, m.id LIMIT 200`,
        params,
      );
      return Response.json({ data: result.rows }, { headers });
    }
    const result = await pool.query(
      `SELECT b.id, p.id AS "productId", p.name, p.category, p.unit, p.minimum::float8 AS minimum, p.active,
      l.id AS "lotId", l.number AS lot, l.expires_on::text AS expiry, l.supplier, l.unit_cost::float8 AS cost,
      CASE WHEN l.expires_on < (NOW() AT TIME ZONE 'America/Fortaleza')::date THEN 'EXPIRED' ELSE l.status END AS status,
      b.quantity::float8 AS quantity, loc.id AS "locationId", loc.name AS location,
      (l.expires_on >= (NOW() AT TIME ZONE 'America/Fortaleza')::date AND l.expires_on <= (NOW() AT TIME ZONE 'America/Fortaleza')::date + 30) AS "expiringSoon"
      FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id JOIN inventory_products p ON p.id=l.product_id JOIN inventory_locations loc ON loc.id=b.location_id
      WHERE p.stock_controlled AND ($1::uuid IS NULL OR p.id=$1) AND ($2::uuid IS NULL OR loc.id=$2)
      AND (p.name ILIKE $3 OR l.number ILIKE $3 OR l.supplier ILIKE $3)
      ORDER BY p.name, l.expires_on, l.id, loc.name`,
      params,
    );
    return Response.json({ data: result.rows }, { headers });
  } catch (error) {
    // Never expose SQL, connection strings or database errors to the browser.
    console.error("Inventory query failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json(
      { error: "Não foi possível consultar o estoque. Verifique a configuração do ambiente." },
      { status: 503, headers },
    );
  }
}
