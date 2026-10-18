import { z } from "zod";
const id = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
export const engineItemKinds = ["ACTIVE", "MEDICATION", "SERVICE", "PROCEDURE"] as const;
const base = { id, operationId: id, version: z.number().int().positive().nullable() };
export const engineCatalogInput = z
  .discriminatedUnion("action", [
    z
      .object({
        ...base,
        action: z.literal("SAVE_ITEM"),
        kind: z.enum(engineItemKinds),
        category: z.string().trim().max(100).default(""),
        unit: z.string().trim().max(80).default(""),
        presentation: z.string().trim().max(160).nullable().default(null),
        concentration: z.string().trim().max(160).nullable().default(null),
        internalCode: z.string().trim().max(100).nullable().default(null),
        supplierId: id.nullable().default(null),
        name: text(160),
        description: z.string().trim().max(2000).default(""),
        active: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...base,
        action: z.literal("LINK_ACTIVE"),
        productId: id,
        activeItemId: id,
        active: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...base,
        action: z.literal("SAVE_MAPPING"),
        sourceItemId: id,
        targetProductId: id.nullable(),
        targetItemId: id.nullable(),
        billingMode: z.enum(["SEPARATE", "INCLUDED"]),
        chargeGroup: text(100),
        active: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...base,
        action: z.literal("SET_UNIT_PRICE"),
        unitId: id,
        productId: id.nullable(),
        catalogItemId: id.nullable(),
        amount: z
          .string()
          .regex(/^(?:0|[1-9]\d{0,9})\.\d{2}$/)
          .refine((v) => Number(v) > 0),
        sellingUnit: text(80),
        source: text(500),
        validFrom: date,
        validUntil: date.nullable(),
        availability: z.enum(["UNKNOWN", "AVAILABLE", "UNAVAILABLE"]),
        active: z.boolean(),
      })
      .strict(),
  ])
  .superRefine((v, c) => {
    if (v.action === "SAVE_MAPPING" && Boolean(v.targetProductId) === Boolean(v.targetItemId))
      c.addIssue({
        code: "custom",
        path: ["targetProductId"],
        message: "Escolha um único destino.",
      });
    if (v.action === "SET_UNIT_PRICE") {
      if (Boolean(v.productId) === Boolean(v.catalogItemId))
        c.addIssue({ code: "custom", path: ["productId"], message: "Escolha um único destino." });
      if (v.validUntil && v.validUntil < v.validFrom)
        c.addIssue({
          code: "custom",
          path: ["validUntil"],
          message: "Intervalo de vigência inválido.",
        });
    }
  });
export type EngineCatalogWrite = z.infer<typeof engineCatalogInput>;
export type EngineCatalogItem = {
  id: string;
  kind: (typeof engineItemKinds)[number];
  name: string;
  description: string;
  category: string;
  unit: string;
  presentation: string | null;
  concentration: string | null;
  internalCode: string | null;
  supplierId: string | null;
  active: boolean;
  version: number;
};
export type EngineProduct = { id: string; name: string; sku: string };
export type EngineActiveLink = {
  id: string;
  productId: string;
  activeItemId: string;
  active: boolean;
  version: number;
};
export type EngineCommercialMapping = {
  id: string;
  sourceItemId: string;
  targetProductId: string | null;
  targetItemId: string | null;
  billingMode: "SEPARATE" | "INCLUDED";
  chargeGroup: string;
  active: boolean;
  version: number;
};
export type EngineUnitPrice = {
  id: string;
  unitId: string;
  productId: string | null;
  catalogItemId: string | null;
  amount: string;
  sellingUnit: string;
  source: string;
  validFrom: string;
  validUntil: string | null;
  availability: "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE";
  active: boolean;
  version: number;
  effectiveAvailability: "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE";
};
export type EngineCatalogPayload = {
  products: EngineProduct[];
  items: EngineCatalogItem[];
  links: EngineActiveLink[];
  mappings: EngineCommercialMapping[];
  prices: EngineUnitPrice[];
  units: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  canManageCatalog: boolean;
  canManagePrices: boolean;
  referenceDate: string;
  limit: number;
  offset: number;
};
