/**
 * What happens to a write that did not reach Firestore.
 *
 * The rule is the same for every context and it is easy to get subtly wrong:
 * keep the data so the user's work is not lost, and **say** that it is only
 * here. The two halves matter equally. `trainingService` used to do the first
 * and skip the second, which is how a trainer could author a course, see it
 * saved, and have it exist only in their own browser.
 *
 * These functions used to be private methods on `FirestoreService`, so a
 * repository outside that file had no way to degrade the same way and each one
 * invented its own — or, more often, invented nothing.
 */

import { createFailureResult } from './persistenceResult';
import type { PersistenceResult } from './persistenceResult';

/** Namespaced so a draft is recognisable in a browser's storage inspector. */
const DRAFT_PREFIX = 'arky.offlineDraft.';

export const draftKey = (key: string): string => `${DRAFT_PREFIX}${key}`;

/**
 * Lee lo que dejó una sesión anterior. Ausente e ilegible son lo mismo.
 *
 * ## El defecto que esto corrige
 *
 * Hasta la Ola 2 esta función leía `localStorage.getItem(key)` mientras
 * `writeLocalDraft` escribía en `draftKey(key)` —con el prefijo
 * `arky.offlineDraft.`— y envolviendo el valor en `{ value, status, at }`.
 * Nunca coincidían. **El espejo local era de sólo escritura**: cada
 * `readLocal(...) ?? []` de la aplicación devolvía siempre la lista vacía, así
 * que la degradación que este módulo documenta —y que `CLAUDE.md` promete en
 * tres sitios— guardaba el trabajo del usuario y luego no era capaz de
 * enseñárselo. Venía así de los dos métodos privados de `firestoreService` de
 * los que este módulo se extrajo, y no lo detectó nadie porque la prueba que lo
 * cubría escribía la clave en crudo, igual que el lector.
 *
 * Ahora mira primero el borrador y sólo después la clave en crudo. Lo segundo
 * es compatibilidad hacia atrás: hay navegadores ahí fuera con valores escritos
 * por versiones anteriores bajo la clave sin prefijo.
 */
export function readLocal<T>(key: string): T | null {
  try {
    const draft = localStorage.getItem(draftKey(key));
    if (draft) {
      const parsed = JSON.parse(draft) as { value?: T } | null;
      if (parsed && typeof parsed === 'object' && 'value' in parsed) return parsed.value as T;
    }
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Keep the value locally and report it as what it is: pending, not saved.
 *
 * The returned result deliberately has `success: false`. A local draft is not
 * a successful write, and reporting it as one is the defect this module exists
 * to prevent.
 */
export function writeLocalDraft<T>(key: string, value: T): PersistenceResult<never> {
  try {
    localStorage.setItem(
      draftKey(key),
      JSON.stringify({ value, status: 'pending-sync', at: new Date().toISOString() }),
    );
    return {
      status: 'offline',
      success: false,
      operationId: `local-draft-${Date.now()}`,
      target: 'local-draft',
      message: 'Borrador local/offline pendiente de sincronizar. No es persistencia remota confirmada.',
    };
  } catch (error) {
    return createFailureResult(`localDraft(${key})`, error);
  }
}
