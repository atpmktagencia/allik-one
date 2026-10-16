import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
import { ActivateInventoryAccount } from "@/routes/estoque/ativar";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
it.each(["#activate=synthetic-token", "?token=synthetic-token"])(
  "keeps the token only in memory and accepts %s",
  async (suffix) => {
    window.history.replaceState(null, "", `/estoque/ativar${suffix}`);
    const outgoing = vi.fn(async () => Response.json({ data: { activated: true } }));
    vi.stubGlobal("fetch", outgoing);
    render(<ActivateInventoryAccount />);
    expect(window.location.href).not.toContain("synthetic-token");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    fireEvent.change(screen.getByLabelText("Nova senha"), {
      target: { value: "Synthetic-password-2026!" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), {
      target: { value: "Synthetic-password-2026!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Definir senha" }));
    await waitFor(() => expect(outgoing).toHaveBeenCalled());
    expect(outgoing).toHaveBeenCalledWith(
      "/api/inventory-activation",
      expect.objectContaining({
        body: JSON.stringify({ token: "synthetic-token", password: "Synthetic-password-2026!" }),
      }),
    );
    expect(await screen.findByRole("heading", { name: "Conta ativada" })).toBeInTheDocument();
  },
);
