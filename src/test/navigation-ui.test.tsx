import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

let currentPath = "/estoque";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: React.PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: currentPath } }),
}));

import { AppShell } from "@/components/clinic/app-shell";

afterEach(() => {
  currentPath = "/estoque";
  cleanup();
  vi.unstubAllGlobals();
});

describe("Inventory navigation", () => {
  it("groups the stable workflow under Estoque and removes the Cadastros section", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell>
          <p>Conteúdo</p>
        </AppShell>
      </QueryClientProvider>,
    );

    const desktopNavigation = screen.getAllByRole("navigation")[0]!;
    expect(within(desktopNavigation).getByText("Estoque")).toBeInTheDocument();
    for (const item of [
      "Estoque atual",
      "Pedidos e entradas",
      "Movimentações e histórico",
      "Produtos e sede",
      "Fazer compra",
      "Aplicações",
      "Paciente360º",
    ])
      expect(within(desktopNavigation).getByRole("link", { name: item })).toBeInTheDocument();
    expect(
      within(desktopNavigation).queryByRole("link", { name: "Precificação" }),
    ).not.toBeInTheDocument();
    expect(within(desktopNavigation).queryByText("Administração")).not.toBeInTheDocument();
    expect(
      within(desktopNavigation).queryByRole("link", { name: "Minha conta" }),
    ).not.toBeInTheDocument();
    expect(within(desktopNavigation).queryByText("Cadastros")).not.toBeInTheDocument();
  });

  it("recolhe a navegação geral no modo focado do atendimento", () => {
    currentPath = "/atendimentos/44444444-4444-4444-8444-444444444444";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell>
          <p>Atendimento focado</p>
        </AppShell>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Abrir menu" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("Atendimento focado").parentElement).toHaveClass("max-w-none");
  });
});

describe("Account administration menu", () => {
  it.each([
    ["PARTNER_ADMIN", true, false],
    ["SUPER_ADMIN", true, true],
    ["VIEWER", false, false],
  ] as const)("limits administrative links for %s", async (role, users, integrations) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            user: {
              id: "synthetic-user",
              name: "Synthetic administrator",
              email: "synthetic@example.test",
            },
            role,
            units: [],
          },
        }),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell>
          <p>Conteúdo</p>
        </AppShell>
      </QueryClientProvider>,
    );
    const trigger = await screen.findByRole("button", {
      name: "Abrir menu da conta de Synthetic administrator",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(!!within(menu).queryByRole("menuitem", { name: "Usuários" })).toBe(users);
    expect(!!within(menu).queryByRole("menuitem", { name: "Integrações" })).toBe(integrations);
  });
});
