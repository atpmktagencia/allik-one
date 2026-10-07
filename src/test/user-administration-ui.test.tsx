import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));

import { UserAdministration } from "@/routes/estoque/usuarios";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("User administration UI", () => {
  it("creates a user with access to more than one unit", async () => {
    const unitIds = {
      fortaleza: "11111111-1111-4111-8111-111111111111",
      juazeiro: "22222222-2222-4222-8222-222222222222",
    };
    let submittedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ data: { activationPath: "/estoque/ativar?token=test" } });
        }
        if (url.endsWith("/api/inventory-session"))
          return Response.json({
            data: {
              units: [
                { id: unitIds.fortaleza, name: "Fortaleza" },
                { id: unitIds.juazeiro, name: "Juazeiro do Norte" },
              ],
            },
          });
        return Response.json({ data: [] });
      }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });

    render(<UserAdministration />);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Usuário Multunidade" } });
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "multi@allik.test" },
    });
    fireEvent.click(await screen.findByLabelText("Fortaleza"));
    fireEvent.click(screen.getByLabelText("Juazeiro do Norte"));
    fireEvent.click(screen.getByRole("button", { name: "Criar e copiar convite" }));

    await waitFor(() =>
      expect(submittedBody?.["unitIds"]).toEqual([unitIds.fortaleza, unitIds.juazeiro]),
    );
  });
});
