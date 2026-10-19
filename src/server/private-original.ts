import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { PATIENT_DOCUMENT_MAX_BYTES } from "../data/patient-document-upload";

export class OriginalIntegrityError extends Error {}

/** Never disclose bytes before the persisted identity and bounded length are verified. */
export async function verifiedOriginal(
  stream: ReadableStream<Uint8Array>,
  expectedSize: number,
  expectedSha: string | null,
  maxBytes = PATIENT_DOCUMENT_MAX_BYTES,
) {
  if (expectedSize < 1 || expectedSize > maxBytes) {
    await stream.cancel().catch(() => {});
    throw new OriginalIntegrityError("ORIGINAL_SIZE_INVALID");
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes || size > expectedSize) {
        await reader.cancel();
        throw new OriginalIntegrityError("ORIGINAL_SIZE_INVALID");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (
    size !== expectedSize ||
    (expectedSha !== null && createHash("sha256").update(bytes).digest("hex") !== expectedSha)
  )
    throw new OriginalIntegrityError("ORIGINAL_INTEGRITY_INVALID");
  return bytes;
}
