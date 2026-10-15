import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { actor, authenticate, can, canAccessLocations } from "./auth";
import { getPool } from "./db";
import {
  locationCatalogInput,
  productCatalogInput,
  type CatalogSnapshot,
} from "../data/catalog-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const productColumns =
  'id,name,sku,category,unit,minimum::text,active,stock_controlled AS "stockControlled",version';
const locationColumns = 'id,unit_id AS "unitId",name,active,version';
class CatalogConflict extends Error {}
class CatalogMissing extends Error {}
type ProductInput = z.infer<typeof productCatalogInput>;
type LocationInput = z.infer<typeof locationCatalogInput>;
function isProductInput(input: ProductInput | LocationInput): input is ProductInput {
  return "category" in input;
}

export async function catalogResponse(
  request: Request,
  resource: "products" | "locations" | "history",
) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar os cadastros." }, { status: 401, headers });
  if (!can(auth, request.method === "GET" ? "inventory.read" : "inventory.catalog.manage"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (request.method !== "GET" && request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (resource === "history" && request.method !== "GET")
    return Response.json({ error: "O histórico é somente de consulta." }, { status: 405, headers });
  let client: PoolClient | undefined;
  try {
    const isProduct = resource === "products";
    // SQL identifiers come only from these fixed branches, never from request data.
    const table = isProduct ? "inventory_products" : "inventory_locations";
    const columns = isProduct ? productColumns : locationColumns;
    if (request.method === "GET") {
      if (resource === "history") {
        const params = new URL(request.url).searchParams;
        const parsed = z
          .object({ resource: z.enum(["PRODUCT", "LOCATION"]), itemId: z.string().uuid() })
          .safeParse({ resource: params.get("resource"), itemId: params.get("itemId") });
        if (!parsed.success)
          return Response.json(
            { error: "Informe o cadastro para consultar o histórico." },
            { status: 400, headers },
          );
        if (
          parsed.data.resource === "LOCATION" &&
          !(await canAccessLocations(auth, [parsed.data.itemId]))
        )
          return Response.json({ error: "Local não autorizado." }, { status: 403, headers });
        const column = parsed.data.resource === "PRODUCT" ? "product_id" : "location_id";
        const result = await getPool().query(
          `SELECT id,action,actor,reason,created_at AS date,before_data AS before,after_data AS after
           FROM inventory_catalog_changes WHERE ${column}=$1 ORDER BY created_at DESC,id DESC LIMIT 50`,
          [parsed.data.itemId],
        );
        return Response.json({ data: result.rows }, { headers });
      }
      const result = isProduct
        ? await getPool().query(
            `SELECT ${columns} FROM inventory_products WHERE organization_id=$1 ORDER BY name,id`,
            [auth.organizationId],
          )
        : await getPool().query(
            `SELECT ${columns} FROM inventory_locations WHERE unit_id=ANY($1::uuid[]) OR $2::boolean ORDER BY name,id`,
            [auth.unitIds, auth.preview || auth.role === "SUPER_ADMIN"],
          );
      return Response.json({ data: result.rows }, { headers });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
    }
    const parsed = isProduct
      ? productCatalogInput.safeParse(body)
      : locationCatalogInput.safeParse(body);
    if (!parsed.success)
      return Response.json(
        {
          error:
            "Confira os campos do cadastro. Para editar, informe um motivo de pelo menos 10 caracteres.",
        },
        { status: 400, headers },
      );
    const input: ProductInput | LocationInput = parsed.data;
    if (
      !isProductInput(input) &&
      input.action === "UPDATE" &&
      !(await canAccessLocations(auth, [input.id]))
    )
      return Response.json({ error: "Local não autorizado." }, { status: 403, headers });
    const hash = createHash("sha256").update(JSON.stringify({ resource, input })).digest("hex");
    client = await getPool().connect();
    await client.query("BEGIN");
    // Serialize retries before locking the record; keep the original audit result after later edits.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `catalog:${input.operationId}`,
    ]);
    const previous = await client.query(
      "SELECT request_hash,after_data FROM inventory_catalog_changes WHERE id=$1",
      [input.operationId],
    );
    if (previous.rowCount) {
      if (previous.rows[0].request_hash !== hash)
        throw new CatalogConflict("Esta alteração já foi enviada com outros dados.");
      await client.query("COMMIT");
      return Response.json(
        { data: { item: previous.rows[0].after_data, replayed: true } },
        { headers },
      );
    }
    let before: CatalogSnapshot | null = null;
    let after: CatalogSnapshot;
    if (input.action === "CREATE") {
      const requestedUnitId = !isProductInput(input)
        ? (input.unitId ?? new URL(request.url).searchParams.get("unitId") ?? undefined)
        : undefined;
      const unitId =
        requestedUnitId ??
        (auth.unitIds.length === 1
          ? auth.unitIds[0]
          : auth.preview
            ? "a1100000-0000-4000-8000-000000000102"
            : undefined);
      if (!isProductInput(input) && (!unitId || !can(auth, "inventory.catalog.manage", unitId)))
        throw new CatalogConflict("Selecione uma unidade autorizada para o novo local.");
      const created = isProductInput(input)
        ? await client.query(
            `INSERT INTO inventory_products(id,organization_id,name,sku,category,unit,minimum) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${productColumns}`,
            [
              input.id,
              auth.organizationId,
              input.name,
              input.sku,
              input.category,
              input.unit,
              input.minimum,
            ],
          )
        : await client.query(
            `INSERT INTO inventory_locations(id,unit_id,name) VALUES($1,$2,$3) RETURNING ${locationColumns}`,
            [input.id, unitId, input.name],
          );
      after = created.rows[0];
    } else {
      const current = await client.query(`SELECT ${columns} FROM ${table} WHERE id=$1 FOR UPDATE`, [
        input.id,
      ]);
      if (!current.rowCount) throw new CatalogMissing("Cadastro não encontrado.");
      before = current.rows[0] as CatalogSnapshot;
      if (before.version !== input.version)
        throw new CatalogConflict(
          "O cadastro mudou desde a consulta. Feche a edição, atualize os cadastros e confira novamente.",
        );
      if (!input.active && before.active) {
        const busy = isProduct
          ? await client.query(
              `SELECT EXISTS(SELECT 1 FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id WHERE l.product_id=$1 AND b.quantity>0) AS stocked,
             EXISTS(SELECT 1 FROM inventory_purchase_items WHERE product_id=$1 AND received<quantity) AS pending`,
              [input.id],
            )
          : await client.query(
              "SELECT EXISTS(SELECT 1 FROM inventory_balances WHERE location_id=$1 AND quantity>0) AS stocked",
              [input.id],
            );
        if (busy.rows[0].stocked)
          throw new CatalogConflict(
            "Ainda há saldo físico neste cadastro. Transfira ou confira o estoque antes de desativar.",
          );
        if (busy.rows[0].pending)
          throw new CatalogConflict(
            "Este produto tem pedidos com recebimento pendente. Conclua as entregas antes de desativar.",
          );
      }
      const unchanged =
        before.name === input.name &&
        before.active === input.active &&
        (!isProductInput(input) ||
          ("category" in before &&
            before.category === input.category &&
            before.minimum === input.minimum));
      if (unchanged) throw new CatalogConflict("Nenhum campo do cadastro foi alterado.");
      const updated = isProductInput(input)
        ? await client.query(
            `UPDATE inventory_products SET name=$2,category=$3,minimum=$4,active=$5,version=version+1 WHERE id=$1 RETURNING ${productColumns}`,
            [input.id, input.name, input.category, input.minimum, input.active],
          )
        : await client.query(
            `UPDATE inventory_locations SET name=$2,active=$3,version=version+1 WHERE id=$1 RETURNING ${locationColumns}`,
            [input.id, input.name, input.active],
          );
      after = updated.rows[0];
    }
    await client.query(
      `INSERT INTO inventory_catalog_changes(id,product_id,location_id,action,request_hash,before_data,after_data,actor,actor_user_id,reason)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
      [
        input.operationId,
        isProduct ? input.id : null,
        isProduct ? null : input.id,
        input.action,
        hash,
        before ? JSON.stringify(before) : null,
        JSON.stringify(after),
        actor(auth).name,
        actor(auth).userId,
        input.action === "CREATE" ? "Cadastro inicial" : input.reason,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { item: after, replayed: false } },
      { status: input.action === "CREATE" ? 201 : 200, headers },
    );
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof CatalogConflict || error instanceof CatalogMissing)
      return Response.json(
        { error: error.message },
        { status: error instanceof CatalogMissing ? 404 : 409, headers },
      );
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "23505")
      return Response.json(
        {
          error:
            resource === "products"
              ? "Este SKU ou identificador já está cadastrado."
              : "Este nome ou identificador de local já está cadastrado.",
        },
        { status: 409, headers },
      );
    if (code === "40P01")
      return Response.json(
        { error: "Outra operação alterou o cadastro. Atualize os dados e tente novamente." },
        { status: 409, headers },
      );
    return Response.json(
      { error: "Não foi possível confirmar a alteração. Tente novamente com os mesmos dados." },
      { status: 503, headers },
    );
  } finally {
    client?.release();
  }
}
