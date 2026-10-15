import { z } from "zod";
import { decimal } from "./receipt-input";

export const applicationInput = z
  .object({
    operationId: z.string().uuid(),
    patientRef: z.enum(["demo-patient-a", "demo-patient-b", "demo-patient-c"]),
    reference: z.string().trim().min(1).max(100),
    service: z.string().trim().min(3).max(100),
    professional: z.string().trim().min(3).max(100),
    locationId: z.string().uuid(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          lotId: z.string().uuid(),
          quantity: decimal(11, 3, true),
        }),
      )
      .min(1)
      .max(20),
  })
  .refine((input) => new Set(input.items.map((item) => item.lotId)).size === input.items.length, {
    message: "Cada lote deve aparecer apenas uma vez na aplicação.",
  });
