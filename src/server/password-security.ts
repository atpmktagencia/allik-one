import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  authenticate,
  clearedSessionHeaders,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("CHANGE_PASSWORD"),
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(12).max(200),
    })
    .strict(),
  z
    .object({ action: z.literal("REQUEST_RESET"), email: z.string().trim().email().max(254) })
    .strict(),
  z
    .object({
      action: z.literal("RESET_PASSWORD"),
      token: z.string().min(32).max(100),
      newPassword: z.string().min(12).max(200),
    })
    .strict(),
]);

export async function consumeAuthRateLimit(key: string, limit: number) {
  const result = await getPool().query(
    `INSERT INTO inventory_auth_rate_limits(key,bucket,attempts)
    VALUES($1,date_trunc('hour',now()),1) ON CONFLICT(key,bucket)
    DO UPDATE SET attempts=LEAST(inventory_auth_rate_limits.attempts+1,1000000) RETURNING attempts`,
    [hashToken(key)],
  );
  return result.rows[0].attempts <= limit;
}

async function invalidateAccountCredentials(
  client: PoolClient,
  userId: string,
  passwordHash: string,
  event: string,
  resetId?: string,
) {
  await client.query(
    "UPDATE inventory_users SET password_hash=$2,session_version=session_version+1,updated_at=now() WHERE id=$1",
    [userId, passwordHash],
  );
  await client.query(
    "UPDATE inventory_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL",
    [userId],
  );
  await client.query(
    "UPDATE inventory_invites SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
    [userId],
  );
  if (resetId)
    await client.query("UPDATE inventory_password_resets SET used_at=now() WHERE id=$1", [resetId]);
  await client.query(
    "UPDATE inventory_password_resets SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
    [userId],
  );
  await client.query("INSERT INTO inventory_auth_events(user_id,event) VALUES($1,$2)", [
    userId,
    event,
  ]);
}

export async function passwordSecurityResponse(request: Request) {
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (request.method === "GET")
    return Response.json({ data: { recoveryAvailable: false } }, { headers });
  if (request.method !== "POST") return fail("Método não permitido.", 405);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return fail("Origem não autorizada.", 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Requisição inválida.", 400);
  }
  const parsed = input.safeParse(body);
  if (!parsed.success)
    return fail("Confira os dados. A nova senha precisa ter pelo menos 12 caracteres.", 400);
  const data = parsed.data;
  try {
    if (data.action === "REQUEST_RESET")
      return fail(
        "A recuperação por e-mail ainda não está configurada. Entre em contato com o suporte.",
        503,
      );
    let userId: string;
    if (data.action === "CHANGE_PASSWORD") {
      const auth = await authenticate(request);
      if (!auth?.user.id || auth.preview || auth.integration)
        return fail("Entre com sua conta individual para alterar a senha.", 401);
      userId = auth.user.id;
      if (!(await consumeAuthRateLimit(`change-password:${userId}`, 5)))
        return fail("Muitas tentativas. Aguarde antes de tentar novamente.", 429);
    } else {
      if (!(await consumeAuthRateLimit(`complete-reset:${hashToken(data.token)}`, 5)))
        return fail("Este link é inválido ou expirou.", 410);
      const result = await getPool().query(
        "SELECT user_id FROM inventory_password_resets WHERE token_hash=$1",
        [hashToken(data.token)],
      );
      if (!result.rowCount) return fail("Este link é inválido, expirou ou já foi usado.", 410);
      userId = result.rows[0].user_id;
    }
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      // All credential flows lock the user first, then invitations/recovery records.
      const result = await client.query(
        "SELECT id,email,password_hash,active,session_version FROM inventory_users WHERE id=$1 FOR UPDATE",
        [userId],
      );
      const user = result.rows[0];
      if (!user?.active || !user.password_hash) {
        await client.query("ROLLBACK");
        return fail(
          "Credenciais inválidas ou conta indisponível.",
          data.action === "RESET_PASSWORD" ? 410 : 401,
        );
      }
      let resetId: string | undefined;
      if (data.action === "CHANGE_PASSWORD") {
        if (!(await verifyPassword(data.currentPassword, user.password_hash))) {
          await client.query("ROLLBACK");
          return fail("Senha atual inválida.", 401);
        }
      } else {
        const recovery = await client.query(
          `SELECT id,session_version,email_hash FROM inventory_password_resets WHERE token_hash=$1 AND user_id=$2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
          [hashToken(data.token), userId],
        );
        const token = recovery.rows[0];
        if (
          !token ||
          token.session_version !== user.session_version ||
          token.email_hash !== hashToken(user.email.toLowerCase())
        ) {
          await client.query("ROLLBACK");
          return fail("Este link é inválido, expirou ou já foi usado.", 410);
        }
        resetId = token.id;
      }
      if (await verifyPassword(data.newPassword, user.password_hash)) {
        await client.query("ROLLBACK");
        return fail("Escolha uma senha diferente da atual.", 400);
      }
      await invalidateAccountCredentials(
        client,
        userId,
        await hashPassword(data.newPassword),
        data.action === "CHANGE_PASSWORD" ? "PASSWORD_CHANGED" : "PASSWORD_RESET",
        resetId,
      );
      await client.query("COMMIT");
      return Response.json({ ok: true }, { headers: clearedSessionHeaders(request) });
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error("PASSWORD_OPERATION_FAILED");
    } finally {
      client.release();
    }
  } catch {
    console.error("password security operation failed");
    return fail("Não foi possível concluir a operação de senha. Tente novamente.", 503);
  }
}
