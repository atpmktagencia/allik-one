import "@tanstack/react-start/server-only";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
const cookieName = "allik_inventory_session";
const lifetime = 60 * 60 * 8;
function config() {
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
export function hasPreviewSession(request: Request, now = Date.now()) {
  const settings = config();
  if (!settings) return false;
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
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
      data.expires <= now + lifetime * 1000
    );
  } catch {
    return false;
  }
}
export async function previewLogin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const settings = config();
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
    return Response.json({ error: "Senha inválida." }, { status: 401 });
  const payload = Buffer.from(
    JSON.stringify({ actor: "preview-operator", expires: Date.now() + lifetime * 1000 }),
  ).toString("base64url");
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${cookieName}=${payload}.${sign(payload, settings.secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetime}${secure}`,
      },
    },
  );
}
