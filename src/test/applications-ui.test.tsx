import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { NewApplicationPage } from "@/components/clinic/application-pages";
import { fefoPositions } from "@/data/application-api";
import { applicationInput } from "@/data/application-input";
import type { InventoryPosition } from "@/data/inventory-api";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <a>{children}</a>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const productId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const lotId = "33333333-3333-4333-8333-333333333333";
const base: InventoryPosition = {
  id: "position-1",
  productId,
  lotId,
  locationId,
  name: "Material",
  category: "Material",
  unit: "un",
  minimum: 1,
  active: true,
  lot: "L-PRIMEIRO",
  expiry: "2099-01-01",
  supplier: "Fornecedor",
  cost: 2,
  status: "AVAILABLE",
  quantity: 5,
  location: "Clínica",
  expiringSoon: false,
};
describe("Application FEFO and validation", () => {
  it("recommends earliest available stock in the selected local and ignores blocked, expired, inactive and empty positions", () => {
    const later = {
      ...base,
      id: "position-2",
      lotId: "44444444-4444-4444-8444-444444444444",
      expiry: "2099-02-01",
    };
    const unavailable = [
      { ...base, status: "BLOCKED", expiry: "2098-01-01" },
      { ...base, status: "EXPIRED" },
      { ...base, active: false },
      { ...base, quantity: 0 },
      { ...base, locationId: "other" },
    ];
    expect(
      fefoPositions([later, ...unavailable, base], productId, locationId).map((row) => row.lotId),
    ).toEqual([lotId, later.lotId]);
  });
  it("accepts synthetic references and positive decimal consumption but rejects duplicate lots and real patient codes", () => {
    const body = {
      operationId: lotId,
      patientRef: "demo-patient-a",
      reference: "AP-1",
      service: "Procedimento",
      professional: "Executor sintético",
      locationId,
      items: [{ productId, lotId, quantity: "2.125" }],
    };
    expect(applicationInput.safeParse(body).success).toBe(true);
    expect(applicationInput.safeParse({ ...body, patientRef: "patient-real" }).success).toBe(false);
    expect(
      applicationInput.safeParse({ ...body, items: [body.items[0], body.items[0]] }).success,
    ).toBe(false);
    for (const quantity of ["0", "-1", "2.1255", "1e2", "100000000000"])
      expect(
        applicationInput.safeParse({ ...body, items: [{ productId, lotId, quantity }] }).success,
      ).toBe(false);
  });
});
describe("Application confirmation", () => {
  it("selects FEFO and retries a lost response exactly once even after the lot is depleted", async () => {
    const writes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          writes.push(String(options.body));
          if (writes.length === 1) throw new Error("Response lost after commit");
          return Response.json({ data: { replayed: true } });
        }
        const data = url.endsWith("products")
          ? [{ id: productId, name: "Material", unit: "un", active: true, stockControlled: true }]
          : url.endsWith("locations")
            ? [{ id: locationId, name: "Clínica" }]
            : [
                base,
                {
                  ...base,
                  id: "later",
                  lotId: "44444444-4444-4444-8444-444444444444",
                  expiry: "2099-02-01",
                  lot: "L-DEPOIS",
                },
              ];
        return Response.json({ data });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NewApplicationPage />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByRole("combobox", { name: "Paciente sintético" }), {
      target: { value: "demo-patient-a" },
    });
    for (const [label, value] of [
      ["Referência da aplicação", "AP-1"],
      ["Serviço / procedimento", "Procedimento sintético"],
      ["Profissional executor", "Executor sintético"],
      ["Local do consumo", locationId],
      ["Produto consumido 1", productId],
      ["Quantidade consumida 1", "5"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    expect(screen.getByRole("combobox", { name: "Lote consumido 1" })).toHaveValue(lotId);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aplicação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar");
    expect(screen.getByLabelText("Quantidade consumida 1")).toBeDisabled();
    act(() => client.setQueryData(["inventory", "stock"], [{ ...base, quantity: 0 }]));
    fireEvent.click(screen.getByRole("button", { name: "Reenviar aplicação" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Aplicação AP-1 concluída");
    expect(writes).toHaveLength(2);
    expect(writes[0]).toBe(writes[1]);
    expect(JSON.parse(writes[0]!)).toMatchObject({
      patientRef: "demo-patient-a",
      items: [{ productId, lotId, quantity: "5" }],
    });
  });
});
