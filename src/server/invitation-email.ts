import "@tanstack/react-start/server-only";

export async function sendInvitationEmail(email: string, token: string) {
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
  )
    return "NOT_CONFIGURED" as const;
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
    )
      return "NOT_CONFIGURED" as const;
  } catch {
    return "NOT_CONFIGURED" as const;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("INVITE_DELIVERY_TIMEOUT"));
      }, 8000);
    });
    const delivery = async () => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Allik One — ative sua conta",
          text: `Você recebeu um convite para o Allik One. Defina sua senha pelo link de uso único, válido por 72 horas:\n${origin.origin}/estoque/ativar?token=${token}\n\nNão compartilhe este link. Se não reconhece o convite, ignore a mensagem.`,
        }),
      });
      if (!response.ok || typeof (await response.json()).id !== "string")
        throw new Error("INVITE_DELIVERY_FAILED");
    };
    await Promise.race([delivery(), timeout]);
    return "ACCEPTED" as const;
  } catch {
    // The same invitation remains usable for the explicitly authorized manual WhatsApp handoff.
    // Never log the provider response, recipient or activation token.
    return "FAILED" as const;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
