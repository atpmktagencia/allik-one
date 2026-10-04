import { z } from "zod";
import { decimal } from "./receipt-input";

export const supplierInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
});
export const purchaseInput = z
  .object({
    id: z.string().uuid(),
    reference: z.string().trim().min(1).max(100),
    supplierId: z.string().uuid(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: decimal(11, 3, true),
          unitCost: decimal(10, 4, false),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine(
    (input) => new Set(input.items.map((item) => item.productId)).size === input.items.length,
    {
      message: "Informe cada produto apenas uma vez no pedido.",
    },
  );
export type PurchaseItem = {
  id: string;
  productId: string;
  name: string;
  quantity: string;
  received: string;
  unitCost: string;
  remaining: string;
};
export type Purchase = {
  id: string;
  reference: string;
  supplierId: string;
  supplier: string;
  status: "OPEN" | "PARTIAL" | "RECEIVED";
  items: PurchaseItem[];
};
export type Supplier = { id: string; name: string };
