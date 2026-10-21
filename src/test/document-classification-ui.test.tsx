import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentClassification } from "../components/clinic/document-classification";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(action = "SUGGESTED", status = "SUPPORTED") {
  const events = [
    {
      id,
      revision: 3,
      action,
      actor_kind: "SYSTEM",
      created_at: "2026-10-21T10:00:00Z",
      attempt_id: id,
      payload: {
        schemaVersion: 1,
        evidenceStatus: status,
        result: {
          categories: [
            { category: "EXAM_REQUEST", evidence: [{ page: 1, quote: "Solicito hemograma" }] },
            { category: "IMAGE_REPORT", evidence: [{ page: 2, quote: "Laudo sintético" }] },
          ],
          abstention: "NONE",
        },
      },
    },
  ];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json({ data: options?.method === "POST" ? { event: events[0] } : { events } }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", { randomUUID: () => id });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <DocumentClassification patientId={id} documentId={id} unitId={id} onChanged={() => {}} />
    </QueryClientProvider>,
  );
  return fetcher;
}
describe("F2 compact classification interface", () => {
  it("shows mixed category evidence and requires explicit human confirmation", async () => {
    const fetcher = mount();
    const button = await screen.findByRole("button", { name: "Aceitar sugestão" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Pág. 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Conferi o original/ }));
    fireEvent.click(button);
    await waitFor(() => expect(fetcher.mock.calls.some((c) => c[1]?.method === "POST")).toBe(true));
    const call = fetcher.mock.calls.find((c) => c[1]?.method === "POST")!;
    const body = JSON.parse(String(call[1]!.body));
    expect(body.command.action).toBe("CONFIRMED");
    expect(body.command.payload.resultEventId).toBe(id);
    expect(body.command.payload.originalReviewed).toBe(true);
  });
  it("does not offer AI confirmation for mismatched identity", async () => {
    mount("NEEDS_REVIEW", "IDENTITY_MISMATCH");
    expect(await screen.findByText(/Identificação divergente/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar sugestão" })).not.toBeInTheDocument();
  });
  it("GET/render does not initiate paid processing", async () => {
    const fetcher = mount();
    await screen.findByText("Categoria sugerida");
    expect(fetcher.mock.calls.every((c) => !c[1]?.method)).toBe(true);
  });
});
