/**
 * How the inventory decides that two names are one thing. Deterministic and
 * deliberately conservative: it equates spelling variants (case, accents,
 * punctuation, spacing) and declared aliases — never similarity. A fuzzy match
 * would merge "Pagos" with "Pagos Móviles" on the strength of a score.
 */

const stripAccents = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '');

export const normalizeInventoryName = (value: unknown): string =>
  stripAccents(String(value ?? ''))
    .toLowerCase()
    .replace(/[`'"“”’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const cleanInventoryText = (value: unknown): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim();

/** Aliases cleaned, without blanks, without the canonical name, without repeats. */
export const cleanAliases = (canonicalName: string, aliases: readonly unknown[]): string[] => {
  const seen = new Set<string>([normalizeInventoryName(canonicalName)]);
  const out: string[] = [];
  for (const alias of aliases) {
    const text = cleanInventoryText(alias);
    const key = normalizeInventoryName(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

/** Every normalized key under which an item answers: its name and its aliases. */
export const nameKeysOf = (item: { readonly name: string; readonly aliases: readonly string[] }): string[] =>
  Array.from(new Set([item.name, ...item.aliases].map(normalizeInventoryName).filter(Boolean)));

/** The existing item of this kind that already answers to this name, if any. */
export const findInventoryMatch = <T extends { readonly kind: string; readonly name: string; readonly aliases: readonly string[]; readonly id: string }>(
  items: readonly T[],
  kind: string,
  names: readonly string[],
  ignoreId?: string,
): T | undefined => {
  const wanted = new Set(names.map(normalizeInventoryName).filter(Boolean));
  if (wanted.size === 0) return undefined;
  return items.find(
    (item) => item.kind === kind && item.id !== ignoreId && nameKeysOf(item).some((key) => wanted.has(key)),
  );
};
