import { expect, it } from "vitest";
import {
  documentVerificationCode,
  parseDocumentVerificationCode,
} from "./clinical-document-identity";
it("normalizes a document code and rejects malformed or ambiguous identifiers", () => {
  const id = "9f49b8a1-6859-4445-bf69-32a7d2179a83";
  expect(parseDocumentVerificationCode(`  ${documentVerificationCode(id).toLowerCase()}  `)).toBe(
    id,
  );
  for (const value of [
    id,
    "A1-",
    `${documentVerificationCode(id)}?token=invalid`,
    "A1-00000000-0000-0000-0000-000000000000",
  ])
    expect(parseDocumentVerificationCode(value)).toBeNull();
});
