export const previewOperatorIdentity = {
  id: "f394c45e-cdf3-4355-b522-7d06437c3c5b",
  membershipId: "c38e0ec1-5413-4f95-b9d4-5d81f456adbc",
  organizationId: "a1100000-0000-4000-8000-000000000001",
  email: "preview-operator@allik.invalid",
  name: "Operador Preview — TESTE SEM VALIDADE CLÍNICA",
  councilNumber: "999999999",
} as const;

/** Never activate shared clinical access outside the explicitly authorized synthetic branch. */
export function fullPreviewOperatorEnabled(env: Record<string, string | undefined>) {
  if (
    env["INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS"] !== "true" ||
    env["VERCEL_ENV"] !== "preview" ||
    env["INVENTORY_ENVIRONMENT"] !== "preview" ||
    env["INVENTORY_PREVIEW_DATA_CLASSIFICATION"] !== "synthetic" ||
    env["VERCEL_GIT_COMMIT_REF"] !== "feature/allik-patients"
  )
    return false;
  try {
    const database = new URL(env["DATABASE_URL"] ?? "");
    return (
      ["postgres:", "postgresql:"].includes(database.protocol) &&
      database.hostname.replace("-pooler.", ".") ===
        "ep-hidden-cloud-b6hskjjt.c-2.sa-east-1.aws.neon.tech" &&
      database.pathname === "/neondb"
    );
  } catch {
    return false;
  }
}
