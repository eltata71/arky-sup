/**
 * Una lista que se lee de la caché, de Firestore o del espejo local — en ese
 * orden — y que al escribirse deja los tres de acuerdo.
 *
 * Este patrón estaba escrito cinco veces dentro de `firestoreService`: para el
 * historial de chat, las acciones del agente, los encargos de la Oficina, las
 * iniciativas de negocio y los artefactos. Las cinco copias hacían lo mismo con
 * pequeñas diferencias, y las diferencias no eran decisiones: eran el orden en
 * que se escribieron. Una de ellas actualizaba la caché en el camino `offline`
 * y otra no.
 *
 * Repartir el fichero por contextos sin extraer esto habría convertido cinco
 * copias en seis, cada una en un módulo distinto y ya sin nadie que las viera
 * juntas. Así que el patrón se declara una vez y cada repositorio lo configura.
 *
 * ## Las dos reglas que encapsula
 *
 * 1. **El espejo local no es persistencia.** `writeLocalDraft` devuelve
 *    `success: false` a propósito y esta clase nunca convierte eso en un
 *    éxito. Guardar el trabajo del usuario y decirle que sólo está aquí son
 *    dos mitades que valen lo mismo.
 * 2. **La caché en memoria sólo guarda lo confirmado.** Un fallo remoto deja
 *    el valor en el espejo local, que es de dónde se lee cuando Firestore no
 *    contesta, pero no en la caché — si no, una escritura fallida se leería
 *    como buena durante los cinco minutos siguientes.
 */

import { MemoryCache } from '../../utils';
import { readLocal, writeLocalDraft } from './localDraftStore';
import { isWriteConfirmed } from './persistenceResult';
import type { PersistenceResult } from './persistenceResult';

/** Lo mínimo que esta lista necesita saber de lo que guarda. */
export interface Identified {
  id: string;
}

export class MirroredList<T extends Identified> {
  private readonly cache = new MemoryCache();

  /**
   * @param keyFor Cómo se nombra la lista de un ámbito — un proyecto, un
   *   usuario. La clave es la misma para la caché y para el espejo local, que
   *   es lo que permite que una lectura degradada devuelva lo último que se vio.
   */
  constructor(private readonly keyFor: (scope: string) => string) {}

  /** Lo que hay en memoria, si no ha caducado. */
  cached(scope: string): T[] | null {
    return this.cache.get<T[]>(this.keyFor(scope));
  }

  /** Lo último que se llegó a ver, aunque Firestore no conteste ahora. */
  fallback(scope: string): T[] {
    return readLocal<T[]>(this.keyFor(scope)) ?? [];
  }

  /** Una lectura remota que salió bien. */
  remember(scope: string, items: T[]): T[] {
    this.cache.set(this.keyFor(scope), items);
    return items;
  }

  /** Lo que se sabe del ámbito sin ir a la red: caché primero, espejo después. */
  known(scope: string): T[] {
    return this.cached(scope) ?? this.fallback(scope);
  }

  /**
   * Deja el elemento al frente de la lista y los espejos de acuerdo.
   *
   * `cap` existe para las listas que sólo crecen — el registro de acciones del
   * agente guarda 200— y no para las demás.
   */
  upsert(scope: string, item: T, result: PersistenceResult<unknown>, cap?: number): void {
    if (!isWriteConfirmed(result) && result.status !== 'offline') return;
    const rest = this.known(scope).filter((existing) => existing.id !== item.id);
    const next = cap === undefined ? [item, ...rest] : [item, ...rest].slice(0, cap);
    if (isWriteConfirmed(result)) this.cache.set(this.keyFor(scope), next);
    writeLocalDraft(this.keyFor(scope), next);
  }

  /** Quita el elemento de los dos espejos. Sin esto reaparece en cuanto se pierde la red. */
  remove(scope: string, id: string): void {
    const next = this.known(scope).filter((existing) => existing.id !== id);
    this.cache.set(this.keyFor(scope), next);
    writeLocalDraft(this.keyFor(scope), next);
  }

  /** Olvida lo que se sabe del ámbito. La siguiente lectura vuelve a la red. */
  invalidate(scope: string): void {
    this.cache.invalidate(this.keyFor(scope));
  }

  clear(): void {
    this.cache.clear();
  }
}
