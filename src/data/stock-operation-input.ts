import { z } from "zod";
import { decimal } from "./receipt-input";

const common = {
  operationId: z.string().uuid(),
  lotId: z.string().uuid(),
  reference: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(10).max(500),
};
export const transferInput = z
  .object({
    ...common,
    sourceId: z.string().uuid(),
    destinationId: z.string().uuid(),
    quantity: decimal(11, 3, true),
  })
  .refine((input) => input.sourceId !== input.destinationId, {
    message: "Origem e destino devem ser diferentes.",
  });
export const adjustmentInput = z.object({
  ...common,
  locationId: z.string().uuid(),
  expectedQuantity: decimal(11, 3, false),
  countedQuantity: decimal(11, 3, false),
});
