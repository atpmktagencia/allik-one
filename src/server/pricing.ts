import "@tanstack/react-start/server-only";
import { actor, authenticate, can } from "./auth";
import { getPool } from "./db";
import { doseInput, presentationInput } from "../data/pricing-input";
import { calculateDosePricing } from "../data/dose-pricing";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const optional = (value: string | null | undefined) => (value ? value : null);

type PresentationRow = {
  id: string;
  productId: string | null;
  name: string;
  baseUnit: string;
  totalBaseQuantity: string;
  totalVolumeMl: string | null;
  acquisitionCost: string;
  technicalLossPercent: string;
  additionalPresentationCost: string;
  minimumMeasurableVolumeMl: string | null;
  beyondUseHours: number | null;
  active: boolean;
  version: number;
};
type DoseRow = {
  id: string;
  presentationId: string;
  name: string;
  doseQuantity: string;
  salePrice: string;
  materialCost: string;
  active: boolean;
  version: number;
};

function withCalculations(presentation: PresentationRow, doses: DoseRow[]) {
  return {
    ...presentation,
    concentrationPerMl:
      presentation.totalVolumeMl === null
        ? null
        : calculateDosePricing({
            ...presentation,
            doseQuantity: presentation.totalBaseQuantity,
            salePrice: "0",
            materialCost: "0",
          }).concentrationPerMl,
    doses: doses
      .filter((dose) => dose.presentationId === presentation.id)
      .map((dose) => ({
        ...dose,
        calculation: calculateDosePricing({ ...presentation, ...dose }),
      })),
  };
}

