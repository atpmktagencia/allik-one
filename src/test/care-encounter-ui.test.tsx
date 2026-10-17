import { useBlocker } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Care encounter UI", () => {
  it("shows the operational context and completes an in-progress appointment", async () => {
    const writes: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
          return Response.json({ data: { documents: [], templates: [], canAuthor: true } });
        if (init?.method === "POST") {
          writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json({ data: { id: "44444444-4444-4444-8444-444444444444" } });
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
            clinicalNote: null,
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
      await screen.findByRole("heading", { name: "Paciente Operacional" }),
    ).toBeInTheDocument();
    const clinicalNavigation = screen.getAllByRole("navigation", {
      name: "Seções do atendimento",
    });
    expect(clinicalNavigation).toHaveLength(2);
    expect(clinicalNavigation[0]!.querySelector('a[href="#prescricao"]')).toHaveTextContent(
      "Prescrição",
    );
    expect(clinicalNavigation[0]!.querySelector('a[href="#orcamento"]')).toHaveTextContent(
      "Orçamento",
    );
    expect(screen.getByText("CRM 12345/CE")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Peso/), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText(/Altura/), { target: { value: "175" } });
    expect(screen.getByText("IMC: 22.9")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Escolha um modelo de anamnese"), {
      target: { value: "healthyLongevity" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inserir modelo" }));
    expect((screen.getByLabelText("Evolução") as HTMLTextAreaElement).value).toContain(
      "ANAMNESE LONGEVIDADE SAUDÁVEL",
    );
    expect(screen.queryByRole("textbox", { name: "Motivo da consulta" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Conduta" })).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Hipóteses diagnósticas e diagnósticos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Plano clínico" })).toBeInTheDocument();
    expect(screen.getByLabelText("Data prevista para retorno")).toBeInTheDocument();
    expect(await screen.findByText("Prescrição do atendimento")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar item" }));
    expect(screen.getByLabelText("Intervalo da frequência do item 1")).toHaveValue(1);
    expect(screen.getByLabelText("Unidade da frequência do item 1")).toHaveValue("WEEK");
    expect(screen.getByLabelText("Quantidade da duração do item 1")).toHaveValue(4);
    expect(screen.getByLabelText("Unidade da duração do item 1")).toHaveValue("WEEK");
    expect(screen.queryByRole("textbox", { name: "Frequência" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anamnese estruturada" }));
    fireEvent.click(screen.getByRole("button", { name: "Motivo da consulta" }));
    expect(screen.getByRole("textbox", { name: "Motivo da consulta" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Concluir atendimento" }));
    await waitFor(() =>
      expect(writes).toContainEqual(
        expect.objectContaining({
          action: "UPDATE_STATUS",
          status: "COMPLETED",
          version: 2,
        }),
      ),
    );
  });

  it("shows reassignment when another professional owns an existing draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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
    const options = vi.mocked(useBlocker).mock.calls.at(-1)![0] as unknown as {
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
    fireEvent.change(evolution, { target: { value: "Meu próximo texto" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2]).toEqual(
      expect.objectContaining({ version: 6, evolution: "Meu próximo texto" }),
    );
  });
});
