import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { authenticate, can, hashToken, type Permission } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export const integrationPermissions = [
  "inventory.read",
  "inventory.catalog.manage",
  "inventory.supplier.manage",
  "inventory.purchase.manage",
  "inventory.receive",
  "inventory.adjust",
  "inventory.trace",
  "inventory.audit.read",
] as const satisfies readonly Permission[];

const createCredential = z.object({
  action: z.literal("CREATE"),
  name: z.string().trim().min(3).max(100),
  expiresInDays: z.union([z.literal(30), z.literal(90)]),
  permissions: z.array(z.enum(integrationPermissions)).min(1).max(integrationPermissions.length),
});
const revokeCredential = z.object({
  action: z.literal("REVOKE"),
  credentialId: z.string().uuid(),
});

export async function integrationCredentialResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json(
      { error: "Entre para administrar integrações." },
      { status: 401, headers },
    );
  if (auth.preview || auth.integration || auth.role !== "SUPER_ADMIN" || !can(auth, "users.manage"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });

  if (request.method === "GET") {
    const result = await getPool().query(
      `SELECT c.id,c.name,c.permissions,c.expires_at,c.revoked_at,c.last_used_at,c.created_at,
        u.name AS created_by,
        CASE WHEN c.revoked_at IS NOT NULL THEN 'REVOKED'
             WHEN c.expires_at<=now() THEN 'EXPIRED' ELSE 'ACTIVE' END AS status
       FROM inventory_api_credentials c
       JOIN inventory_users u ON u.id=c.created_by_user_id
       WHERE c.organization_id=$1 ORDER BY c.created_at DESC`,
      [auth.organizationId],
    );
    return Response.json({ data: result.rows }, { headers });
  }
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = z
    .discriminatedUnion("action", [createCredential, revokeCredential])
    .safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Confira os dados da integração." }, { status: 400, headers });

  if (parsed.data.action === "REVOKE") {
    const result = await getPool().query(
      `WITH revoked AS (
         UPDATE inventory_api_credentials SET revoked_at=now()
         WHERE id=$1 AND organization_id=$2 AND revoked_at IS NULL RETURNING id
       )
       INSERT INTO inventory_api_credential_events(credential_id,action,actor_user_id)
       SELECT id,'REVOKE',$3 FROM revoked RETURNING credential_id`,
      [parsed.data.credentialId, auth.organizationId, auth.user.id],
    );
    if (!result.rowCount)
      return Response.json(
        { error: "Integração não encontrada ou já revogada." },
        { status: 404, headers },
      );
    return Response.json(
      { data: { id: parsed.data.credentialId, status: "REVOKED" } },
      { headers },
    );
  }

  const token = `allik_${randomBytes(32).toString("base64url")}`;
  const uniquePermissions = [...new Set(parsed.data.permissions)];
  const result = await getPool().query(
    `WITH created AS (
       INSERT INTO inventory_api_credentials(
         organization_id,name,token_hash,permissions,expires_at,created_by_user_id
       ) VALUES($1,$2,$3,$4,now()+make_interval(days=>$5),$6)
       RETURNING id,name,permissions,expires_at,created_at
     ), event AS (
       INSERT INTO inventory_api_credential_events(credential_id,action,actor_user_id)
       SELECT id,'CREATE',$6 FROM created
     ) SELECT * FROM created`,
    [
      auth.organizationId,
      parsed.data.name,
      hashToken(token),
      uniquePermissions,
      parsed.data.expiresInDays,
      auth.user.id,
    ],
  );
  return Response.json({ data: { ...result.rows[0], token } }, { status: 201, headers });
}
