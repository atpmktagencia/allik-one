import "@tanstack/react-start/server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { getPool } from "./db";
import { consumeAuthRateLimit, releaseAuthRateLimit } from "./auth-rate-limit";
import {
  fullPreviewOperatorEnabled,
  sharedPreviewBoundaryEnabled,
  sharedPreviewBoundaryProblem,
  previewOperatorIdentity,
} from "../lib/preview-operator-policy";

const cookieName = "allik_inventory_session";
const previewOptOutCookieName = "allik_inventory_preview_opt_out";
const previewLifetimeSeconds = 60 * 60 * 8;
const pilotLifetimeSeconds = 60 * 60 * 12;
let previewBoundaryWarningRecorded = false;
function derivePassword(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

export const roles = [
  "SUPER_ADMIN",
  "PARTNER_ADMIN",
  "INVENTORY_MANAGER",
  "UNIT_MANAGER",
  "CLINICIAN",
  "FINANCE",
  "VIEWER",
] as const;
export type Role = (typeof roles)[number];
export type Permission =
  | "clinical.templates.approve"
  | "inventory.read"
  | "inventory.catalog.manage"
  | "inventory.supplier.manage"
  | "inventory.purchase.manage"
  | "inventory.receive"
  | "inventory.transfer"
  | "inventory.count"
  | "inventory.adjust"
  | "inventory.consume"
  | "inventory.trace"
  | "inventory.audit.read"
  | "inventory.loss.record"
  | "patients.read"
  | "patients.manage"
  | "patients.private.read"
  | "patients.clinical.manage"
  | "quotes.manage"
  | "quotes.approve"
  | "quotes.payment.record"
  | "pricing.costs.read"
  | "pricing.manage"
  | "users.manage"
  | "organization.read";
export type AuthContext = {
  user: {
    id: string | null;
    name: string;
    email: string | null;
    professionalRegistryState?: string;
  };
  membershipId: string | null;
  organizationId: string;
  role: Role;
  unitIds: string[];
  preview: boolean;
  sharedPreviewOperator?: boolean;
  integration: { id: string; name: string; permissions: Permission[] } | null;
};

const allPermissions: Permission[] = [
  "inventory.read",
  "inventory.catalog.manage",
  "inventory.supplier.manage",
  "inventory.purchase.manage",
  "inventory.receive",
  "inventory.transfer",
  "inventory.count",
  "inventory.adjust",
  "inventory.consume",
  "inventory.trace",
  "inventory.audit.read",
  "inventory.loss.record",
  "patients.read",
  "patients.manage",
  "patients.private.read",
  "patients.clinical.manage",
  "quotes.manage",
  "quotes.approve",
  "quotes.payment.record",
  "pricing.costs.read",
  "pricing.manage",
  "users.manage",
  "organization.read",
];
const permissions: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set([...allPermissions, "clinical.templates.approve"]),
  PARTNER_ADMIN: new Set(allPermissions),
  INVENTORY_MANAGER: new Set(
    allPermissions.filter(
      (permission) =>
        permission !== "users.manage" &&
        permission !== "patients.manage" &&
        permission !== "patients.private.read" &&
        permission !== "patients.clinical.manage" &&
        permission !== "quotes.manage" &&
        permission !== "quotes.approve" &&
        permission !== "quotes.payment.record",
    ),
  ),
  CLINICIAN: new Set([
    "patients.read",
    "patients.manage",
    "patients.private.read",
    "patients.clinical.manage",
    "inventory.read",
    "quotes.manage",
    "organization.read",
  ]),
  UNIT_MANAGER: new Set([
    "inventory.read",
    "inventory.catalog.manage",
    "inventory.supplier.manage",
    "inventory.purchase.manage",
    "inventory.receive",
    "inventory.transfer",
    "inventory.count",
    "inventory.adjust",
    "inventory.consume",
    "inventory.trace",
    "inventory.audit.read",
    "inventory.loss.record",
    "patients.read",
    "patients.manage",
    "quotes.manage",
    "quotes.approve",
    "organization.read",
  ]),
  FINANCE: new Set([
    "quotes.manage",
    "quotes.approve",
    "quotes.payment.record",
    "pricing.costs.read",
    "inventory.read",
    "inventory.purchase.manage",
    "inventory.trace",
    "inventory.audit.read",
    "organization.read",
  ]),
  VIEWER: new Set(["inventory.read", "inventory.trace", "organization.read"]),
};

