import { z } from "zod";
import { decimal } from "./receipt-input";

export const pricingBaseUnits = ["MG", "MCG", "G", "ML", "UI", "UNIT"] as const;

const optionalDecimal = (precision: number, scale: number) =>
  z.union([decimal(precision, scale, true), z.literal(""), z.null()]).optional();

export const presentationInput = z
  .object({
    action: z.enum(["CREATE_PRESENTATION", "UPDATE_PRESENTATION"]),
    id: z.string().uuid(),
    productId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
    name: z.string().trim().min(3).max(180),
    baseUnit: z.enum(pricingBaseUnits),
    totalBaseQuantity: decimal(12, 6, true),
    totalVolumeMl: optionalDecimal(12, 6),
    acquisitionCost: decimal(10, 4, false),
    technicalLossPercent: decimal(5, 4, false),
    additionalPresentationCost: decimal(10, 4, false),
    minimumMeasurableVolumeMl: optionalDecimal(6, 6),
    beyondUseHours: z.union([z.number().int().positive().max(87600), z.null()]).optional(),
    active: z.boolean().default(true),
    version: z.number().int().nonnegative(),
    reason: z.string().trim().min(10).max(500),
  })
  .refine((input) => Number(input.technicalLossPercent) < 100, {
    message: "A perda técnica deve ser menor que 100%.",
    path: ["technicalLossPercent"],
  });

export const doseInput = z.object({
  action: z.enum(["CREATE_DOSE", "UPDATE_DOSE"]),
  id: z.string().uuid(),
  presentationId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  doseQuantity: decimal(12, 6, true),
  salePrice: decimal(10, 2, true),
  materialCost: decimal(10, 4, false),
  active: z.boolean().default(true),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(10).max(500),
});
