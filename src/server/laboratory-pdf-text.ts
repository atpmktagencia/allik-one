import "@tanstack/react-start/server-only";
import { getDocumentProxy } from "unpdf";
import type { LaboratorySourcePage } from "../lib/laboratory-evidence";

export const LABORATORY_PDF_TEXT_LIMITS = {
  bytes: 4 * 1024 * 1024,
  pages: 100,
  characters: 200_000,
  milliseconds: 8_000,
} as const;

export type LaboratoryPdfText =
  | { status: "available"; pages: LaboratorySourcePage[]; totalPages: number }
  | {
      status: "unavailable";
      reason: "INVALID_PDF" | "FILE_LIMIT" | "PAGE_LIMIT" | "TEXT_LIMIT" | "NO_TEXT" | "TIMEOUT";
    };

/** Independent literal text only: no OCR, AI, interpretation or remote resources.
 * The deadline is cooperative: PDF.js serverless parsing shares the event loop.
 * No partial text is returned on failure; evidence checking must fail closed.
 */
export async function extractLaboratoryPdfText(bytes: Uint8Array): Promise<LaboratoryPdfText> {
  const limits = LABORATORY_PDF_TEXT_LIMITS;
  if (bytes.byteLength > limits.bytes) return { status: "unavailable", reason: "FILE_LIMIT" };
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-")
    return { status: "unavailable", reason: "INVALID_PDF" };

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    void pdf?.loadingTask.destroy().catch(() => undefined);
  };
  const deadline = new Promise<LaboratoryPdfText>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      stop();
      resolve({ status: "unavailable", reason: "TIMEOUT" });
    }, limits.milliseconds);
  });
  const parse = async (): Promise<LaboratoryPdfText> => {
    try {
      // Copy because PDF.js may transfer/detach its input. Never detach the original
      // file that is also used for hashing or a provider request.
      pdf = await getDocumentProxy(new Uint8Array(bytes), {
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        standardFontDataUrl: undefined,
        cMapUrl: undefined,
        maxImageSize: 1_000_000,
        verbosity: 0,
      });
      if (expired) return { status: "unavailable", reason: "TIMEOUT" };
      if (pdf.numPages > limits.pages) return { status: "unavailable", reason: "PAGE_LIMIT" };
      const pages: LaboratorySourcePage[] = [];
      let characters = 0;
      // Sequential pages bound fan-out and retain page provenance.
      for (let number = 1; number <= pdf.numPages; number++) {
        if (expired) return { status: "unavailable", reason: "TIMEOUT" };
        const page = await pdf.getPage(number);
        try {
          const content = await page.getTextContent();
          let text = "";
          for (const item of content.items) {
            if (!("str" in item)) continue;
            const part = item.str + (item.hasEOL ? "\n" : " ");
            characters += part.length;
            if (characters > limits.characters)
              return { status: "unavailable", reason: "TEXT_LIMIT" };
            text += part;
          }
          pages.push({ page: number, text: text.trim() });
        } finally {
          page.cleanup();
        }
      }
      return pages.some((page) => page.text.trim())
        ? { status: "available", pages, totalPages: pdf.numPages }
        : { status: "unavailable", reason: "NO_TEXT" };
    } catch {
      return { status: "unavailable", reason: expired ? "TIMEOUT" : "INVALID_PDF" };
    } finally {
      stop();
    }
  };
  try {
    return await Promise.race([parse(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
