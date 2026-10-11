import { z } from "zod";

const careType = z.enum([
  "FIRST_VISIT",
  "FOLLOW_UP",
  "CONSULTATION",
  "TELECONSULTATION",
  "INJECTABLE",
  "OTHER",
]);
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
    action: z.enum(["CREATE", "UPDATE_STATUS"]),
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
    notes: z.string().trim().max(1000),
    status,
    version: z.number().int().nonnegative(),
    reason: z.string().trim().min(10).max(500),
  })
  .superRefine((value, context) => {
    if (value.careType === "OTHER" && !value.otherCareType?.trim())
      context.addIssue({ code: "custom", path: ["otherCareType"], message: "Informe o tipo." });
    if (value.careType !== "OTHER" && value.otherCareType)
      context.addIssue({ code: "custom", path: ["otherCareType"], message: "Tipo inválido." });
    const startsAt = new Date(value.startsAt).getTime();
    const endsAt = new Date(value.endsAt).getTime();
    if (endsAt <= startsAt || endsAt - startsAt > 12 * 60 * 60 * 1000)
      context.addIssue({ code: "custom", path: ["endsAt"], message: "Período inválido." });
  });

export type CareAppointmentInput = z.infer<typeof careAppointmentInput>;
