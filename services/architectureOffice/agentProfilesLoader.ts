/**
 * La puerta mínima para leer las fichas resueltas de un usuario (plan de
 * agentes, 16.1).
 *
 * `hooks/useLazyAgentProfiles` la carga con `import()`. Cargar con `import()` la
 * puerta `agents.ts` fijaba en el chunk de cada ruta todo lo que esa puerta
 * reexporta —la orquestación incluida— porque un import dinámico conserva las
 * exportaciones de los módulos que ya comparte con quien lo pide (*The barrel
 * against the bundle*, en CLAUDE.md). Ésta exporta una función.
 */
import { resolveAgentProfiles, type OfficeAgentProfile } from './domain/officeAgentProfile';
export type { OfficeAgentProfile } from './domain/officeAgentProfile';
import { officeAgentProfileRepository } from './infrastructure/OfficeAgentProfileRepository';

export const loadResolvedAgentProfiles = async (userId: string): Promise<OfficeAgentProfile[]> =>
  resolveAgentProfiles(await officeAgentProfileRepository.list(userId));
