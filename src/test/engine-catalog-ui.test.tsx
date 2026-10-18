import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineCatalogPanel } from "@/components/clinic/engine-catalog-panel";
const state = vi.hoisted(() => ({ payload: {} as Record<string, unknown> }));
vi.mock("@/data/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/inventory-api")>()),
  useInventory: () => ({ data: state.payload, isPending: false, error: null, refetch: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});
function fixture() {
  return {
    products: [],
    suppliers: [],
    items: [],
    links: [],
    mappings: [],
    prices: [],
    units: [{ id: "unit", name: "Unidade sintética" }],
    canManageCatalog: false,
    canManagePrices: false,
    referenceDate: "2026-10-18",
    limit: 100,
    offset: 0,
  };
}
describe("Clinical catalog disclosure and explicit operations", () => {
  it("does not create records while browsing and keeps unavailable prices distinct from zero", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    state.payload = fixture();
    render(<EngineCatalogPanel />);
    expect(screen.queryByRole("button", { name: "Novo item" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Vínculos" }));
    expect(screen.queryByRole("button", { name: "Novo mapeamento" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Preços por unidade" }));
    expect(screen.getByText(/Preço indisponível —/)).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s*0,00/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo preço" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not display an amount for unknown, unavailable, archived, expired or future prices", () => {
    const base = {
      id: "price",
      unitId: "unit",
      productId: null,
      catalogItemId: "item",
      amount: "120.00",
      sellingUnit: "sessão",
      source: "Fonte sintética",
      validFrom: "2026-01-01",
      validUntil: null,
      availability: "AVAILABLE",
      active: true,
      version: 1,
      effectiveAvailability: "AVAILABLE",
    };
    state.payload = {
      ...fixture(),
      prices: [
        base,
        { ...base, id: "unknown", availability: "UNKNOWN" },
        { ...base, id: "unavailable", effectiveAvailability: "UNAVAILABLE" },
        { ...base, id: "archived", active: false },
        { ...base, id: "expired", validUntil: "2026-10-17" },
        { ...base, id: "future", validFrom: "2026-10-19" },
      ],
    };
    render(<EngineCatalogPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Preços por unidade" }));
    expect(screen.getAllByText(/120,00/)).toHaveLength(1);
    expect(screen.getAllByText("Preço indisponível")).toHaveLength(5);
  });
  it("reuses the operation identifier and record identifier when an ambiguous request is retried", async () => {
    state.payload = { ...fixture(), canManageCatalog: true };
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        if (bodies.length === 1) throw new Error("Resposta não recebida");
        return Response.json({ data: { id: "item", version: 1 } });
      }),
    );
    render(<EngineCatalogPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Novo item" }));
    fireEvent.change(screen.getByLabelText("Nome do item"), {
      target: { value: "Serviço sintético" },
    });
    fireEvent.change(screen.getByLabelText("Tipo do item"), { target: { value: "SERVICE" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar item" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Salvar item" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]?.["operationId"]).toEqual(expect.any(String));
    expect(bodies[0]?.["action"]).toBe("SAVE_ITEM");
  });
});
