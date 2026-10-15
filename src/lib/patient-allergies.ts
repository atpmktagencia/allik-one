export type AllergyStatus = "UNKNOWN" | "DENIED" | "REPORTED";
export type AllergySummary = {
  status: AllergyStatus;
  allergies: string[];
  legacyAllergies: string[];
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  version?: number;
  canAssess?: boolean;
};
const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
/** Positive evidence takes precedence; an empty list is never a negative assessment. */
export function resolveAllergies(
  privateData: unknown,
  alerts: Array<{ type: string; title: string; status?: string }>,
  declared: string = "UNKNOWN",
): AllergySummary {
  const raw =
    privateData && typeof privateData === "object"
      ? (privateData as { allergies?: unknown }).allergies
      : [];
  const legacy = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  const active = alerts
    .filter((item) => item.type === "ALLERGY" && item.status !== "INACTIVE")
    .map((item) => item.title);
  const names = new Map<string, string>();
  for (const name of [...active, ...legacy])
    if (name.trim() && !names.has(normalize(name))) names.set(normalize(name), name.trim());
  const allergies = [...names.values()];
  return {
    status:
      allergies.length || declared === "REPORTED"
        ? "REPORTED"
        : declared === "DENIED"
          ? "DENIED"
          : "UNKNOWN",
    allergies,
    legacyAllergies: legacy,
  };
}
export function allergyLabel(summary: Pick<AllergySummary, "status" | "allergies">) {
  return summary.status === "REPORTED"
    ? summary.allergies.length
      ? `Alergias: ${summary.allergies.join(", ")}`
      : "Alergias relatadas · detalhes pendentes"
    : summary.status === "DENIED"
      ? "Paciente nega alergias"
      : "Alergias: não informadas";
}
