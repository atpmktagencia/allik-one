export const previewOperatorIdentity = {
  id: "f394c45e-cdf3-4355-b522-7d06437c3c5b",
  membershipId: "c38e0ec1-5413-4f95-b9d4-5d81f456adbc",
  organizationId: "a1100000-0000-4000-8000-000000000001",
  email: "preview-operator@allik.invalid",
  name: "Operador Preview — TESTE SEM VALIDADE CLÍNICA",
  councilNumber: "999999999",
} as const;

export type SharedPreviewBoundaryProblem =
  | "PREVIEW_BOUNDARY_CLASSIFICATION"
  | "PREVIEW_BOUNDARY_URL_PARSE"
  | "PREVIEW_BOUNDARY_URL_PROTOCOL"
  | "PREVIEW_BOUNDARY_PARAMETERS"
  | "PREVIEW_BOUNDARY_LOCAL"
  | "PREVIEW_BOUNDARY_DEPLOYMENT_ENV"
  | "PREVIEW_BOUNDARY_APPLICATION_ENV"
  | "PREVIEW_BOUNDARY_BRANCH"
  | "PREVIEW_BOUNDARY_RUNTIME_USER"
  | "PREVIEW_BOUNDARY_HOST"
  | "PREVIEW_BOUNDARY_PORT"
  | "PREVIEW_BOUNDARY_DATABASE";

/** Fixed diagnostic codes only: never return connection details or environment values. */
export function sharedPreviewBoundaryProblem(
  env: Record<string, string | undefined>,
): SharedPreviewBoundaryProblem | null {
  if (env["INVENTORY_PREVIEW_DATA_CLASSIFICATION"] !== "synthetic")
    return "PREVIEW_BOUNDARY_CLASSIFICATION";
  try {
    const database = new URL(env["DATABASE_URL"] ?? "");
    if (!["postgres:", "postgresql:"].includes(database.protocol))
      return "PREVIEW_BOUNDARY_URL_PROTOCOL";
    // node-postgres lets query parameters override URL host/user/options. Do not
    // validate one endpoint and then connect to another (including Neon options).
    const connectionParameters = new Set([
      "sslmode",
      "channel_binding",
      "application_name",
      "connect_timeout",
    ]);
    if ([...database.searchParams.keys()].some((key) => !connectionParameters.has(key)))
      return "PREVIEW_BOUNDARY_PARAMETERS";
    // Local disposable databases are a separate boundary, never a deployment bypass.
    if (!env["VERCEL_ENV"] && env["VERCEL"] !== "1")
      return ["test", "development"].includes(env["NODE_ENV"] ?? "") &&
        ["test", "development"].includes(env["INVENTORY_ENVIRONMENT"] ?? "") &&
        ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) &&
        database.pathname.endsWith("_test")
        ? null
        : "PREVIEW_BOUNDARY_LOCAL";
    if (env["VERCEL_ENV"] !== "preview") return "PREVIEW_BOUNDARY_DEPLOYMENT_ENV";
    if (env["INVENTORY_ENVIRONMENT"] !== "preview") return "PREVIEW_BOUNDARY_APPLICATION_ENV";
    if (env["VERCEL_GIT_COMMIT_REF"] !== "feature/allik-patients") return "PREVIEW_BOUNDARY_BRANCH";
    if (
      decodeURIComponent(database.username) !==
      (env["INVENTORY_RUNTIME_ROLE"]?.trim() || "allik_runtime")
    )
      return "PREVIEW_BOUNDARY_RUNTIME_USER";
    if (
      database.hostname.replace("-pooler.", ".") !==
      "ep-hidden-cloud-b6hskjjt.c-2.sa-east-1.aws.neon.tech"
    )
      return "PREVIEW_BOUNDARY_HOST";
    if (database.port && database.port !== "5432") return "PREVIEW_BOUNDARY_PORT";
    if (database.pathname !== "/neondb") return "PREVIEW_BOUNDARY_DATABASE";
    return null;
  } catch {
    return "PREVIEW_BOUNDARY_URL_PARSE";
  }
}

/** Every shared identity, including the legacy password-only actor, uses this boundary. */
export function sharedPreviewBoundaryEnabled(env: Record<string, string | undefined>) {
  return sharedPreviewBoundaryProblem(env) === null;
}

/** Diagnostic booleans compare only with the public runtime-role identifier. */
export function sharedPreviewRuntimeRoleState(env: Record<string, string | undefined>) {
  let urlUserIsAllikRuntime = false;
  try {
    urlUserIsAllikRuntime =
      decodeURIComponent(new URL(env["DATABASE_URL"] ?? "").username) === "allik_runtime";
  } catch {
    /* Do not return parser errors or any part of the connection string. */
  }
  return {
    expectedRoleIsAllikRuntime:
      (env["INVENTORY_RUNTIME_ROLE"]?.trim() || "allik_runtime") === "allik_runtime",
    urlUserIsAllikRuntime,
    pgUserIsAllikRuntime: env["PGUSER"]?.trim() === "allik_runtime",
  };
}

/** Never activate shared clinical access outside the explicitly authorized synthetic branch. */
export function fullPreviewOperatorEnabled(env: Record<string, string | undefined>) {
  if (
    !sharedPreviewBoundaryEnabled(env) ||
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
