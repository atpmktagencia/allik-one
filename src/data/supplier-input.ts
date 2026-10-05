import { z } from "zod";
import { decimal } from "./receipt-input";

const uuid = z
  .string()
  .uuid()
  .transform((v) => v.toLowerCase());
const base = { operationId: uuid, id: uuid };
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^0-9]/g, ""))
  .refine((v) => v === "" || /^\d{10,15}$/.test(v));
const email = z.union([z.literal(""), z.string().trim().email().max(254)]);
const update = {
  action: z.literal("UPDATE"),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(10).max(500),
};
const supplier = { name: z.string().trim().min(2).max(100), phone, email, active: z.boolean() };
export const supplierProfileInput = z.discriminatedUnion("action", [
  z.object({ ...base, ...supplier, action: z.literal("CREATE") }).strict(),
  z.object({ ...base, ...supplier, ...update }).strict(),
]);
const entry = {
  supplierId: uuid,
  code: z.string().trim().min(1).max(64),
  supplierSku: z.string().trim().max(100),
  name: z.string().trim().min(2).max(500),
  kind: z.enum(["PRODUCT", "KIT", "ADDON"]),
  description: z.string().trim().max(3000),
  packaging: z.string().trim().min(2).max(200),
  contents: z.string().trim().min(1).max(200),
  boxesPerPack: z.number().int().positive().max(100).nullable(),
  price: decimal(10, 2, true),
  priceSource: z.string().trim().min(3).max(200),
  active: z.boolean(),
};
export const supplierCatalogInput = z.discriminatedUnion("action", [
  z.object({ ...base, ...entry, action: z.literal("CREATE") }).strict(),
  z.object({ ...base, ...entry, ...update }).strict(),
]);
export const supplierOrderInput = z
  .object({
    operationId: uuid,
    reference: z.string().trim().min(1).max(100),
    supplierId: uuid,
    supplierVersion: z.number().int().nonnegative(),
    freight: decimal(11, 2, false).nullable(),
    notes: z.string().trim().max(2000),
    items: z
      .array(
        z
          .object({
            catalogItemId: uuid,
            quantity: z.number().int().positive().max(9999),
            version: z.number().int().nonnegative(),
            expectedPrice: decimal(10, 2, true),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine((v) => new Set(v.items.map((i) => i.catalogItemId)).size === v.items.length);

export type SupplierProfile = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  version: number;
};
export type SupplierCatalogItem = {
  id: string;
  supplierId: string;
  productId: string | null;
  code: string;
  supplierSku: string | null;
  name: string;
  kind: "PRODUCT" | "KIT" | "ADDON";
  description: string;
  packaging: string;
  contents: string;
  boxesPerPack: number | null;
  price: string | null;
  pricingNote: string | null;
  priceSource: string;
  sourcePage: number | null;
  active: boolean;
  version: number;
};
export type SupplierOrderLine = {
  catalogItemId: string;
  productId: string;
  code: string;
  supplierSku: string | null;
  name: string;
  packaging: string;
  contents: string;
  quantity: number;
  boxes: number | null;
  price: string;
  subtotal: string;
  priceSource: string;
};
export type SupplierOrder = {
  id: string;
  reference: string;
  supplier: SupplierProfile;
  items: SupplierOrderLine[];
  subtotal: string;
  freight: string | null;
  total: string;
  notes: string;
  actor: string;
  date: string;
};
