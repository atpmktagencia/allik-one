import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));

import { UserAdministration } from "@/routes/estoque/usuarios";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("User administration UI", () => {
  it("creates a user with access to more than one unit", async () => {
    const unitIds = {
      fortaleza: "11111111-1111-4111-8111-111111111111",
      juazeiro: "22222222-2222-4222-8222-222222222222",
    };
    let submittedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ data: { activationPath: "/estoque/ativar?token=test" } });
        }
        if (url.endsWith("/api/inventory-session"))
          return Response.json({
            data: {
              units: [
                { id: unitIds.fortaleza, name: "Fortaleza" },
                { id: unitIds.juazeiro, name: "Juazeiro do Norte" },
              ],
            },
          });
        return Response.json({ data: [] });
      }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });

    render(<UserAdministration />);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Usuário Multunidade" } });
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "multi@allik.test" },
    });
    fireEvent.change(screen.getByLabelText("Profissão"), { target: { value: "Médico" } });
    fireEvent.change(screen.getByLabelText("Perfil de acesso"), { target: { value: "CLINICIAN" } });
    expect(screen.getByRole("option", { name: "Profissional de saúde" })).toHaveValue("CLINICIAN");
    fireEvent.change(screen.getByLabelText("Conselho profissional"), {
      target: { value: "CRM" },
    });
    fireEvent.change(screen.getByLabelText("Número do conselho"), {
      target: { value: "12345" },
    });
    fireEvent.change(screen.getByLabelText("UF do conselho"), { target: { value: "ce" } });
    fireEvent.click(await screen.findByLabelText("Fortaleza"));
    fireEvent.click(screen.getByLabelText("Juazeiro do Norte"));
    fireEvent.click(screen.getByRole("button", { name: "Criar e copiar convite" }));

    await waitFor(() =>
      expect(submittedBody?.["unitIds"]).toEqual([unitIds.fortaleza, unitIds.juazeiro]),
    );
    expect(submittedBody).toEqual(
      expect.objectContaining({
        role: "CLINICIAN",
        professionalCouncil: "CRM",
        councilNumber: "12345",
        councilRegion: "CE",
      }),
    );
  });

  it("edits an existing professional registration and unit access", async () => {
    const fortaleza = "11111111-1111-4111-8111-111111111111";
    const juazeiro = "22222222-2222-4222-8222-222222222222";
    const userId = "33333333-3333-4333-8333-333333333333";
    let submittedBody: Record<string, unknown> | undefined;
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ data: { id: userId } });
        }
        if (String(input).endsWith("/api/inventory-session"))
          return Response.json({
            data: {
              units: [
                { id: fortaleza, name: "Fortaleza" },
                { id: juazeiro, name: "Juazeiro do Norte" },
              ],
            },
          });
        return Response.json({
          data: [
            {
              id: userId,
              name: "Profissional Existente",
              email: "profissional@allik.test",
              role: "UNIT_MANAGER",
              active: true,
              profession: null,
              title: null,
              professionalCouncil: null,
              councilNumber: null,
              councilRegion: null,
              units: [{ id: fortaleza, name: "Fortaleza" }],
            },
          ],
        });
      }),
    );
    render(<UserAdministration />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Profissão"), { target: { value: "Médico" } });
    fireEvent.change(screen.getByLabelText("Conselho profissional"), {
      target: { value: "CRM" },
    });
    fireEvent.change(screen.getByLabelText("Número do conselho"), {
      target: { value: "98765" },
    });
    fireEvent.change(screen.getByLabelText("UF do conselho"), { target: { value: "CE" } });
    fireEvent.click(screen.getByLabelText("Juazeiro do Norte"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() =>
      expect(submittedBody).toEqual(
        expect.objectContaining({
          action: "UPDATE",
          userId,
          professionalCouncil: "CRM",
          councilNumber: "98765",
          unitIds: [fortaleza, juazeiro],
        }),
      ),
    );
  });

  it("copies a one-time password reset link for an active user", async () => {
    const userId = "33333333-3333-4333-8333-333333333333";
    let submittedBody: Record<string, unknown> | undefined;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({
            data: { activationPath: "/estoque/ativar?token=reset-token" },
          });
        }
        if (String(input).endsWith("/api/inventory-session"))
          return Response.json({ data: { units: [] } });
        return Response.json({
          data: [
            {
              id: userId,
              name: "Profissional Ativo",
              email: "ativo@allik.test",
              role: "PARTNER_ADMIN",
              active: true,
              units: [],
            },
          ],
        });
      }),
    );
    render(<UserAdministration />);
    fireEvent.click(await screen.findByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(submittedBody).toEqual({ action: "REINVITE", userId }));
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/estoque/ativar?token=reset-token`,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("expira em 72 horas");
  });
});
