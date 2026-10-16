import { afterEach, describe, expect, it, vi } from "vitest";
import { sendInvitationEmail } from "./invitation-email";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function configure() {
  vi.stubEnv("AUTH_INVITES_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "synthetic-key");
  vi.stubEnv("AUTH_EMAIL_FROM", "Allik <sender@example.test>");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("AUTH_PUBLIC_ORIGIN", "https://allik.example.test");
}
describe("Holder invitation email", () => {
  it("sends only to the holder with fixed origin and a 72-hour single-use link", async () => {
    configure();
    const outgoing = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ id: "synthetic-id" }),
    );
    vi.stubGlobal("fetch", outgoing);
    expect(await sendInvitationEmail("holder@example.test", "synthetic-token")).toBe("ACCEPTED");
    const body = JSON.parse(String(outgoing.mock.calls[0]?.[1]?.body));
    expect(body.to).toEqual(["holder@example.test"]);
    expect(body.text).toContain(
      "https://allik.example.test/estoque/ativar#activate=synthetic-token",
    );
    expect(body.text).toContain("72 horas");
  });
  it("does not send when disabled or configured with an unsafe origin", async () => {
    configure();
    const outgoing = vi.fn();
    vi.stubGlobal("fetch", outgoing);
    vi.stubEnv("AUTH_INVITES_ENABLED", "false");
    expect(await sendInvitationEmail("holder@example.test", "token")).toBe("NOT_CONFIGURED");
    vi.stubEnv("AUTH_INVITES_ENABLED", "true");
    vi.stubEnv("AUTH_PUBLIC_ORIGIN", "https://user:password@unsafe.example");
    expect(await sendInvitationEmail("holder@example.test", "token")).toBe("NOT_CONFIGURED");
    expect(outgoing).not.toHaveBeenCalled();
  });
  it("reports failure without claiming delivery or losing the manual fallback", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "synthetic" }, { status: 500 })),
    );
    expect(await sendInvitationEmail("holder@example.test", "token")).toBe("FAILED");
  });
});

it("uses a stable provider idempotency key without exposing the invitation token", async () => {
  configure();
  const outgoing = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ id: "synthetic" }),
  );
  vi.stubGlobal("fetch", outgoing);
  await sendInvitationEmail("holder@example.test", "first-secret");
  await sendInvitationEmail("holder@example.test", "first-secret");
  await sendInvitationEmail("holder@example.test", "second-secret");
  const keys = outgoing.mock.calls.map((call) =>
    new Headers(call[1].headers).get("Idempotency-Key"),
  );
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).not.toBe(keys[2]);
  expect(keys[0]).toMatch(/^invitation\/[0-9a-f]{64}$/);
  expect(keys[0]).not.toContain("first-secret");
});
