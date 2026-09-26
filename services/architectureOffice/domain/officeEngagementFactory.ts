/**
 * La única forma de construir una Solicitud de Entregable.
 *
 * Hasta la Ola 3 el agregado se construía con un literal de objeto dentro de
 * `context/OfficeContext.tsx`, en un `useCallback` de unas sesenta líneas que
 * hacía, en este orden: buscar el proyecto (repositorio), planificar el
 * charter, refinarlo con IA (orquestación), montar el agregado con sus
 * invariantes (dominio), heredar las iniciativas del padre (regla de negocio),
 * escribir dos entradas de auditoría (dominio) y persistir.
 *
 * Es el mismo defecto que `CLAUDE.md` ya documenta para `addProject`, sin
 * corregir: **una invariante que vive fuera del agregado no es una invariante,
 * es una convención de una pantalla.** Y aquí costaba además que ninguna de
 * esas reglas se pudiera probar sin montar React.
 *
 * Lo que se queda en el contexto es lo que de verdad es suyo: leer el proyecto,
 * llamar al modelo y persistir. Lo que se viene aquí es el agregado.
 *
 * ## Las invariantes que esta fábrica sostiene
 *
 * 1. **Un entregable pertenece a una atención.** Sin `projectId` no hay
 *    encargo, igual que sin iniciativa no hay atención.
 * 2. **Y hereda su vínculo con la iniciativa.** El tercer nivel sirve a la
 *    misma necesidad de negocio que el segundo; que la intake pueda *estrechar*
 *    ese conjunto no significa que pueda vaciarlo. Un encargo sin iniciativa es
 *    trabajo de arquitectura del que nadie puede decir para qué era.
 *
 *    El vínculo vale **por id o por código**. Los ids son la relación canónica
 *    y mandan, pero un proyecto guardado por una versión anterior llega con
 *    sólo su espejo de códigos `NEG-YYYY-NNN`, y `portfolioResolver` lo migra
 *    de forma perezosa en cada lectura. Exigir el id aquí rechazaría registros
 *    heredados que el producto sí sabe resolver — sería convertir una
 *    migración silenciosa y correcta en un error de cara al usuario.
 * 3. **Nace con su rastro de auditoría escrito**, no con uno que haya que
 *    acordarse de añadir después. El encargo se abrió y el charter se propuso:
 *    son dos hechos del dominio, y ocurrieron aquí.
 */

import type {
  OfficeActor,
  OfficeCharter,
  OfficeEngagement,
  OfficeEngagementPriority,
} from './OfficeTypes';
import { DEFAULT_OFFICE_BUDGET, OFFICE_ENGAGEMENT_SCHEMA_VERSION } from './OfficeTypes';
import { buildTasksFromCharter } from './OfficeEngagementPlanner';
import { newEngagementId, withAuditEntry } from './officeEngagementRecord';
import { normalizeBusinessProjectIds } from './officeShared';

/** Por qué no se pudo abrir el encargo. */
export type OfficeEngagementRejection =
  | { readonly reason: 'attention-required'; readonly message: string }
  | { readonly reason: 'initiative-required'; readonly message: string }
  | { readonly reason: 'title-required'; readonly message: string };

/**
 * El veredicto.
 *
 * `outcome` en vez de un `ok` booleano, por la misma razón que en
 * `createArchitectureProject`: buena parte del árbol compila sin
 * `strictNullChecks` y un literal booleano no estrecha de forma fiable ahí.
 */
export type CreateOfficeEngagementResult =
  | { readonly outcome: 'created'; readonly engagement: OfficeEngagement }
  | { readonly outcome: 'rejected'; readonly rejection: OfficeEngagementRejection };

export interface CreateOfficeEngagementInput {
  /** La atención a la que pertenece. Obligatoria. */
  readonly projectId: string;
  readonly title: string;
  readonly brief: string;
  /**
   * Las iniciativas a las que responde. **Obligatoria y no vacía.**
   *
   * No es opcional con un `?? []` detrás: así es como se perdió la regla la
   * primera vez en `addProject`. Quien no tenga una iniciativa tiene que
   * decirlo y ser rechazado.
   */
  readonly initiativeIds: readonly string[];
  /** Los códigos `NEG-YYYY-NNN` de esas mismas iniciativas — espejo derivado. */
  readonly businessProjectIds?: readonly string[];
  /** El charter ya planificado: determinista, o refinado por el modelo. */
  readonly charter: OfficeCharter;
  readonly priority?: OfficeEngagementPriority;
  readonly dueAt?: string;
  readonly createdBy: OfficeActor;
  /** Costura para pruebas y para quien asigne su propio id. */
  readonly id?: string;
  /** Costura para pruebas. Por defecto, ahora. */
  readonly now?: () => string;
}

const clean = (values: readonly string[] | undefined): string[] =>
  [...new Set(
    (values ?? [])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )];

/**
 * Construye una Solicitud de Entregable, o se niega.
 *
 * Devuelve un resultado en vez de lanzar: que falte la iniciativa es un
 * desenlace normal que la interfaz tiene que pintar, no algo excepcional, y un
 * `throw` empujaría a cada llamador a un `try`/`catch` que la mayoría
 * escribiría vacío.
 */
export function createOfficeEngagement(
  input: CreateOfficeEngagementInput,
): CreateOfficeEngagementResult {
  const title = input.title?.trim() ?? '';
  if (!title) {
    return {
      outcome: 'rejected',
      rejection: {
        reason: 'title-required',
        message: 'Un entregable necesita un título para poder pedirlo.',
      },
    };
  }

  const projectId = input.projectId?.trim() ?? '';
  if (!projectId) {
    return {
      outcome: 'rejected',
      rejection: {
        reason: 'attention-required',
        message: 'Un entregable siempre se pide dentro de una atención. Elige una antes de continuar.',
      },
    };
  }

  const initiativeIds = clean(input.initiativeIds);
  const businessProjectIds = normalizeBusinessProjectIds([...(input.businessProjectIds ?? [])]);
  if (initiativeIds.length === 0 && businessProjectIds.length === 0) {
    return {
      outcome: 'rejected',
      rejection: {
        reason: 'initiative-required',
        message:
          'Un entregable responde a la misma iniciativa de negocio que su atención. Vincula al menos una antes de pedirlo.',
      },
    };
  }

  const now = input.now ?? (() => new Date().toISOString());
  const createdAt = now();
  const id = input.id ?? newEngagementId();

  const engagement: OfficeEngagement = {
    id,
    projectId,
    schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
    title,
    brief: input.brief ?? '',
    initiativeIds,
    businessProjectIds,
    status: 'awaiting-charter',
    priority: input.priority ?? 'medium',
    dueAt: input.dueAt,
    charter: input.charter,
    tasks: buildTasksFromCharter(id, input.charter),
    arbDecisions: [],
    budget: { ...DEFAULT_OFFICE_BUDGET },
    auditTrail: [],
    createdBy: input.createdBy,
    createdAt,
    updatedAt: createdAt,
  };

  // Los dos hechos que acaban de ocurrir, escritos aquí y no en el llamador.
  const opened = withAuditEntry(
    engagement,
    'engagement-created',
    `${input.createdBy.name} abrió el encargo "${title}".`,
    { actor: input.createdBy },
  );
  const planned = withAuditEntry(
    opened,
    'charter-proposed',
    `La Oficina propuso ${input.charter.deliverables.length} entregable(s) (`
    + `${input.charter.provenance === 'ai-refined' ? 'plan refinado con IA' : 'plan determinista'}).`,
  );

  return { outcome: 'created', engagement: planned };
}
