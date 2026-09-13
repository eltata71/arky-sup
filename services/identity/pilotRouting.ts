const normalized = (value: string): string => value.trim().toLowerCase();

/** Parses the explicit, browser-visible pilot allowlist deterministically. */
export function parseSupabasePilotEmails(value: string | undefined): readonly string[] {
  return [...new Set((value ?? '')
    .split(',')
    .map(normalized)
    .filter((email) => email !== ''))];
}

/** The cohort is opt-in: absent or unmatched addresses retain Firebase. */
export function isSupabasePilotEmail(
  email: string | null | undefined,
  cohort: readonly string[],
): boolean {
  return typeof email === 'string' && cohort.includes(normalized(email));
}
