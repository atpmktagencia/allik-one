import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";

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
      "Precificação",
      "Aplicações",
      "Pacientes",
    ])
      expect(within(desktopNavigation).getByRole("link", { name: item })).toBeInTheDocument();
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
