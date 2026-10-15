import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
import { PatientNewEncounter } from "@/components/clinic/patient-new-encounter";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigate.mockReset();
});
it("creates an encounter for the current patient and unit, preserving conflicts and allowing a corrected retry", async () => {
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(JSON.parse(String(init.body)));
        return writes.length === 1
          ? Response.json({ error: "Conflito de horário: profissional ocupado." }, { status: 409 })
          : Response.json({ data: { id: "new-encounter" } }, { status: 201 });
      }
      return Response.json({
        data: {
          canManage: true,
          currentUserId: "doctor",
          professionals: [{ id: "doctor", name: "Profissional de teste", unitId: "fortaleza" }],
          rooms: [
            { id: "room", unitId: "fortaleza", name: "Sala Fortaleza" },
            { id: "foreign", unitId: "juazeiro", name: "Sala Juazeiro" },
          ],
          careTypes: [{ code: "CONSULTATION", name: "Consulta" }],
        },
      });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PatientNewEncounter patientId="current-patient" unitId="fortaleza" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Nova consulta" }));
  const dialog = await screen.findByRole("dialog", { name: "Nova consulta" });
  await within(dialog).findByRole("option", { name: "Sala Fortaleza" });
  expect(within(dialog).queryByRole("option", { name: "Sala Juazeiro" })).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Criar e abrir atendimento" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Conflito de horário");
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Criar e abrir atendimento" }));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/atendimentos/$appointmentId",
      params: { appointmentId: "new-encounter" },
    }),
  );
  expect(writes[0]).toMatchObject({
    patientId: "current-patient",
    unitId: "fortaleza",
    professionalUserId: "doctor",
    room: "Sala Fortaleza",
    status: "SCHEDULED",
  });
  expect(writes[1]?.["id"]).toBe(writes[0]?.["id"]);
});
