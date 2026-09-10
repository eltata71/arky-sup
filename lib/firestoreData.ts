/**
 * Removes values that Firestore rejects before writes reach the SDK.
 *
 * Firestore does not accept `undefined` in documents, nested maps, or arrays.
 * Object fields with `undefined` are omitted; array slots become `null` so
 * positional data is not shifted unexpectedly.
 */
export function sanitizeForFirestore<T>(value: T): T {
  return pruneUndefined(value) as T;
}

function pruneUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const sanitized = pruneUndefined(item);
      return sanitized === undefined ? null : sanitized;
    });
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  const sanitizedEntries = Object.entries(value as Record<string, unknown>)
    .map(([key, entryValue]) => [key, pruneUndefined(entryValue)] as const)
    .filter(([, entryValue]) => entryValue !== undefined);

  return Object.fromEntries(sanitizedEntries);
}
