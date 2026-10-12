import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { CareAppointmentsPage } from "@/components/clinic/care-appointments-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="#patient" className={className}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CareAppointmentsPage />
    </QueryClientProvider>,
  );
}

describe("Care appointments UI", () => {
  it("opens the patient and sends an audited status transition", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const unitId = "11111111-1111-4111-8111-111111111111";
    const patientId = "22222222-2222-4222-8222-222222222222";
    const professionalId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json({ data: { id: "44444444-4444-4444-8444-444444444444" } });
        }
        return Response.json({
          data: {
            appointments: [
              {
                id: "44444444-4444-4444-8444-444444444444",
                unitId,
                unitName: "Fortaleza",
                patientId,
                patientName: "Paciente Agenda",
                phone: "+55 85 99999-0000",
                professionalUserId: professionalId,
                professionalName: "Profissional Teste",
                careType: "CONSULTATION",
                otherCareType: null,
                startsAt: "2026-10-12T12:00:00.000Z",
                endsAt: "2026-10-12T13:00:00.000Z",
                room: "Consultório 1",
                chair: null,
                resourceName: null,
                notes: "",
                status: "SCHEDULED",
                version: 0,
              },
            ],
            patients: [
              {
                id: patientId,
                unitId,
                fullName: "Paciente Agenda",
                phone: "+55 85 99999-0000",
                email: "paciente@example.test",
                documentNumber: "12345678900",
                internalCode: "PAC-000001",
              },
            ],
            professionals: [
              {
                id: professionalId,
                name: "Profissional Teste",
                profession: "Médico",
                unitId,
              },
            ],
            units: [{ id: unitId, name: "Fortaleza" }],
            careTypes: [{ code: "CONSULTATION", name: "Consulta" }],
            rooms: [{ id: "55555555-5555-4555-8555-555555555555", unitId, name: "Consultório 1" }],
            resources: [],
            canManage: true,
          },
        });
      }),
    );
    mount();

    expect(await screen.findByRole("link", { name: "Paciente Agenda" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(writes).toContainEqual(
        expect.objectContaining({
          action: "UPDATE_STATUS",
          patientId,
          status: "CONFIRMED",
          version: 0,
        }),
      ),
    );
    expect(await screen.findByText(/marcado como confirmado/i)).toBeInTheDocument();
  });
});
