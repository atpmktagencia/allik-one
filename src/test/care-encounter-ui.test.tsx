import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { CareEncounterPage } from "@/components/clinic/care-encounter-page";

vi.mock("@tanstack/react-router", () => ({
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
        if (init?.method === "POST") {
          writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json({ data: { id: "44444444-4444-4444-8444-444444444444" } });
        }
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
    expect(screen.getByText("CRM 12345/CE")).toBeInTheDocument();
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
});
