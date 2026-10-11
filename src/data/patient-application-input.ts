import { z } from "zod";

export const patientApplicationInput = z.object({
  operationId: z.string().uuid(),
  patientId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  scheduleVersion: z.number().int().nonnegative(),
  locationId: z.string().uuid(),
  reference: z.string().trim().min(3).max(100),
  professional: z.string().trim().min(3).max(100),
  reason: z.string().trim().min(10).max(500),
});

export type PatientApplicationInput = z.infer<typeof patientApplicationInput>;
