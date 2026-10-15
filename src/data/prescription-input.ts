import { z } from "zod";

export const prescriptionMetadataInput = z
  .object({
    treatmentId: z.string().uuid(),
    prescriberName: z.string().trim().min(2).max(150),
    councilNumber: z.string().trim().min(3).max(30),
    councilRegion: z.string().trim().min(2).max(10),
    issuedOn: z.string().date(),
    validUntil: z.string().date(),
    supersedesId: z.union([z.string().uuid(), z.literal("")]),
    reason: z.string().trim().min(10).max(500),
  })
  .refine((value) => value.validUntil >= value.issuedOn, {
    message: "A validade deve ser igual ou posterior à emissão.",
    path: ["validUntil"],
  });
