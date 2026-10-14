import { describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
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

  it("accepts a numbered list serialized by the installed editor", () => {
    const editor = new Editor({
      extensions: [StarterKit, TextAlign.configure({ types: ["heading", "paragraph"] })],
      content: '<ol start="2"><li><p><strong>Tomar conforme prescrição</strong></p></li></ol>',
    });
    try {
      const json = editor.getJSON();
      expect(json.content?.[0]?.attrs).toMatchObject({ start: 2, type: null });
      const saved = richContentSchema.parse(json);
      expect(renderRichContentHtml(saved)).toContain('<ol start="2">');
      expect(richContentText(saved)).toBe("Tomar conforme prescrição");
      editor.commands.setContent(saved as JSONContent);
      expect(richContentSchema.parse(editor.getJSON()).content?.[0]).toEqual(saved.content?.[0]);
    } finally {
      editor.destroy();
    }
  });

  it("normalizes Tiptap numbered lists without losing their numbering or formatting", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 3, type: null },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { textAlign: null },
                  content: [{ type: "text", text: "Medicamento", marks: [{ type: "bold" }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = richContentSchema.parse(input);
    expect(parsed.content?.[0]?.attrs).toEqual({ start: 3 });
    expect(renderRichContentHtml(parsed)).toContain(
      '<ol start="3"><li><p><strong>Medicamento</strong>',
    );
    expect(input.content[0]?.attrs).toEqual({ start: 3, type: null });
    expect(richContentSchema.parse(parsed)).toEqual(parsed);
  });

  it("does not broaden the attribute allowlist for numbered lists or other nodes", () => {
    const list = {
      type: "orderedList",
      attrs: { start: 1, type: "evil" },
      content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
    };
    expect(richContentSchema.safeParse({ type: "doc", content: [list] }).success).toBe(false);
    expect(
      richContentSchema.safeParse({
        type: "doc",
        content: [{ type: "paragraph", attrs: { type: null } }],
      }).success,
    ).toBe(false);
    expect(
      richContentSchema.safeParse({
        type: "doc",
        content: [{ ...list, attrs: { start: 1, type: null, onclick: "x" } }],
      }).success,
    ).toBe(false);
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
