import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PatientTimelinePage } from "@/components/clinic/patient-timeline-page";
import { setSelectedUnitId } from "@/data/unit-context";
import { act } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PatientTimelinePage patientId="patient-a" />
    </QueryClientProvider>,
  );
}
const patient = {
  id: "patient-a",
  name: "Paciente Teste",
  internalCode: "ALL-001",
  unitName: "Fortaleza",
};
describe("Patient timeline", () => {
  it("embeds readonly history in the encounter unit without exposing authoring or navigation", async () => {
    localStorage.setItem("allik.inventory.unit", "another-unit");
    const fetchMock = vi.fn(async (..._args: [string]) =>
      Response.json({
        data: {
          patient,
          canCreateEncounter: true,
          events: [
            {
              id: "note",
              kind: "CLINICAL_NOTE",
              title: "Historical note",
              occurredAt: "2026-10-12T12:00:00Z",
              unitName: "Fortaleza",
              status: "FINAL",
              summary: "Saved conduct",
              content: "Historical immutable content",
              appointmentId: "older-appointment",
            },
          ],
          nextCursor: null,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PatientTimelinePage patientId="patient-a" unitId="encounter-unit" embedded />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Historical note")).toBeInTheDocument();
    expect(screen.getByText(/Seu rascunho permanece aberto/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("unitId=encounter-unit");
    expect(screen.queryByRole("link", { name: "Abrir atendimento" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo atendimento/ })).not.toBeInTheDocument();
  });

  it("reloads in the new unit context instead of retaining the previous scope", async () => {
    const fetchMock = vi.fn(async (..._args: [string]) =>
      Response.json({ data: { patient, events: [], nextCursor: null } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount();
    expect(await screen.findByText("Paciente Teste")).toBeInTheDocument();
    act(() => setSelectedUnitId("fortaleza-unit"));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("unitId=fortaleza-unit")),
      ).toBe(true),
    );
  });
  it("loads older records and exposes clinical content without inventing data", async () => {
    const fetchMock = vi.fn(async (input: string) =>
      Response.json({
        data: {
          patient,
          events: [
            {
              id: input.includes("cursor=") ? "older" : "new",
              kind: "CLINICAL_NOTE",
              title: input.includes("cursor=") ? "Consulta anterior" : "Evolução clínica",
              occurredAt: "2026-10-12T12:00:00Z",
              authorName: "Profissional Teste",
              unitName: "Fortaleza",
              status: "FINAL",
              summary: "Registro finalizado",
              content: "Conduta registrada pelo profissional.",
            },
          ],
          nextCursor: input.includes("cursor=") ? null : "older-cursor",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount();
    expect(await screen.findByText("Paciente Teste")).toBeInTheDocument();
    expect(screen.getByText(/Profissional Teste/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ler registro completo"));
    expect(screen.getByText("Conduta registrada pelo profissional.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Carregar registros anteriores" }));
    expect(await screen.findByText("Consulta anterior")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=older-cursor");
  });
  it("requests the selected category and clears records from the old filter", async () => {
    const fetchMock = vi.fn(async (..._args: [string]) =>
      Response.json({ data: { patient, events: [], nextCursor: null } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount();
    expect(await screen.findByText("Nenhum registro encontrado")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mostrar"), { target: { value: "DOCUMENT" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("kind=DOCUMENT"))).toBe(
        true,
      ),
    );
  });
  it("shows retry feedback for a failed service response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    mount();
    expect(await screen.findByText("Não foi possível carregar os dados.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});
