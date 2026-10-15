import "@tanstack/react-start/server-only";

const regions = new Set([
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
]);
const councils = new Set(["CRM", "COREN", "CREFITO", "CRP", "CRN", "CREFONO", "CRO", "CREF"]);
export function hasClinicalRegistration(professional: {
  professional_council?: string | null;
  council_number?: string | null;
  council_region?: string | null;
}) {
  return Boolean(
    professional.professional_council &&
    councils.has(professional.professional_council) &&
    professional.council_number?.trim() &&
    regions.has(professional.council_region ?? ""),
  );
}

// Conservative pilot policy. Broader professional scopes require separately reviewed flows.
export function canWriteClinicalDocument(council: string | null | undefined, type: string) {
  if (!council || !councils.has(council)) return false;
  return (
    type === "INSTRUCTIONS" ||
    (council === "CRM" &&
      [
        "PRESCRIPTION",
        "EXAM_REQUEST",
        "MEDICAL_CERTIFICATE",
        "REFERRAL",
        "MEDICAL_REPORT",
        "MEDICAL_OPINION",
      ].includes(type))
  );
}

export function professionalRegistryConflictResponse(error: unknown, headers: HeadersInit) {
  if (
    error &&
    typeof error === "object" &&
    "constraint" in error &&
    error.constraint === "clinical_professional_registration_conflict"
  ) {
    return Response.json(
      {
        error:
          "Seu registro profissional precisa de correção administrativa antes de registrar conteúdo clínico.",
      },
      { status: 409, headers },
    );
  }
  return null;
}
