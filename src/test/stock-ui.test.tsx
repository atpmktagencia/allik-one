import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ProductDetailPage, StockOverviewPage } from "@/components/clinic/stock-ui";

// Render a page inside a minimal router so <Link> can build hrefs, without the
// document shell that the real root route renders.
function renderWithRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{ui}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("Stock UI", () => {
  it("links each product row to its detail page", async () => {
    renderWithRouter(<StockOverviewPage />);

    const link = await screen.findByRole("link", { name: "Injetável A" });

    expect(link).toHaveAttribute("href", "/estoque/produtos/prod-001");
  });

  it("derives the below-minimum metric from the stock data", async () => {
    renderWithRouter(<StockOverviewPage />);

    expect(await screen.findByText("3 itens")).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown product", async () => {
    renderWithRouter(<ProductDetailPage productId="nao-existe" />);

    expect(
      await screen.findByRole("heading", { name: "Produto não encontrado" }),
    ).toBeInTheDocument();
  });

  it("shows empty states for a product without lots or movements", async () => {
    renderWithRouter(<ProductDetailPage productId="prod-005" />);

    expect(
      await screen.findByText("Nenhum lote registrado para este produto."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nenhuma movimentação registrada para este produto."),
    ).toBeInTheDocument();
  });
});
