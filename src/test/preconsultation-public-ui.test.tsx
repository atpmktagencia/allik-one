import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreconsultationPublic } from "@/components/clinic/preconsultation-public";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
});
const token = "a".repeat(43);
function mount() {
  const requests: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      requests.push(init);
      expect(window.location.hash).toBe("");
      expect(window.location.search).toBe("?source=clinic");
      return Response.json({
        data:
          requests.length === 1
            ? {
                title: "Questionário sintético",
                description: "Responda se desejar",
                expiresAt: "2030-01-01",
                questions: [
                  { id: "constructor", label: "Qual seu objetivo?", type: "TEXT" },
                  {
                    id: "medicine",
                    label: "Usa medicamentos?",
                    type: "CHOICE",
                    options: ["Sim", "Não"],
                  },
                ],
              }
            : { submitted: true },
      });
    }),
  );
  render(<PreconsultationPublic />);
  return requests;
}
describe("Public preconsultation bearer credential", () => {
  it("clears URL before requesting and submits voluntary answers without requiring application identity", async () => {
    window.history.replaceState(
      {},
      "",
      `/preconsulta?token=legacy-secret&source=clinic#token=${token}`,
    );
    const requests = mount();
    await screen.findByRole("heading", { name: "Questionário sintético" });
    expect(JSON.parse(String(requests[0]!.body))).toEqual({ action: "READ", token });
    expect(requests[0]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(screen.getByLabelText(/Qual seu objetivo/)).toHaveValue("");
    fireEvent.change(screen.getByLabelText(/Qual seu objetivo/), {
      target: { value: "Meu relato, sem alteração." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Enviar respostas$/ }));
    await screen.findByRole("heading", { name: /^Respostas enviadas$/ });
    expect(JSON.parse(String(requests[1]!.body))).toEqual({
      action: "SUBMIT",
      token,
      answers: { constructor: "Meu relato, sem alteração." },
    });
    expect(requests[1]).toMatchObject({
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
    });
    expect(screen.queryByText("Meu relato, sem alteração.")).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
  it("does not fetch without a fragment credential and removes legacy query credentials", async () => {
    window.history.replaceState({}, "", "/preconsulta?token=legacy-secret&source=clinic");
    const requests = mount();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Abra o link completo"),
    );
    expect(requests).toHaveLength(0);
    expect(window.location.search).toBe("?source=clinic");
  });
  it("loads a new fragment on the mounted page, clearing the URL and previous answers", async () => {
    const second = "b".repeat(43),
      third = "c".repeat(43);
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        expect(window.location.hash).toBe("");
        const body = JSON.parse(String(init.body));
        requests.push(body);
        return Response.json({
          data:
            body.action === "SUBMIT"
              ? { submitted: true }
              : {
                  title:
                    body.token === token
                      ? "Primeiro"
                      : body.token === second
                        ? "Segundo"
                        : "Terceiro",
                  description: "",
                  expiresAt: "2030-01-01",
                  questions: [{ id: "shared", label: "Seu relato", type: "TEXT" }],
                },
        });
      }),
    );
    window.history.replaceState({}, "", `/preconsulta#token=${token}`);
    render(<PreconsultationPublic />);
    await screen.findByRole("heading", { name: /^Primeiro$/ });
    fireEvent.change(screen.getByLabelText(/Seu relato/), {
      target: { value: "Resposta anterior" },
    });
    act(() => {
      window.history.replaceState({}, "", `/preconsulta#token=${second}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(window.location.hash).toBe("");
    await screen.findByRole("heading", { name: /^Segundo$/ });
    expect(screen.getByLabelText(/Seu relato/)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /^Enviar respostas$/ }));
    await screen.findByRole("heading", { name: /^Respostas enviadas$/ });
    expect(requests.at(-1)).toEqual({ action: "SUBMIT", token: second, answers: {} });
    act(() => {
      window.history.replaceState({}, "", `/preconsulta#token=${third}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(window.location.hash).toBe("");
    await screen.findByRole("heading", { name: /^Terceiro$/ });
    expect(screen.queryByRole("heading", { name: /^Respostas enviadas$/ })).not.toBeInTheDocument();
  });
  it("ignores an older questionnaire response after navigation to another token", async () => {
    let resolveOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const questionnaire = (title: string) =>
      Response.json({
        data: {
          title,
          description: "",
          expiresAt: "2030-01-01",
          questions: [{ id: "goal", label: "Seu objetivo", type: "TEXT" }],
        },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        expect(window.location.hash).toBe("");
        return JSON.parse(String(init.body)).token === token ? oldResponse : questionnaire("Atual");
      }),
    );
    window.history.replaceState({}, "", `/preconsulta#token=${token}`);
    render(<PreconsultationPublic />);
    act(() => {
      window.history.replaceState({}, "", `/preconsulta#token=${"b".repeat(43)}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByRole("heading", { name: /^Atual$/ });
    await act(async () => {
      resolveOld(questionnaire("Antigo"));
      await oldResponse;
    });
    expect(screen.getByRole("heading", { name: /^Atual$/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Antigo$/ })).not.toBeInTheDocument();
  });
  it("retains the in-memory credential when StrictMode replays the mount effect", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        expect(window.location.hash).toBe("");
        requests.push(JSON.parse(String(init.body)));
        return Response.json({
          data: {
            title: "Modo estrito",
            description: "",
            expiresAt: "2030-01-01",
            questions: [{ id: "goal", label: "Seu objetivo", type: "TEXT" }],
          },
        });
      }),
    );
    window.history.replaceState({}, "", `/preconsulta#token=${token}`);
    render(
      <StrictMode>
        <PreconsultationPublic />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: /^Modo estrito$/ });
    expect(requests.length).toBeGreaterThan(0);
    expect(
      requests.every((request) => request["action"] === "READ" && request["token"] === token),
    ).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

it("keeps optional answers in memory across steps and reviews without submitting early", async () => {
  window.history.replaceState({}, "", `/preconsulta#token=${token}`);
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return Response.json({
        data:
          body.action === "READ"
            ? {
                title: "Questionário por etapas",
                description: "Respostas opcionais",
                expiresAt: "2030-01-01",
                questions: Array.from({ length: 7 }, (_, index) => ({
                  id: `q${index}`,
                  label: `Pergunta ${index + 1}`,
                  type: "TEXT",
                })),
              }
            : { submitted: true },
      });
    }),
  );
  render(<PreconsultationPublic />);
  await screen.findByRole("heading", { name: "Questionário por etapas" });
  expect(screen.queryByLabelText(/Pergunta 6/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Pergunta 1 /), {
    target: { value: "Relato voluntário" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Próxima etapa" }));
  expect(requests).toHaveLength(1);
  fireEvent.change(screen.getByLabelText(/Pergunta 7 /), { target: { value: "Outro relato" } });
  fireEvent.click(screen.getByRole("button", { name: "Etapa anterior" }));
  expect(screen.getByLabelText(/Pergunta 1 /)).toHaveValue("Relato voluntário");
  fireEvent.click(screen.getByRole("button", { name: "Próxima etapa" }));
  expect(screen.getByLabelText(/Pergunta 7 /)).toHaveValue("Outro relato");
  fireEvent.click(screen.getByRole("button", { name: "Revisar respostas" }));
  expect(screen.getByText("Relato voluntário")).toBeVisible();
  expect(screen.getAllByText("Não respondida")).toHaveLength(5);
  expect(requests).toHaveLength(1);
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Enviar respostas" }));
  await screen.findByRole("heading", { name: "Respostas enviadas" });
  expect(requests[1]).toEqual({
    action: "SUBMIT",
    token,
    answers: { q0: "Relato voluntário", q6: "Outro relato" },
  });
});

it("shows conditional branches, clears descendant answers and submits only visible answers", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return Response.json({
        data:
          body.action === "READ"
            ? {
                title: "Condicional",
                description: "",
                expiresAt: "2030-01-01",
                questions: [
                  {
                    id: "meds",
                    label: "Usa medicamentos?",
                    type: "CHOICE",
                    options: ["Sim", "Não"],
                  },
                  {
                    id: "daily",
                    label: "Uso diário?",
                    type: "CHOICE",
                    options: ["Sim", "Não"],
                    visibleWhen: { questionId: "meds", equals: "Sim" },
                  },
                  {
                    id: "names",
                    label: "Quais medicamentos?",
                    type: "TEXT",
                    visibleWhen: { questionId: "daily", equals: "Sim" },
                  },
                ],
              }
            : { submitted: true },
      });
    }),
  );
  window.history.replaceState({}, "", `/preconsulta#token=${token}`);
  render(<PreconsultationPublic />);
  await screen.findByRole("heading", { name: "Condicional" });
  expect(screen.queryByLabelText(/Uso diário/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Usa medicamentos/), { target: { value: "Sim" } });
  fireEvent.change(screen.getByLabelText(/Uso diário/), { target: { value: "Sim" } });
  fireEvent.change(screen.getByLabelText(/Quais medicamentos/), {
    target: { value: "Relato a descartar" },
  });
  fireEvent.change(screen.getByLabelText(/Usa medicamentos/), { target: { value: "Não" } });
  expect(screen.queryByLabelText(/Uso diário/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Quais medicamentos/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Usa medicamentos/), { target: { value: "Sim" } });
  expect(screen.getByLabelText(/Uso diário/)).toHaveValue("");
  expect(screen.queryByLabelText(/Quais medicamentos/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Usa medicamentos/), { target: { value: "Não" } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar respostas" }));
  expect(screen.queryByText("Uso diário?")).not.toBeInTheDocument();
  expect(screen.queryByText("Relato a descartar")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Enviar respostas" }));
  await screen.findByRole("heading", { name: "Respostas enviadas" });
  expect(requests.at(-1)).toEqual({ action: "SUBMIT", token, answers: { meds: "Não" } });
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
});

it("paginates the visible branch rather than hidden questions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          title: "Etapas condicionais",
          description: "",
          expiresAt: "2030-01-01",
          questions: [
            { id: "gate", label: "Mostrar detalhes?", type: "CHOICE", options: ["Sim", "Não"] },
            ...Array.from({ length: 6 }, (_, i) => ({
              id: `detail${i}`,
              label: `Detalhe ${i}`,
              type: "TEXT",
              visibleWhen: { questionId: "gate", equals: "Sim" },
            })),
          ],
        },
      }),
    ),
  );
  window.history.replaceState({}, "", `/preconsulta#token=${token}`);
  render(<PreconsultationPublic />);
  await screen.findByRole("heading", { name: "Etapas condicionais" });
  expect(screen.getByText(/Etapa 1 de 1/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Mostrar detalhes/), { target: { value: "Sim" } });
  expect(screen.getByText(/Etapa 1 de 2/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Detalhe 4/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Próxima etapa" }));
  expect(screen.getByLabelText(/Detalhe 4/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Etapa anterior" }));
  fireEvent.change(screen.getByLabelText(/Mostrar detalhes/), { target: { value: "Não" } });
  expect(screen.getByText(/Etapa 1 de 1/)).toBeInTheDocument();
});
