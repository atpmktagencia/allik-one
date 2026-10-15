import { describe, expect, it } from "vitest";
import { InventoryError, readInventoryResponse } from "@/data/inventory-api";

describe("inventory API response handling", () => {
  it("preserves an application error returned as JSON", async () => {
    const response = Response.json({ error: "Conflito de agenda." }, { status: 409 });
    await expect(readInventoryResponse(response)).rejects.toEqual(
      expect.objectContaining<Partial<InventoryError>>({
        message: "Conflito de agenda.",
        status: 409,
      }),
    );
  });

  it("replaces an HTML infrastructure error with a useful message", async () => {
    const response = new Response("<!doctype html><title>Unavailable</title>", {
      status: 503,
      headers: { "Content-Type": "text/html" },
    });
    await expect(readInventoryResponse(response)).rejects.toMatchObject({
      message: "O serviço está temporariamente indisponível. Tente novamente em instantes.",
      status: 503,
    });
  });

  it("rejects a non-JSON success instead of exposing a parser error", async () => {
    const response = new Response("<!doctype html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
    await expect(readInventoryResponse(response)).rejects.toMatchObject({
      message: "O servidor devolveu uma resposta inválida. Tente novamente.",
      status: 200,
    });
  });
});
