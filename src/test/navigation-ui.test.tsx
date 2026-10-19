import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

let currentPath = "/estoque";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    onClick,
    ...props
  }: React.PropsWithChildren<{
    to: string;
    params?: Record<string, string>;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }>) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (url, [key, value]) => url.replace(`$${key}`, value),
        to,
      )}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: currentPath } }),
}));

import { AppShell } from "@/components/clinic/app-shell";
import { selectedUnitId, setSelectedUnitId } from "@/data/unit-context";

afterEach(() => {
  currentPath = "/estoque";
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Inventory navigation", () => {
  it("groups the stable workflow under Estoque and removes the Cadastros section", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell>
          <p>Conteúdo</p>
        </AppShell>
      </QueryClientProvider>,
    );

    const desktopNavigation = screen.getAllByRole("navigation")[0]!;
    expect(within(desktopNavigation).getByText("Estoque")).toBeInTheDocument();
    for (const item of [
      "Estoque atual",
      "Pedidos e entradas",
      "Movimentações e histórico",
      "Produtos e sede",
      "Fazer compra",
      "Aplicações",
      "Paciente360º",
    ])
      expect(within(desktopNavigation).getByRole("link", { name: item })).toBeInTheDocument();
    expect(
      within(desktopNavigation).queryByRole("link", { name: "Precificação" }),
    ).not.toBeInTheDocument();
    expect(within(desktopNavigation).queryByText("Administração")).not.toBeInTheDocument();
    expect(
      within(desktopNavigation).queryByRole("link", { name: "Minha conta" }),
    ).not.toBeInTheDocument();
    expect(within(desktopNavigation).queryByText("Cadastros")).not.toBeInTheDocument();
  });

  it("recolhe a navegação geral no modo focado do atendimento", () => {
    currentPath = "/atendimentos/44444444-4444-4444-8444-444444444444";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell>
          <p>Atendimento focado</p>
        </AppShell>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Abrir menu" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByText("Atendimento focado"));
    expect(main).toHaveClass("w-full", "min-w-0");
    expect(main.className).not.toMatch(/max-w-\[/);
    expect(screen.getByRole("link", { name: "Allik One — Paciente360º" })).toHaveAttribute(
      "href",
      "/pacientes",
    );
    expect(screen.getByRole("button", { name: "Pesquisar pacientes" })).toBeInTheDocument();
    expect(screen.queryByText("Allik One · Operação de estoque")).not.toBeInTheDocument();
  });
});

describe("Account administration menu", () => {
  it.each([
    ["PARTNER_ADMIN", true, false],
    ["SUPER_ADMIN", true, true],
    ["VIEWER", false, false],
  ] as const)("limits administrative links for %s", async (role, users, integrations) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            user: {
              id: "synthetic-user",
              name: "Synthetic administrator",
              email: "synthetic@example.test",
            },
            role,
            units: [],
          },
        }),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell>
          <p>Conteúdo</p>
        </AppShell>
      </QueryClientProvider>,
    );
    const trigger = await screen.findByRole("button", {
      name: "Abrir menu da conta de Synthetic administrator",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(!!within(menu).queryByRole("menuitem", { name: "Usuários" })).toBe(users);
    expect(!!within(menu).queryByRole("menuitem", { name: "Integrações" })).toBe(integrations);
  });
});

