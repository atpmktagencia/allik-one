import "@tanstack/react-start/server-only";
import { authenticate, can } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const allowedHorizons = new Set([7, 30, 60, 90]);
const allowedLeadDays = new Set([3, 7, 14, 21]);
type Dose = { scheduledOn: string; quantity: string };
type OpenContainer = { quantity: string; usableThrough: string };
type PhysicalLot = { quantity: string; expiresOn: string };

function datePlus(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function presentationsForDemand(
  doses: Dose[],
  containers: OpenContainer[],
  usablePerPresentation: number,
  beyondUseHours: number | null,
) {
  const daily = new Map<string, number>();
  for (const dose of doses)
    daily.set(dose.scheduledOn, (daily.get(dose.scheduledOn) ?? 0) + Number(dose.quantity));
  const available = containers.map((container) => ({
    quantity: Number(container.quantity),
    usableThrough: container.usableThrough,
  }));
  const reuseDays = beyondUseHours ? Math.max(0, Math.floor(beyondUseHours / 24) - 1) : 0;
  let presentations = 0;
  const cumulative: Array<{ scheduledOn: string; presentations: number }> = [];
  for (const [scheduledOn, quantity] of [...daily.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let remaining = quantity;
    for (const container of available) {
      if (remaining <= 0) break;
      if (container.quantity <= 0 || container.usableThrough < scheduledOn) continue;
      const used = Math.min(remaining, container.quantity);
      container.quantity -= used;
      remaining -= used;
    }
    while (remaining > 0.0000001) {
      presentations += 1;
      const used = Math.min(remaining, usablePerPresentation);
      remaining -= used;
      const leftover = usablePerPresentation - used;
      if (leftover > 0.0000001)
        available.push({ quantity: leftover, usableThrough: datePlus(scheduledOn, reuseDays) });
    }
    cumulative.push({ scheduledOn, presentations });
  }
  return { presentations, cumulative };
}

export function shortagesForOpenings(
  cumulative: Array<{ scheduledOn: string; presentations: number }>,
  lots: PhysicalLot[],
) {
  const available = lots
    .map((lot) => ({ quantity: Number(lot.quantity), expiresOn: lot.expiresOn }))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  let previousRequired = 0;
  let shortageUnits = 0;
  let firstShortageOn: string | null = null;
  for (const point of cumulative) {
    let needed = point.presentations - previousRequired;
    previousRequired = point.presentations;
    for (const lot of available) {
      if (needed <= 0) break;
      if (lot.quantity <= 0 || lot.expiresOn < point.scheduledOn) continue;
      const used = Math.min(needed, lot.quantity);
      lot.quantity -= used;
      needed -= used;
    }
    if (needed > 0) {
      shortageUnits += needed;
      firstShortageOn ??= point.scheduledOn;
    }
  }
  return { shortageUnits, firstShortageOn };
}

export async function patientPurchaseNeedsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json(
      { error: "Entre para acessar a necessidade de compra." },
      { status: 401, headers },
    );
  if (!can(auth, "inventory.purchase.manage"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  const url = new URL(request.url);
  const requestedUnit = url.searchParams.get("unitId");
  const horizon = Number(url.searchParams.get("horizon") ?? 30);
  const leadDays = Number(url.searchParams.get("leadDays") ?? 7);
  if (!allowedHorizons.has(horizon) || !allowedLeadDays.has(leadDays))
    return Response.json({ error: "Filtros de compra inválidos." }, { status: 400, headers });
  if (requestedUnit && !can(auth, "inventory.purchase.manage", requestedUnit))
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
  const unrestricted = auth.preview || auth.role === "SUPER_ADMIN" || auth.role === "PARTNER_ADMIN";
  const pool = getPool();
  const [demand, openStock] = await Promise.all([
    pool.query(
      `WITH physical AS (
         SELECT loc.unit_id,l.product_id,COALESCE(sum(b.quantity),0) AS units,
           jsonb_agg(jsonb_build_object('quantity',b.quantity,'expiresOn',l.expires_on)
             ORDER BY l.expires_on,l.id) AS lots
         FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id
         JOIN inventory_locations loc ON loc.id=b.location_id
         WHERE l.status='AVAILABLE' AND l.expires_on>=current_date AND b.quantity>0
         GROUP BY loc.unit_id,l.product_id
       ), pending AS (
         SELECT pu.unit_id,pi.product_id,COALESCE(sum(pi.quantity-pi.received),0) AS units
         FROM inventory_purchase_items pi JOIN inventory_purchases pu ON pu.id=pi.purchase_id
         WHERE pi.received<pi.quantity GROUP BY pu.unit_id,pi.product_id
       )
       SELECT s.unit_id AS "unitId",u.name AS "unitName",s.product_id AS "productId",
         p.name AS "productName",p.sku,upper(s.dose_unit) AS "doseUnit",
         count(*)::integer AS administrations,count(DISTINCT s.patient_id)::integer AS patients,
         jsonb_agg(jsonb_build_object('scheduledOn',s.scheduled_on,'quantity',s.dose_quantity)
           ORDER BY s.scheduled_on,s.sequence) AS doses,
         pp.name AS "presentationName",pp.total_base_quantity::text AS "totalBaseQuantity",
         pp.technical_loss_percent::text AS "technicalLossPercent",pp.beyond_use_hours AS "beyondUseHours",
         pp.acquisition_cost::text AS "acquisitionCost",COALESCE(ph.units,0)::text AS "physicalUnits",
         COALESCE(ph.lots,'[]'::jsonb) AS "physicalLots",
         COALESCE(po.units,0)::text AS "pendingUnits",sc.name AS "supplierName",
         sc.supplier_id AS "supplierId",sc.id AS "catalogItemId",sc.code AS "catalogCode",
         sc.price::text AS "catalogPrice"
       FROM inventory_patient_treatment_schedule s
       JOIN inventory_units u ON u.id=s.unit_id JOIN inventory_products p ON p.id=s.product_id
       LEFT JOIN physical ph ON ph.unit_id=s.unit_id AND ph.product_id=s.product_id
       LEFT JOIN pending po ON po.unit_id=s.unit_id AND po.product_id=s.product_id
       LEFT JOIN LATERAL (
         SELECT name,total_base_quantity,technical_loss_percent,beyond_use_hours,acquisition_cost
         FROM inventory_pricing_presentations WHERE organization_id=s.organization_id
           AND product_id=s.product_id AND active AND upper(base_unit)=upper(s.dose_unit)
         ORDER BY pricing_status DESC,updated_at DESC LIMIT 1
       ) pp ON true
       LEFT JOIN LATERAL (
         SELECT sup.name,cat.supplier_id,cat.id,cat.code,cat.price FROM inventory_supplier_catalog cat
         JOIN inventory_suppliers sup ON sup.id=cat.supplier_id
         WHERE cat.product_id=s.product_id AND cat.active AND sup.active
           AND sup.organization_id=s.organization_id
         ORDER BY (cat.price IS NULL),cat.price,cat.code LIMIT 1
       ) sc ON true
       WHERE s.organization_id=$1 AND s.status IN ('PLANNED','RESERVED')
         AND s.scheduled_on BETWEEN current_date AND current_date+($2::integer-1)
         AND ($3::uuid IS NULL OR s.unit_id=$3) AND ($4::boolean OR s.unit_id=ANY($5::uuid[]))
       GROUP BY s.unit_id,u.name,s.product_id,p.name,p.sku,upper(s.dose_unit),pp.name,
         pp.total_base_quantity,pp.technical_loss_percent,pp.beyond_use_hours,pp.acquisition_cost,
         ph.units,ph.lots,po.units,sc.name,sc.supplier_id,sc.id,sc.code,sc.price
       ORDER BY u.name,lower(p.name),upper(s.dose_unit)`,
      [auth.organizationId, horizon, requestedUnit, unrestricted, auth.unitIds],
    ),
    pool.query(
      `SELECT unit_id AS "unitId",product_id AS "productId",upper(base_unit) AS "baseUnit",
         jsonb_agg(jsonb_build_object('quantity',remaining_base_quantity,
           'usableThrough',((usable_until AT TIME ZONE 'America/Fortaleza')::date-1)::text)
           ORDER BY usable_until,id) AS containers
       FROM inventory_open_presentations
       WHERE organization_id=$1 AND status='OPEN' AND usable_until>now() AND remaining_base_quantity>0
         AND ($2::uuid IS NULL OR unit_id=$2) AND ($3::boolean OR unit_id=ANY($4::uuid[]))
       GROUP BY unit_id,product_id,upper(base_unit)`,
      [auth.organizationId, requestedUnit, unrestricted, auth.unitIds],
    ),
  ]);
  const items = demand.rows.map((row) => {
    const total = row.totalBaseQuantity === null ? null : Number(row.totalBaseQuantity);
    const loss = row.technicalLossPercent === null ? null : Number(row.technicalLossPercent);
    const usable = total === null || loss === null ? null : total * (1 - loss / 100);
    const containers = (openStock.rows.find(
      (open) =>
        open.unitId === row.unitId &&
        open.productId === row.productId &&
        open.baseUnit === row.doseUnit,
    )?.containers ?? []) as OpenContainer[];
    const calculation = usable
      ? presentationsForDemand(row.doses as Dose[], containers, usable, row.beyondUseHours)
      : null;
    const physicalUnits = Number(row.physicalUnits);
    const pendingUnits = Number(row.pendingUnits);
    const requiredUnits = calculation?.presentations ?? null;
    const shortage = calculation
      ? shortagesForOpenings(calculation.cumulative, row.physicalLots as PhysicalLot[])
      : null;
    const recommendedUnits = shortage?.shortageUnits ?? null;
    const netAfterPending =
      recommendedUnits === null ? null : Math.max(0, recommendedUnits - pendingUnits);
    const firstShortage = shortage?.firstShortageOn ?? null;
    return {
      ...row,
      doses: undefined,
      physicalLots: undefined,
      totalBaseQuantity: total,
      technicalLossPercent: loss,
      usablePerPresentation: usable,
      acquisitionCost: row.acquisitionCost === null ? null : Number(row.acquisitionCost),
      physicalUnits,
      pendingUnits,
      openQuantity: containers.reduce((sum, item) => sum + Number(item.quantity), 0),
      requiredUnits,
      recommendedUnits,
      netAfterPending,
      firstShortageOn: firstShortage,
      suggestedOrderBy: firstShortage ? datePlus(firstShortage, -leadDays) : null,
      estimatedCost:
        netAfterPending !== null && row.acquisitionCost !== null
          ? netAfterPending * Number(row.acquisitionCost)
          : null,
    };
  });
  return Response.json(
    {
      data: {
        horizon,
        leadDays,
        generatedOn: new Date().toISOString(),
        items,
        summary: {
          products: items.length,
          needingPurchase: items.filter(
            (item) => item.netAfterPending !== null && item.netAfterPending > 0,
          ).length,
          missingPresentation: items.filter((item) => item.requiredUnits === null).length,
          estimatedCost: items.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0),
        },
      },
    },
    { headers },
  );
}
