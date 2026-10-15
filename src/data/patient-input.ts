import { z } from "zod";

const optionalText = (schema: z.ZodString) => z.union([schema, z.literal(""), z.null()]).optional();

export const patientInput = z
  .object({
    action: z.enum(["CREATE", "UPDATE"]),
    id: z.string().uuid(),
    primaryUnitId: z.string().uuid(),
    internalCode: z.union([
      z
        .string()
        .trim()
        .min(3)
        .max(40)
        .regex(/^[A-Za-z0-9._-]+$/),
      z.literal(""),
    ]),
    fullName: z.string().trim().min(3).max(180),
    phone: optionalText(z.string().trim().min(8).max(30)),
    phone2: optionalText(z.string().trim().min(8).max(30)),
    email: optionalText(z.string().trim().email().max(254)),
    documentType: z.enum(["CPF", "PASSPORT"]).nullable().optional(),
    documentNumber: optionalText(z.string().trim().min(5).max(30)),
    noDocument: z.boolean().default(false),
    birthDate: optionalText(z.string().date()),
    insurance: z
      .object({
        name: z.string().trim().max(100),
        plan: z.string().trim().max(100),
        memberNumber: z.string().trim().max(80),
        validUntil: z.union([z.string().date(), z.literal("")]),
      })
      .default({ name: "", plan: "", memberNumber: "", validUntil: "" }),
    additional: z
      .object({
        rg: z.string().trim().max(30),
        profession: z.string().trim().max(100),
        motherName: z.string().trim().max(180),
        fatherName: z.string().trim().max(180),
        zipCode: z.string().trim().max(12),
        address: z.string().trim().max(180),
        complement: z.string().trim().max(100),
        district: z.string().trim().max(100),
        state: z.string().trim().max(2),
        city: z.string().trim().max(100),
      })
      .default({
        rg: "",
        profession: "",
        motherName: "",
        fatherName: "",
        zipCode: "",
        address: "",
        complement: "",
        district: "",
        state: "",
        city: "",
      }),
    privateData: z
      .object({
        allergies: z.array(z.string().trim().min(1).max(100)).max(50),
        vegan: z.boolean().nullable(),
        notes: z.string().trim().max(2000),
      })
      .default({ allergies: [], vegan: null, notes: "" }),
    active: z.boolean(),
    consentStatus: z.enum(["PENDING", "RECORDED", "REVOKED"]),
    version: z.number().int().nonnegative(),
    reason: z.string().trim().min(10).max(500),
  })
  .superRefine((value, context) => {
    if (!value.noDocument && Boolean(value.documentType) !== Boolean(value.documentNumber))
      context.addIssue({
        code: "custom",
        path: ["documentNumber"],
        message: "Documento incompleto.",
      });
    if (value.noDocument && (value.documentType || value.documentNumber))
      context.addIssue({ code: "custom", path: ["noDocument"], message: "Remova o documento." });
  });

export type PatientInput = z.infer<typeof patientInput>;
