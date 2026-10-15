import { z } from "zod";
export const brazilStates = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;
export const prescriberContactFields = {
  prescribingAddress: z
    .string()
    .trim()
    .max(500)
    .refine((value) => !value || value.length >= 5)
    .optional(),
  prescribingCity: z
    .string()
    .trim()
    .max(100)
    .refine((value) => !value || value.length >= 2)
    .optional(),
  prescribingState: z.union([z.literal(""), z.enum(brazilStates)]).optional(),
  prescribingPhone: z
    .string()
    .trim()
    .max(40)
    .refine((value) => !value || /^\d{10,15}$/.test(value.replace(/\D/g, "")))
    .optional(),
};
export function prescriberPrintDefaults(profile: Record<string, unknown>) {
  return {
    issuerAddress: String(profile["prescribing_address"] ?? ""),
    issuerCity: String(profile["prescribing_city"] ?? ""),
    issuerState: String(profile["prescribing_state"] ?? ""),
    issuerPhone: String(profile["prescribing_phone"] ?? ""),
  };
}
export function hasPrescriberContact(profile: Record<string, unknown>) {
  const value = prescriberPrintDefaults(profile);
  return (
    value.issuerAddress.trim().length >= 5 &&
    value.issuerCity.trim().length >= 2 &&
    (brazilStates as readonly string[]).includes(value.issuerState) &&
    /^\d{10,15}$/.test(value.issuerPhone.replace(/\D/g, ""))
  );
}
