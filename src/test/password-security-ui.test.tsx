import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
import { InventoryAccess } from "@/routes/estoque/acesso";
import { MyAccount } from "@/routes/estoque/minha-conta";
import { UserAdministration } from "@/routes/estoque/usuarios";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
describe("Password security UI", () => {
  it.each([500, 200])(
    "handles an HTML login response (%s) without a JSON parser error",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: unknown, init?: RequestInit) =>
          init?.method === "POST"
            ? new Response("<!doctype html><title>Unavailable</title>", {
                status,
                headers: { "Content-Type": "text/html" },
              })
            : Response.json({ data: { recoveryAvailable: false } }),
        ),
      );
      render(<InventoryAccess />);
      const submit = await screen.findByRole("button", { name: "Acessar estoque" });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.change(screen.getByLabelText("E-mail"), {
        target: { value: "owner@example.test" },
      });
      fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "test-password" } });
      fireEvent.click(submit);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        status === 500 ? "temporariamente indisponível" : "resposta inválida",
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("Unexpected token");
      expect(submit).toBeEnabled();
    },
  );
  it("does not offer a password form for the shared Preview identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            user: { name: "Preview", email: null },
            preview: true,
            role: "SUPER_ADMIN",
            units: [],
          },
        }),
      ),
    );
    render(<MyAccount />);
    expect(
      await screen.findByText("Entre com sua conta individual para alterar a senha."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Senha atual")).not.toBeInTheDocument();
  });
  it("offers login instead of an endless account spinner when the session expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Expired" }, { status: 401 })),
    );
    render(<MyAccount />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Entre novamente");
    expect(screen.getByRole("link", { name: "Fazer login" })).toHaveAttribute(
      "href",
      "/estoque/acesso",
    );
  });

  it("requests owner recovery with a generic confirmation", async () => {
    let submitted: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
          submitted = JSON.parse(String(init.body));
          return Response.json({ data: { ok: true } });
        }
        return Response.json({ data: { recoveryAvailable: true } });
      }),
    );
    render(<InventoryAccess />);
    fireEvent.click(await screen.findByRole("button", { name: "Esqueci minha senha" }));
    fireEvent.change(screen.getByLabelText("E-mail cadastrado"), {
      target: { value: "owner@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar instruções" }));
    await waitFor(() =>
      expect(submitted).toEqual({ action: "REQUEST_RESET", email: "owner@example.test" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Se houver uma conta elegível");
  });
  it("removes the recovery fragment and resets without exposing the token in the URL", async () => {
    window.history.replaceState(null, "", "/estoque/acesso#recover=single-use-test");
    let submitted: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
          submitted = JSON.parse(String(init.body));
          return Response.json({ data: { ok: true } });
        }
        return Response.json({ data: { recoveryAvailable: true } });
      }),
    );
    render(<InventoryAccess />);
    await screen.findByRole("heading", { name: "Definir nova senha" });
    expect(window.location.hash).toBe("");
    fireEvent.change(screen.getByLabelText("Nova senha"), {
      target: { value: "Long-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
      target: { value: "Long-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Definir senha" }));
    await waitFor(() =>
      expect(submitted).toEqual({
        action: "RESET_PASSWORD",
        token: "single-use-test",
        newPassword: "Long-password-123",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Senha redefinida");
    expect(screen.queryByRole("button", { name: "Definir senha" })).not.toBeInTheDocument();
  });
  it("opens a recovery link when it arrives in an already open login page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: { recoveryAvailable: true } })),
    );
    render(<InventoryAccess />);
    await screen.findByRole("button", { name: "Esqueci minha senha" });
    window.history.replaceState(null, "", "/estoque/acesso#recover=another-single-use-token");
    fireEvent(window, new Event("hashchange"));
    expect(await screen.findByRole("heading", { name: "Definir nova senha" })).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
  it("requires matching new passwords before sending account changes", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          user: { name: "Owner", email: "owner@example.test" },
          role: "CLINICIAN",
          units: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<MyAccount />);
    fireEvent.change(await screen.findByLabelText("Senha atual"), {
      target: { value: "old-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Nova senha"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
      target: { value: "wrong-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Alterar senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não coincidem");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("prevents administrators from reinviting or changing a credentialed account email", async () => {
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) =>
        String(input).endsWith("/api/inventory-session")
          ? Response.json({ data: { units: [] } })
          : Response.json({
              data: [
                {
                  id: "user",
                  name: "Account Owner",
                  email: "owner@example.test",
                  role: "CLINICIAN",
                  credentialed: true,
                  active: true,
                  units: [],
                },
              ],
            }),
      ),
    );
    render(<UserAdministration />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("E-mail")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Redefinir senha" })).not.toBeInTheDocument();
    expect(screen.getByText(/O titular altera a senha em Minha conta/)).toBeInTheDocument();
  });
});
