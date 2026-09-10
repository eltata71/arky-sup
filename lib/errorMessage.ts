/**
 * Reading a message out of something that was thrown.
 *
 * `catch (error)` gives `unknown` — `useUnknownInCatchVariables` has been on
 * for a while — and the shortcut around that was `catch (error: any)` followed
 * by `error?.message`. It reads harmlessly and is wrong twice: a thrown string
 * has no `.message`, and an object with a `message` property that is not a
 * string puts `[object Object]` in front of the user.
 *
 * Pure and dependency-free so a component can use it without pulling in the
 * observability service, which is what made the `any` shortcut attractive.
 * `readUnknownError` delegates here rather than keeping a second copy: two
 * implementations of "what does this error say" drift, and the one used in the
 * UI is the one people read.
 */

/** The most useful human-readable message a thrown value carries. */
export function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message || error.name;
    return message || fallback;
  }

  if (typeof error === 'string') {
    return error.trim() || fallback;
  }

  // A rejected fetch or a serialised remote failure often arrives as a plain
  // object with a `message`; anything else has nothing worth showing.
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }

  return fallback;
}

/** The stack, when there is one. Diagnostics only — never shown to a user. */
export function errorDetailOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
