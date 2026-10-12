import "@tanstack/react-start/server-only";
import { authenticate, can, canAccessAllUnits } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const allowedHorizons = new Set([7, 30, 60, 90]);

type DemandRow = {
  unitId: string;
  unitName: string;
  productId: string;
  productName: string;
  sku: string;
  doseUnit: string;
  administrations: string;
  patients: string;
  plannedQuantity: string;
  reservedQuantity: string;
  firstScheduledOn: string;
  lastScheduledOn: string;
  presentationName: string | null;
  totalBaseQuantity: string | null;
  technicalLossPercent: string | null;
  totalVolumeMl: string | null;
  minimumMeasurableVolumeMl: string | null;
  beyondUseHours: number | null;
  scheduledDoses: Array<{ scheduledOn: string; quantity: string }>;
  availableStockUnits: string;
};

export async function patientDemandResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar a demanda." }, { status: 401, headers });
  if (!can(auth, "patients.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });

  const url = new URL(request.url);
  const requestedUnit = url.searchParams.get("unitId");
  const horizon = Number(url.searchParams.get("horizon") ?? 30);
  if (!allowedHorizons.has(horizon))
    return Response.json({ error: "Período inválido." }, { status: 400, headers });
  if (requestedUnit && !can(auth, "patients.read", requestedUnit))
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });

  const unrestricted = canAccessAllUnits(auth);
  const pool = getPool();
  const [demand, availableUnits, overview] = await Promise.all([
    pool.query<DemandRow>(
      `WITH physical_stock AS (
         SELECT loc.unit_id,l.product_id,COALESCE(sum(b.quantity),0) AS quantity
         FROM inventory_balances b
         JOIN inventory_lots l ON l.id=b.lot_id
         JOIN inventory_locations loc ON loc.id=b.location_id
         WHERE l.status='AVAILABLE' AND l.expires_on>=current_date
         GROUP BY loc.unit_id,l.product_id
       )
       SELECT s.unit_id AS "unitId",u.name AS "unitName",s.product_id AS "productId",
         p.name AS "productName",p.sku,upper(s.dose_unit) AS "doseUnit",
         count(*)::text AS administrations,count(DISTINCT s.patient_id)::text AS patients,
         COALESCE(sum(s.dose_quantity) FILTER (WHERE s.status='PLANNED'),0)::text AS "plannedQuantity",
         COALESCE(sum(s.dose_quantity) FILTER (WHERE s.status='RESERVED'),0)::text AS "reservedQuantity",
         min(s.scheduled_on)::text AS "firstScheduledOn",max(s.scheduled_on)::text AS "lastScheduledOn",
         pp.name AS "presentationName",pp.total_base_quantity::text AS "totalBaseQuantity",
         pp.technical_loss_percent::text AS "technicalLossPercent",
         pp.total_volume_ml::text AS "totalVolumeMl",
         pp.minimum_measurable_volume_ml::text AS "minimumMeasurableVolumeMl",
         pp.beyond_use_hours AS "beyondUseHours",
         jsonb_agg(jsonb_build_object('scheduledOn',s.scheduled_on,'quantity',s.dose_quantity)
           ORDER BY s.scheduled_on,s.sequence) AS "scheduledDoses",
         COALESCE(ps.quantity,0)::text AS "availableStockUnits"
       FROM inventory_patient_treatment_schedule s
       JOIN inventory_units u ON u.id=s.unit_id
       JOIN inventory_products p ON p.id=s.product_id
       LEFT JOIN physical_stock ps ON ps.unit_id=s.unit_id AND ps.product_id=s.product_id
       LEFT JOIN LATERAL (
         SELECT name,total_base_quantity,technical_loss_percent,total_volume_ml,
           minimum_measurable_volume_ml,beyond_use_hours
         FROM inventory_pricing_presentations
         WHERE organization_id=s.organization_id AND product_id=s.product_id AND active
           AND upper(base_unit)=upper(s.dose_unit)
         ORDER BY pricing_status DESC,updated_at DESC
         LIMIT 1
       ) pp ON true
       WHERE s.organization_id=$1
         AND s.status IN ('PLANNED','RESERVED')
         AND s.scheduled_on BETWEEN current_date AND current_date+($2::integer-1)
         AND ($3::uuid IS NULL OR s.unit_id=$3)
         AND ($4::boolean OR s.unit_id=ANY($5::uuid[]))
       GROUP BY s.unit_id,u.name,s.product_id,p.name,p.sku,upper(s.dose_unit),
         pp.name,pp.total_base_quantity,pp.technical_loss_percent,ps.quantity
         ,pp.total_volume_ml,pp.minimum_measurable_volume_ml,pp.beyond_use_hours
       ORDER BY u.name,MIN(s.scheduled_on),lower(p.name),upper(s.dose_unit)`,
      [auth.organizationId, horizon, requestedUnit, unrestricted, auth.unitIds],
    ),
    pool.query(
      `SELECT id,name FROM inventory_units
       WHERE organization_id=$1 AND active AND ($2::boolean OR id=ANY($3::uuid[]))
       ORDER BY name`,
      [auth.organizationId, unrestricted, auth.unitIds],
    ),
    pool.query<{ patients: string }>(
      `SELECT count(DISTINCT patient_id)::text AS patients
       FROM inventory_patient_treatment_schedule
       WHERE organization_id=$1 AND status IN ('PLANNED','RESERVED')
         AND scheduled_on BETWEEN current_date AND current_date+($2::integer-1)
         AND ($3::uuid IS NULL OR unit_id=$3)
         AND ($4::boolean OR unit_id=ANY($5::uuid[]))`,
      [auth.organizationId, horizon, requestedUnit, unrestricted, auth.unitIds],
    ),
  ]);

  const items = demand.rows.map((row) => {
    const plannedQuantity = Number(row.plannedQuantity);
    const reservedQuantity = Number(row.reservedQuantity);
    const demandQuantity = plannedQuantity + reservedQuantity;
    const totalBaseQuantity = row.totalBaseQuantity === null ? null : Number(row.totalBaseQuantity);
    const technicalLossPercent =
      row.technicalLossPercent === null ? null : Number(row.technicalLossPercent);
    const totalVolumeMl = row.totalVolumeMl === null ? null : Number(row.totalVolumeMl);
    const minimumMeasurableVolumeMl =
      row.minimumMeasurableVolumeMl === null ? null : Number(row.minimumMeasurableVolumeMl);
    const usablePerPresentation =
      totalBaseQuantity !== null && technicalLossPercent !== null
        ? totalBaseQuantity * (1 - technicalLossPercent / 100)
        : null;
    const dailyDemand = new Map<string, number>();
    for (const dose of row.scheduledDoses)
      dailyDemand.set(
        dose.scheduledOn,
        (dailyDemand.get(dose.scheduledOn) ?? 0) + Number(dose.quantity),
      );
    const requiredStockUnits =
      usablePerPresentation !== null && usablePerPresentation > 0
        ? [...dailyDemand.values()].reduce(
            (total, dailyQuantity) => total + Math.ceil(dailyQuantity / usablePerPresentation),
            0,
          )
        : null;
    const availableStockUnits = Number(row.availableStockUnits);
    const doseVolumeMl =
      totalBaseQuantity && totalVolumeMl
        ? (Math.min(...row.scheduledDoses.map((dose) => Number(dose.quantity))) /
            totalBaseQuantity) *
          totalVolumeMl
        : null;
    return {
      ...row,
      administrations: Number(row.administrations),
      patients: Number(row.patients),
      plannedQuantity,
      reservedQuantity,
      demandQuantity,
      totalBaseQuantity,
      technicalLossPercent,
      totalVolumeMl,
      minimumMeasurableVolumeMl,
      beyondUseHours: row.beyondUseHours,
      usablePerPresentation,
      doseVolumeMl,
      measurementWarning:
        doseVolumeMl !== null &&
        minimumMeasurableVolumeMl !== null &&
        doseVolumeMl < minimumMeasurableVolumeMl,
      requiredStockUnits,
      availableStockUnits,
      shortageStockUnits:
        requiredStockUnits === null ? null : Math.max(0, requiredStockUnits - availableStockUnits),
    };
  });
  return Response.json(
    {
      data: {
        horizon,
        generatedOn: new Date().toISOString(),
        units: availableUnits.rows,
        items,
        summary: {
          administrations: items.reduce((sum, item) => sum + item.administrations, 0),
          patients: Number(overview.rows[0]?.patients ?? 0),
          products: new Set(items.map((item) => `${item.unitId}:${item.productId}`)).size,
          itemsWithShortage: items.filter(
            (item) => item.shortageStockUnits !== null && item.shortageStockUnits > 0,
          ).length,
          itemsWithoutPresentation: items.filter((item) => item.requiredStockUnits === null).length,
        },
      },
    },
    { headers },
  );
}
