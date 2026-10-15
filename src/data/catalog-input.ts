import { z } from "zod";
import { decimal } from "./receipt-input";

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const name = z.string().trim().min(2).max(100);
const minimum = decimal(11, 3, false).transform((value) => {
  const [integer, fraction = ""] = value.split(".");
  return `${BigInt(integer!).toString()}.${fraction.padEnd(3, "0")}`;
});
const common = { operationId: uuid, id: uuid, name };
const update = {
  ...common,
  action: z.literal("UPDATE"),
  version: z.number().int().nonnegative(),
  active: z.boolean(),
  reason: z.string().trim().min(10).max(500),
};
const product = { name: z.string().trim().min(2).max(500), category: name, minimum };

export const productCatalogInput = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      ...product,
      action: z.literal("CREATE"),
      sku: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9._-]+$/)
        .transform((v) => v.toUpperCase()),
      unit: z.string().trim().min(1).max(20),
    })
    .strict(),
  z.object({ ...update, ...product }).strict(),
]);
export const locationCatalogInput = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("CREATE"), unitId: uuid.optional() }).strict(),
  z.object(update).strict(),
]);

export type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  minimum: string;
  active: boolean;
  stockControlled: boolean;
  version: number;
};
export type CatalogLocation = {
  id: string;
  name: string;
  active: boolean;
  version: number;
  unitId?: string;
};
export type CatalogSnapshot = CatalogProduct | CatalogLocation;
export type CatalogChange = {
  id: string;
  action: "CREATE" | "UPDATE";
  actor: string;
  reason: string;
  date: string;
  before: CatalogSnapshot | null;
  after: CatalogSnapshot;
};