function previewConfig() {
  const environment = process.env["INVENTORY_ENVIRONMENT"];
  const password = process.env["INVENTORY_PREVIEW_PASSWORD"];
  const secret = process.env["INVENTORY_SESSION_SECRET"];
  if (
    !sharedPreviewBoundaryEnabled(process.env) ||
    !["development", "preview", "test"].includes(environment ?? "") ||
    !password ||
    password.length < 12 ||
    !secret ||
    secret.length < 32
  )
    return null;
  return { password, secret };
}
export function isPreviewLoginDisabled() {
  return (
    sharedPreviewBoundaryEnabled(process.env) &&
    process.env["INVENTORY_DISABLE_PREVIEW_LOGIN"] === "true" &&
    process.env["INVENTORY_ENVIRONMENT"] === "preview" &&
    process.env["VERCEL_ENV"] === "preview"
  );
}
function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
function namedCookie(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function cookie(request: Request) {
  return namedCookie(request, cookieName);
}
function secureCookie(request: Request, value: string, maxAge: number, name = cookieName) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function hasPreviewSession(request: Request, now = Date.now()) {
  const settings = previewConfig();
  if (!settings) return false;
  const token = cookie(request);
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !equal(signature, sign(payload, settings.secret)))
    return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      expires?: number;
      actor?: string;
    };
    return (
      data.actor === "preview-operator" &&
      typeof data.expires === "number" &&
      data.expires > now &&
      data.expires <= now + previewLifetimeSeconds * 1000
    );
  } catch {
    return false;
  }
}

export async function previewLogin(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const settings = previewConfig();
  if (!settings)
    return Response.json({ error: "Acesso de Preview ainda não configurado." }, { status: 503 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const password =
    body && typeof body === "object" && "password" in body ? body.password : undefined;
  if (typeof password !== "string" || !equal(password, settings.password))
    return Response.json({ error: "Credenciais inválidas." }, { status: 401 });
  const payload = Buffer.from(
    JSON.stringify({
      actor: "preview-operator",
      expires: Date.now() + previewLifetimeSeconds * 1000,
    }),
  ).toString("base64url");
  return Response.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": secureCookie(
          request,
          `${payload}.${sign(payload, settings.secret)}`,
          previewLifetimeSeconds,
        ),
      },
    },
  );
}

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 200)
    throw new Error("A senha deve ter entre 12 e 200 caracteres.");
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}
const unusablePasswordHash = `scrypt$32768$8$1$${"A".repeat(22)}$${"A".repeat(86)}`;
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, saltValue, hashValue, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || extra || !n || !r || !p || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const derived = await derivePassword(
    password,
    Buffer.from(saltValue, "base64url"),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 },
  );
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function authenticate(request: Request): Promise<AuthContext | null> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer allik_")) {
    const token = authorization.slice("Bearer ".length);
    const result = await getPool().query(
      `WITH authenticated AS (
         SELECT c.id,c.organization_id,c.name,c.permissions
         FROM inventory_api_credentials c
         JOIN inventory_organizations o ON o.id=c.organization_id AND o.active
         WHERE c.token_hash=$1 AND c.revoked_at IS NULL AND c.expires_at>now()
       ), used AS (
         UPDATE inventory_api_credentials c SET last_used_at=now()
         FROM authenticated a WHERE c.id=a.id RETURNING c.id
       ), event AS (
         INSERT INTO inventory_api_credential_events(credential_id,action,details)
         SELECT id,'USE',jsonb_build_object('method',$2::text,'path',$3::text) FROM used
       )
       SELECT a.id,a.organization_id,a.name,a.permissions,
         COALESCE(array_agg(u.id::text) FILTER (WHERE u.id IS NOT NULL),'{}') AS unit_ids
       FROM authenticated a
       LEFT JOIN inventory_units u ON u.organization_id=a.organization_id AND u.active
       GROUP BY a.id,a.organization_id,a.name,a.permissions`,
      [hashToken(token), request.method, new URL(request.url).pathname],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0] as {
      id: string;
      organization_id: string;
      name: string;
      permissions: Permission[];
      unit_ids: string[];
    };
    return {
      user: { id: null, name: `Integração: ${row.name}`, email: null },
      membershipId: null,
      organizationId: row.organization_id,
      role: "SUPER_ADMIN",
      unitIds: row.unit_ids,
      preview: false,
      integration: { id: row.id, name: row.name, permissions: row.permissions },
    };
  }
  const rawToken = cookie(request);
  if (rawToken && !rawToken.includes(".")) {
    const result = await getPool().query(
      `SELECT u.id,u.name,u.email,m.id AS membership_id,m.organization_id,m.role,
        inventory_professional_registration_state(u.id,m.organization_id) AS registry_state,
        COALESCE(array_agg(ua.unit_id::text) FILTER (WHERE ua.unit_id IS NOT NULL),'{}') AS unit_ids
       FROM inventory_sessions s JOIN inventory_users u ON u.id=s.user_id
       JOIN inventory_memberships m ON m.user_id=u.id AND m.active
       LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
         AND s.session_version=u.session_version AND u.active
       GROUP BY u.id,u.name,u.email,m.id,m.organization_id,m.role,s.id`,
      [hashToken(rawToken)],
    );
    if (result.rowCount) {
      const row = result.rows[0] as {
        id: string;
        name: string;
        email: string;
        registry_state: string;
        membership_id: string;
        organization_id: string;
        role: Role;
        unit_ids: string[];
      };
      return {
        user: {
          id: row.id,
          name: row.name,
          email: row.email,
          professionalRegistryState: row.registry_state,
        },
        membershipId: row.membership_id,
        organizationId: row.organization_id,
        role: row.role,
        unitIds: row.unit_ids,
        preview: false,
        integration: null,
      };
    }
  }
  const previewAutoLoginAllowed = namedCookie(request, previewOptOutCookieName) !== "1";
  if ((isPreviewLoginDisabled() && previewAutoLoginAllowed) || hasPreviewSession(request)) {
    if (fullPreviewOperatorEnabled(process.env)) {
      const demo = previewOperatorIdentity;
      const result = await getPool().query(
        `SELECT u.id,m.id AS membership_id,
          inventory_professional_registration_state(u.id,m.organization_id) AS registry_state
         FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id
         WHERE u.id=$1 AND m.id=$2 AND m.organization_id=$3 AND u.email=$4 AND u.name=$5
          AND u.active AND m.active AND m.role='SUPER_ADMIN'
          AND u.password_hash IS NULL AND u.professional_council='CRM'
          AND u.council_number=$6 AND u.council_region='CE'`,
        [
          demo.id,
          demo.membershipId,
          demo.organizationId,
          demo.email,
          demo.name,
          demo.councilNumber,
        ],
      );
      if (result.rows[0]?.registry_state !== "OK") return null;
      return {
        user: { id: demo.id, name: demo.name, email: demo.email, professionalRegistryState: "OK" },
        membershipId: demo.membershipId,
        organizationId: demo.organizationId,
        role: "SUPER_ADMIN",
        unitIds: [],
        // Legacy `preview` denotes the restricted anonymous actor (without an audit FK).
        preview: false,
        sharedPreviewOperator: true,
        integration: null,
      };
    }
    return {
      user: { id: null, name: "Operador do Preview", email: null },
      membershipId: null,
      organizationId: "a1100000-0000-4000-8000-000000000001",
      role: "SUPER_ADMIN",
      unitIds: [],
      preview: true,
      integration: null,
    };
  }
  return null;
}

