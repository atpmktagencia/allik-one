import { z } from "zod";

export const prescriptionPrintDataSchema = z
  .object({
    kind: z.enum(["SIMPLE", "ANTIMICROBIAL", "SPECIAL_CONTROL"]).default("SIMPLE"),
    patientDocument: z.string().trim().max(60).default(""),
    patientAddress: z.string().trim().max(500).default(""),
    patientAge: z.number().int().min(0).max(130).nullable().default(null),
    patientSex: z.string().trim().max(40).default(""),
    issuerAddress: z.string().trim().max(500).default(""),
    issuerPhone: z.string().trim().max(40).default(""),
    issuerCity: z.string().trim().max(100).default(""),
    issuerState: z.string().trim().max(2).default(""),
  })
  .strict();
export type PrescriptionPrintData = z.infer<typeof prescriptionPrintDataSchema>;

export function patientPrintDefaults(
  patient: {
    document_number?: string | null;
    birth_date?: string | null;
    additional_data?: Record<string, unknown> | null;
  },
  now = new Date(),
): PrescriptionPrintData {
  const birthday = patient.birth_date?.slice(0, 10);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  let age: number | null = null;
  if (birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    const [year, month, day] = birthday.split("-").map(Number) as [number, number, number];
    const currentYear = Number(dateParts.find((part) => part.type === "year")?.value);
    const currentMonth = Number(dateParts.find((part) => part.type === "month")?.value);
    const currentDay = Number(dateParts.find((part) => part.type === "day")?.value);
    const result =
      currentYear -
      year -
      (currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0);
    if (result >= 0 && result <= 130) age = result;
  }
  const additional = patient.additional_data ?? {};
  const address = ["address", "complement", "district", "city", "state", "zipCode"]
    .map((key) => (typeof additional[key] === "string" ? additional[key] : ""))
    .filter(Boolean)
    .join(", ")
    .slice(0, 500);
  return prescriptionPrintDataSchema.parse({
    patientDocument: patient.document_number ?? "",
    patientAddress: address,
    patientAge: age,
  });
}
