import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
} from "@testing-library/react";
import { LaboratoryReview } from "@/components/clinic/laboratory-review";
import { emptyLaboratoryDraft, emptyLaboratoryRow } from "@/lib/laboratory-results";
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderView(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
vi.mock("@/components/clinic/private-document-preview", () => ({
  PrivateDocumentPreview: () => <div>PDF original preservado</div>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("reviews beside the original, saves before validation and preserves literal results", async () => {
  let current = {
    source: {
      id: "doc",
      title: "Exame sintético",
      sha256: "hash",
      previewUrl: "/api/v1/inventory/patient-document-file?sourceId=doc",
    },
    import: {
      id: "job",
      status: "WAITING",
      version: 0,
      draft: emptyLaboratoryDraft(),
      processing_started_at: null,
      failure_code: null,
    },
    versions: [] as { id: string; version: number; reviewer_name: string; created_at: string }[],
    events: [],
    extractionAvailable: false,
    extractionMessage: "Extração por IA ainda não configurada.",
  };
  const actions: {
    action: string;
    draft?: import("@/lib/laboratory-results").LaboratoryDraft;
    version?: number;
    operationId?: string;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      if (body) {
        actions.push(body);
        if (body.action === "SAVE")
          current = {
            ...current,
            import: { ...current.import, draft: body.draft, status: "READY_REVIEW", version: 1 },
          };
        if (body.action === "VALIDATE")
          current = {
            ...current,
            import: { ...current.import, status: "VALIDATED", version: 2 },
            versions: [
              {
                id: "version",
                version: 1,
                reviewer_name: "Profissional",
                created_at: "2026-10-19T12:00:00Z",
              },
            ],
          };
      }
      return Response.json({ data: current });
    }),
  );
  render(<LaboratoryReview patientId="patient" documentId="doc" />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir resultados laboratoriais" }));
  await screen.findByText("PDF original preservado");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Adicionar resultado" })).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "Confirmar resultados" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Extrair resultados com IA" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Adicionar resultado" }));
  fireEvent.change(screen.getByLabelText("Exame da linha 1"), { target: { value: "TSH" } });
  fireEvent.change(screen.getByLabelText("Resultado da linha 1"), { target: { value: "<0,1" } });
  fireEvent.click(screen.getByLabelText("Conferir linha 1"));
  fireEvent.click(
    screen.getByLabelText("Confirmei que o PDF corresponde ao paciente selecionado."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar resultados" }));
  await waitFor(() => expect(screen.getByText("Validado")).toBeInTheDocument());
  expect(actions.map((a) => a.action)).toEqual(["OPEN", "SAVE", "VALIDATE"]);
  expect(actions[1]?.draft?.rows[0]?.result).toBe("<0,1");
  expect(actions[2]?.version).toBe(1);
  expect(actions[2]?.operationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(screen.getByLabelText("Resultado da linha 1")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Corrigir resultados" })).toBeInTheDocument();
});

async function openExtractedReview(version = 3) {
  const rows = [
    { ...emptyLaboratoryRow(), name: "TSH", result: "<0,1", evidence: "TSH <0,1", sourcePage: 1 },
    {
      ...emptyLaboratoryRow(),
      name: "Ferritina",
      result: "20",
      uncertainty: "Número pouco legível",
    },
    { ...emptyLaboratoryRow(), name: "Vitamina D", result: "30" },
    {
      ...emptyLaboratoryRow(),
      name: "Antígeno",
      result: "Não reagente",
      evidence: "Antígeno Não reagente",
      sourcePage: 1,
    },
  ];
  const response = {
    source: { id: "doc", title: "Exame sintético", sha256: "hash", previewUrl: "/private.pdf" },
    import: {
      id: "job",
      status: "READY_REVIEW",
      version: 1,
      draft: { ...emptyLaboratoryDraft(), rows },
      processing_started_at: null,
      failure_code: null,
    },
    versions: [],
    events: [],
    extractionAvailable: true,
    extractionMessage: null,
    evidenceChecks: {
      version,
      parserStatus: "available",
      totalPages: 1,
      rows: [
        {
          status: "literal_match",
          basis: "source_text",
          issues: [],
          fields: { name: { status: "supported" }, result: { status: "supported" } },
        },
        { status: "attention", basis: "source_text", issues: ["MODEL_UNCERTAINTY"] },
        { status: "literal_match", basis: "model_evidence", issues: [] },
        {
          status: "literal_match",
          basis: "source_text",
          issues: [],
          fields: { name: { status: "supported" }, result: { status: "supported" } },
        },
      ],
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: response })),
  );
  render(<LaboratoryReview patientId="patient" documentId="doc" />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir resultados laboratoriais" }));
  await screen.findByDisplayValue("Ferritina");
  if (version === 3)
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Conferi as 2 linhas sem pendências" }),
      ).toBeEnabled(),
    );
}

it("bulk confirmation only marks independently matched rows and still requires patient confirmation", async () => {
  await openExtractedReview();
  expect(screen.getByLabelText("Conferir linha 1")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Conferi as 2 linhas sem pendências" }));
  expect(screen.getByLabelText("Conferir linha 1")).toBeChecked();
  expect(screen.getByLabelText("Conferir linha 4")).toBeChecked();
  expect(screen.getByLabelText("Conferir linha 2")).not.toBeChecked();
  expect(screen.getByLabelText("Conferir linha 3")).not.toBeChecked();
  expect(
    screen.getByLabelText("Confirmei que o PDF corresponde ao paciente selecionado."),
  ).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Confirmar resultados" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Conferir linha 3"));
  expect(screen.getByLabelText("Conferir linha 3")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Conferir linha 2"));
  fireEvent.click(screen.getByRole("button", { name: "Atenção individual" }));
  expect(screen.getByLabelText("Conferir linha 2")).toBeChecked();
  expect(screen.getByRole("button", { name: "Confirmar resultados" })).toBeDisabled();
});

it("edits the original row index when attention filtering hides other rows", async () => {
  await openExtractedReview();
  fireEvent.click(screen.getByRole("button", { name: "Atenção individual" }));
  expect(screen.queryByLabelText("Exame da linha 1")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Resultado da linha 2"), { target: { value: "21" } });
  fireEvent.click(screen.getByRole("button", { name: "Todos" }));
  expect(screen.getByLabelText("Resultado da linha 1")).toHaveValue("<0,1");
  expect(screen.getByLabelText("Resultado da linha 2")).toHaveValue("21");
  expect(screen.getByLabelText("Resultado da linha 3")).toHaveValue("30");
  expect(screen.getByLabelText("Resultado da linha 4")).toHaveValue("Não reagente");
});

it("editing an independently matched result clears its confirmation and bulk eligibility", async () => {
  await openExtractedReview();
  fireEvent.click(screen.getByRole("button", { name: "Conferi as 2 linhas sem pendências" }));
  fireEvent.change(screen.getByLabelText("Resultado da linha 1"), { target: { value: "0,2" } });
  expect(screen.getByLabelText("Conferir linha 1")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Conferi as 0 linhas sem pendências" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Não conferidos" }));
  expect(screen.getByLabelText("Resultado da linha 1")).toHaveValue("0,2");
  expect(screen.queryByLabelText("Resultado da linha 4")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Conferir linha 1"));
  expect(screen.queryByLabelText("Resultado da linha 1")).not.toBeInTheDocument();
});

it("retains an edited laboratory review when outer document close or unit change is attempted", async () => {
  await openExtractedReview();
  fireEvent.change(screen.getByLabelText("Resultado da linha 1"), { target: { value: "17" } });
  const close = new CustomEvent("allik:before-clinical-file-close", {
    cancelable: true,
    detail: { patientId: "patient" },
  });
  expect(window.dispatchEvent(close)).toBe(false);
  const changeUnit = new CustomEvent("allik:before-unit-change", { cancelable: true });
  expect(window.dispatchEvent(changeUnit)).toBe(false);
  expect(screen.getByLabelText("Resultado da linha 1")).toHaveValue("17");
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Salve ou descarte explicitamente"),
  );
});

it("publishes keyed clinical review draft state and clears its navigation guard on unmount", async () => {
  const states: { editorId: string; patientId: string; dirty: boolean; pending: boolean }[] = [];
  const listener = (event: Event) => states.push((event as CustomEvent).detail);
  window.addEventListener("allik:clinical-file-draft-state", listener);
  try {
    await openExtractedReview();
    fireEvent.change(screen.getByLabelText("Resultado da linha 1"), { target: { value: "19" } });
    expect(states.at(-1)).toMatchObject({ patientId: "patient", dirty: true, pending: false });
    const editorId = states.at(-1)!.editorId;
    expect(editorId).toBeTruthy();
    cleanup();
    expect(states.at(-1)).toEqual({ editorId, patientId: "patient", dirty: false, pending: false });
  } finally {
    window.removeEventListener("allik:clinical-file-draft-state", listener);
  }
});

function extractionState(status = "WAITING", version = 0) {
  return {
    source: { id: "doc", title: "Exame sintético", sha256: "hash", previewUrl: "/private.pdf" },
    import: {
      id: "job",
      status,
      version,
      draft:
        status === "READY_REVIEW"
          ? {
              patientConfirmed: false,
              notes: "",
              rows: [{ ...emptyLaboratoryRow(), name: "TSH", result: "0,2" }],
            }
          : emptyLaboratoryDraft(),
      processing_started_at: status === "PROCESSING" ? new Date().toISOString() : null,
      failure_code: null,
    },
    versions: [],
    events: [],
    extractionAvailable: true,
    extractionMessage: null,
  };
}
it.each(["network", "invalid-json"])(
  "recovers the completed job after %s without another extraction or implicit confirmation",
  async (failure) => {
    const actions: string[] = [];
    let current = extractionState();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const action = init.body ? JSON.parse(String(init.body)).action : null;
        if (action) actions.push(action);
        else reads++;
        if (action === "EXTRACT") {
          current = extractionState("READY_REVIEW", 2);
          if (failure === "network") throw new TypeError("Network lost");
          return new Response("<!doctype html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        return Response.json({ data: current });
      }),
    );
    render(<LaboratoryReview patientId="patient" documentId="doc" />);
    fireEvent.click(screen.getByRole("button", { name: "Conferir resultados laboratoriais" }));
    fireEvent.click(await screen.findByRole("button", { name: "Extrair resultados com IA" }));
    expect(await screen.findByDisplayValue("0,2")).toBeEnabled();
    expect(
      screen.getByText("Extração concluída. Confira os resultados antes de confirmar."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Conferir linha 1")).not.toBeChecked();
    expect(actions).toEqual(["OPEN", "EXTRACT"]);
    expect(reads).toBe(1);
  },
);
it("reconciles a running job and ignores delayed polling after the professional edits the completed draft", async () => {
  let poll: (() => void) | undefined;
  const native = window.setInterval.bind(window);
  const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, ms, ...args) => {
    if (ms === 3000) {
      if (typeof handler === "function") poll = () => handler(...args);
      return 987 as unknown as ReturnType<typeof window.setInterval>;
    }
    return native(handler, ms, ...args) as unknown as ReturnType<typeof window.setInterval>;
  });
  const pending: Array<(response: Response) => void> = [];
  const actions: string[] = [];
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const action = init.body ? JSON.parse(String(init.body)).action : null;
      if (action) actions.push(action);
      if (action === "EXTRACT") throw new TypeError("Network lost");
      if (!action) {
        if (reads++ === 0) return Response.json({ data: extractionState("PROCESSING", 1) });
        return new Promise<Response>((resolve) => pending.push(resolve));
      }
      return Response.json({ data: extractionState() });
    }),
  );
  try {
    render(<LaboratoryReview patientId="patient" documentId="doc" />);
    fireEvent.click(screen.getByRole("button", { name: "Conferir resultados laboratoriais" }));
    fireEvent.click(await screen.findByRole("button", { name: "Extrair resultados com IA" }));
    await screen.findByText(/A extração continua no servidor/);
    await waitFor(() => expect(poll).toBeDefined());
    act(() => {
      poll!();
      poll!();
    });
    expect(pending).toHaveLength(2);
    await act(async () => {
      pending[1]!(Response.json({ data: extractionState("READY_REVIEW", 2) }));
    });
    const value = await screen.findByDisplayValue("0,2");
    fireEvent.change(value, { target: { value: "5,5" } });
    await act(async () => {
      pending[0]!(Response.json({ data: extractionState("PROCESSING", 1) }));
    });
    expect(value).toHaveValue("5,5");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(actions).toEqual(["OPEN", "EXTRACT"]);
  } finally {
    interval.mockRestore();
  }
});
it("does not reconcile a forbidden extraction as a transport failure", async () => {
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const action = init.body ? JSON.parse(String(init.body)).action : null;
      if (!action) reads++;
      return action === "EXTRACT"
        ? Response.json({ error: "Acesso revogado" }, { status: 403 })
        : Response.json({ data: extractionState() });
    }),
  );
  render(<LaboratoryReview patientId="patient" documentId="doc" />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir resultados laboratoriais" }));
  fireEvent.click(await screen.findByRole("button", { name: "Extrair resultados com IA" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Acesso revogado");
  expect(reads).toBe(0);
});

it.each([1, 2])(
  "keeps legacy v%s evidence readable without granting current bulk eligibility",
  async (version) => {
    await openExtractedReview(version);
    expect(screen.getByRole("button", { name: /Conferi as 0/ })).toBeDisabled();
    expect(screen.getByLabelText("Conferir linha 1")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Conferir linha 1"));
    expect(screen.getByLabelText("Conferir linha 1")).toBeChecked();
  },
);
