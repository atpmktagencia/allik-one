import "@tanstack/react-start/server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { getPool } from "./db";

const cookieName = "allik_inventory_session";
const previewLifetimeSeconds = 60 * 60 * 8;
const pilotLifetimeSeconds = 60 * 60 * 12;
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
  "FINANCE",
  "VIEWER",
] as const;
export type Role = (typeof roles)[number];
export type Permission =
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
  | "users.manage"
  | "organization.read";
export type AuthContext = {
  user: { id: string | null; name: string; email: string | null };
  membershipId: string | null;
  organizationId: string;
  role: Role;
  unitIds: string[];
  preview: boolean;
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
  "users.manage",
  "organization.read",
];
const permissions: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(allPermissions),
  PARTNER_ADMIN: new Set(allPermissions.filter((permission) => permission !== "users.manage")),
  INVENTORY_MANAGER: new Set(allPermissions.filter((permission) => permission !== "users.manage")),
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
    "organization.read",
  ]),
  FINANCE: new Set([
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
    !["development", "preview", "test"].includes(environment ?? "") ||
    !password ||
    password.length < 12 ||
    !secret ||
    secret.length < 32
  )
    return null;
  return { password, secret };
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
function cookie(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
function secureCookie(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
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
  if (hasPreviewSession(request))
    return {
      user: { id: null, name: "Operador do Preview", email: null },
      membershipId: null,
      organizationId: "a1100000-0000-4000-8000-000000000001",
      role: "SUPER_ADMIN",
      unitIds: [],
      preview: true,
      integration: null,
    };
  const rawToken = cookie(request);
  if (!rawToken || rawToken.includes(".")) return null;
  const result = await getPool().query(
    `SELECT u.id,u.name,u.email,m.id AS membership_id,m.organization_id,m.role,
      COALESCE(array_agg(ua.unit_id::text) FILTER (WHERE ua.unit_id IS NOT NULL),'{}') AS unit_ids
     FROM inventory_sessions s JOIN inventory_users u ON u.id=s.user_id
     JOIN inventory_memberships m ON m.user_id=u.id AND m.active
     LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id
     WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
       AND s.session_version=u.session_version AND u.active
     GROUP BY u.id,u.name,u.email,m.id,m.organization_id,m.role,s.id`,
    [hashToken(rawToken)],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0] as {
    id: string;
    name: string;
    email: string;
    membership_id: string;
    organization_id: string;
    role: Role;
    unit_ids: string[];
  };
  return {
    user: { id: row.id, name: row.name, email: row.email },
    membershipId: row.membership_id,
    organizationId: row.organization_id,
    role: row.role,
    unitIds: row.unit_ids,
    preview: false,
    integration: null,
  };
}

export function can(context: AuthContext, permission: Permission, unitId?: string | null) {
  if (context.integration && !context.integration.permissions.includes(permission)) return false;
  if (!permissions[context.role].has(permission)) return false;
  if (!unitId || context.preview || context.role === "SUPER_ADMIN") return true;
  return context.unitIds.includes(unitId);
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
  if (typeof email !== "string" || typeof password !== "string")
    return Response.json({ error: "Credenciais inválidas." }, { status: 401 });
  const result = await getPool().query(
    "SELECT id,password_hash,active,session_version FROM inventory_users WHERE lower(email)=lower($1)",
    [email.trim()],
  );
  const row = result.rows[0] as
    | { id: string; password_hash: string | null; active: boolean; session_version: number }
    | undefined;
  const valid = row?.password_hash ? await verifyPassword(password, row.password_hash) : false;
  if (!row || !row.active || !valid) {
    await getPool().query(
      "INSERT INTO inventory_auth_events(user_id,event) VALUES($1,'LOGIN_FAILURE')",
      [row?.id ?? null],
    );
    return Response.json({ error: "Credenciais inválidas." }, { status: 401 });
  }
  const token = randomBytes(32).toString("base64url");
  await getPool().query(
    `WITH created AS (INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,$3,now()+make_interval(secs=>$4)) RETURNING user_id) INSERT INTO inventory_auth_events(user_id,event) SELECT user_id,'LOGIN_SUCCESS' FROM created`,
    [row.id, hashToken(token), row.session_version, pilotLifetimeSeconds],
  );
  return Response.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": secureCookie(request, token, pilotLifetimeSeconds),
      },
    },
  );
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
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": secureCookie(request, "", 0) } },
  );
}

export async function sessionResponse(request: Request) {
  if (request.method === "DELETE") return logout(request);
  if (request.method === "GET") {
    const context = await authenticate(request);
    if (!context) return Response.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const allowedUnits = context.preview || context.role === "SUPER_ADMIN" ? null : context.unitIds;
    const unitsResult = await getPool().query(
      `SELECT id,name FROM inventory_units WHERE organization_id=$1 AND active
       AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,
      [context.organizationId, allowedUnits],
    );
    return Response.json(
      { data: { ...context, units: unitsResult.rows } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return process.env["INVENTORY_ENVIRONMENT"] === "production"
    ? pilotLogin(request)
    : previewLogin(request);
}
