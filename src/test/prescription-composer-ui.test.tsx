import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrescriptionComposer } from "@/components/clinic/prescription-composer";

vi.mock("@/data/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/inventory-api")>()),
  useInventory: () => ({
    data: { templates: [], canCompose: true },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fill() {
  for (const [label, value] of [
    ["Nome do componente", "Componente sintético"],
    ["Quantidade por unidade", "5"],
    ["Unidade da quantidade (ex.: mg)", "mg"],
    ["Apresentação (unidade de administração)", "cápsula"],
    ["Via de administração", "oral"],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}
function setup() {
  const insert = vi.fn();
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({
        data: {
          text: "Composição revisada no servidor",
          quantity: 1,
          quantityLabel: "1 unidade",
          warnings: ["Conferir clinicamente."],
        },
      });
    }),
  );
  render(<PrescriptionComposer appointmentId="synthetic-appointment" onInsert={insert} />);
  fill();
  return { insert, requests };
}
describe("Structured prescription review", () => {
  it("requires explicit review before inserting text and never saves or finalizes a document", async () => {
    const { insert, requests } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    const button = await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(insert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/^Conferi composição/));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(insert).toHaveBeenCalledWith("Composição revisada no servidor");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      action: "PREVIEW",
      appointmentId: "synthetic-appointment",
    });
  });
  it("invalidates preview and acknowledgement whenever composition changes", async () => {
    const { insert } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ });
    fireEvent.click(screen.getByLabelText(/^Conferi composição/));
    fireEvent.change(screen.getByLabelText("Quantidade por unidade"), { target: { value: "10" } });
    expect(
      screen.queryByRole("button", { name: /^Inserir no rascunho da receita$/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    expect(
      await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/^Conferi composição/)).not.toBeChecked();
    expect(insert).not.toHaveBeenCalled();
  });
});
