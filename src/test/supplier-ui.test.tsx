import { afterEach, describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SupplierPage } from "@/components/clinic/supplier-page";
import { SavedSupplierOrder, SupplierCheckout } from "@/components/clinic/supplier-orders";
import type { SupplierProfile, SupplierCatalogItem } from "@/data/supplier-input";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a href={String(to)} {...props}>
      {children}
    </a>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const supplier: SupplierProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Essentia",
  phone: "554888029876",
  email: null,
  active: true,
  version: 2,
};
const item: SupplierCatalogItem = {
  id: "22222222-2222-4222-8222-222222222222",
  supplierId: supplier.id,
  productId: null,
  code: "ESS-P092",
  supplierSku: null,
  name: "Produto de catálogo",
  kind: "PRODUCT",
  description: "Composição literal",
  packaging: "Conjunto de 2 boxes",
  contents: "20 ampolas",
  boxesPerPack: 2,
  price: "378.00",
  pricingNote: null,
  priceSource: "Catálogo 04.2026",
  sourcePage: 5,
  active: true,
  version: 3,
};
const mount = (child: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {child}
    </QueryClientProvider>,
  );
describe("supplier order UI", () => {
  it("keeps selected quantities across search and prevents unconfirmed prices from selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json({
          data: url.endsWith("vendors")
            ? [supplier]
            : url.includes("vendor-catalog")
              ? [
                  item,
                  {
                    ...item,
                    id: "pending",
                    code: "ESS-AMBIGUO",
                    name: "Preço a confirmar",
                    price: null,
                  },
                ]
              : [],
        }),
      ),
    );
    mount(<SupplierPage />);
    const selection = await screen.findByRole("checkbox", { name: "Selecionar ESS-P092" });
    expect(screen.getByRole("checkbox", { name: "Selecionar ESS-AMBIGUO" })).toBeDisabled();
    fireEvent.click(selection);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Quantidade de apresentações ESS-P092" }),
      { target: { value: "2" } },
    );
    fireEvent.change(screen.getByLabelText("Buscar no catálogo"), { target: { value: "AMBIGUO" } });
    expect(screen.queryByRole("checkbox", { name: "Selecionar ESS-P092" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revisar pedido" }));
    expect(screen.getByRole("region", { name: "Revisão do pedido" })).toHaveTextContent(
      "4 boxes físicos",
    );
    expect(screen.getByRole("region", { name: "Revisão do pedido" })).toHaveTextContent("756,00");
  });
  it("freezes a lost response and retries the original request, including price/version and operation UUID", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce(Response.json({ data: { replayed: true } }));
    vi.stubGlobal("fetch", fetch);
    const saved = vi.fn(),
      close = vi.fn();
    mount(
      <SupplierCheckout
        supplier={supplier}
        selection={[{ item, quantity: 2 }]}
        onClose={close}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Frete estimado (R$, opcional)"), {
      target: { value: "24.90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido e exportar" }));
    await screen.findByRole("button", { name: "Tentar novamente" });
    expect(screen.getByLabelText("Frete estimado (R$, opcional)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Voltar ao catálogo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const a = fetch.mock.calls[0]![1].body,
      b = fetch.mock.calls[1]![1].body;
    expect(a).toBe(b);
    expect(JSON.parse(a)).toMatchObject({
      supplierVersion: 2,
      freight: "24.90",
      items: [{ catalogItemId: item.id, quantity: 2, version: 3, expectedPrice: "378.00" }],
    });
    expect(saved).toHaveBeenCalledWith(JSON.parse(a).operationId);
  });
  it("offers copy and a short WhatsApp link for extensive orders", async () => {
    const messageItems = Array.from({ length: 50 }, (_, n) => ({
      catalogItemId: `item-${n}`,
      productId: `product-${n}`,
      code: `ESS-${n}`,
      supplierSku: null,
      name: "Produto de apresentação com nome completo ".repeat(8),
      packaging: "Box de 10 ampolas",
      contents: "10 ampolas",
      quantity: 1,
      boxes: 1,
      price: "10.00",
      subtotal: "10.00",
      priceSource: "Catálogo",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            id: item.id,
            reference: "PO-LONG",
            supplier,
            items: messageItems,
            subtotal: "500.00",
            freight: null,
            total: "500.00",
            notes: "",
            actor: "preview-operator",
            date: "2026-10-05T00:00:00Z",
          },
        }),
      ),
    );
    mount(<SavedSupplierOrder id={item.id} onClose={() => {}} />);
    expect(
      await screen.findByRole("link", { name: "Abrir WhatsApp (copie a lista)" }),
    ).toHaveAttribute("href", "https://wa.me/554888029876");
    expect(screen.getByRole("button", { name: "Copiar mensagem" })).toBeEnabled();
  });
  it("shows a stale-price conflict without completing or silently accepting a new price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "O preço mudou. Atualize o catálogo." }, { status: 409 }),
      ),
    );
    const saved = vi.fn();
    mount(
      <SupplierCheckout
        supplier={supplier}
        selection={[{ item, quantity: 1 }]}
        onClose={() => {}}
        onSaved={saved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar pedido e exportar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O preço mudou");
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Voltar ao catálogo" })).toBeEnabled();
  });
});
