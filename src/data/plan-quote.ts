import { z } from "zod";
import { treatmentPlanSchema, computeTreatmentPlan } from "./treatment-plan";
const uuid = z.string().uuid();
const qtyPattern = /^(?:0|[1-9]\d{0,7})(?:[.,]\d{1,4})?$/;
const quantity = z
  .string()
  .trim()
  .refine((v) => qtyPattern.test(v) && scaled(v) > 0n);
const unit = z.string().trim().min(1).max(80);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
export const planQuoteOverrideSchema = z
  .object({
    candidateKey: z.string().max(500),
    selected: z.boolean(),
    quantity: quantity.nullable(),
    unit: unit.nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (Boolean(v.quantity) !== Boolean(v.unit))
      c.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Informe quantidade e unidade juntas.",
      });
  });
export type PlanQuoteOverride = z.infer<typeof planQuoteOverrideSchema>;
const mapping = z
  .object({
    id: uuid,
    sourceItemId: uuid,
    targetProductId: uuid.nullable(),
    targetItemId: uuid.nullable(),
    billingMode: z.enum(["SEPARATE", "INCLUDED"]),
    chargeGroup: z.string().trim().min(1).max(100),
    active: z.boolean(),
  })
  .superRefine((v, c) => {
    if (Boolean(v.targetProductId) === Boolean(v.targetItemId))
      c.addIssue({
        code: "custom",
        path: ["targetProductId"],
        message: "Destino comercial ambíguo.",
      });
  });
const price = z
  .object({
    id: uuid,
    unitId: uuid,
    productId: uuid.nullable(),
    catalogItemId: uuid.nullable(),
    amount: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,9})\.\d{2}$/)
      .refine((v) => Number(v) > 0),
    sellingUnit: unit,
    source: z.string().max(500),
    validFrom: date,
    validUntil: date.nullable(),
    availability: z.enum(["UNKNOWN", "AVAILABLE", "UNAVAILABLE"]),
    effectiveAvailability: z.enum(["UNKNOWN", "AVAILABLE", "UNAVAILABLE"]).optional(),
    active: z.boolean(),
    version: z.number().int().positive(),
  })
  .superRefine((v, c) => {
    if (Boolean(v.productId) === Boolean(v.catalogItemId))
      c.addIssue({ code: "custom", path: ["productId"], message: "Destino de preço ambíguo." });
    if (v.validUntil && v.validUntil < v.validFrom)
      c.addIssue({ code: "custom", path: ["validUntil"], message: "Vigência inválida." });
  });
