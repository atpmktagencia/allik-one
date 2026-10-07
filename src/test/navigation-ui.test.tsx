import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: React.PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: "/estoque" } }),
}));

import { AppShell } from "@/components/clinic/app-shell";

afterEach(() => {
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
      "Minha conta",
    ])
      expect(within(desktopNavigation).getByRole("link", { name: item })).toBeInTheDocument();
    expect(within(desktopNavigation).queryByText("Cadastros")).not.toBeInTheDocument();
  });
});
