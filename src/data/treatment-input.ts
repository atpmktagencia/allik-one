import { z } from "zod";

export const treatmentInput = z.object({
  action: z.enum(["CREATE_TREATMENT", "UPDATE_TREATMENT"]),
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  productId: z.string().uuid(),
  doseQuantity: z.coerce.number().positive().max(1_000_000),
  doseUnit: z.enum(["MG", "ML", "UI", "UNIT"]),
  route: z.string().trim().min(2).max(40),
  frequencyEveryDays: z.coerce.number().positive().max(365),
  firstScheduledOn: z.string().date(),
  plannedAdministrations: z.union([z.coerce.number().int().positive().max(1000), z.null()]),
  status: z.enum(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELED"]),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(10).max(500),
});
