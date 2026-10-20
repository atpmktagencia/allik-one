import { useBlocker } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { CareEncounterPage } from "@/components/clinic/care-encounter-page";

vi.mock("@tanstack/react-router", () => ({
  useBlocker: vi.fn(),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="#destination" className={className}>
      {children}
    </a>
  ),
}));

// Sibling plans register a delegated, disabled blocker after the encounter's guard.
function isActiveBlocker(options: unknown) {
  return (
    typeof options === "object" &&
    options !== null &&
    "disabled" in options &&
    options.disabled === false
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Care encounter UI", () => {
  it("shows operational context, blocks incomplete closure and preserves drafts across steps", async () => {
    const writes: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (String(_input).includes("patient-timeline"))
          return Response.json({
            data: {
              patient: {
                id: "22222222-2222-4222-8222-222222222222",
                name: "Paciente Operacional",
                internalCode: "PAC-000001",
                unitName: "Fortaleza",
              },
              events: [],
              nextCursor: null,
            },
          });
        if (String(_input).includes("patient-treatment-plans"))
          return Response.json({
            data: {
              plans: [],
              canManage: false,
              targets: {
                products: [],
                catalogItems: [],
                treatments: [],
                appointments: [],
                prescriptionInstances: [],
              },
            },
          });
        if (String(_input).includes("laboratory-history"))
          return Response.json({ data: { rows: [], hasMore: false } });
        if (String(_input).includes("patient-documents"))
          return Response.json({
            data: { documents: [], total: 0, categories: [], professionals: [], canUpload: false },
          });
        if (String(_input).includes("encounter-quotes"))
          return Response.json({
            data: {
              prescription: null,
              quote: null,
              pricingOptions: [],
              canManage: false,
              canApprove: false,
              canDecline: false,
              canRegisterPayment: false,
            },
          });
        if (String(_input).includes("preconsultation"))
          return Response.json({
            data: {
              forms: [],
              invitations: [],
              units: [],
              canManage: false,
              canReadAnswers: false,
            },
          });
        if (String(_input).includes("care-tasks"))
          return Response.json({
            data: {
              tasks: [],
              units: [],
              assignees: [],
              canManage: false,
              hasMore: false,
              userId: null,
            },
          });
        if (String(_input).includes("/inventory/patients"))
          return Response.json({ data: { patients: [] } });
        if (String(_input).includes("encounter-documents"))
          return Response.json({
            data: {
              documents: [
                {
                  id: "instructions-test",
                  type: "INSTRUCTIONS",
                  title: "Orientações do atendimento",
                  content: "Orientações sintéticas registradas pelo profissional.",
                  status: "FINAL",
                  version: 1,
                  authorName: "Dra. Profissional",
                  professionalCouncil: "CRM",
                  councilNumber: "12345",
                  councilRegion: "CE",
                  canEdit: false,
                },
              ],
              templates: [],
              canAuthor: true,
            },
          });
        if (init?.method === "POST") {
          writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json({
            data: { id: "initial-note", version: 1 },
          });
        }
        if (String(_input).includes("encounter-prescriptions"))
          return Response.json({
            data: { prescription: null, products: [], canAuthor: true },
          });
        return Response.json({
          data: {
            appointment: {
              id: "44444444-4444-4444-8444-444444444444",
              unitId: "11111111-1111-4111-8111-111111111111",
              unitName: "Fortaleza",
              patientId: "22222222-2222-4222-8222-222222222222",
              patientName: "Paciente Operacional",
              patientCode: "PAC-000001",
              professionalUserId: "33333333-3333-4333-8333-333333333333",
              professionalName: "Dra. Profissional",
              professionalCouncil: "CRM",
              councilNumber: "12345",
              councilRegion: "CE",
              careType: "CONSULTATION",
              careTypeName: "Consulta",
              otherCareType: null,
              startsAt: "2026-10-12T00:00:00.000Z",
              endsAt: "2026-10-12T01:00:00.000Z",
              room: "Consultório 1",
              chair: null,
              resourceName: null,
              notes: "Retorno programado.",
              status: "IN_PROGRESS",
              version: 2,
            },
            changes: [],
            treatments: [],
            schedule: [],
            canManage: true,
            canAuthorClinicalNote: true,
            canClaimClinicalNote: false,
            needsProfessionalRegistration: false,
            clinicalAuthorBlockReason: null,
            clinicalNote: {
              id: "initial-note",
              evolution: "",
              conduct: "",
              diagnosticHypotheses: "",
              clinicalPlan: "",
              returnRecommendation: "",
              returnOn: null,
              chiefComplaint: "Histórico motivo preservado",
              currentHistory: "Histórico atual preservado",
              personalHistory: "Antecedentes históricos preservados",
              familyHistory: "Histórico familiar preservado",
              habits: "Hábitos históricos preservados",
              systemsReview: "Revisão histórica preservada",
              generalExam: "Exame geral histórico preservado",
              cardiovascularExam: "Cardiovascular histórico preservado",
              respiratoryExam: "Respiratório histórico preservado",
              abdominalExam: "Abdominal histórico preservado",
              neurologicalExam: "Neurológico histórico preservado",
              musculoskeletalExam: "Musculoesquelético histórico preservado",
              skinExam: "Pele histórica preservada",
              otherExam: "Outros achados históricos preservados",
              status: "DRAFT",
              version: 0,
              authorName: "Dra. Profissional",
              professionalCouncil: "CRM",
              councilNumber: "12345",
              councilRegion: "CE",
              systolicPressure: null,
              diastolicPressure: null,
              heartRate: null,
              oxygenSaturation: null,
              temperatureC: null,
              weightKg: null,
              heightCm: null,
              finalizedAt: null,
              updatedAt: "2026-10-12T00:30:00.000Z",
            },
            clinicalAlerts: [],
          },
        });
      }),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CareEncounterPage appointmentId="44444444-4444-4444-8444-444444444444" />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Atendimento de Paciente Operacional" }),
    ).toBeInTheDocument();
    const cleanUnitChange = new Event("allik:before-unit-change", { cancelable: true });
    window.dispatchEvent(cleanUnitChange);
    expect(cleanUnitChange.defaultPrevented).toBe(false);
    const steps = screen.getByRole("tablist", { name: "Etapas do atendimento" });
    expect(
      within(steps)
        .getAllByRole("tab")
        .map((item) => item.textContent),
    ).toEqual(["1Anamnese", "2Exames", "3Prescrição", "4Solicitações", "5Revisão"]);
    expect(within(steps).getByRole("tab", { name: "Anamnese" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent(
      window,
      new CustomEvent("allik:clinical-file-draft-state", {
        detail: {
          editorId: "lab-review",
          patientId: "22222222-2222-4222-8222-222222222222",
          dirty: true,
          pending: false,
        },
      }),
    );
    const laboratoryBlocker = [...vi.mocked(useBlocker).mock.calls]
      .reverse()
      .find(([options]) => isActiveBlocker(options))?.[0] as unknown as {
      disabled: boolean;
      enableBeforeUnload: boolean;
    };
    expect(laboratoryBlocker.disabled).toBe(false);
    expect(laboratoryBlocker.enableBeforeUnload).toBe(true);
    const laboratoryUnitChange = new Event("allik:before-unit-change", { cancelable: true });
    window.dispatchEvent(laboratoryUnitChange);
    expect(laboratoryUnitChange.defaultPrevented).toBe(true);
    fireEvent(
      window,
      new CustomEvent("allik:clinical-file-draft-state", {
        detail: {
          editorId: "lab-review",
          patientId: "22222222-2222-4222-8222-222222222222",
          dirty: false,
          pending: false,
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Concluir atendimento" }));
    expect(screen.getByRole("button", { name: "Concluir atendimento" })).toBeDisabled();
    expect(writes).toHaveLength(0);
    fireEvent.click(within(steps).getByRole("tab", { name: /^Prescrição$/ }));
    if (!screen.queryByRole("button", { name: "Adicionar item" })) {
      const returnToMedications = await screen.findByRole("button", {
        name: "Voltar aos medicamentos",
      });
      fireEvent.click(returnToMedications);
    }
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar item" }));
    const therapeuticBlocker = [...vi.mocked(useBlocker).mock.calls]
      .reverse()
      .find(([options]) => isActiveBlocker(options))?.[0] as unknown as {
      disabled: boolean;
      enableBeforeUnload: boolean;
    };
    expect(therapeuticBlocker.disabled).toBe(false);
    expect(therapeuticBlocker.enableBeforeUnload).toBe(true);
    const unsafeUnitChange = new Event("allik:before-unit-change", { cancelable: true });
    window.dispatchEvent(unsafeUnitChange);
    expect(unsafeUnitChange.defaultPrevented).toBe(true);
    fireEvent.click(within(steps).getByRole("tab", { name: /^Anamnese$/ }));
    expect(screen.getByRole("textbox", { name: "Evolução" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Concluir atendimento" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Informações do atendimento" }));
    expect(screen.getByText("CRM 12345/CE")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver ou editar sinais vitais" }));
    fireEvent.change(screen.getByLabelText(/Peso/), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText(/Altura/), { target: { value: "175" } });
    expect(screen.getByText("IMC: 22.9")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /^Modelos$/ }));
    fireEvent.change(screen.getByLabelText("Escolha um modelo de anamnese"), {
      target: { value: "healthyLongevity" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inserir modelo" }));
    const evolution = screen.getByLabelText("Evolução");
    expect((evolution as HTMLTextAreaElement).value).toContain("ANAMNESE LONGEVIDADE SAUDÁVEL");
    expect(screen.queryByRole("button", { name: "Anamnese estruturada" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Exame físico estruturado" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Conduta" })).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Hipóteses diagnósticas, plano clínico e retorno/));
    expect(
      screen.getByRole("textbox", { name: "Hipóteses diagnósticas e diagnósticos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Plano clínico" })).toBeInTheDocument();
    expect(screen.getByLabelText("Data prevista para retorno")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByText("Rascunho salvo.");
    expect(writes[writes.length - 1]).toEqual(
      expect.objectContaining({
        chiefComplaint: "Histórico motivo preservado",
        currentHistory: "Histórico atual preservado",
        generalExam: "Exame geral histórico preservado",
        cardiovascularExam: "Cardiovascular histórico preservado",
      }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Conduta" }), {
      target: { value: "Conduta local não salva" },
    });
    fireEvent.click(within(steps).getByRole("tab", { name: /^Prescrição$/ }));
    if (!screen.queryByRole("button", { name: "Adicionar item" })) {
      const returnToMedications = screen.queryByRole("button", {
        name: "Voltar aos medicamentos",
      });
      if (returnToMedications) fireEvent.click(returnToMedications);
    }
    expect(
      await screen.findByRole("heading", { name: "Registro terapêutico" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Intervalo da frequência do item 1")).toHaveValue(null);
    expect(screen.getByLabelText("Unidade da frequência do item 1")).toHaveValue("");
    expect(screen.getByLabelText("Quantidade da duração do item 1")).toHaveValue(null);
    expect(screen.getByLabelText("Unidade da duração do item 1")).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "Frequência" })).not.toBeInTheDocument();
    fireEvent.click(within(steps).getByRole("tab", { name: /^Revisão$/ }));
    expect(screen.getByRole("heading", { name: "Resumo do atendimento" })).toBeInTheDocument();
    const guidanceCard = screen
      .getByRole("heading", { name: "Orientações e retorno" })
      .closest("article")!;
    expect(within(guidanceCard).getByText("1 documento(s) de orientações")).toBeInTheDocument();
    expect(within(guidanceCard).queryByText("Não registrados")).not.toBeInTheDocument();
    fireEvent.click(within(guidanceCard).getByRole("button", { name: "Revisar" }));
    expect(within(steps).getByRole("tab", { name: /^Prescrição$/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() =>
      expect(within(steps).getByRole("tab", { name: /^Prescrição$/ })).toHaveFocus(),
    );
    expect(screen.getByText("Etapa atual: Prescrição")).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole("tab", { name: /^Exames$/ }));
    fireEvent.click(within(steps).getByRole("tab", { name: /^Anamnese$/ }));
    expect(screen.getByLabelText("Evolução")).toBe(evolution);
    expect((evolution as HTMLTextAreaElement).value).toContain("ANAMNESE LONGEVIDADE SAUDÁVEL");
    expect(screen.queryByRole("textbox", { name: "Motivo da consulta" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Exame físico estruturado" }),
    ).not.toBeInTheDocument();
    const blocker = [...vi.mocked(useBlocker).mock.calls]
      .reverse()
      .find(([options]) => isActiveBlocker(options))?.[0] as unknown as {
      disabled: boolean;
      enableBeforeUnload: boolean;
    };
    expect(blocker.disabled).toBe(false);
    expect(blocker.enableBeforeUnload).toBe(true);
    expect(screen.getByRole("button", { name: "Concluir atendimento" })).toBeDisabled();
    expect(screen.getAllByText("Alterações não salvas")[0]).toBeVisible();
    const beforeHistory = (evolution as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole("button", { name: "Histórico" }));
    expect(
      screen.getByRole("heading", { name: "Histórico longitudinal do paciente" }),
    ).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("textbox", { name: "Evolução" })).toHaveValue(beforeHistory);

    // This scenario traverses all five mounted clinical workspaces and several dialogs.
  }, 15000);

  it("shows reassignment when another professional owns an existing draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("patient-treatment-plans"))
          return Response.json({
            data: {
              plans: [],
              canManage: false,
              targets: {
                products: [],
                catalogItems: [],
                treatments: [],
                appointments: [],
                prescriptionInstances: [],
              },
            },
          });
        if (String(input).includes("laboratory-history"))
          return Response.json({ data: { rows: [], hasMore: false } });
        if (String(input).includes("patient-documents"))
          return Response.json({
            data: { documents: [], total: 0, categories: [], professionals: [], canUpload: false },
          });
        if (String(input).includes("encounter-quotes"))
          return Response.json({
            data: {
              prescription: null,
              quote: null,
              pricingOptions: [],
              canManage: false,
              canApprove: false,
              canDecline: false,
              canRegisterPayment: false,
            },
          });
        if (String(input).includes("preconsultation"))
          return Response.json({
            data: {
              forms: [],
              invitations: [],
              units: [],
              canManage: false,
              canReadAnswers: false,
            },
          });
        if (String(input).includes("care-tasks"))
          return Response.json({
            data: {
              tasks: [],
              units: [],
              assignees: [],
              canManage: false,
              hasMore: false,
              userId: null,
            },
          });
        if (String(input).includes("/inventory/patients"))
          return Response.json({ data: { patients: [] } });
        if (String(input).includes("encounter-documents"))
          return Response.json({ data: { documents: [], templates: [], canAuthor: false } });
        if (String(input).includes("encounter-prescriptions"))
          return Response.json({
            data: { prescription: null, products: [], canAuthor: false },
          });
        return Response.json({
          data: {
            appointment: {
              id: "44444444-4444-4444-8444-444444444444",
              unitId: "11111111-1111-4111-8111-111111111111",
              unitName: "Fortaleza",
              patientId: "22222222-2222-4222-8222-222222222222",
              patientName: "Paciente com Rascunho",
              patientCode: "PAC-000002",
              professionalUserId: "33333333-3333-4333-8333-333333333333",
              professionalName: "Outro Profissional",
              professionalCouncil: "CRM",
              councilNumber: "12345",
              councilRegion: "CE",
              careType: "CONSULTATION",
              careTypeName: "Consulta",
              otherCareType: null,
              startsAt: "2026-10-12T00:00:00.000Z",
              endsAt: "2026-10-12T01:00:00.000Z",
              room: "Consultório 1",
              chair: null,
              resourceName: null,
              notes: "",
              status: "COMPLETED",
              version: 1,
            },
            changes: [],
            treatments: [],
            schedule: [],
            canManage: true,
            canAuthorClinicalNote: false,
            canClaimClinicalNote: true,
            needsProfessionalRegistration: false,
            clinicalAuthorBlockReason: "Este atendimento está atribuído a Outro Profissional.",
            clinicalNote: {
              id: "55555555-5555-4555-8555-555555555555",
              status: "DRAFT",
              version: 0,
              evolution: "Rascunho preservado.",
              conduct: "",
              authorName: "Outro Profissional",
              professionalCouncil: "CRM",
              councilNumber: "12345",
              councilRegion: "CE",
              finalizedAt: null,
              updatedAt: "2026-10-12T00:30:00.000Z",
            },
            clinicalAlerts: [],
          },
        });
      }),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CareEncounterPage appointmentId="44444444-4444-4444-8444-444444444444" />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("Este atendimento está atribuído a Outro Profissional."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Assumir responsabilidade pelo atendimento" }),
    ).toBeInTheDocument();
  });
});

describe("Clinical draft concurrency", () => {
  it("keeps the displayed version and local text through refresh and failed saves", async () => {
    let serverVersion = 4;
    let failSave = true;
    const writes: Array<Record<string, unknown>> = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("patient-treatment-plans"))
          return Response.json({
            data: {
              plans: [],
              canManage: false,
              targets: {
                products: [],
                catalogItems: [],
                treatments: [],
                appointments: [],
                prescriptionInstances: [],
              },
            },
          });
        if (String(input).includes("laboratory-history"))
          return Response.json({ data: { rows: [], hasMore: false } });
        if (String(input).includes("patient-documents"))
          return Response.json({
            data: { documents: [], total: 0, categories: [], professionals: [], canUpload: false },
          });
        if (String(input).includes("encounter-quotes"))
          return Response.json({
            data: {
              prescription: null,
              quote: null,
              pricingOptions: [],
              canManage: false,
              canApprove: false,
              canDecline: false,
              canRegisterPayment: false,
            },
          });
        if (String(input).includes("preconsultation"))
          return Response.json({
            data: {
              forms: [],
              invitations: [],
              units: [],
              canManage: false,
              canReadAnswers: false,
            },
          });
        if (String(input).includes("care-tasks"))
          return Response.json({
            data: {
              tasks: [],
              units: [],
              assignees: [],
              canManage: false,
              hasMore: false,
              userId: null,
            },
          });
        if (String(input).includes("/inventory/patients"))
          return Response.json({ data: { patients: [] } });
        if (String(input).includes("encounter-documents"))
          return Response.json({ data: { documents: [], templates: [], canAuthor: false } });
        if (String(input).includes("encounter-prescriptions"))
          return Response.json({ data: { prescription: null, products: [], canAuthor: false } });
        if (init?.method === "POST") {
          writes.push(JSON.parse(String(init.body)));
          return failSave
            ? Response.json({ error: "A evolução foi alterada por outra sessão." }, { status: 409 })
            : Response.json({ data: { id: "note", version: 6 } });
        }
        return Response.json({
          data: {
            appointment: {
              id: "appointment",
              patientId: "patient",
              unitName: "Fortaleza",
              patientName: "Paciente teste",
              patientCode: "PAC-001",
              professionalName: "Profissional teste",
              professionalCouncil: "CRM",
              councilNumber: "123",
              councilRegion: "CE",
              startsAt: "2026-10-14T10:00:00Z",
              endsAt: "2026-10-14T11:00:00Z",
              status: "IN_PROGRESS",
              version: 1,
              careTypeName: "Consulta",
              room: "Sala",
            },
            changes: [],
            treatments: [],
            schedule: [],
            clinicalAlerts: [],
            canManage: false,
            canAuthorClinicalNote: true,
            canClaimClinicalNote: false,
            needsProfessionalRegistration: false,
            clinicalAuthorBlockReason: null,
            clinicalNote: {
              id: "note",
              version: serverVersion,
              status: "DRAFT",
              evolution: serverVersion === 4 ? "Texto inicial" : "Texto de outra sessão",
              conduct: "",
              authorName: "Profissional teste",
              professionalCouncil: "CRM",
              councilNumber: "123",
              councilRegion: "CE",
              updatedAt: "2026-10-14T10:00:00Z",
            },
          },
        });
      }),
    );
    render(
      <QueryClientProvider client={client}>
        <CareEncounterPage appointmentId="appointment" />
      </QueryClientProvider>,
    );
    const evolution = await screen.findByRole("textbox", { name: "Evolução" });
    await waitFor(() => expect(evolution).toHaveValue("Texto inicial"));
    fireEvent.change(evolution, { target: { value: "Meu texto não salvo" } });
    serverVersion = 5;
    await client.refetchQueries();
    expect(evolution).toHaveValue("Meu texto não salvo");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByText("A evolução foi alterada por outra sessão.");
    expect(writes[0]).toEqual(
      expect.objectContaining({ version: 4, evolution: "Meu texto não salvo" }),
    );
    expect(evolution).toHaveValue("Meu texto não salvo");
    const options = [...vi.mocked(useBlocker).mock.calls]
      .reverse()
      .find(([options]) => isActiveBlocker(options))?.[0] as unknown as {
      disabled: boolean;
      enableBeforeUnload: boolean;
      shouldBlockFn: (args: {
        current: { pathname: string };
        next: { pathname: string };
      }) => boolean;
    };
    expect(options.disabled).toBe(false);
    expect(options.enableBeforeUnload).toBe(true);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    expect(
      options.shouldBlockFn({
        current: { pathname: "/atendimentos/appointment" },
        next: { pathname: "/pacientes" },
      }),
    ).toBe(true);
    failSave = false;
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByText("Rascunho salvo.");
    await waitFor(() => {
      const savedUnitChange = new Event("allik:before-unit-change", { cancelable: true });
      window.dispatchEvent(savedUnitChange);
      expect(savedUnitChange.defaultPrevented).toBe(false);
    });
    fireEvent.change(evolution, { target: { value: "Meu próximo texto" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2]).toEqual(
      expect.objectContaining({ version: 6, evolution: "Meu próximo texto" }),
    );
  });
  it.each(["SAVE_DRAFT", "FINALIZE"] as const)(
    "reconciles a committed %s whose response was lost without replaying the write",
    async (action) => {
      vi.stubGlobal(
        "confirm",
        vi.fn(() => true),
      );
      const writes: Array<Record<string, unknown>> = [];
      let note: Record<string, unknown> = {
        id: "reconciled-note",
        version: 4,
        status: "DRAFT",
        evolution: "Initial synthetic text",
        conduct: "",
        authorName: "Synthetic clinician",
        professionalCouncil: "CRM",
        councilNumber: "123",
        councilRegion: "CE",
        updatedAt: "2026-10-19T10:00:00Z",
      };
      const appointment = {
        id: "reconcile-appointment",
        patientId: "reconcile-patient",
        unitId: "reconcile-unit",
        unitName: "Synthetic unit",
        patientName: "Synthetic patient",
        patientCode: "SYN-001",
        professionalName: "Synthetic clinician",
        professionalCouncil: "CRM",
        councilNumber: "123",
        councilRegion: "CE",
        startsAt: "2026-10-19T10:00:00Z",
        endsAt: "2026-10-19T11:00:00Z",
        status: "IN_PROGRESS",
        version: 0,
        careTypeName: "Consulta",
        room: "Synthetic room",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "POST") {
            const submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
            writes.push(submitted);
            note = {
              ...note,
              ...submitted,
              version: Number(submitted["version"]) + 1,
              status: submitted["action"] === "FINALIZE" ? "FINAL" : "DRAFT",
            };
            if (writes.length === 1) throw new TypeError("Connection lost after commit");
            return Response.json({
              data: { id: note["id"], version: note["version"], status: note["status"] },
            });
          }
          return Response.json({
            data: {
              appointment,
              clinicalNote: note,
              canAuthorClinicalNote: note["status"] !== "FINAL",
              canManage: false,
              canClaimClinicalNote: false,
              needsProfessionalRegistration: false,
              clinicalAuthorBlockReason: null,
              clinicalAlerts: [],
              changes: [],
              treatments: [],
              schedule: [],
              documents: [],
              templates: [],
              prescription: null,
              products: [],
              requests: [],
              rows: [],
              hasMore: false,
              total: 0,
              categories: [],
              professionals: [],
              canUpload: false,
              canAuthor: false,
              quote: null,
              pricingOptions: [],
              forms: [],
              invitations: [],
              units: [],
              tasks: [],
              assignees: [],
              plans: [],
            },
          });
        }),
      );
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <CareEncounterPage appointmentId="reconcile-appointment" />
        </QueryClientProvider>,
      );
      const evolution = await screen.findByRole("textbox", { name: "Evolução" });
      await waitFor(() => expect(evolution).toHaveValue("Initial synthetic text"));
      fireEvent.change(evolution, {
        target: { value: "Synthetic text committed before connection loss" },
      });
      fireEvent.click(
        screen.getByRole("button", {
          name: action === "FINALIZE" ? "Finalizar evolução" : "Salvar rascunho",
        }),
      );
      await screen.findByText(
        action === "FINALIZE"
          ? "Finalização confirmada no servidor após falha de resposta."
          : "Rascunho confirmado no servidor após falha de resposta.",
      );
      expect(writes).toHaveLength(1);
      expect(evolution).toHaveValue("Synthetic text committed before connection loss");
      const cleanUnitChange = new Event("allik:before-unit-change", { cancelable: true });
      window.dispatchEvent(cleanUnitChange);
      expect(cleanUnitChange.defaultPrevented).toBe(false);
      if (action === "FINALIZE") expect(evolution).toBeDisabled();
      else {
        fireEvent.change(evolution, { target: { value: "Next synthetic revision" } });
        fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
        await waitFor(() => expect(writes).toHaveLength(2));
        expect(writes[1]?.["version"]).toBe(5);
      }
    },
  );
});
