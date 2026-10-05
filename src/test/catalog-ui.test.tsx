import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CatalogForm } from "@/components/clinic/catalog-form";
import { CatalogPage } from "@/components/clinic/catalog-page";
import type { CatalogProduct } from "@/data/catalog-input";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    target,
    rel,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a href={String(to)} target={target as string} rel={rel as string} {...props}>
      {children}
    </a>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const product: CatalogProduct = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Produto de teste",
  sku: "CAT-01",
  category: "Material",
  unit: "un",
  minimum: "1.000",
  active: true,
  stockControlled: true,
  version: 3,
};
function mount(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {child}
    </QueryClientProvider>,
  );
}
describe("Catalog UI", () => {
  it("shows a denied session instead of fallback catalog data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Entre para acessar os cadastros." }, { status: 401 }),
      ),
    );
    mount(<CatalogPage />);
    expect(await screen.findByText("Acessar demonstração")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo produto" })).not.toBeInTheDocument();
  });
  it("lists zero-stock and inactive products and filters by SKU or status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json({
          data: url.endsWith("products")
            ? [
                product,
                {
                  ...product,
                  id: "other",
                  name: "Produto desativado",
                  sku: "INACTIVE",
                  active: false,
                },
              ]
            : [],
        }),
      ),
    );
    mount(<CatalogPage />);
    expect(await screen.findByRole("link", { name: product.name })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Situação dos cadastros"), {
      target: { value: "inactive" },
    });
    expect(screen.queryByRole("link", { name: product.name })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Produto desativado" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar cadastros"), { target: { value: "not-found" } });
    expect(screen.getByText("Nenhum produto encontrado.")).toBeInTheDocument();
  });
  it("keeps the same payload and freezes editing after a lost response, then confirms once", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce(Response.json({ data: { replayed: true } }));
    vi.stubGlobal("fetch", fetch);
    const saved = vi.fn();
    const close = vi.fn();
    mount(<CatalogForm kind="products" initial={product} onClose={close} onSaved={saved} />);
    expect(screen.getByLabelText("SKU")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Unidade")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("Nome do produto"), {
      target: { value: "Nome revisado" },
    });
    fireEvent.change(screen.getByLabelText("Motivo da alteração"), {
      target: { value: "Motivo sintético de revisão" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar");
    expect(screen.getByLabelText("Nome do produto")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const original = fetch.mock.calls[0]![1].body;
    expect(fetch.mock.calls[1]![1].body).toBe(original);
    expect(JSON.parse(original)).toMatchObject({ version: 3, name: "Nome revisado" });
    expect(JSON.parse(original)).not.toHaveProperty("sku");
    expect(close).not.toHaveBeenCalled();
  });
  it("keeps a conflicted edit visible without claiming success or silently loading a newer version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "O cadastro mudou desde a consulta." }, { status: 409 }),
      ),
    );
    const saved = vi.fn();
    mount(
      <CatalogForm
        kind="locations"
        initial={{ id: product.id, name: "Local antigo", active: true, version: 4 }}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Nome do local"), { target: { value: "Local novo" } });
    fireEvent.change(screen.getByLabelText("Motivo da alteração"), {
      target: { value: "Motivo sintético de revisão" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar local" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("mudou desde a consulta");
    expect(screen.getByLabelText("Nome do local")).toHaveValue("Local novo");
    expect(screen.getByLabelText("Nome do local")).not.toBeDisabled();
    expect(saved).not.toHaveBeenCalled();
  });
});
