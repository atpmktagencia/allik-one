import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const insert = vi.fn();
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return Response.json({
        data:
          body.action === "SAVE"
            ? { id: "synthetic-protocol", version: 1 }
            : {
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
function addIngredient(name: string, index: number) {
  fireEvent.click(screen.getByRole("button", { name: /^Adicionar componente$/ }));
  for (const [label, value] of [
    ["Nome do componente", name],
    ["Quantidade por unidade", "10"],
    ["Unidade da quantidade (ex.: mg)", "mg"],
  ])
    fireEvent.change(screen.getAllByLabelText(label!)[index]!, { target: { value } });
}
function pointer(target: Element | Window | Document, type: string) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperties(event, { pointerType: { value: "mouse" }, pointerId: { value: 1 } });
  fireEvent(target, event);
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
  it("excludes deselected ingredients from calculation and saved protocols while preserving their editable values", async () => {
    const { requests } = setup();
    addIngredient("Segundo sintético", 1);
    fireEvent.click(screen.getByLabelText("Incluir componente 1"));
    const live = screen.getByRole("complementary", { name: "Prévia do documento" });
    expect(within(live).getByText(/Segundo sintético/)).toBeInTheDocument();
    expect(within(live).queryByText(/Componente sintético:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ });
    expect(requests[0]).toMatchObject({
      action: "PREVIEW",
      formula: { ingredients: [{ medicationName: "Segundo sintético", dose: "10" }] },
    });
    fireEvent.change(screen.getByLabelText("Nome do protocolo pessoal"), {
      target: { value: "Selecionados" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Salvar protocolo$/ }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({
      action: "SAVE",
      formula: { ingredients: [{ medicationName: "Segundo sintético" }] },
    });
    await screen.findByText("Protocolo pessoal salvo.");
    fireEvent.click(screen.getByLabelText("Incluir componente 1"));
    expect(screen.getAllByLabelText("Nome do componente")[0]).toHaveValue("Componente sintético");
    expect(screen.getAllByLabelText("Quantidade por unidade")[0]).toHaveValue("5");
    expect(within(live).getByText(/Componente sintético:/)).toBeInTheDocument();
  });
  it("invalidates server review when selection changes and blocks calculation with no selected ingredient", async () => {
    const { requests, insert } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ });
    fireEvent.click(screen.getByLabelText(/^Conferi composição/));
    fireEvent.click(screen.getByLabelText("Incluir componente 1"));
    expect(screen.queryByRole("region", { name: "Revisão da composição" })).not.toBeInTheDocument();
    const calculate = screen.getByRole("button", { name: /^Calcular e revisar composição$/ });
    expect(calculate).toBeDisabled();
    fireEvent.click(calculate);
    expect(requests).toHaveLength(1);
    expect(insert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Incluir componente 1"));
    fireEvent.click(calculate);
    const insertButton = await screen.findByRole("button", {
      name: /^Inserir no rascunho da receita$/,
    });
    expect(insertButton).toBeDisabled();
    expect(screen.getByLabelText(/^Conferi composição/)).not.toBeChecked();
  });
  it("paints one selection state across multiple selectors without toggling repeatedly", async () => {
    setup();
    addIngredient("Segundo sintético", 1);
    addIngredient("Terceiro sintético", 2);
    const first = screen.getByLabelText("Incluir componente 1"),
      second = screen.getByLabelText("Incluir componente 2"),
      third = screen.getByLabelText("Incluir componente 3");
    const descriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    const elementFromPoint = vi.fn().mockReturnValue(second);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });
    try {
      pointer(first, "pointerdown");
      expect(first).not.toBeChecked();
      pointer(window, "pointermove");
      expect(second).not.toBeChecked();
      pointer(window, "pointermove");
      expect(second).not.toBeChecked();
      elementFromPoint.mockReturnValue(third);
      pointer(window, "pointermove");
      expect(third).not.toBeChecked();
      pointer(window, "pointerup");
      expect(
        screen.getByRole("button", { name: /^Calcular e revisar composição$/ }),
      ).toBeDisabled();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      fireEvent.click(first);
      expect(first).toBeChecked();
      expect(second).not.toBeChecked();
      expect(third).not.toBeChecked();
      pointer(first, "pointerdown");
      expect(first).not.toBeChecked();
      fireEvent.blur(window);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      fireEvent.click(first);
      expect(first).toBeChecked();
    } finally {
      if (descriptor) Object.defineProperty(document, "elementFromPoint", descriptor);
      else Reflect.deleteProperty(document, "elementFromPoint");
    }
  });
});
