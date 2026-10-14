import { describe, expect, it } from "vitest";
import {
  plainTextRichContent,
  renderRichContentHtml,
  richContentSchema,
  richContentText,
} from "./clinical-document-content";

describe("clinical document rich content safety", () => {
  it("preserves supported formatting while escaping executable text", () => {
    const document = richContentSchema.parse({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            {
              type: "text",
              text: "<img src=x onerror=alert(1)>",
              marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 2 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Orientação" }] }],
            },
          ],
        },
      ],
    });
    const html = renderRichContentHtml(document);
    expect(html).toContain('style="text-align:center"');
    expect(html).toContain('<ol start="2">');
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<u>");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(richContentText(document)).toContain("Orientação");
  });

  it.each([
    { type: "doc", content: [{ type: "image", attrs: { src: "https://tracking.example/pixel" } }] },
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "left; background:url(https://tracking.example)" },
        },
      ],
    },
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    },
    { type: "doc", content: [{ type: "text", text: "invalid root child" }] },
    { type: "doc", content: [{ type: "orderedList", content: [{ type: "paragraph" }] }] },
  ])("rejects unsupported or malformed editor content", (document) => {
    expect(richContentSchema.safeParse(document).success).toBe(false);
  });

  it("preserves line breaks in legacy plain text without interpreting markup", () => {
    const text = "Primeira linha\n\n<script>legado</script>";
    const rich = plainTextRichContent(text);
    expect(richContentSchema.safeParse(rich).success).toBe(true);
    expect(richContentText(rich)).toBe(text);
    expect(renderRichContentHtml(rich)).toContain("&lt;script&gt;");
  });

  it("rejects excessive depth and oversized content before rendering", () => {
    let nested: Record<string, unknown> = { type: "paragraph" };
    for (let i = 0; i < 60; i++) nested = { type: "listItem", content: [nested] };
    expect(richContentSchema.safeParse({ type: "doc", content: [nested] }).success).toBe(false);
    expect(richContentSchema.safeParse(plainTextRichContent("x".repeat(30001))).success).toBe(
      false,
    );
  });
});
