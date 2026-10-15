import { z } from "zod";

export const documentTypes = [
  "PRESCRIPTION",
  "EXAM_REQUEST",
  "MEDICAL_CERTIFICATE",
  "REFERRAL",
  "MEDICAL_REPORT",
  "MEDICAL_OPINION",
  "INSTRUCTIONS",
] as const;
export type DocumentType = (typeof documentTypes)[number];
export const documentTitles: Record<DocumentType, string> = {
  PRESCRIPTION: "RECEITA MÉDICA",
  EXAM_REQUEST: "SOLICITAÇÃO DE EXAMES",
  MEDICAL_CERTIFICATE: "ATESTADO MÉDICO",
  REFERRAL: "ENCAMINHAMENTO",
  MEDICAL_REPORT: "RELATÓRIO MÉDICO",
  MEDICAL_OPINION: "LAUDO MÉDICO",
  INSTRUCTIONS: "ORIENTAÇÕES",
};
export type RichContentNode = {
  type: string;
  text?: string | undefined;
  content?: RichContentNode[] | undefined;
  attrs?:
    | {
        textAlign?: "left" | "center" | "right" | "justify" | null | undefined;
        level?: number | undefined;
        start?: number | undefined;
      }
    | undefined;
  marks?: { type: "bold" | "italic" | "underline" }[] | undefined;
};
const nodeSchema: z.ZodType<RichContentNode> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "doc",
        "paragraph",
        "heading",
        "text",
        "bulletList",
        "orderedList",
        "listItem",
        "hardBreak",
      ]),
      text: z.string().max(30000).optional(),
      content: z.array(nodeSchema).max(2000).optional(),
      attrs: z
        .object({
          textAlign: z.enum(["left", "center", "right", "justify"]).nullable().optional(),
          level: z.number().int().min(1).max(6).optional(),
          start: z.number().int().min(1).max(100000).optional(),
          // Tiptap emits this default attribute; only null is accepted and it is not persisted.
          type: z.null().optional(),
        })
        .strict()
        .optional(),
      marks: z
        .array(z.object({ type: z.enum(["bold", "italic", "underline"]) }).strict())
        .max(3)
        .optional(),
    })
    .strict()
    .superRefine((node, ctx) => {
      if (node.attrs?.type !== undefined && node.type !== "orderedList") {
        ctx.addIssue({ code: "custom", message: "Atributo de lista inválido." });
      }
    })
    .transform((node) => {
      if (node.attrs && "type" in node.attrs) {
        const { type: _listType, ...attrs } = node.attrs;
        return { ...node, attrs };
      }
      return node;
    }),
);
function validTree(node: RichContentNode, depth = 0): boolean {
  if (depth > 20) return false;
  const children = node.content ?? [];
  if (node.type === "text") return typeof node.text === "string" && !node.content && !node.attrs;
  if (node.text !== undefined || node.marks !== undefined) return false;
  if (node.type === "hardBreak") return !node.content && !node.attrs;
  if (node.type === "doc") {
    if (
      depth !== 0 ||
      node.attrs ||
      children.some((n) => !["paragraph", "heading", "bulletList", "orderedList"].includes(n.type))
    )
      return false;
  } else if (["paragraph", "heading"].includes(node.type)) {
    if (
      children.some((n) => !["text", "hardBreak"].includes(n.type)) ||
      node.attrs?.start !== undefined
    )
      return false;
    if (node.type === "paragraph" && node.attrs?.level !== undefined) return false;
  } else if (["bulletList", "orderedList"].includes(node.type)) {
    if (
      !children.length ||
      children.some((n) => n.type !== "listItem") ||
      node.attrs?.textAlign !== undefined ||
      node.attrs?.level !== undefined ||
      (node.type === "bulletList" && node.attrs)
    )
      return false;
  } else if (node.type === "listItem") {
    if (
      node.attrs ||
      !children.length ||
      children[0]?.type !== "paragraph" ||
      children.some((n) => !["paragraph", "bulletList", "orderedList"].includes(n.type))
    )
      return false;
  }
  return children.every((child) => validTree(child, depth + 1));
}
export const richContentSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Conteúdo inválido." });
      return;
    }
    if (!serialized || serialized.length > 200000) {
      ctx.addIssue({ code: "custom", message: "Documento muito extenso." });
      return;
    }
    // Bound nesting before recursive parsing, avoiding stack exhaustion on hostile JSON.
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (const char of serialized) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{" || char === "[") {
        if (++depth > 50) {
          ctx.addIssue({ code: "custom", message: "Estrutura inválida." });
          return;
        }
      } else if (char === "}" || char === "]") depth--;
    }
    const parsed = nodeSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.type !== "doc" ||
      !validTree(parsed.data) ||
      richContentText(parsed.data).length > 30000
    )
      ctx.addIssue({ code: "custom", message: "Formatação inválida." });
  })
  .transform((value) => nodeSchema.parse(value));
export function richContentText(node: RichContentNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const separator = ["paragraph", "heading"].includes(node.type) ? "" : "\n";
  return (node.content ?? []).map(richContentText).join(separator);
}
export function plainTextRichContent(content: string): RichContentNode {
  return {
    type: "doc",
    content: content
      .split("\n")
      .map((text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })),
  };
}
export const escapeDocumentHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function renderRichContentHtml(node: RichContentNode): string {
  if (node.type === "text") {
    return (node.marks ?? []).reduce((text, mark) => {
      const tag = { bold: "strong", italic: "em", underline: "u" }[mark.type];
      return `<${tag}>${text}</${tag}>`;
    }, escapeDocumentHtml(node.text));
  }
  if (node.type === "hardBreak") return "<br>";
  const children = (node.content ?? []).map(renderRichContentHtml).join("");
  if (node.type === "doc") return children;
  const tag =
    node.type === "heading"
      ? `h${node.attrs?.level ?? 2}`
      : (
          { paragraph: "p", bulletList: "ul", orderedList: "ol", listItem: "li" } as Record<
            string,
            string
          >
        )[node.type];
  const align = node.attrs?.textAlign ? ` style="text-align:${node.attrs.textAlign}"` : "";
  const start =
    node.type === "orderedList" && node.attrs?.start ? ` start="${node.attrs.start}"` : "";
  return `<${tag}${align}${start}>${children || "<br>"}</${tag}>`;
}
