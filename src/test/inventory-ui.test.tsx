import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";
import { StockOverviewPage } from "@/components/clinic/stock-ui";
import { summarizeStock, type InventoryPosition } from "@/data/inventory-api";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a href={String(props["to"])}>{children}</a>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mount = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StockOverviewPage />
    </QueryClientProvider>,
  );
describe("Inventory UI", () => {
  it("shows pending while requests are unresolved", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando estoque");
  });
  it("shows an empty state from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [] })),
    );
    mount();
    expect(
      await screen.findByText("Nenhum produto encontrado para estes filtros."),
    ).toBeInTheDocument();
  });
  it("shows an error instead of silently falling back to mocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Banco indisponível" }, { status: 503 })),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Banco indisponível");
    expect(screen.queryByText("Injetável A")).not.toBeInTheDocument();
  });
  it("offers preview login on access denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Entre para acessar" }, { status: 401 })),
    );
    mount();
    expect(await screen.findByText("Fazer login")).toBeInTheDocument();
    expect(screen.getByText("Faça o login para liberar seu acesso.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entre em contato por aqui" })).toHaveAttribute(
      "href",
      "https://wa.me/5585996146664",
    );
  });
  it("excludes blocked and expired balances from available quantity", () => {
    const base = {
      id: "position",
      productId: "product",
      name: "Produto",
      category: "Material",
      unit: "un",
      minimum: 2,
      active: true,
      lotId: "lot",
      lot: "L1",
      expiry: "2027-01-01",
      supplier: "Synthetic",
      cost: 10,
      status: "AVAILABLE",
      quantity: 5,
      locationId: "location",
      location: "Allik Fortaleza",
      expiringSoon: false,
    } satisfies InventoryPosition;
    const result = summarizeStock([
      base,
      { ...base, id: "blocked", status: "BLOCKED", quantity: 100 },
    ]);
    expect(result[0]?.quantity).toBe(5);
    expect(result[0]?.value).toBe(1050);
  });
});
