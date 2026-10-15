import { z } from "zod";

export const patientSupplyInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE_PURCHASE"),
    id: z.string().uuid(),
    patientId: z.string().uuid(),
    treatmentId: z.string().uuid(),
    purchasedQuantity: z.coerce.number().positive().max(1_000_000),
    totalValue: z.union([z.coerce.number().nonnegative().max(100_000_000), z.null()]),
    reference: z.string().trim().min(3).max(100),
    purchasedOn: z.string().date(),
    reason: z.string().trim().min(10).max(500),
  }),
  z.object({
    action: z.literal("UPDATE_SCHEDULE_STATUS"),
    patientId: z.string().uuid(),
    scheduleId: z.string().uuid(),
    status: z.enum(["PLANNED", "RESERVED", "CANCELED"]),
    version: z.number().int().nonnegative(),
    reason: z.string().trim().min(10).max(500),
  }),
]);

export type PatientSupplyInput = z.infer<typeof patientSupplyInput>;
