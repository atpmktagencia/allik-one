import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prescriptionReferenceIngredients } from "@/data/prescription-reference";
import type { PrescriptionProtocol } from "@/data/prescription-composer";
import { PrescriptionComposer } from "@/components/clinic/prescription-composer";

const fixtures = vi.hoisted(() => ({
  templates: [] as PrescriptionProtocol[],
  refreshedTemplates: null as PrescriptionProtocol[] | null,
}));

vi.mock("@/data/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/inventory-api")>()),
  useInventory: () => ({
    data: {
      templates: fixtures.templates,
      canCompose: true,
      units: [
        { id: "unit-a", name: "Unidade A" },
        { id: "unit-b", name: "Unidade B" },
      ],
      canCreateShared: true,
      canCreateInstitutional: true,
    },
    isPending: false,
    error: null,
    refetch: vi.fn(async () => {
      if (fixtures.refreshedTemplates) fixtures.templates = fixtures.refreshedTemplates;
      return { data: { templates: fixtures.templates } };
    }),
  }),
}));
afterEach(() => {
  cleanup();
  fixtures.templates = [];
  fixtures.refreshedTemplates = null;
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
                instanceId: "synthetic-instance",
              },
      });
    }),
  );
  render(
    <PrescriptionComposer
      appointmentId="synthetic-appointment"
      documentId="synthetic-document"
      onInsert={insert}
    />,
  );
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
  it("adds an optional second dose schedule without suggesting values and removes it explicitly", () => {
    setup();
    expect(screen.getByText("Posologia inicial")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar aumento de dose" }));
    const second = screen.getByRole("group", { name: /^Etapa 2$/ });
    expect(within(second).getByText("Segunda posologia · aumento ou ajuste")).toBeInTheDocument();
    for (const label of ["Unidades por administração", "Administrações por dia", "Duração em dias"])
      expect(within(second).getByLabelText(label)).toHaveValue(null);
    expect(screen.getByRole("button", { name: /^Calcular e revisar composição$/ })).toBeDisabled();
    fireEvent.change(within(second).getByLabelText("Unidades por administração"), {
      target: { value: "2" },
    });
    fireEvent.change(within(second).getByLabelText("Administrações por dia"), {
      target: { value: "1" },
    });
    fireEvent.change(within(second).getByLabelText("Duração em dias"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: /^Calcular e revisar composição$/ })).toBeEnabled();
    expect(screen.getByText(/Após concluir a etapa anterior \(dias 2 a 11\)/)).toBeInTheDocument();
    fireEvent.click(within(second).getByRole("button", { name: "Remover etapa 2" }));
    expect(screen.queryByRole("group", { name: /^Etapa 2$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar aumento de dose" })).toBeEnabled();
  });
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
    await waitFor(() =>
      expect(insert).toHaveBeenCalledWith("Composição revisada no servidor", "synthetic-instance"),
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      action: "INSTANTIATE",
      documentId: "synthetic-document",
      formula: { ingredients: [{ medicationName: "Componente sintético" }] },
    });
    expect(
      requests.every((request) => !["FINALIZE", "SAVE_DRAFT"].includes(String(request["action"]))),
    ).toBe(true);
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
    fireEvent.click(screen.getByRole("button", { name: "Transformar em modelo" }));
    fireEvent.change(screen.getByLabelText("Nome do modelo"), {
      target: { value: "Selecionados" },
    });
    fireEvent.click(
      screen.getByLabelText("Confirmei que o modelo não contém dados pessoais de pacientes."),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Salvar modelo$/ }));
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
  it("loads the photo reference without selecting ingredients, inferring doses or making requests", () => {
    const { requests } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Modelo da foto · conferir$/ }));
    const include = screen.getAllByRole("checkbox", { name: /^Incluir componente / });
    expect(include).toHaveLength(prescriptionReferenceIngredients.length);
    include.forEach((checkbox) => expect(checkbox).not.toBeChecked());
    expect(
      screen
        .getAllByLabelText("Nome do componente")
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual([...prescriptionReferenceIngredients]);
    screen
      .getAllByLabelText("Quantidade por unidade")
      .forEach((input) => expect(input).toHaveValue(""));
    screen
      .getAllByLabelText("Unidade da quantidade (ex.: mg)")
      .forEach((input) => expect(input).toHaveValue(""));
    expect(screen.getByLabelText("Unidades por administração")).toHaveValue(null);
    expect(screen.getByLabelText("Administrações por dia")).toHaveValue(null);
    expect(screen.getByLabelText("Duração em dias")).toHaveValue(null);
    expect(screen.getByLabelText("Via de administração")).toHaveValue("");
    expect(screen.getByLabelText("Apresentação (unidade de administração)")).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Calcular e revisar composição$/ })).toBeDisabled();
    expect(requests).toHaveLength(0);
  });
  it("calculates and saves only the chosen reference ingredients with explicitly entered dispensing values", async () => {
    const { requests } = setup();
    const calculate = screen.getByRole("button", { name: /^Calcular e revisar composição$/ });
    const save = screen.getByRole("button", { name: /^Transformar em modelo$/ });
    const live = screen.getByRole("complementary", { name: "Prévia do documento" });
    const reference = screen.getByRole("button", { name: /^Modelo da foto · conferir$/ });
    const include = screen.getByLabelText("Incluir componente 1");
    const quantity = screen.getByLabelText("Quantidade por unidade");
    const unit = screen.getByLabelText("Unidade da quantidade (ex.: mg)");
    const presentation = screen.getByLabelText("Apresentação (unidade de administração)");
    const route = screen.getByLabelText("Via de administração");
    const perDose = screen.getByLabelText("Unidades por administração");
    const frequency = screen.getByLabelText("Administrações por dia");
    const duration = screen.getByLabelText("Duração em dias");
    const dispenseQuantity = screen.getByLabelText("Quantidade a dispensar");
    const dispenseUnit = screen.getByLabelText("Unidade de dispensação");
    fireEvent.click(reference);
    fireEvent.click(include);
    for (const [control, value] of [
      [quantity, "1,25"],
      [unit, "mg"],
      [presentation, "cápsula"],
      [route, "oral"],
      [perDose, "1"],
      [frequency, "1"],
      [duration, "30"],
      [dispenseQuantity, "90"],
      [dispenseUnit, "cápsulas"],
    ] as const)
      fireEvent.change(control, { target: { value } });
    expect(within(live).getByText(/Quantidade a dispensar: 90 cápsulas/)).toBeInTheDocument();
    fireEvent.click(calculate);
    await within(live).findByRole("button", { name: /^Inserir no rascunho da receita$/ });
    const expected = {
      ingredients: [
        {
          medicationName: prescriptionReferenceIngredients[0],
          dose: "1,25",
          doseUnit: "mg",
          individualCapsule: false,
        },
      ],
      dispenseQuantity: "90",
      dispenseUnit: "cápsulas",
    };
    expect(requests[0]).toMatchObject({ action: "PREVIEW", formula: expected });
    expect((requests[0]!["formula"] as { ingredients: unknown[] }).ingredients).toHaveLength(1);
    fireEvent.click(save);
    fireEvent.click(
      screen.getByLabelText("Confirmei que o modelo não contém dados pessoais de pacientes."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar modelo" }));
    await within(live).findByText("Protocolo pessoal salvo.");
    expect(requests[1]).toMatchObject({ action: "SAVE", formula: expected });
    expect((requests[1]!["formula"] as { ingredients: unknown[] }).ingredients).toHaveLength(1);
  });
  it("requires a new server review after manual dispensing quantity changes", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ });
    fireEvent.click(screen.getByLabelText(/^Conferi composição/));
    fireEvent.change(screen.getByLabelText("Quantidade a dispensar"), { target: { value: "30" } });
    expect(screen.queryByRole("region", { name: "Revisão da composição" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Calcular e revisar composição$/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Unidade de dispensação"), {
      target: { value: "cápsulas" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    expect(
      await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/^Conferi composição/)).not.toBeChecked();
  });
  it("prints and submits explicit pharmaceutical form, capsule, custom base and packaging choices", async () => {
    const { requests } = setup();
    for (const label of ["Forma farmacêutica", "Tipo de cápsula", "Base / excipiente", "Embalagem"])
      expect(screen.getByLabelText(label)).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Forma farmacêutica"), { target: { value: "cápsula" } });
    fireEvent.change(screen.getByLabelText("Tipo de cápsula"), { target: { value: "vegetal" } });
    fireEvent.change(screen.getByLabelText("Base / excipiente"), {
      target: { value: "__custom__" },
    });
    fireEvent.change(screen.getByLabelText("Base / excipiente personalizado"), {
      target: { value: "Base informada pelo prescritor" },
    });
    fireEvent.change(screen.getByLabelText("Embalagem"), { target: { value: "frasco" } });
    const live = screen.getByRole("complementary", { name: "Prévia do documento" });
    expect(within(live).getByText(/Forma farmacêutica: cápsula/)).toBeInTheDocument();
    expect(within(live).getByText(/Tipo de cápsula: vegetal/)).toBeInTheDocument();
    expect(within(live).getByText(/Base informada pelo prescritor/)).toBeInTheDocument();
    expect(within(live).getByText(/Embalagem: frasco/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ });
    const choices = {
      pharmaceuticalForm: "cápsula",
      capsuleType: "vegetal",
      excipient: "Base informada pelo prescritor",
      packaging: "frasco",
    };
    expect(requests[0]).toMatchObject({ action: "PREVIEW", formula: choices });
    fireEvent.click(screen.getByRole("button", { name: "Transformar em modelo" }));
    fireEvent.change(screen.getByLabelText("Nome do modelo"), {
      target: { value: "Escolhas explícitas" },
    });
    fireEvent.click(
      screen.getByLabelText("Confirmei que o modelo não contém dados pessoais de pacientes."),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Salvar modelo$/ }));
    await screen.findByText("Protocolo pessoal salvo.");
    expect(requests[1]).toMatchObject({ action: "SAVE", formula: choices });
    expect(screen.queryByRole("region", { name: "Revisão da composição" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Calcular e revisar composição" }));
    await screen.findByRole("button", { name: "Inserir no rascunho da receita" });
    fireEvent.click(screen.getByLabelText(/^Conferi composição/));
    fireEvent.change(screen.getByLabelText("Embalagem"), { target: { value: "pote" } });
    expect(screen.queryByRole("region", { name: "Revisão da composição" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    expect(
      await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ }),
    ).toBeDisabled();
  });
  it("preserves previously saved values outside the choice lists and allows explicit custom overrides", async () => {
    fixtures.templates = [
      {
        id: "legacy-protocol",
        title: "Modelo anterior",
        version: 1,
        formula: {
          ingredients: [
            {
              medicationName: "Sintético legado",
              dose: "2",
              doseUnit: "mg",
              individualCapsule: false,
            },
          ],
          route: "Via personalizada anterior",
          presentation: "Apresentação anterior",
          pharmaceuticalForm: "Forma anterior",
          capsuleType: "Cápsula anterior",
          excipient: "Base anterior",
          packaging: "Embalagem anterior",
          instructions: "",
          phases: [{ doseUnits: 1, frequencyPerDay: 1, durationDays: 7, maintenance: false }],
        },
      },
    ];
    const { requests } = setup();
    fireEvent.change(screen.getByLabelText("Protocolo pessoal"), {
      target: { value: "legacy-protocol" },
    });
    for (const [label, value] of [
      ["Via de administração", "Via personalizada anterior"],
      ["Apresentação (unidade de administração)", "Apresentação anterior"],
      ["Forma farmacêutica", "Forma anterior"],
      ["Tipo de cápsula", "Cápsula anterior"],
      ["Base / excipiente", "Base anterior"],
      ["Embalagem", "Embalagem anterior"],
    ]) {
      expect(screen.getByLabelText(label!)).toHaveValue("__custom__");
      expect(screen.getByLabelText(`${label} personalizado`)).toHaveValue(value);
    }
    fireEvent.change(screen.getByLabelText("Via de administração personalizado"), {
      target: { value: "Via ajustada explicitamente" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    await screen.findByRole("button", { name: /^Inserir no rascunho da receita$/ });
    expect(requests[0]).toMatchObject({
      formula: {
        route: "Via ajustada explicitamente",
        presentation: "Apresentação anterior",
        pharmaceuticalForm: "Forma anterior",
        capsuleType: "Cápsula anterior",
        excipient: "Base anterior",
        packaging: "Embalagem anterior",
      },
    });
  });
  it("copies a shared model without updating its source and requires an explicit no-patient-data acknowledgement", async () => {
    fixtures.templates = [
      {
        id: "shared",
        title: "Modelo compartilhado",
        version: 3,
        visibility: "ORGANIZATION",
        canEdit: false,
        formula: {
          ingredients: [
            {
              medicationName: "Ativo sintético",
              dose: "5",
              doseUnit: "mg",
              individualCapsule: false,
            },
          ],
          route: "oral",
          presentation: "cápsula",
          instructions: "",
          phases: [{ doseUnits: 1, frequencyPerDay: 1, durationDays: 10, maintenance: false }],
        },
      },
    ];
    const original = JSON.stringify(fixtures.templates);
    const { requests } = setup();
    fireEvent.change(screen.getByLabelText("Protocolo pessoal"), { target: { value: "shared" } });
    expect(screen.queryByRole("button", { name: "Editar este modelo" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transformar em modelo" }));
    expect(screen.getByRole("button", { name: "Salvar modelo" })).toBeDisabled();
    expect(requests).toHaveLength(0);
    fireEvent.click(
      screen.getByLabelText("Confirmei que o modelo não contém dados pessoais de pacientes."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar modelo" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      action: "SAVE",
      visibility: "PRIVATE",
      confirmedNoPatientData: true,
      title: "Modelo compartilhado",
    });
    expect(requests[0]).not.toHaveProperty("id");
    expect(requests[0]).not.toHaveProperty("version");
    expect(JSON.stringify(fixtures.templates)).toBe(original);
  });
  it("updates a source only after its explicit owner edit action and never broadens the last selected unit implicitly", async () => {
    fixtures.templates = [
      {
        id: "owned",
        title: "Modelo próprio",
        version: 2,
        visibility: "PRIVATE",
        unitIds: ["unit-a"],
        canEdit: true,
        formula: {
          ingredients: [
            {
              medicationName: "Ativo sintético",
              dose: "5",
              doseUnit: "mg",
              individualCapsule: false,
            },
          ],
          route: "oral",
          presentation: "cápsula",
          instructions: "",
          phases: [{ doseUnits: 1, frequencyPerDay: 1, durationDays: 10, maintenance: false }],
        },
      },
    ];
    const { requests } = setup();
    fireEvent.change(screen.getByLabelText("Protocolo pessoal"), { target: { value: "owned" } });
    fireEvent.click(screen.getByRole("button", { name: "Editar este modelo" }));
    expect(screen.getByLabelText("Unidade A")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Unidade A"));
    expect(screen.getByLabelText("Unidade A")).toBeChecked();
    expect(screen.getByLabelText("Todas as unidades da organização")).not.toBeChecked();
    fireEvent.click(
      screen.getByLabelText("Confirmei que o modelo não contém dados pessoais de pacientes."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar modelo" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      action: "SAVE",
      id: "owned",
      version: 2,
      unitIds: ["unit-a"],
      confirmedNoPatientData: true,
    });
  });
  it("links the instantiated copy to the newly saved model revision instead of its earlier shared source", async () => {
    const source: PrescriptionProtocol = {
      id: "earlier-source",
      title: "Modelo compartilhado",
      version: 3,
      visibility: "ORGANIZATION",
      canEdit: false,
      formula: {
        ingredients: [
          {
            medicationName: "Ativo sintético",
            dose: "5",
            doseUnit: "mg",
            individualCapsule: false,
          },
        ],
        route: "oral",
        presentation: "cápsula",
        instructions: "",
        phases: [{ doseUnits: 1, frequencyPerDay: 1, durationDays: 10, maintenance: false }],
      },
    };
    fixtures.templates = [source];
    const { requests, insert } = setup();
    fireEvent.change(screen.getByLabelText("Protocolo pessoal"), { target: { value: source.id } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular e revisar composição" }));
    await screen.findByRole("button", { name: "Inserir no rascunho da receita" });
    fireEvent.click(screen.getByLabelText(/^Conferi composição/));
    fireEvent.click(screen.getByRole("button", { name: "Transformar em modelo" }));
    fireEvent.click(
      screen.getByLabelText("Confirmei que o modelo não contém dados pessoais de pacientes."),
    );
    fixtures.refreshedTemplates = [
      { ...source, id: "synthetic-protocol", version: 1, visibility: "PRIVATE", canEdit: true },
    ];
    fireEvent.click(screen.getByRole("button", { name: "Salvar modelo" }));
    await screen.findByText("Protocolo pessoal salvo.");
    expect(
      screen.queryByRole("button", { name: "Inserir no rascunho da receita" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Protocolo pessoal")).toHaveValue("synthetic-protocol");
    fireEvent.click(screen.getByRole("button", { name: "Calcular e revisar composição" }));
    await screen.findByRole("button", { name: "Inserir no rascunho da receita" });
    fireEvent.click(screen.getByLabelText(/^Conferi composição/));
    fireEvent.click(screen.getByRole("button", { name: "Inserir no rascunho da receita" }));
    await waitFor(() => expect(insert).toHaveBeenCalled());
    expect(requests.find((request) => request["action"] === "INSTANTIATE")).toMatchObject({
      sourceId: "synthetic-protocol",
      sourceVersion: 1,
      documentId: "synthetic-document",
    });
    expect(requests.find((request) => request["action"] === "SAVE")).not.toHaveProperty("id");
  });
});
