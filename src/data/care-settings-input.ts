import { z } from "zod";

export const careSettingsInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_UNIT"), name: z.string().trim().min(2).max(100) }),
  z.object({ action: z.literal("CREATE_TYPE"), name: z.string().trim().min(2).max(100) }),
  z.object({
    action: z.literal("CREATE_ROOM"),
    unitId: z.string().uuid(),
    name: z.string().trim().min(2).max(80),
  }),
  z.object({
    action: z.literal("CREATE_RESOURCE"),
    unitId: z.string().uuid(),
    roomId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
  }),
]);
