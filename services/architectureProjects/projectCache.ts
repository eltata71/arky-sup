/**
 * La caché de proyectos, con un solo dueño.
 *
 * Está en su propio fichero porque la comparten las lecturas y las escrituras
 * de este contexto, y porque `services/artifacts` necesita invalidarla: el
 * documento del proyecto lleva `artifactCount` y `lastArtifactUpdatedAt`, así
 * que escribir un artefacto deja obsoleto al proyecto cacheado.
 *
 * `forgetProject` es toda la superficie que otro módulo ve. Exponer el `Map`
 * sería tener dos módulos escribiendo en la misma estructura, que es de donde
 * venimos: en `firestoreService` había una sola caché para siete contextos y
 * borrar un proyecto invalidaba a mano la clave del chat.
 */

import { MemoryCache } from '../../utils';

export const projectCache = new MemoryCache();

/** Olvida un proyecto y las listas que lo contienen. */
export const forgetProject = (projectId: string): void => {
    projectCache.invalidate(`project_${projectId}`);
    projectCache.invalidatePrefix('projects_');
};

/** Olvida todo. Lo usa el cierre de sesión y las pruebas entre casos. */
export const clearProjectCache = (): void => projectCache.clear();