export const planQuoteInputSchema = z
  .object({
    plan: treatmentPlanSchema,
    unitId: uuid,
    referenceDate: date,
    mappings: z.array(mapping).max(5000),
    prices: z.array(price).max(5000),
    products: z
      .array(z.object({ id: uuid, name: z.string().max(200), active: z.boolean() }))
      .max(5000),
    catalogItems: z
      .array(
        z.object({
          id: uuid,
          name: z.string().max(200),
          kind: z.enum(["ACTIVE", "MEDICATION", "SERVICE", "PROCEDURE"]),
          active: z.boolean(),
        }),
      )
      .max(5000),
    overrides: z.array(planQuoteOverrideSchema).max(500).default([]),
    discountBps: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type PlanQuoteInput = z.infer<typeof planQuoteInputSchema>;
export type PlanQuoteLine = {
  candidateKey: string;
  originItemId: string;
  chargeGroup: string;
  targetType: "PRODUCT" | "CATALOG" | null;
  targetId: string | null;
  label: string;
  billingMode: "SEPARATE" | "INCLUDED";
  selected: boolean;
  isOptional: boolean;
  canExclude: boolean;
  status: "RESOLVED" | "UNRESOLVED" | "INCLUDED" | "EXCLUDED";
  reason: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  subtotal: string | null;
  priceId: string | null;
  priceVersion: number | null;
  mappingIds: string[];
  priceSource: string | null;
  validFrom: string | null;
  validUntil: string | null;
};
export type ComputedPlanQuote = {
  lines: PlanQuoteLine[];
  knownSubtotal: string;
  subtotal: string | null;
  discountBps: number;
  discountAmount: string | null;
  total: string | null;
  complete: boolean;
};
function scaled(v: string) {
  const [a, b = ""] = v.replace(",", ".").split(".");
  return BigInt(a!) * 10000n + BigInt(b.padEnd(4, "0"));
}
function fmtQty(v: bigint) {
  const rest = (v % 10000n).toString().padStart(4, "0").replace(/0+$/, "");
  return `${v / 10000n}${rest ? "." + rest : ""}`;
}
function cents(v: string) {
  return BigInt(v.replace(".", ""));
}
function money(v: bigint) {
  return `${v / 100n}.${(v % 100n).toString().padStart(2, "0")}`;
}
/** Per-line cents × 4-place quantity rounded half up; discount is rounded half up on the sum of rounded lines. No stock/sales effects. */
type Candidate = {
  group: string;
  type: "PRODUCT" | "CATALOG" | null;
  target: string | null;
  mode: "SEPARATE" | "INCLUDED";
  mappingId: string | null;
};
export function computePlanQuote(value: unknown): ComputedPlanQuote {
  const input = planQuoteInputSchema.parse(value),
    computed = computeTreatmentPlan(input.plan);
  const products = new Map(input.products.map((p) => [p.id, p])),
    catalog = new Map(input.catalogItems.map((c) => [c.id, c]));
  if (products.size !== input.products.length || catalog.size !== input.catalogItems.length)
    throw Error("Catálogo duplicado ou ambíguo.");
  const overrides = new Map(input.overrides.map((o) => [o.candidateKey, o]));
  if (overrides.size !== input.overrides.length) throw Error("Seleções comerciais repetidas.");
  const lines: PlanQuoteLine[] = [];
  let rawCount = 0;
  for (const item of input.plan.items) {
    const source = item.catalogItemId ? catalog.get(item.catalogItemId) : null;
    const mappings = item.catalogItemId
      ? input.mappings.filter((m) => m.active && m.sourceItemId === item.catalogItemId)
      : [];
    const candidates: Candidate[] = mappings.length
      ? mappings.map((m) => ({
          group: m.chargeGroup,
          type: m.targetProductId ? ("PRODUCT" as const) : ("CATALOG" as const),
          target: m.targetProductId ?? m.targetItemId,
          mode: m.billingMode,
          mappingId: m.id,
        }))
      : item.productId
        ? [
            {
              group: "DIRECT",
              type: "PRODUCT" as const,
              target: item.productId,
              mode: "SEPARATE" as const,
              mappingId: null,
            },
          ]
        : source && ["SERVICE", "PROCEDURE"].includes(source.kind)
          ? [
              {
                group: "DIRECT",
                type: "CATALOG" as const,
                target: source.id,
                mode: "SEPARATE" as const,
                mappingId: null,
              },
            ]
          : [
              {
                group: "UNMAPPED",
                type: null,
                target: null,
                mode: "SEPARATE" as const,
                mappingId: null,
              },
            ];
    rawCount += candidates.length;
    if (rawCount > 500)
      throw Error("A estimativa excede 500 candidatos. Refine os vínculos explicitamente.");
    const unique = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const key = JSON.stringify([item.id, candidate.group, candidate.type, candidate.target]);
      unique.set(key, [...(unique.get(key) ?? []), candidate]);
    }
    for (const [key, duplicates] of unique) {
      const candidate = duplicates[0]!,
        override = overrides.get(key);
      overrides.delete(key);
      if (override && !override.selected && !item.optional)
        throw Error("Somente itens clínicos opcionais podem ser excluídos da estimativa.");
      const target =
        candidate.type === "PRODUCT"
          ? products.get(candidate.target!)
          : candidate.type === "CATALOG"
            ? catalog.get(candidate.target!)
            : null;
      const matchingPrices = input.prices.filter(
        (p) =>
          p.unitId === input.unitId &&
          (candidate.type === "PRODUCT"
            ? p.productId === candidate.target
            : p.catalogItemId === candidate.target && candidate.type === "CATALOG"),
      );
      const p = matchingPrices.length === 1 ? matchingPrices[0] : null;
      const line: PlanQuoteLine = {
        candidateKey: key,
        originItemId: item.id,
        chargeGroup: candidate.group,
        targetType: candidate.type,
        targetId: candidate.target,
        label: target?.name ?? "Item comercial sem vínculo",
        billingMode: candidate.mode,
        selected: override?.selected ?? true,
        isOptional: item.optional,
        canExclude: item.optional,
        status: "UNRESOLVED",
        reason: null,
        quantity: null,
        unit: p?.sellingUnit ?? null,
        unitPrice: null,
        subtotal: null,
        priceId: p?.id ?? null,
        priceVersion: p?.version ?? null,
        mappingIds: duplicates.flatMap((c) => (c.mappingId ? [c.mappingId] : [])),
        priceSource: p?.source ?? null,
        validFrom: p?.validFrom ?? null,
        validUntil: p?.validUntil ?? null,
      };
      const invalidSource = item.catalogItemId && (!source || !source.active);
      if (override?.quantity && p && override.unit !== p.sellingUnit)
        throw Error(
          "A unidade comercial deve coincidir exatamente com a unidade do preço; não há conversão.",
        );
      if (!line.selected) {
        line.status = "EXCLUDED";
        line.reason = "Item opcional excluído somente desta estimativa.";
        lines.push(line);
        continue;
      }
      if (new Set(duplicates.map((c) => c.mode)).size > 1)
        line.reason = "Modos de cobrança conflitantes para o mesmo destino.";
      else if (
        invalidSource ||
        !target ||
        !target.active ||
        (candidate.type === "CATALOG" &&
          !["SERVICE", "PROCEDURE"].includes(catalog.get(candidate.target!)?.kind ?? ""))
      )
        line.reason =
          "Destino comercial ou origem de catálogo indisponível; vínculo explícito necessário.";
      else if (candidate.mode === "INCLUDED") {
        lines.push(line);
        continue;
      } else if (!p || matchingPrices.length !== 1)
        line.reason =
          matchingPrices.length > 1
            ? "Preço atual ambíguo para a unidade e destino."
            : "Preço da unidade não informado.";
      else if (
        !p.active ||
        p.availability !== "AVAILABLE" ||
        (p.effectiveAvailability && p.effectiveAvailability !== "AVAILABLE") ||
        p.validFrom > input.referenceDate ||
        (p.validUntil !== null && p.validUntil < input.referenceDate)
      )
        line.reason = "Preço não disponível ou fora da vigência informada.";
      else {
        line.unitPrice = p.amount;
        let q: string | null = null;
        if (override?.quantity) {
          if (override.unit !== p.sellingUnit)
            throw Error(
              "A unidade comercial deve coincidir exatamente com a unidade do preço; não há conversão.",
            );
          q = override.quantity;
        } else if (
          candidate.type === "PRODUCT" &&
          item.dispense &&
          item.dispense.unit === p.sellingUnit
        )
          q = item.dispense.quantity;
        else if (item.administrationUnit === p.sellingUnit)
          q = computed.items.find((c) => c.id === item.id)!.administrationQuantity;
        if (q === null || scaled(q) <= 0n)
          line.reason = "Quantidade comercial não resolvida na unidade exata do preço.";
        else {
          line.quantity = fmtQty(scaled(q));
          line.subtotal = money((cents(p.amount) * scaled(q) + 5000n) / 10000n);
          line.status = "RESOLVED";
        }
      }
      lines.push(line);
    }
  }
  if (overrides.size) throw Error("Seleção comercial não pertence aos candidatos atuais.");
  for (const line of lines.filter(
    (l) => l.selected && l.billingMode === "INCLUDED" && l.reason === null,
  )) {
    const anchors = lines.filter(
      (l) =>
        l.selected &&
        l.originItemId === line.originItemId &&
        l.chargeGroup === line.chargeGroup &&
        l.billingMode === "SEPARATE",
    );
    if (!anchors.length || anchors.some((l) => l.status !== "RESOLVED"))
      line.reason = "Inclusão sem âncora de cobrança resolvida na mesma origem e grupo.";
    else {
      line.status = "INCLUDED";
      line.subtotal = "0.00";
      line.reason = "Incluído em cobrança separada da mesma origem e grupo; não somado novamente.";
    }
  }
  const known = lines
    .filter((l) => l.status === "RESOLVED")
    .reduce((sum, l) => sum + cents(l.subtotal!), 0n);
  const complete =
    lines.some((l) => l.selected) &&
    lines.every((l) => !l.selected || l.status === "RESOLVED" || l.status === "INCLUDED");
  const discount = (known * BigInt(input.discountBps) + 5000n) / 10000n;
  return {
    lines,
    knownSubtotal: money(known),
    subtotal: complete ? money(known) : null,
    discountBps: input.discountBps,
    discountAmount: complete ? money(discount) : null,
    total: complete ? money(known - discount) : null,
    complete,
  };
}
