import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReceivingPage } from "@/components/clinic/receiving-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <a>{children}</a>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const product = "33333333-3333-4333-8333-333333333333";
const location = "22222222-2222-4222-8222-222222222222";
describe("Receiving form", () => {
  it("selects a purchase and sends a partial delivery with its item link", async () => {
    const purchaseId = "44444444-4444-4444-8444-444444444444";
    const purchaseItemId = "55555555-5555-4555-8555-555555555555";
    let saved = false;
    let written: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          written = JSON.parse(String(options.body));
          saved = true;
          return Response.json({ data: { id: "receipt" } });
        }
        const data = url.endsWith("products")
          ? [{ id: product, name: "Material", unit: "un", active: true, stockControlled: true }]
          : url.endsWith("locations")
            ? [{ id: location, name: "Clínica" }]
            : url.endsWith("purchases")
              ? [
                  {
                    id: purchaseId,
                    reference: "PO-PARCIAL",
                    supplierId: location,
                    supplier: "Fornecedor",
                    status: saved ? "PARTIAL" : "OPEN",
                    items: [
                      {
                        id: purchaseItemId,
                        productId: product,
                        name: "Material",
                        quantity: "10.000",
                        received: saved ? "4.000" : "0.000",
                        remaining: saved ? "6.000" : "10.000",
                        unitCost: "2.0000",
                      },
                    ],
                  },
                ]
              : [];
        return Response.json({ data });
      }),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReceivingPage />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Receber PO-PARCIAL" }));
    expect(screen.getByLabelText("Fornecedor")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Quantidade 1")).toHaveValue(10);
    for (const [label, value] of [
      ["Localização", location],
      ["Lote 1", "L-PARCIAL"],
      ["Validade 1", "2099-01-01"],
      ["Quantidade 1", "4"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    expect(await screen.findByText(/recebido 4.000 · pendente 6.000/)).toBeInTheDocument();
    expect(written["purchaseId"]).toBe(purchaseId);
    expect(written["items"]).toEqual([
      {
        productId: product,
        purchaseItemId,
        lot: "L-PARCIAL",
        expiry: "2099-01-01",
        quantity: "4",
        unitCost: "2.0000",
      },
    ]);
  });
  it("retries a failed response with the original key and refreshes inventory on success", async () => {
    const writes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          writes.push(String(options.body));
          if (writes.length === 1) throw new Error("Connection lost after commit");
          return Response.json({ data: { replayed: true } });
        }
        return Response.json({
          data: url.endsWith("products")
            ? [{ id: product, name: "Material", unit: "un", active: true, stockControlled: true }]
            : url.endsWith("locations")
              ? [{ id: location, name: "Clínica" }]
              : [],
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <ReceivingPage />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Fornecedor"), {
      target: { value: "Fornecedor" },
    });
    for (const [label, value] of [
      ["Referência da compra", "PO-42"],
      ["Localização", location],
      ["Produto 1", product],
      ["Lote 1", "L1"],
      ["Validade 1", "2099-01-01"],
      ["Quantidade 1", "2"],
      ["Custo unitário 1", "10"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar");
    expect(screen.getByLabelText("Quantidade 1")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Recebimento registrado"),
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]).toBe(writes[1]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inventory"] });
  });
});
