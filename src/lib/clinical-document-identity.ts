/** Display identifiers do not grant access; verification always requires an authorized session. */
export function documentVerificationCode(documentId: string): string {
  return `A1-${documentId.toUpperCase()}`;
}
export function parseDocumentVerificationCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^A1-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(normalized)
    ? normalized.slice(3).toLowerCase()
    : null;
}