export function can(context: AuthContext, permission: Permission, unitId?: string | null) {
  if (
    permission === "patients.clinical.manage" &&
    ["DUPLICATE", "INVALID"].includes(context.user.professionalRegistryState ?? "")
  )
    return false;
  if (context.integration && !context.integration.permissions.includes(permission)) return false;
  if (!permissions[context.role].has(permission)) return false;
  if (!unitId || context.preview || context.role === "SUPER_ADMIN") return true;
  return context.unitIds.includes(unitId);
}

/** Only Preview and SUPER_ADMIN have organization-wide operational scope. */
export function canAccessAllUnits(context: AuthContext) {
  return context.preview || context.role === "SUPER_ADMIN";
}

export function actor(context: AuthContext) {
  return {
    name: context.preview ? "preview-operator" : context.user.name,
    userId: context.user.id,
  };
}

export async function canAccessLocations(context: AuthContext, locationIds: string[]) {
  if (!locationIds.length) return true;
  if (context.preview) return true;
  const result = await getPool().query(
    `SELECT count(DISTINCT l.id)::int AS count
     FROM inventory_locations l JOIN inventory_units u ON u.id=l.unit_id
     WHERE l.id=ANY($1::uuid[]) AND l.active AND u.active AND u.organization_id=$2
       AND ($3::boolean OR l.unit_id=ANY($4::uuid[]))`,
    [
      locationIds,
      context.organizationId,
      context.preview || context.role === "SUPER_ADMIN",
      context.unitIds,
    ],
  );
  return result.rows[0]?.count === new Set(locationIds).size;
}

