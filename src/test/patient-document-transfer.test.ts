import { afterEach, expect, it, vi } from "vitest";
import { DocumentTransferError, transferPatientDocument } from "@/data/patient-document-transfer";
class FakeXHR {
  static last: FakeXHR;
  upload = {
    onprogress: null as
      null | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void),
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  responseText = "";
  status = 200;
  withCredentials = false;
  timeout = 0;
  open = vi.fn();
  send = vi.fn();
  constructor() {
    FakeXHR.last = this;
  }
  abort() {
    this.onabort?.();
  }
}
afterEach(() => vi.unstubAllGlobals());
it("reports actual transfer progress and only succeeds after a valid storage acknowledgement", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const progress = vi.fn(),
    body = new FormData();
  const p = transferPatientDocument(
    "/api/v1/inventory/patient-documents",
    body,
    new AbortController().signal,
    progress,
  );
  const xhr = FakeXHR.last;
  expect(xhr.withCredentials).toBe(true);
  expect(xhr.send).toHaveBeenCalledWith(body);
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
  expect(progress).toHaveBeenCalledWith(50);
  xhr.responseText = JSON.stringify({ data: { id: "stored" } });
  xhr.onload?.();
  await expect(p).resolves.toBe("stored");
});
it("surfaces duplicates without retry, and distinguishes malformed, lost and interrupted responses", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const duplicate = transferPatientDocument(
    "/api",
    new FormData(),
    new AbortController().signal,
    vi.fn(),
  );
  FakeXHR.last.status = 409;
  FakeXHR.last.responseText = JSON.stringify({
    code: "DUPLICATE_DOCUMENT",
    duplicateId: "existing",
    error: "Duplicado",
  });
  FakeXHR.last.onload?.();
  await expect(duplicate).rejects.toMatchObject({
    duplicateId: "existing",
    code: "DUPLICATE_DOCUMENT",
  });
  const malformed = transferPatientDocument(
    "/api",
    new FormData(),
    new AbortController().signal,
    vi.fn(),
  );
  FakeXHR.last.responseText = "null";
  FakeXHR.last.onload?.();
  await expect(malformed).rejects.toBeInstanceOf(DocumentTransferError);
  const lost = transferPatientDocument(
    "/api",
    new FormData(),
    new AbortController().signal,
    vi.fn(),
  );
  FakeXHR.last.onerror?.();
  await expect(lost).rejects.toThrow("pode ter sido concluído");
  const abort = new AbortController();
  const interrupted = transferPatientDocument("/api", new FormData(), abort.signal, vi.fn());
  abort.abort();
  await expect(interrupted).rejects.toMatchObject({ name: "AbortError" });
});
