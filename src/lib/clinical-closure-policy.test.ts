import { describe, expect, it } from "vitest";
import { documentDraftHasContent, therapeuticDraftHasContent } from "./clinical-closure-policy";
import { plainTextRichContent } from "./clinical-document-content";

describe("Clinical closure content policy", () => {
  it("does not mistake an empty therapeutic container for a prescription", () => {
    expect(therapeuticDraftHasContent([], " \n")).toBe(false);
    expect(therapeuticDraftHasContent([], "Pending patient instructions")).toBe(true);
    expect(therapeuticDraftHasContent([{ dose: "1" }], "")).toBe(true);
    expect(therapeuticDraftHasContent(null, "")).toBe(true);
  });
  it("checks rich content even when the plain text field is empty", () => {
    expect(documentDraftHasContent("", plainTextRichContent(""))).toBe(false);
    expect(documentDraftHasContent("", plainTextRichContent("Pending document"))).toBe(true);
    expect(documentDraftHasContent("Pending plain text", null)).toBe(true);
    expect(documentDraftHasContent("", { invalid: true })).toBe(true);
  });
});
