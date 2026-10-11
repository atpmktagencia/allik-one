import { z } from "zod";

const optionalText = (schema: z.ZodString) => z.union([schema, z.literal(""), z.null()]).optional();

export const patientInput = z.object({
  action: z.enum(["CREATE", "UPDATE"]),
  id: z.string().uuid(),
  primaryUnitId: z.string().uuid(),
  internalCode: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/),
  fullName: z.string().trim().min(3).max(180),
  phone: optionalText(z.string().trim().min(8).max(30)),
  email: optionalText(z.string().trim().email().max(254)),
  active: z.boolean(),
  consentStatus: z.enum(["PENDING", "RECORDED", "REVOKED"]),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(10).max(500),
});

export type PatientInput = z.infer<typeof patientInput>;