export async function pricingResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar a precificação." }, { status: 401, headers });
  if (!can(auth, "inventory.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });

  if (request.method === "GET") {
    const [presentations, doses, products, legacyPrices] = await Promise.all([
      getPool().query<PresentationRow>(
        `SELECT id,product_id AS "productId",name,base_unit AS "baseUnit",
          total_base_quantity::text AS "totalBaseQuantity",total_volume_ml::text AS "totalVolumeMl",
          acquisition_cost::text AS "acquisitionCost",technical_loss_percent::text AS "technicalLossPercent",
          additional_presentation_cost::text AS "additionalPresentationCost",
          minimum_measurable_volume_ml::text AS "minimumMeasurableVolumeMl",
          beyond_use_hours AS "beyondUseHours",active,version
         FROM inventory_pricing_presentations WHERE organization_id=$1 ORDER BY active DESC,name`,
        [auth.organizationId],
      ),
      getPool().query<DoseRow>(
        `SELECT d.id,d.presentation_id AS "presentationId",d.name,
          d.dose_quantity::text AS "doseQuantity",d.sale_price::text AS "salePrice",
          d.material_cost::text AS "materialCost",d.active,d.version
         FROM inventory_pricing_doses d JOIN inventory_pricing_presentations p ON p.id=d.presentation_id
         WHERE p.organization_id=$1 ORDER BY d.active DESC,d.dose_quantity,d.name`,
        [auth.organizationId],
      ),
      getPool().query(
        "SELECT id,name,sku FROM inventory_products WHERE organization_id=$1 AND active ORDER BY name",
        [auth.organizationId],
      ),
      getPool().query(
        `SELECT id,name,route,supplier,price::text AS price
         FROM inventory_sale_prices WHERE active ORDER BY route,name,supplier`,
      ),
    ]);
    return Response.json(
      {
        data: {
          presentations: presentations.rows.map((presentation) =>
            withCalculations(presentation, doses.rows),
          ),
          products: products.rows,
          legacyPrices: legacyPrices.rows,
          canManage: can(auth, "inventory.catalog.manage"),
        },
      },
      { headers },
    );
  }

  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (!can(auth, "inventory.catalog.manage"))
    return Response.json(
      { error: "Sem permissão para alterar a precificação." },
      { status: 403, headers },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = presentationInput.safeParse(body);
  const parsedDose = doseInput.safeParse(body);
  if (!parsed.success && !parsedDose.success)
    return Response.json({ error: "Confira os campos da precificação." }, { status: 400, headers });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (parsed.success) {
      const input = parsed.data;
      if (input.productId) {
        const product = await client.query(
          "SELECT id FROM inventory_products WHERE id=$1 AND organization_id=$2 AND active",
          [input.productId, auth.organizationId],
        );
        if (!product.rowCount) {
          await client.query("ROLLBACK");
          return Response.json(
            { error: "Produto inválido para esta organização." },
            { status: 400, headers },
          );
        }
      }
      const values = [
        input.productId || null,
        input.name,
        input.baseUnit,
        input.totalBaseQuantity,
        optional(input.totalVolumeMl),
        input.acquisitionCost,
        input.technicalLossPercent,
        input.additionalPresentationCost,
        optional(input.minimumMeasurableVolumeMl),
        input.beyondUseHours ?? null,
        input.active,
      ];
      let before: unknown = null;
      let result;
      if (input.action === "CREATE_PRESENTATION") {
        result = await client.query(
          `INSERT INTO inventory_pricing_presentations(
             id,organization_id,product_id,name,base_unit,total_base_quantity,total_volume_ml,
             acquisition_cost,technical_loss_percent,additional_presentation_cost,
             minimum_measurable_volume_ml,beyond_use_hours,active,created_by_user_id
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [input.id, auth.organizationId, ...values, auth.user.id],
        );
      } else {
        const current = await client.query(
          "SELECT * FROM inventory_pricing_presentations WHERE id=$1 AND organization_id=$2 FOR UPDATE",
          [input.id, auth.organizationId],
        );
        if (!current.rowCount || current.rows[0].version !== input.version) {
          await client.query("ROLLBACK");
          return Response.json(
            { error: "A apresentação mudou. Recarregue e tente novamente." },
            { status: 409, headers },
          );
        }
        before = current.rows[0];
        result = await client.query(
          `UPDATE inventory_pricing_presentations SET
             product_id=$3,name=$4,base_unit=$5,total_base_quantity=$6,total_volume_ml=$7,
             acquisition_cost=$8,technical_loss_percent=$9,additional_presentation_cost=$10,
             minimum_measurable_volume_ml=$11,beyond_use_hours=$12,active=$13,
             version=version+1,updated_at=now()
           WHERE id=$1 AND organization_id=$2 RETURNING *`,
          [input.id, auth.organizationId, ...values],
        );
      }
      await client.query(
        `INSERT INTO inventory_pricing_changes(
           organization_id,presentation_id,action,before_data,after_data,reason,actor,actor_user_id
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          auth.organizationId,
          input.id,
          input.action,
          before,
          result.rows[0],
          input.reason,
          actor(auth).name,
          actor(auth).userId,
        ],
      );
      await client.query("COMMIT");
      return Response.json(
        { data: { id: input.id } },
        { status: input.action === "CREATE_PRESENTATION" ? 201 : 200, headers },
      );
    }

    const input = parsedDose.data!;
    const presentation = await client.query(
      "SELECT id FROM inventory_pricing_presentations WHERE id=$1 AND organization_id=$2 AND active FOR UPDATE",
      [input.presentationId, auth.organizationId],
    );
    if (!presentation.rowCount) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Apresentação inválida." }, { status: 400, headers });
    }
    let before: unknown = null;
    let result;
    if (input.action === "CREATE_DOSE") {
      result = await client.query(
        `INSERT INTO inventory_pricing_doses(id,presentation_id,name,dose_quantity,sale_price,material_cost,active)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.id,
          input.presentationId,
          input.name,
          input.doseQuantity,
          input.salePrice,
          input.materialCost,
          input.active,
        ],
      );
    } else {
      const current = await client.query(
        "SELECT * FROM inventory_pricing_doses WHERE id=$1 AND presentation_id=$2 FOR UPDATE",
        [input.id, input.presentationId],
      );
      if (!current.rowCount || current.rows[0].version !== input.version) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "A dose mudou. Recarregue e tente novamente." },
          { status: 409, headers },
        );
      }
      before = current.rows[0];
      result = await client.query(
        `UPDATE inventory_pricing_doses SET name=$3,dose_quantity=$4,sale_price=$5,material_cost=$6,
          active=$7,version=version+1,updated_at=now() WHERE id=$1 AND presentation_id=$2 RETURNING *`,
        [
          input.id,
          input.presentationId,
          input.name,
          input.doseQuantity,
          input.salePrice,
          input.materialCost,
          input.active,
        ],
      );
    }
    await client.query(
      `INSERT INTO inventory_pricing_changes(
         organization_id,presentation_id,dose_id,action,before_data,after_data,reason,actor,actor_user_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        auth.organizationId,
        input.presentationId,
        input.id,
        input.action,
        before,
        result.rows[0],
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.id } },
      { status: input.action === "CREATE_DOSE" ? 201 : 200, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return Response.json(
      {
        error:
          code === "23505"
            ? "Já existe um cadastro com este nome."
            : "Não foi possível salvar a precificação.",
      },
      { status: code === "23505" ? 409 : 503, headers },
    );
  } finally {
    client.release();
  }
}
