import { z } from "zod";

export const openPresentationInput = z.object({
  eventId: z.string().uuid(),
  openPresentationId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  type: z.enum(["EXPIRED", "DAMAGE", "DISCARD"]),
  reason: z.string().trim().min(10).max(500),
});
