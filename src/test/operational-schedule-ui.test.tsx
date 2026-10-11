import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { OperationalSchedulePage } from "@/components/clinic/operational-schedule-page";

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
});

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OperationalSchedulePage />
    </QueryClientProvider>,
  );
}

describe("Operational schedule UI", () => {
  it("shows patient applications and reloads its operational filters", async () => {
    const requests: string[] = [];
    const writes: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push(String(input));
        if (init?.method === "POST") {
          writes.push(JSON.parse(String(init.body)));
          return Response.json({ data: { id: "schedule-1" } });
        }
        return Response.json({
          data: {
            days: 7,
            status: "PENDING",
            summary: { total: 1, today: 1, overdue: 0, stockWarnings: 1 },
            items: [
              {
                id: "schedule-1",
                patientId: "patient-1",
                unitName: "Fortaleza",
                patientName: "Paciente Sintético",
                internalCode: "PAC-001",
                productName: "Tirzepatida 20 mg / 0,8 mL",
                sku: "STIN-P110",
                route: "SC",
                sequence: 1,
                scheduledOn: "2026-10-11",
                doseQuantity: 2.5,
                doseUnit: "MG",
                status: "PLANNED",
                attendanceStatus: "SCHEDULED",
                version: 0,
                hasPrescription: false,
                presentationName: "Tirzepatida 20 mg",
                physicalUnits: 0,
                openQuantity: 0,
                availableDoseQuantity: 0,
                cumulativeDemandQuantity: 2.5,
                stockWarning: true,
                presentationMissing: false,
                overdue: false,
              },
            ],
          },
        });
      }),
    );
    mount();
    expect(await screen.findByText("Paciente Sintético")).toBeInTheDocument();
    expect(screen.getByText("Estoque insuficiente")).toBeInTheDocument();
    expect(screen.getByText("Sem receita vinculada")).toBeInTheDocument();
    expect(screen.getByText("A confirmar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Paciente confirmou presença para a aplicação." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ação" }));
    await waitFor(() =>
      expect(writes).toContainEqual(
        expect.objectContaining({ action: "CONFIRM", scheduleId: "schedule-1", version: 0 }),
      ),
    );
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "ALL" } });
    await waitFor(() => expect(requests.some((url) => url.includes("status=ALL"))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "14 dias" }));
    await waitFor(() => {
      expect(requests.some((url) => url.includes("days=14") && url.includes("status=ALL"))).toBe(
        true,
      );
    });
  });

  it("shows the empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            days: 7,
            status: "PENDING",
            summary: { total: 0, today: 0, overdue: 0, stockWarnings: 0 },
            items: [],
          },
        }),
      ),
    );
    mount();
    expect(
      await screen.findByText("Nenhuma aplicação encontrada neste período."),
    ).toBeInTheDocument();
  });
});
