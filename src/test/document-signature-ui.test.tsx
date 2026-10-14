import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSignatureActions } from "@/components/clinic/document-signature-actions";
const defaultState = {
  configured: false,
  canSign: true,
  canManageIdentity: false,
  identityReady: false,
  signerName: "Synthetic physician",
  attempt: null,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
function mount(data: Record<string, unknown>) {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: { ...defaultState, ...data } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DocumentSignatureActions documentId="document-one" />
    </QueryClientProvider>,
  );
  return writes;
}
describe("signature UI communicates actual availability", () => {
  it("never enables signing when the provider is not configured", async () => {
    mount({});
    expect(await screen.findByRole("button", { name: "Assinar digitalmente" })).toBeDisabled();
    expect(screen.getByText(/integração Lacuna ainda não configurada/)).toBeInTheDocument();
    expect(screen.queryByText("PDF assinado digitalmente")).not.toBeInTheDocument();
  });
  it("requires registered signer identity before signing", async () => {
    mount({ configured: true });
    expect(await screen.findByRole("button", { name: "Assinar digitalmente" })).toBeDisabled();
    expect(
      screen.getByText("É necessário cadastrar a identidade do signatário."),
    ).toBeInTheDocument();
  });
  it("offers signed download only when server confirms completion", async () => {
    mount({ attempt: { id: "attempt", status: "SIGNED", expiresAt: "2031-01-01" } });
    expect(await screen.findByRole("link", { name: "Baixar PDF assinado" })).toHaveAttribute(
      "href",
      expect.stringContaining("download=true"),
    );
    expect(screen.queryByRole("button", { name: "Assinar digitalmente" })).not.toBeInTheDocument();
  });
  it("consumes correlated callback once and removes sensitive callback parameters", async () => {
    window.history.replaceState(
      {},
      "",
      "/?signatureAttempt=attempt-one&signatureDocumentId=document-one&signatureSessionId=session-one&state=opaque-state&tab=documents",
    );
    const writes = mount({ configured: true, identityReady: true });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      action: "COMPLETE",
      documentId: "document-one",
      attemptId: "attempt-one",
      signatureSessionId: "session-one",
      state: "opaque-state",
    });
    expect(window.location.search).toBe("?tab=documents");
  });
  it("does not consume a callback for another document", async () => {
    window.history.replaceState(
      {},
      "",
      "/?signatureAttempt=another-attempt&signatureDocumentId=document-two&state=opaque",
    );
    const writes = mount({});
    await screen.findByRole("button", { name: "Assinar digitalmente" });
    expect(writes).toHaveLength(0);
  });
});