describe("Clinical workspace navigation", () => {
  it.each([
    "/pacientes/11111111-1111-4111-8111-111111111111",
    "/pacientes/11111111-1111-4111-8111-111111111111/prontuario",
  ])("preserves the full-width clinical shell on %s", (path) => {
    currentPath = path;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell>
          <p>Ficha do paciente</p>
        </AppShell>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Pesquisar pacientes" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("w-full", "min-w-0");
    expect(screen.getByRole("link", { name: "Allik One — Paciente360º" })).toHaveAttribute(
      "href",
      "/pacientes",
    );
  });

  it.each(["/pacientes", "/pacientes/demanda", "/pacientes/fracionamento"])(
    "preserves the operational navigation on %s",
    (path) => {
      currentPath = path;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise(() => undefined)),
      );
      render(
        <QueryClientProvider client={new QueryClient()}>
          <AppShell>
            <p>Conteúdo operacional</p>
          </AppShell>
        </QueryClientProvider>,
      );
      const navigation = screen.getByRole("navigation");
      expect(within(navigation).getByRole("link", { name: "Estoque atual" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pesquisar pacientes" })).not.toBeInTheDocument();
    },
  );

  it("opens patient search only on demand and scopes results to the selected unit", async () => {
    currentPath = "/pacientes/current-patient";
    window.localStorage.setItem("allik_inventory_unit", "unit-one");
    let resolveSecond!: (response: Response) => void;
    const secondResponse = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const searchRequests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname === "/api/inventory-session")
          return Response.json({
            data: {
              user: { name: "Profissional sintético" },
              role: "CLINICIAN",
              sharedPreviewOperator: true,
              units: [
                { id: "unit-one", name: "Unidade Um" },
                { id: "unit-two", name: "Unidade Dois" },
              ],
            },
          });
        searchRequests.push(url);
        if (url.searchParams.get("unitId") === "unit-two") return secondResponse;
        return Response.json({
          data: {
            patients: [
              {
                id: "patient-one",
                fullName: "Paciente da Unidade Um",
                internalCode: "P001",
                unitName: "Unidade Um",
              },
            ],
          },
        });
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell>
          <p>Ficha</p>
        </AppShell>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Unidade atual" })).toHaveValue("unit-one"),
    );
    expect(searchRequests).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveAccessibleName(/Preview de teste com dados fictícios/);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog");
    const search = within(dialog).getByRole("textbox", { name: "Nome ou código do paciente" });
    fireEvent.change(search, { target: { value: "P" } });
    expect(searchRequests).toHaveLength(0);
    fireEvent.change(search, { target: { value: "Paciente" } });
    expect(
      await within(dialog).findByRole("link", { name: /Paciente da Unidade Um/ }),
    ).toHaveAttribute("href", "/pacientes/patient-one");
    expect(searchRequests[0]?.searchParams.get("search")).toBe("Paciente");
    expect(searchRequests[0]?.searchParams.get("unitId")).toBe("unit-one");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: "Unidade atual" }), {
      target: { value: "unit-two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar pacientes" }));
    await waitFor(() =>
      expect(searchRequests.some((url) => url.searchParams.get("unitId") === "unit-two")).toBe(
        true,
      ),
    );
    expect(screen.queryByText("Paciente da Unidade Um")).not.toBeInTheDocument();
    resolveSecond(
      Response.json({
        data: {
          patients: [
            {
              id: "patient-two",
              fullName: "Paciente da Unidade Dois",
              internalCode: "P002",
              unitName: "Unidade Dois",
            },
          ],
        },
      }),
    );
    expect(await screen.findByRole("link", { name: /Paciente da Unidade Dois/ })).toHaveAttribute(
      "href",
      "/pacientes/patient-two",
    );
    fireEvent.click(screen.getByRole("link", { name: /Paciente da Unidade Dois/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar pacientes" }));
    expect(screen.getByRole("textbox", { name: "Nome ou código do paciente" })).toHaveValue("");
  });
});

describe("Unit changes preserve unsaved work", () => {
  it.each(["/atendimentos/synthetic-appointment", "/estoque"])(
    "does not mutate the selector, storage or query scope when a draft vetoes switching on %s",
    async (path) => {
      currentPath = path;
      window.localStorage.setItem("allik_inventory_unit", "unit-one");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            data: {
              user: { name: "Profissional sintético" },
              role: "CLINICIAN",
              units: [
                { id: "unit-one", name: "Unidade Um" },
                { id: "unit-two", name: "Unidade Dois" },
              ],
            },
          }),
        ),
      );
      const client = new QueryClient();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      render(
        <QueryClientProvider client={client}>
          <AppShell>
            <p>Rascunho em edição</p>
          </AppShell>
        </QueryClientProvider>,
      );
      const selector = await screen.findByRole("combobox", { name: "Unidade atual" });
      await waitFor(() => expect(selector).toHaveValue("unit-one"));
      let dirty = true;
      const requests: string[] = [];
      const before = (event: Event) => {
        requests.push((event as CustomEvent<{ next: string }>).detail.next);
        if (dirty) event.preventDefault();
      };
      const committed = vi.fn();
      window.addEventListener("allik:before-unit-change", before);
      window.addEventListener("inventory-unit-change", committed);
      try {
        fireEvent.change(selector, { target: { value: "unit-two" } });
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Salve os rascunhos antes de trocar de unidade.",
        );
        expect(selector).toHaveValue("unit-one");
        expect(selectedUnitId()).toBe("unit-one");
        expect(requests).toEqual(["unit-two"]);
        expect(committed).not.toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();
        expect(screen.getByText("Rascunho em edição")).toBeInTheDocument();
        dirty = false;
        fireEvent.change(selector, { target: { value: "unit-two" } });
        expect(selector).toHaveValue("unit-two");
        expect(selectedUnitId()).toBe("unit-two");
        expect(committed).toHaveBeenCalledTimes(1);
        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      } finally {
        window.removeEventListener("allik:before-unit-change", before);
        window.removeEventListener("inventory-unit-change", committed);
      }
    },
  );

  it("does not reset editors when synchronizing an already selected unit", () => {
    window.localStorage.setItem("allik_inventory_unit", "unit-one");
    const before = vi.fn((event: Event) => event.preventDefault());
    const committed = vi.fn();
    window.addEventListener("allik:before-unit-change", before);
    window.addEventListener("inventory-unit-change", committed);
    try {
      expect(setSelectedUnitId("unit-one")).toBe(true);
      expect(selectedUnitId()).toBe("unit-one");
      expect(before).not.toHaveBeenCalled();
      expect(committed).not.toHaveBeenCalled();
      expect(setSelectedUnitId("unit-two")).toBe(false);
      expect(selectedUnitId()).toBe("unit-one");
      expect(committed).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("allik:before-unit-change", before);
      window.removeEventListener("inventory-unit-change", committed);
    }
  });
});
