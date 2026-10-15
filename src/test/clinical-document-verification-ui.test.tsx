import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClinicalDocumentVerification } from "@/components/clinic/clinical-document-verification";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("clears stale verification on code changes and allows retry after a scoped denial", async () => {
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ++attempts === 1
        ? Response.json({ error: "Documento não encontrado." }, { status: 404 })
        : Response.json({
            data: {
              documentId: "synthetic-document",
              title: "RECEITA MÉDICA",
              patientName: "Paciente sintético",
              patientCode: "SYNTH-1",
              unitName: "Fortaleza",
              authorName: "Profissional sintético",
              professionalCouncil: "CRM",
              councilNumber: "123",
              councilRegion: "CE",
              finalizedAt: "2026-10-15T12:00:00Z",
              contentSha256: "f".repeat(64),
              amendments: [{ kind: "RECTIFICATION", documentId: "rectification" }],
              notice: "Verificação interna. Não comprova assinatura digital.",
            },
          }),
    ),
  );
  render(<ClinicalDocumentVerification initialCode="A1-TEST" />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir documento" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Documento não encontrado.");
  expect(screen.queryByText("Paciente sintético")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Conferir documento" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Integridade do registro confirmada");
  expect(screen.getByRole("status")).toHaveTextContent("há adendo ou retificação");
  fireEvent.change(screen.getByLabelText("Código de verificação"), {
    target: { value: "another-code" },
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
