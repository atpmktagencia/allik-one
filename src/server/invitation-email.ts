import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";

export type InvitationEmailFailure =
  | "NOT_CONFIGURED"
  | "INVALID_ORIGIN"
  | "INVALID_API_KEY"
  | "DOMAIN_NOT_VERIFIED"
  | "TEST_RECIPIENT_RESTRICTED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "TIMEOUT"
  | "NETWORK_ERROR";
class InvitationDeliveryError extends Error {
  constructor(readonly code: InvitationEmailFailure) {
    super(code);
  }
}

export async function sendInvitationEmail(
  email: string,
  token: string,
  onFailure?: (reason: InvitationEmailFailure) => void,
) {
  const reportFailure = (reason: InvitationEmailFailure) => {
    onFailure?.(reason);
    console.error("INVITATION_EMAIL_FAILED", reason);
  };
  const key = process.env["RESEND_API_KEY"];
  const from = process.env["AUTH_EMAIL_FROM"];
  const rawOrigin =
    process.env["VERCEL_ENV"] === "preview"
      ? `https://${process.env["VERCEL_URL"] ?? ""}`
      : process.env["AUTH_PUBLIC_ORIGIN"];
  if (
    process.env["AUTH_INVITES_ENABLED"] !== "true" ||
    !key ||
    !from ||
    /[\r\n]/.test(from) ||
    !rawOrigin
  ) {
    reportFailure("NOT_CONFIGURED");
    return "NOT_CONFIGURED" as const;
  }
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      reportFailure("INVALID_ORIGIN");
      return "NOT_CONFIGURED" as const;
    }
  } catch {
    reportFailure("INVALID_ORIGIN");
    return "NOT_CONFIGURED" as const;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new InvitationDeliveryError("TIMEOUT"));
      }, 8000);
    });
    const delivery = async () => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `invitation/${createHash("sha256").update(token).digest("hex")}`,
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Allik One — ative sua conta",
          text: `Você recebeu um convite para o Allik One. Defina sua senha pelo link de uso único, válido por 72 horas:\n${origin.origin}/estoque/ativar#activate=${token}\n\nNão compartilhe este link. Se não reconhece o convite, ignore a mensagem.`,
        }),
      });
      let payload: { id?: unknown; message?: unknown } | null = null;
      try {
        payload = await response.json();
      } catch {
        if (response.ok) throw new InvitationDeliveryError("INVALID_RESPONSE");
      }
      if (!response.ok) {
        // Classify known provider failures; never expose/log the provider body or recipient.
        const message = typeof payload?.message === "string" ? payload.message.toLowerCase() : "";
        const code: InvitationEmailFailure =
          response.status === 401
            ? "INVALID_API_KEY"
            : message.includes("domain is not verified") || message.includes("verify your domain")
              ? "DOMAIN_NOT_VERIFIED"
              : message.includes("testing emails") && message.includes("own email")
                ? "TEST_RECIPIENT_RESTRICTED"
                : response.status === 403
                  ? "FORBIDDEN"
                  : response.status === 429
                    ? "RATE_LIMITED"
                    : response.status >= 500
                      ? "PROVIDER_UNAVAILABLE"
                      : "INVALID_REQUEST";
        throw new InvitationDeliveryError(code);
      }
      if (typeof payload?.id !== "string") throw new InvitationDeliveryError("INVALID_RESPONSE");
    };
    await Promise.race([delivery(), timeout]);
    return "ACCEPTED" as const;
  } catch (error) {
    reportFailure(
      controller.signal.aborted
        ? "TIMEOUT"
        : error instanceof InvitationDeliveryError
          ? error.code
          : "NETWORK_ERROR",
    );
    // The same invitation remains usable for the explicitly authorized manual WhatsApp handoff.
    // Never log the provider response, recipient or activation token.
    return "FAILED" as const;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
