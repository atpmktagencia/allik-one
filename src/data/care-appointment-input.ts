import { z } from "zod";

const careType = z.string().regex(/^[A-Z0-9_]{2,40}$/);
const status = z.enum([
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "NO_SHOW",
  "CANCELED",
]);

export const careAppointmentInput = z
  .object({
    action: z.enum(["CREATE", "UPDATE", "UPDATE_STATUS"]),
    id: z.string().uuid(),
    unitId: z.string().uuid(),
    patientId: z.string().uuid(),
    professionalUserId: z.string().uuid(),
    careType,
    otherCareType: z.string().trim().max(80).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    room: z.string().trim().min(2).max(80),
    chair: z.union([z.literal(1), z.literal(2), z.null()]),
    resourceName: z.string().trim().max(80).nullable().default(null),
    notes: z.string().trim().max(1000),
    status,
    version: z.number().int().nonnegative(),
    reason: z.string().trim().min(10).max(500),
  })
  .superRefine((value, context) => {
    const startsAt = new Date(value.startsAt).getTime();
    const endsAt = new Date(value.endsAt).getTime();
    if (endsAt <= startsAt || endsAt - startsAt > 12 * 60 * 60 * 1000)
      context.addIssue({ code: "custom", path: ["endsAt"], message: "Período inválido." });
    if (value.action === "CREATE" && (value.status !== "SCHEDULED" || value.version !== 0))
      context.addIssue({ code: "custom", path: ["status"], message: "Estado inicial inválido." });
  });

export type CareAppointmentInput = z.infer<typeof careAppointmentInput>;
