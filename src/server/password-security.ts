import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
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
import { consumeAuthRateLimit } from "./auth-rate-limit";

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

function recoveryConfiguration() {
  if (process.env["AUTH_RECOVERY_ENABLED"] !== "true") return null;
  const key = process.env["RESEND_API_KEY"];
  const from = process.env["AUTH_EMAIL_FROM"];
  // Preview links always point to this deployment, never a caller-supplied Host.
  const rawOrigin =
    process.env["VERCEL_ENV"] === "preview"
      ? `https://${process.env["VERCEL_URL"] ?? ""}`
      : process.env["AUTH_PUBLIC_ORIGIN"];
  if (!key || !from || /[\r\n]/.test(from) || !rawOrigin) return null;
  try {
    const url = new URL(rawOrigin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return { key, from, origin: url.origin };
  } catch {
    return null;
  }
}

// Delivery to the provider takes a few hundred milliseconds; answering every eligible,
// unknown or throttled request after the same floor keeps account existence private.
// Disposable test databases skip the floor; a dedicated test measures it explicitly.
const recoveryResponseFloorMs = () => (process.env["INVENTORY_ENVIRONMENT"] === "test" ? 0 : 2500);

async function requestRecovery(email: string, request: Request) {
  const started = Date.now();
  const response = await issueRecovery(email, request);
  if (response.status === 200) {
    const remaining = recoveryResponseFloorMs() - (Date.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  return response;
}

async function issueRecovery(email: string, request: Request) {
  const config = recoveryConfiguration();
  if (!config)
    return Response.json(
      {
        error:
          "A recuperação por e-mail ainda não está configurada. Entre em contato com o suporte.",
      },
      { status: 503, headers },
    );
  const generic = () => Response.json({ ok: true }, { headers });
  const normalized = email.trim().toLowerCase();
  const ip =
    process.env["VERCEL"] === "1"
      ? (request.headers.get("x-vercel-forwarded-for") ?? "unknown")
      : "local";
  if (
    !(await consumeAuthRateLimit(`recovery-ip:${ip}`, 10)) ||
    !(await consumeAuthRateLimit(`recovery-email:${normalized}`, 3))
  )
    return generic();
  const pool = getPool();
  const found = await pool.query(
    "SELECT id FROM inventory_users WHERE lower(email)=$1 AND active=true AND password_hash IS NOT NULL",
    [normalized],
  );
  if (!found.rowCount) return generic();
  if (!(await consumeAuthRateLimit("recovery-delivery", 80, "day"))) return generic();
  const token = randomBytes(32).toString("hex");
  const client = await pool.connect();
  let resetId: string | undefined;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id,email,session_version FROM inventory_users WHERE id=$1 AND active=true AND password_hash IS NOT NULL FOR UPDATE",
      [found.rows[0].id],
    );
    const user = result.rows[0];
    if (user && user.email.toLowerCase() === normalized) {
      const reset = await client.query(
        `INSERT INTO inventory_password_resets(user_id,token_hash,email_hash,session_version,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes') RETURNING id`,
        [user.id, hashToken(token), hashToken(normalized), user.session_version],
      );
      resetId = reset.rows[0].id;
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error("RECOVERY_ISSUE_FAILED");
  } finally {
    client.release();
  }
  if (!resetId) return generic();
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `password-recovery/${resetId}`,
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        from: config.from,
        to: [normalized],
        subject: "Allik One — redefinir sua senha",
        text: `Você solicitou a recuperação de acesso ao Allik One.\n\nDefina sua nova senha neste link de uso único, válido por 30 minutos:\n${config.origin}/estoque/acesso#recover=${token}\n\nSe você não solicitou, ignore esta mensagem. Sua senha permanece inalterada. Nunca compartilhe este link.`,
      }),
    });
    if (!response.ok || typeof (await response.json()).id !== "string")
      throw new Error("DELIVERY_FAILED");
  } catch {
    await pool.query(
      "UPDATE inventory_password_resets SET revoked_at=now() WHERE id=$1 AND used_at IS NULL",
      [resetId],
    );
    // Never log provider bodies, recipient addresses, passwords or recovery links.
    console.error("password recovery email delivery failed");
  }
  // Same response for unknown, inactive, throttled and eligible accounts.
  return generic();
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
    return Response.json(
      { data: { recoveryAvailable: recoveryConfiguration() !== null } },
      { headers },
    );
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
    if (data.action === "REQUEST_RESET") return await requestRecovery(data.email, request);
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
