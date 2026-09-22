/**
 * La única forma de construir un Artefacto y sus versiones.
 *
 * Estaba dentro de `context/app/useArtifactsState.ts`, en dos `useCallback`s
 * que además hacían el `setState` optimista y disparaban la escritura. Las tres
 * cosas mezcladas significaban que la regla de versionado —la que decide qué
 * número lleva la siguiente versión y qué comparte con las anteriores— sólo se
 * podía comprobar renderizando un proveedor de React.
 *
 * ## Las dos invariantes que sostiene
 *
 * 1. **La primera versión es su propio grupo.** `versionGroupId === id` en la
 *    v1 no es una casualidad de implementación: es lo que permite pedir «todas
 *    las versiones de este artefacto» sin una tabla aparte, y lo que hace que
 *    restaurar una versión antigua cree una v(n+1) del mismo grupo en vez de un
 *    artefacto nuevo sin historia.
 * 2. **El número de versión sale de las versiones que ya hay**, no de un
 *    contador que alguien lleve por su cuenta. Se calcula sobre el grupo, así
 *    que dos ramas del producto no pueden producir dos «v3» distintas.
 *
 * `attachCompilerSummary` viaja con la construcción a propósito: un artefacto
 * sin su resumen de compilación es un artefacto que la pantalla no sabe puntuar,
 * y dejarlo fuera obligaba a cada llamador a acordarse. Es de sólo observación
 * y no lanza, así que no cambia el comportamiento de persistencia ni el
 * retroceso optimista.
 */

import type { Artifact } from '../../types';
import { newArtifactId } from '../../lib/ids';
import { attachCompilerSummary, recompileArtifactBeforePersist } from '../artifactCompiler';

/** Lo que el llamador aporta: todo menos la identidad y el versionado. */
export type NewArtifactDraft = Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>;

export interface ArtifactFactoryOptions {
  /** Costura para pruebas y para quien asigne su propio id. */
  readonly id?: string;
  /** Costura para pruebas. Por defecto, ahora. */
  readonly now?: () => string;
}

/**
 * La primera versión de un artefacto nuevo.
 *
 * `id` y `versionGroupId` son el mismo valor: el grupo lo abre su primera
 * versión, y por eso restaurar una v1 antigua no crea una historia paralela.
 */
export function createArtifact(
  draft: NewArtifactDraft,
  options: ArtifactFactoryOptions = {},
): Artifact {
  const sharedId = options.id ?? newArtifactId();
  const now = options.now ?? (() => new Date().toISOString());
  return attachCompilerSummary({
    ...draft,
    id: sharedId,
    versionGroupId: sharedId,
    version: 1,
    createdAt: now(),
  });
}

/**
 * La siguiente versión de un artefacto que ya existe.
 *
 * `siblings` son los artefactos del proyecto; la función se queda con los del
 * grupo y numera sobre el máximo. Recibe la lista entera en vez del número
 * porque calcularlo fuera es justo la parte que se puede equivocar, y era lo
 * que hacía el hook.
 */
export function createArtifactVersion(
  versionGroupId: string,
  draft: NewArtifactDraft,
  siblings: readonly Artifact[],
  options: ArtifactFactoryOptions = {},
): Artifact {
  const now = options.now ?? (() => new Date().toISOString());
  const versions = siblings.filter((item) => item.versionGroupId === versionGroupId);
  const latest = versions.length > 0 ? Math.max(...versions.map((item) => item.version)) : 0;
  return attachCompilerSummary({
    ...draft,
    id: options.id ?? newArtifactId(),
    versionGroupId,
    version: latest + 1,
    createdAt: now(),
  });
}

/**
 * Una versión nueva a partir de una que ya existe, cuyo contenido puede haber
 * cambiado.
 *
 * Es distinta de `createArtifactVersion` en una cosa que importa: **recompila**
 * en vez de anexar el resumen anterior. Restaurar una versión, guardar una
 * edición manual y aplicar una sugerencia de consistencia son todos el mismo
 * movimiento —clonar un artefacto y cambiarle el contenido— y en los tres la
 * compilación heredada sería la del contenido viejo. Un artefacto que dice
 * estar compilado y puntuado sobre un texto que ya no tiene es peor que uno sin
 * puntuar: parece verificado.
 *
 * `latestVersion` lo aporta el llamador porque en los dos sitios que la usan ya
 * tiene el grupo ordenado en la mano.
 */
export function reviseArtifact(
  source: Artifact,
  latestVersion: number,
  overrides: Partial<Artifact> = {},
  options: ArtifactFactoryOptions = {},
): Artifact {
  const now = options.now ?? (() => new Date().toISOString());
  // Una versión nueva es otro artefacto: no hereda la revisión de su origen
  // (ADR-106). Heredarla haría que la primera edición de la versión recién
  // creada comparara la revisión de otra fila.
  const { revision: _revision, ...origin } = source;
  return recompileArtifactBeforePersist({
    ...origin,
    ...overrides,
    id: options.id ?? newArtifactId(),
    version: latestVersion + 1,
    createdAt: now(),
  }, { source: 'manual' }).artifact;
}
