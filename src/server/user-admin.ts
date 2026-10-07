import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { authenticate, can, hashPassword, hashToken, roles } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const createUser = z.object({
  action: z.literal("CREATE"),
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(254),
  profession: z.string().trim().max(100).optional(),
  title: z.string().trim().max(150).optional(),
  role: z.enum(roles),
  unitIds: z.array(z.string().uuid()).max(20),
});
const updateUser = z.object({
  action: z.enum(["ACTIVATE", "DEACTIVATE", "REINVITE"]),
  userId: z.string().uuid(),
});

async function createInvite(
  userId: string,
  organizationId: string,
  createdByUserId: string | null,
) {
  const token = randomBytes(32).toString("base64url");
  await getPool().query(
    `WITH revoked AS (
       UPDATE inventory_invites SET revoked_at=now()
       WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL
     ), created AS (
       INSERT INTO inventory_invites(user_id,organization_id,token_hash,expires_at,created_by_user_id)
       VALUES($1,$2,$3,now()+interval '72 hours',$4) RETURNING user_id
     ) INSERT INTO inventory_auth_events(user_id,event) SELECT user_id,'INVITE_CREATED' FROM created`,
    [userId, organizationId, hashToken(token), createdByUserId],
  );
  return token;
}

export async function userAdminResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para administrar usuários." }, { status: 401, headers });
  if (!can(auth, "users.manage"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (request.method === "GET") {
    const result = await getPool().query(
      `SELECT u.id,u.name,u.email,u.profession,u.title,u.active,m.role,
       COALESCE(jsonb_agg(jsonb_build_object('id',un.id,'name',un.name) ORDER BY un.name) FILTER (WHERE un.id IS NOT NULL),'[]') AS units
       FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id
       LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id LEFT JOIN inventory_units un ON un.id=ua.unit_id
       WHERE m.organization_id=$1 GROUP BY u.id,m.id ORDER BY u.name`,
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
  const parsed = z.discriminatedUnion("action", [createUser, updateUser]).safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Confira os dados do usuário." }, { status: 400, headers });
  const input = parsed.data;
  if (input.action === "CREATE") {
    if (input.role === "SUPER_ADMIN")
      return Response.json(
        { error: "A criação de outro superadministrador exige o bootstrap controlado." },
        { status: 403, headers },
      );
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const validUnits = await client.query(
        "SELECT id FROM inventory_units WHERE organization_id=$1 AND active AND id=ANY($2::uuid[])",
        [auth.organizationId, input.unitIds],
      );
      if (validUnits.rowCount !== new Set(input.unitIds).size) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Uma unidade informada é inválida." },
          { status: 400, headers },
        );
      }
      const user = await client.query(
        "INSERT INTO inventory_users(name,email,profession,title) VALUES($1,lower($2),$3,$4) RETURNING id",
        [input.name, input.email, input.profession ?? null, input.title ?? null],
      );
      const membership = await client.query(
        "INSERT INTO inventory_memberships(user_id,organization_id,role) VALUES($1,$2,$3) RETURNING id",
        [user.rows[0].id, auth.organizationId, input.role],
      );
      for (const unitId of input.unitIds)
        await client.query(
          "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
          [membership.rows[0].id, unitId],
        );
      await client.query("COMMIT");
      const token = await createInvite(user.rows[0].id, auth.organizationId, auth.user.id);
      return Response.json(
        { data: { id: user.rows[0].id, activationPath: `/estoque/ativar?token=${token}` } },
        { status: 201, headers },
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      return Response.json(
        {
          error:
            code === "23505"
              ? "Este e-mail já está cadastrado."
              : "Não foi possível criar o usuário.",
        },
        { status: code === "23505" ? 409 : 503, headers },
      );
    } finally {
      client.release();
    }
  }
  const target = await getPool().query(
    "SELECT u.id,u.active FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.organization_id=$2 AND m.role<>'SUPER_ADMIN'",
    [input.userId, auth.organizationId],
  );
  if (!target.rowCount)
    return Response.json(
      { error: "Usuário não encontrado ou protegido." },
      { status: 404, headers },
    );
  if (input.action === "REINVITE") {
    if (!target.rows[0].active)
      return Response.json(
        { error: "Ative o usuário antes de gerar um novo convite." },
        { status: 409, headers },
      );
    const token = await createInvite(input.userId, auth.organizationId, auth.user.id);
    return Response.json(
      { data: { activationPath: `/estoque/ativar?token=${token}` } },
      { headers },
    );
  }
  const active = input.action === "ACTIVATE";
  await getPool().query(
    `WITH changed AS (
       UPDATE inventory_users SET active=$2,session_version=session_version+1,updated_at=now()
       WHERE id=$1 RETURNING id
     ), revoked_invites AS (
       UPDATE inventory_invites SET revoked_at=now()
       WHERE user_id=(SELECT id FROM changed) AND $2=false
         AND used_at IS NULL AND revoked_at IS NULL
     )
     INSERT INTO inventory_auth_events(user_id,event) SELECT id,$3 FROM changed`,
    [input.userId, active, active ? "USER_ACTIVATED" : "USER_DEACTIVATED"],
  );
  return Response.json({ data: { id: input.userId, active } }, { headers });
}

const activationInput = z.object({
  token: z.string().min(40).max(100),
  password: z.string().min(12).max(200),
});
export async function activationResponse(request: Request) {
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405 });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const parsed = activationInput.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Convite ou senha inválidos." }, { status: 400 });
  const passwordHash = await hashPassword(parsed.data.password);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const invite = await client.query(
      `SELECT i.id,i.user_id FROM inventory_invites i
       JOIN inventory_users u ON u.id=i.user_id AND u.active
       WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
       FOR UPDATE OF i,u`,
      [hashToken(parsed.data.token)],
    );
    if (!invite.rowCount) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Este convite é inválido, expirou ou já foi utilizado." },
        { status: 410 },
      );
    }
    await client.query(
      "UPDATE inventory_users SET password_hash=$2,active=true,session_version=session_version+1,updated_at=now() WHERE id=$1",
      [invite.rows[0].user_id, passwordHash],
    );
    await client.query("UPDATE inventory_invites SET used_at=now() WHERE id=$1", [
      invite.rows[0].id,
    ]);
    await client.query(
      "INSERT INTO inventory_auth_events(user_id,event) VALUES($1,'INVITE_ACCEPTED')",
      [invite.rows[0].user_id],
    );
    await client.query("COMMIT");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json({ error: "Não foi possível concluir a ativação." }, { status: 503 });
  } finally {
    client.release();
  }
}
