/** Normalizes an email for storage/lookup — lowercased, trimmed. Callers must
 * apply this before every insert/lookup so the DB's unique index actually
 * prevents case-variant duplicates (e.g. "a@b.com" vs "A@B.com"). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
