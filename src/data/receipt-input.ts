import { z } from "zod";

export const decimal = (digits: number, scale: number, positive: boolean) =>
  z
    .string()
    .regex(new RegExp(`^\\d{1,${digits}}(?:\\.\\d{1,${scale}})?$`))
    .refine((value) => (positive ? Number(value) > 0 : Number(value) >= 0));

export const receiptInput = z
  .object({
    operationId: z.string().uuid(),
    purchaseId: z.string().uuid().optional(),
    reference: z.string().trim().min(1).max(100),
    supplier: z.string().trim().min(1).max(100),
    locationId: z.string().uuid(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          purchaseItemId: z.string().uuid().optional(),
          lot: z.string().trim().min(1).max(100),
          expiry: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((value) => {
              const date = new Date(`${value}T00:00:00Z`);
              return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
            }),
          quantity: decimal(11, 3, true),
          unitCost: decimal(10, 4, false),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine(
    (input) =>
      input.items.every((item) => Boolean(item.purchaseItemId) === Boolean(input.purchaseId)),
    {
      message: "Itens e pedido devem ser vinculados juntos.",
    },
  );
export type ReceiptInput = z.infer<typeof receiptInput>;
