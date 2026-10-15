import { z } from "zod";

const base = {
  scheduleId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(10).max(500),
};

export const scheduleOperationInput = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("CONFIRM") }).strict(),
  z.object({ ...base, action: z.literal("CANCEL") }).strict(),
  z.object({ ...base, action: z.literal("NO_SHOW") }).strict(),
  z
    .object({
      ...base,
      action: z.literal("RESCHEDULE"),
      scheduledOn: z.string().date(),
    })
    .strict(),
]);

export type ScheduleOperationInput = z.infer<typeof scheduleOperationInput>;
