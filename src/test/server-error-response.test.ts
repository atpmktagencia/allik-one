import { afterEach, describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => vi.fn());
vi.mock("@/lib/error-capture", () => ({ consumeLastCapturedError: () => undefined }));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: handler } }));
import server from "@/server";

afterEach(() => {
  handler.mockReset();
  vi.restoreAllMocks();
});

describe("server error response boundary", () => {
  it("normalizes an HTML failure produced by the framework for an API request", async () => {
    handler.mockResolvedValue(
      new Response("<!doctype html><title>Unavailable</title>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const response = await server.fetch(
      new Request("https://preview.example.test/api/inventory-session"),
      {},
      {},
    );
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "O serviço está temporariamente indisponível. Tente novamente em instantes.",
    });
  });
  it.each(["throw", "swallowed"])(
    "returns safe JSON for a catastrophic API error: %s",
    async (kind) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      if (kind === "throw") handler.mockRejectedValue(new Error("INVENTORY_RUNTIME_ROLE_REJECTED"));
      else
        handler.mockResolvedValue(
          Response.json({ unhandled: true, message: "HTTPError" }, { status: 500 }),
        );
      const response = await server.fetch(
        new Request("https://preview.example.test/api/inventory-session", { method: "POST" }),
        {},
        {},
      );
      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "O serviço está temporariamente indisponível. Tente novamente em instantes.",
      });
    },
  );

  it("preserves application validation errors", async () => {
    handler.mockResolvedValue(Response.json({ error: "Credenciais inválidas." }, { status: 401 }));
    const response = await server.fetch(
      new Request("https://preview.example.test/api/inventory-session"),
      {},
      {},
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Credenciais inválidas." });
  });

  it("keeps an HTML fallback for page requests", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    handler.mockRejectedValue(new Error("SSR unavailable"));
    const response = await server.fetch(
      new Request("https://preview.example.test/estoque"),
      {},
      {},
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain("<!doctype html>");
  });
});
