import { describe, it, expect } from "vitest";
import { computePlanQuote, planQuoteInputSchema, type PlanQuoteInput } from "@/data/plan-quote";
const ids = Array.from(
  { length: 15 },
  (_, i) => `00000000-0000-4000-8000-${(i + 1).toString().padStart(12, "0")}`,
);
const [origin, product, unit, price, source, service, price2, map1, map2] = ids as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
function input(): PlanQuoteInput {
  return {
    plan: {
      startDate: "2026-10-19",
      previewDays: 3,
      items: [
        {
          id: origin,
          kind: "PRESCRIPTION",
          title: "Nome clínico confidencial",
          productId: product,
          catalogItemId: null,
          administrationUnit: "CAPSULE",
          optional: false,
          patientInstructions: "Orientação privada",
          stages: [
            {
              doseUnits: "1",
              frequencyPerDay: 1,
              everyDays: 1,
              durationDays: 3,
              weekdays: null,
              times: null,
            },
          ],
          dispense: null,
          package: null,
        },
      ],
    },
    unitId: unit,
    referenceDate: "2026-10-19",
    products: [{ id: product, name: "Produto comercial", active: true }],
    catalogItems: [],
    mappings: [],
    prices: [
      {
        id: price,
        unitId: unit,
        productId: product,
        catalogItemId: null,
        amount: "10.00",
        sellingUnit: "CAPSULE",
        source: "Tabela explícita",
        validFrom: "2026-10-01",
        validUntil: null,
        availability: "AVAILABLE",
        active: true,
        version: 1,
      },
    ],
    overrides: [],
    discountBps: 0,
  };
}
function mapped(): PlanQuoteInput {
  const v = input();
  v.plan.items[0]!.productId = null;
  v.plan.items[0]!.catalogItemId = source;
  v.catalogItems = [
    { id: source, name: "Ativo clínico", kind: "ACTIVE", active: true },
    { id: service, name: "Procedimento comercial", kind: "SERVICE", active: true },
  ];
  v.mappings = [
    {
      id: map1,
      sourceItemId: source,
      targetProductId: product,
      targetItemId: null,
      billingMode: "SEPARATE",
      chargeGroup: "G1",
      active: true,
    },
  ];
  return v;
}
const key = (i: PlanQuoteInput) => computePlanQuote(i).lines[0]!.candidateKey;
describe("Deterministic commercial plan estimates", () => {
  it("prices directexistingSKU only through explicitreference not clinical labels", () => {
    const p = input(),
      before = structuredClone(p),
      r = computePlanQuote(p);
    expect(r.total).toBe("30.00");
    expect(r.lines[0]).toMatchObject({
      quantity: "3",
      status: "RESOLVED",
      unitPrice: "10.00",
      priceId: price,
      priceVersion: 1,
    });
    expect(JSON.stringify(r)).not.toContain("Nome clínico confidencial");
    expect(JSON.stringify(r)).not.toContain("Orientação privada");
    expect(p).toEqual(before);
  });
  it("prefers explicit productdispensequantity andneverconverts packagecounts", () => {
    const p = input();
    p.plan.items[0]!.dispense = { quantity: "40", unit: "CAPSULE" };
    expect(computePlanQuote(p).total).toBe("400.00");
    p.prices[0]!.sellingUnit = "PACK";
    p.plan.items[0]!.package = { capacity: "20", unit: "CAPSULE" };
    const r = computePlanQuote(p);
    expect(r.complete).toBe(false);
    expect(r.total).toBeNull();
  });
  it("uses finiteadministration forservices ignoring pharmacydispensequantity", () => {
    const p = input();
    p.plan.items[0]!.productId = null;
    p.plan.items[0]!.catalogItemId = service;
    p.catalogItems = [{ id: service, name: "Consulta", kind: "SERVICE", active: true }];
    p.prices[0]!.productId = null;
    p.prices[0]!.catalogItemId = service;
    p.plan.items[0]!.dispense = { quantity: "40", unit: "CAPSULE" };
    expect(computePlanQuote(p).total).toBe("30.00");
  });
  it("keepsunmappedrequireditems partialwithknowntotals separatefromunknownamount", () => {
    const p = input();
    p.plan.items.push({ ...structuredClone(p.plan.items[0]!), id: ids[10]!, productId: null });
    const r = computePlanQuote(p);
    expect(r.knownSubtotal).toBe("30.00");
    expect(r.subtotal).toBeNull();
    expect(r.total).toBeNull();
    expect(r.lines[1]!.label).toBe("Item comercial sem vínculo");
  });
  it("neverdirectchargesACTIVEorMEDICATIONwithoutmapping", () => {
    const p = mapped();
    p.mappings = [];
    expect(computePlanQuote(p).lines[0]!.status).toBe("UNRESOLVED");
  });
  it("doesnotfallback to directsourcewhenexplicitmappinghasunknownprice", () => {
    const p = mapped();
    p.catalogItems[0]!.kind = "SERVICE";
    p.mappings[0]!.targetProductId = null;
    p.mappings[0]!.targetItemId = service;
    expect(computePlanQuote(p).complete).toBe(false);
    expect(computePlanQuote(p).lines).toHaveLength(1);
  });
  it("deduplicatessametypedtargetoriginandgroupbutnotdistinctclinicalorigins", () => {
    const p = mapped();
    p.mappings.push({ ...p.mappings[0]!, id: map2 });
    let r = computePlanQuote(p);
    expect(r.lines).toHaveLength(1);
    expect(r.total).toBe("30.00");
    expect(r.lines[0]!.mappingIds).toEqual([map1, map2]);
    p.plan.items.push({ ...structuredClone(p.plan.items[0]!), id: ids[10]! });
    r = computePlanQuote(p);
    expect(r.lines).toHaveLength(2);
    expect(r.total).toBe("60.00");
  });
  it("chargesdistinctseparatetargetsinthesamegroup independently", () => {
    const p = mapped();
    p.mappings.push({ ...p.mappings[0]!, id: map2, targetProductId: null, targetItemId: service });
    p.prices.push({
      ...p.prices[0]!,
      id: price2,
      productId: null,
      catalogItemId: service,
      amount: "5.00",
    });
    expect(computePlanQuote(p).total).toBe("45.00");
  });
  it("includesonlywithresolvedseparateanchorinsameoriginandgroup", () => {
    const p = mapped();
    p.mappings.push({
      ...p.mappings[0]!,
      id: map2,
      targetProductId: null,
      targetItemId: service,
      billingMode: "INCLUDED",
    });
    const r = computePlanQuote(p);
    expect(r.total).toBe("30.00");
    expect(r.lines[1]).toMatchObject({ status: "INCLUDED", subtotal: "0.00" });
    p.prices = [];
    expect(computePlanQuote(p).lines[1]!.status).toBe("UNRESOLVED");
    expect(computePlanQuote(p).total).toBeNull();
  });
  it("doesnotmakeorphanincludeditemfree orborrowanchorsfromothergroup", () => {
    const p = mapped();
    p.mappings[0]!.billingMode = "INCLUDED";
    expect(computePlanQuote(p).total).toBeNull();
    p.mappings.push({
      ...p.mappings[0]!,
      id: map2,
      targetProductId: null,
      targetItemId: service,
      billingMode: "SEPARATE",
      chargeGroup: "OTHER",
    });
    p.prices.push({ ...p.prices[0]!, id: price2, productId: null, catalogItemId: service });
    expect(computePlanQuote(p).total).toBeNull();
  });
  it("doesnotborrowinclusionanchorsfromanotherclinicalorigin", () => {
    const p = mapped();
    p.plan.items.push({
      ...structuredClone(p.plan.items[0]!),
      id: ids[10]!,
      catalogItemId: null,
      productId: product,
    });
    p.mappings[0]!.billingMode = "INCLUDED";
    expect(computePlanQuote(p).total).toBeNull();
  });
  it("rejectscontradictorybillingmodes ratherthanchoosingone", () => {
    const p = mapped();
    p.mappings.push({ ...p.mappings[0]!, id: map2, billingMode: "INCLUDED" });
    expect(computePlanQuote(p).total).toBeNull();
  });
  it("acceptsexplicitquantityonlyinthepricedunitwithoutchangingclinicalplan", () => {
    const p = input();
    p.prices[0]!.sellingUnit = "PACK";
    p.overrides = [{ candidateKey: key(p), selected: true, quantity: "2", unit: "PACK" }];
    expect(computePlanQuote(p).total).toBe("20.00");
    p.overrides[0]!.unit = "pack";
    expect(() => computePlanQuote(p)).toThrow(/unidade/);
  });
  it("onlyexcludesoptionalorigins anddoesnotmutatetheclinicalsource", () => {
    const p = input();
    p.overrides = [{ candidateKey: key(p), selected: false, quantity: null, unit: null }];
    expect(() => computePlanQuote(p)).toThrow(/opcionais/);
    p.plan.items[0]!.optional = true;
    const r = computePlanQuote(p);
    expect(r.lines[0]!.status).toBe("EXCLUDED");
    expect(r.total).toBeNull();
    expect(p.plan.items[0]!.optional).toBe(true);
  });
  it.each(["UNKNOWN", "UNAVAILABLE"] as const)(
    "doesnot inventpricewhenavailability%s",
    (availability) => {
      const p = input();
      p.prices[0]!.availability = availability;
      expect(computePlanQuote(p).total).toBeNull();
    },
  );
  it("rejectsexpired,future,inactive,otherunit,ambiguouscurrentpricesandunknownquantities", () => {
    for (const mutate of [
      (p: PlanQuoteInput) => (p.prices[0]!.validFrom = "2026-11-01"),
      (p: PlanQuoteInput) => (p.prices[0]!.validUntil = "2026-10-18"),
      (p: PlanQuoteInput) => (p.prices[0]!.active = false),
      (p: PlanQuoteInput) => (p.prices[0]!.unitId = ids[12]!),
      (p: PlanQuoteInput) => p.prices.push({ ...p.prices[0]!, id: price2 }),
      (p: PlanQuoteInput) => (p.plan.items[0]!.stages[0]!.durationDays = null),
      (p: PlanQuoteInput) => (p.products[0]!.active = false),
    ]) {
      const p = input();
      mutate(p);
      expect(computePlanQuote(p).total).toBeNull();
    }
  });
  it("usesinclusivevalidityboundaries", () => {
    const p = input();
    p.prices[0]!.validFrom = p.referenceDate;
    p.prices[0]!.validUntil = p.referenceDate;
    expect(computePlanQuote(p).total).toBe("30.00");
  });
  it("roundseachlinehalfup exact .005 anddiscountcentshalfup", () => {
    const p = input();
    p.prices[0]!.amount = "0.01";
    p.overrides = [{ candidateKey: key(p), selected: true, quantity: "0.5", unit: "CAPSULE" }];
    expect(computePlanQuote(p).total).toBe("0.01");
    p.discountBps = 5000;
    expect(computePlanQuote(p)).toMatchObject({
      subtotal: "0.01",
      discountAmount: "0.01",
      total: "0.00",
    });
    p.overrides[0]!.quantity = "0.4999";
    expect(computePlanQuote(p).subtotal).toBe("0.00");
  });
  it("rejectsfakeorrepeatedoverridekeys andinvaliddecimalssafely", () => {
    const p = input();
    p.overrides = [{ candidateKey: "fake", selected: true, quantity: null, unit: null }];
    expect(() => computePlanQuote(p)).toThrow();
    p.overrides = [
      { candidateKey: key(input()), selected: true, quantity: "abc", unit: "CAPSULE" },
    ];
    expect(() => planQuoteInputSchema.safeParse(p)).not.toThrow();
    expect(planQuoteInputSchema.safeParse(p).success).toBe(false);
  });
  it("failsclosedabove500candidates ratherthansilentlytruncating", () => {
    const p = mapped();
    p.mappings = Array.from({ length: 501 }, (_, i) => ({
      ...p.mappings[0]!,
      id: `00000000-0000-4000-8000-${(i + 1000).toString().padStart(12, "0")}`,
      chargeGroup: `G${i}`,
    }));
    expect(() => computePlanQuote(p)).toThrow(/500/);
  });
});

it("never exposes stale or unusable price as a usable unitPrice", () => {
  const p = input();
  p.prices[0]!.availability = "UNKNOWN";
  expect(computePlanQuote(p).lines[0]!.unitPrice).toBeNull();
  p.prices[0]!.availability = "AVAILABLE";
  p.products[0]!.active = false;
  expect(computePlanQuote(p).lines[0]!.unitPrice).toBeNull();
  p.products[0]!.active = true;
  p.plan.items[0]!.stages[0]!.durationDays = null;
  expect(computePlanQuote(p).lines[0]!.unitPrice).toBe("10.00");
});