export async function pilotLogin(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const email = body && typeof body === "object" && "email" in body ? body.email : undefined;
  const password =
    body && typeof body === "object" && "password" in body ? body.password : undefined;
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim().length > 254 ||
    password.length > 200
  )
    return Response.json({ error: "Credenciais inválidas." }, { status: 401 });
  const normalized = email.trim().toLowerCase();
  // Vercel overwrites this platform header. Do not trust a client-supplied
  // x-forwarded-for value or let an email variant evade the shared counter.
  const ip =
    process.env["VERCEL"] === "1"
      ? (request.headers.get("x-vercel-forwarded-for") ?? "unknown")
      : "local";
  // Successful attempts are returned below, so the per-account counters hold failures only.
  // The per-address limit stops one source from locking another person's account out.
  const accountLimits = [`login-email-ip:${normalized}:${ip}`, `login-email:${normalized}`];
  if (
    !(await consumeAuthRateLimit(`login-ip:${ip}`, 100)) ||
    !(await consumeAuthRateLimit(accountLimits[0]!, 10)) ||
    !(await consumeAuthRateLimit(accountLimits[1]!, 50))
  )
    return Response.json(
      { error: "Muitas tentativas de acesso. Tente novamente mais tarde." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "3600" } },
    );
  const result = await getPool().query(
    "SELECT id,password_hash,active,session_version FROM inventory_users WHERE lower(email)=lower($1)",
    [normalized],
  );
  const row = result.rows[0] as
    | { id: string; password_hash: string | null; active: boolean; session_version: number }
    | undefined;
  // Unknown and pending accounts pay the same scrypt cost as real ones.
  const valid =
    (await verifyPassword(password, row?.password_hash ?? unusablePasswordHash)) &&
    Boolean(row?.password_hash);
  if (!row || !row.active || !valid) {
    await getPool().query(
      "INSERT INTO inventory_auth_events(user_id,event) VALUES($1,'LOGIN_FAILURE')",
      [row?.id ?? null],
    );
    return Response.json({ error: "Credenciais inválidas." }, { status: 401 });
  }
  for (const key of accountLimits) await releaseAuthRateLimit(key);
  const token = randomBytes(32).toString("base64url");
  await getPool().query(
    `WITH created AS (INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,$3,now()+make_interval(secs=>$4)) RETURNING user_id) INSERT INTO inventory_auth_events(user_id,event) SELECT user_id,'LOGIN_SUCCESS' FROM created`,
    [row.id, hashToken(token), row.session_version, pilotLifetimeSeconds],
  );
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", secureCookie(request, token, pilotLifetimeSeconds));
  headers.append("Set-Cookie", secureCookie(request, "", 0, previewOptOutCookieName));
  return Response.json({ ok: true }, { headers });
}

export function clearedSessionHeaders(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", secureCookie(request, "", 0));
  headers.append(
    "Set-Cookie",
    secureCookie(request, "1", previewLifetimeSeconds, previewOptOutCookieName),
  );
  return headers;
}

export async function logout(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const rawToken = cookie(request);
  if (rawToken && !rawToken.includes("."))
    await getPool().query(
      `WITH revoked AS (UPDATE inventory_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE token_hash=$1 RETURNING user_id) INSERT INTO inventory_auth_events(user_id,event) SELECT user_id,'LOGOUT' FROM revoked`,
      [hashToken(rawToken)],
    );
  const headers = clearedSessionHeaders(request);
  return Response.json({ ok: true }, { headers });
}

export async function sessionResponse(request: Request) {
  if (request.method === "DELETE") return logout(request);
  if (request.method === "GET") {
    const context = await authenticate(request);
    if (!context) {
      if (
        !previewBoundaryWarningRecorded &&
        process.env["INVENTORY_PREVIEW_OPERATOR_FULL_ACCESS"] === "true" &&
        process.env["VERCEL_ENV"] === "preview"
      ) {
        previewBoundaryWarningRecorded = true;
        console.warn(
          "SHARED_PREVIEW_ACCESS_DENIED",
          sharedPreviewBoundaryProblem(process.env) ?? "PREVIEW_SHARED_SESSION_UNAVAILABLE",
        );
      }
      return Response.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    }
    const allowedUnits = context.preview || context.role === "SUPER_ADMIN" ? null : context.unitIds;
    const unitsResult = await getPool().query(
      `SELECT id,name FROM inventory_units WHERE organization_id=$1 AND active
       AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,
      [context.organizationId, allowedUnits],
    );
    return Response.json(
      {
        data: {
          ...context,
          units: unitsResult.rows,
          capabilities: {
            canReadPricingCosts: can(context, "pricing.costs.read"),
            canManagePricing:
              Boolean(context.user.id) &&
              !context.preview &&
              !context.integration &&
              can(context, "pricing.manage"),
          },
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (process.env["INVENTORY_ENVIRONMENT"] === "production") return pilotLogin(request);

  // Preview deployments can be backed by an isolated database branch copied
  // from Pilot. Prefer individual authentication whenever the login form sends
  // an email, while retaining the password-only synthetic flow for local tests.
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const hasIndividualIdentity =
    body !== null &&
    typeof body === "object" &&
    "email" in body &&
    typeof body.email === "string" &&
    body.email.trim().length > 0;
  return hasIndividualIdentity ? pilotLogin(request) : previewLogin(request);
}
