import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { StockOperationForms } from "@/components/clinic/stock-operation-forms";
import type { InventoryPosition } from "@/data/inventory-api";
import { adjustmentInput, transferInput } from "@/data/stock-operation-input";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <a>{children}</a>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const source = "22222222-2222-4222-8222-222222222222";
const destination = "33333333-3333-4333-8333-333333333333";
const lotId = "44444444-4444-4444-8444-444444444444";
const position: InventoryPosition = {
  id: "position",
  productId: "55555555-5555-4555-8555-555555555555",
  lotId,
  name: "Material",
  category: "Material",
  unit: "un",
  minimum: 2,
  active: true,
  lot: "LOTE-1",
  expiry: "2099-01-01",
  supplier: "Fornecedor",
  cost: 2,
  status: "AVAILABLE",
  quantity: 10,
  locationId: source,
  location: "Almoxarifado",
  expiringSoon: false,
};
function mount(post: (options: RequestInit) => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") return post(options);
      return Response.json({
        data: url.endsWith("stock")
          ? [position]
          : [
              { id: source, name: "Almoxarifado" },
              { id: destination, name: "Clínica" },
            ],
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StockOperationForms />
    </QueryClientProvider>,
  );
  return client;
}
function fill(fields: [string, string][]) {
  for (const [label, value] of fields)
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
describe("Stock operation forms", () => {
  it("retries a lost transfer response with the original payload even after stock changes", async () => {
    const writes: string[] = [];
    const client = mount(async (options) => {
      writes.push(String(options.body));
      if (writes.length === 1) throw new Error("Lost response after commit");
      return Response.json({ data: { replayed: true } });
    });
    fireEvent.change(await screen.findByRole("combobox", { name: "Posição de origem" }), {
      target: { value: position.id },
    });
    fill([
      ["Local de destino", destination],
      ["Quantidade a transferir", "10"],
      ["Referência da transferência", "TR-1"],
      ["Motivo da transferência", "Reposição da clínica"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar transferência" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar");
    expect(screen.getByLabelText("Quantidade a transferir")).toBeDisabled();
    act(() => client.setQueryData(["inventory", "stock"], [{ ...position, quantity: 0 }]));
    fireEvent.click(screen.getByRole("button", { name: "Reenviar transferência" }));
    expect(await screen.findByText(/Transferência registrada/)).toBeInTheDocument();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toBe(writes[1]);
    expect(JSON.parse(writes[0]!)).toMatchObject({
      lotId,
      sourceId: source,
      destinationId: destination,
      quantity: "10",
    });
  });
  it("keeps the originally consulted balance when a background refresh arrives during a count", async () => {
    let written: Record<string, unknown> = {};
    const client = mount(async (options) => {
      written = JSON.parse(String(options.body));
      return Response.json({ error: "O saldo mudou desde a consulta." }, { status: 409 });
    });
    fireEvent.change(await screen.findByRole("combobox", { name: "Posição para contagem" }), {
      target: { value: position.id },
    });
    fill([
      ["Quantidade contada", "8.125"],
      ["Referência da contagem", "CT-1"],
      ["Motivo do ajuste", "Conferência física diária"],
    ]);
    act(() => client.setQueryData(["inventory", "stock"], [{ ...position, quantity: 12 }]));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ajuste" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("saldo mudou");
    expect(written).toMatchObject({
      expectedQuantity: "10.000",
      countedQuantity: "8.125",
      locationId: source,
    });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar saldos" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Posição para contagem" })).toHaveValue(""),
    );
    expect(screen.getByRole("button", { name: "Confirmar ajuste" })).toBeDisabled();
  });
});

describe("Stock operation validation", () => {
  const common = {
    operationId: "11111111-1111-4111-8111-111111111111",
    lotId,
    reference: "TR-1",
    reason: "Reposição da clínica",
  };
  const transfer = { ...common, sourceId: source, destinationId: destination, quantity: "2.125" };
  const adjustment = {
    ...common,
    locationId: source,
    expectedQuantity: "10.000",
    countedQuantity: "0",
  };
  it("requires different locations, positive exact quantity and a useful reason", () => {
    expect(transferInput.safeParse(transfer).success).toBe(true);
    for (const change of [
      { destinationId: source },
      { quantity: "0" },
      { quantity: "-1" },
      { quantity: "1.1234" },
      { quantity: "1e2" },
      { quantity: "100000000000" },
      { reason: "curto" },
    ])
      expect(transferInput.safeParse({ ...transfer, ...change }).success).toBe(false);
  });
  it("accepts zero physical stock but rejects negative or imprecise counts", () => {
    expect(adjustmentInput.safeParse(adjustment).success).toBe(true);
    expect(adjustmentInput.safeParse({ ...adjustment, countedQuantity: "-1" }).success).toBe(false);
    expect(adjustmentInput.safeParse({ ...adjustment, expectedQuantity: "10.1234" }).success).toBe(
      false,
    );
  });
});
