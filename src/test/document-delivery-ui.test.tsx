import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DocumentDelivery } from "@/components/clinic/document-delivery";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("requires recipient and unsigned-file confirmation and prevents a second accepted send", async () => {
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(JSON.parse(String(init.body)));
        return Response.json({ data: { status: "ACCEPTED" } });
      }
      return Response.json({
        data: {
          email: "patient@example.test",
          phone: "5585999999999",
          emailAvailable: true,
          signed: false,
          hasAmendments: false,
        },
      });
    }),
  );
  render(<DocumentDelivery documentId="synthetic-document" />);
  const button = await screen.findByRole("button", { name: "Enviar receita por e-mail" });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Conferi que este é o contato do paciente."));
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Estou ciente de que o PDF/));
  fireEvent.click(button);
  expect(await screen.findByText("E-mail aceito para envio pelo serviço.")).toBeInTheDocument();
  expect(button).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    documentId: "synthetic-document",
    action: "SEND_EMAIL",
    confirmedRecipient: "patient@example.test",
    allowUnsigned: true,
  });
});
it("keeps WhatsApp preparation distinct from actual delivery", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response("%PDF-synthetic", { headers: { "Content-Type": "application/pdf" } })
        : Response.json({
            data: {
              email: "patient@example.test",
              phone: "5585999999999",
              emailAvailable: true,
              signed: true,
              hasAmendments: false,
            },
          }),
    ),
  );
  render(<DocumentDelivery documentId="synthetic-document" />);
  fireEvent.change(await screen.findByLabelText("Canal de envio"), {
    target: { value: "PREPARE_WHATSAPP" },
  });
  fireEvent.click(screen.getByLabelText("Conferi que este é o contato do paciente."));
  fireEvent.click(screen.getByRole("button", { name: "Preparar PDF para WhatsApp" }));
  expect(await screen.findByRole("button", { name: "Baixar PDF" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Abrir WhatsApp" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "A preparação não confirma envio ao paciente",
  );
});
