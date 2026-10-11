import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PatientsPage } from "@/components/clinic/patients-page";

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
      <PatientsPage />
    </QueryClientProvider>,
  );
}

describe("Patients UI", () => {
  it("starts empty and sends the minimum operational identity", async () => {
    const unitId = "11111111-1111-4111-8111-111111111111";
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ data: { id: submitted["id"] } }, { status: 201 });
        }
        return Response.json({
          data: {
            patients: [],
            units: [{ id: unitId, name: "Fortaleza" }],
            canManage: true,
          },
        });
      }),
    );
    mount();

    expect(await screen.findByText("Nenhum paciente cadastrado")).toBeInTheDocument();
    expect(screen.getByText(/não recebe dados sintéticos/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /novo paciente/i }));
    expect(screen.getByLabelText("Código interno")).toHaveValue("Gerado automaticamente ao salvar");
    fireEvent.change(screen.getByLabelText("Nome completo"), {
      target: { value: "Paciente de Teste" },
    });
    fireEvent.click(screen.getByLabelText("Não possui documento"));
    fireEvent.change(screen.getByLabelText("Telefone principal"), {
      target: { value: "+55 85 99999-0000" },
    });
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "paciente@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar paciente" }));

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toEqual(
      expect.objectContaining({
        action: "CREATE",
        primaryUnitId: unitId,
        internalCode: "",
        fullName: "Paciente de Teste",
        noDocument: true,
        phone: "+55 85 99999-0000",
        email: "paciente@example.test",
        consentStatus: "PENDING",
        version: 0,
      }),
    );
  });

  it("does not show create controls to a read-only response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: { patients: [], units: [], canManage: false } })),
    );
    mount();
    expect(await screen.findByText("Nenhum paciente cadastrado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /novo paciente/i })).not.toBeInTheDocument();
  });
});
