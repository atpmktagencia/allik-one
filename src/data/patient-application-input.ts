import { z } from "zod";

export const patientApplicationInput = z.object({
  operationId: z.string().uuid(),
  patientId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  scheduleVersion: z.number().int().nonnegative(),
  locationId: z.string().uuid(),
  reference: z.string().trim().min(3).max(100),
  professional: z.string().trim().min(3).max(100),
  administeredDoseQuantity: z.number().positive().max(1_000_000),
  route: z.string().trim().min(2).max(40),
  occurrenceNotes: z.string().trim().max(1000).default(""),
  reason: z.string().trim().min(10).max(500),
});

export type PatientApplicationInput = z.infer<typeof patientApplicationInput>;
