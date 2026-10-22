import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { PrivateDocumentPreview } from "@/components/clinic/private-document-preview";
vi.mock("@/data/unit-context", () => ({ withSelectedUnit: (url: string) => url }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("opens the evidence page without refetching the original and rejects invalid page anchors", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      blob: async () => new Blob(["synthetic PDF"], { type: "application/pdf" }),
    });
  vi.stubGlobal("fetch", fetchMock);
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic"),
    revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const document = {
    title: "Sintético.pdf",
    contentType: "application/pdf",
    previewUrl: "/api/v1/inventory/patient-document-file?sourceId=synthetic",
    initialPage: 2,
  };
  const view = render(<PrivateDocumentPreview document={document} />);
  await waitFor(() =>
    expect(screen.getByTitle("Prévia privada: Sintético.pdf")).toHaveAttribute(
      "src",
      "blob:synthetic#page=2",
    ),
  );
  view.rerender(<PrivateDocumentPreview document={{ ...document, initialPage: 3 }} />);
  expect(screen.getByTitle("Prévia privada: Sintético.pdf")).toHaveAttribute(
    "src",
    "blob:synthetic#page=3",
  );
  view.rerender(<PrivateDocumentPreview document={{ ...document, initialPage: -1 }} />);
  expect(screen.getByTitle("Prévia privada: Sintético.pdf")).toHaveAttribute(
    "src",
    "blob:synthetic",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:synthetic");
  create.mockRestore();
  revoke.mockRestore();
});
