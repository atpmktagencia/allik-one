import { richContentSchema, richContentText } from "./clinical-document-content";

/** Empty containers do not prescribe anything. Malformed stored data fails closed. */
export function therapeuticDraftHasContent(items: unknown, generalInstructions?: string | null) {
  return !Array.isArray(items) || items.length > 0 || Boolean(generalInstructions?.trim());
}
export function documentDraftHasContent(content?: string | null, richContent?: unknown) {
  if (content?.trim()) return true;
  if (richContent == null) return false;
  const parsed = richContentSchema.safeParse(richContent);
  return !parsed.success || Boolean(richContentText(parsed.data).trim());
}
