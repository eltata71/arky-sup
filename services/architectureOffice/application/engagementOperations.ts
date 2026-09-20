/**
 * Qué se le puede pedir a un encargo, quién lo escribe y qué pasa si no se
 * escribe.
 *
 * Esto vivía dentro de `context/OfficeContext.tsx`, mezclado con el
 * `AbortController`, el `setState` y las importaciones diferidas. Era el sitio
 * equivocado por la razón de siempre —un fichero cuyo trabajo es renderizar no
 * debería decidir la política de una oficina de arquitectura— y también por una
 * concreta y comprobable: la única forma de ejercitar «qué pasa si la escritura
 * falla» era montar un proveedor de React, y por eso nadie la ejercitaba. Las
 * seis operaciones devolvían `ok: true` pasara lo que pasara.
 *
 * Aquí no hay React ni SDK. Todo entra por dos puertos:
 *
 *  - `EngagementWritePort` — cómo se escribe. Lo implementa el repositorio.
 *  - `CharterRefinementPort` — cómo se le pide al modelo que mejore un charter.
 *    Opcional: sin él queda el plan determinista, que es un plan ejecutable
 *    completo. Un modelo no disponible degrada la calidad del plan, nunca su
 *    existencia.
 *
 * `onDraft` es el tercero y es distinto: no es infraestructura sino la
 * actualización optimista. La escritura puede tardar y el trabajo ya está
 * hecho; enseñarlo antes de confirmarlo es correcto **si** después se dice la
 * verdad sobre si se confirmó. Esa segunda mitad es la que faltaba.
 */

import type { PersistenceResult, PersistenceStatus } from '../../persistence';
import {
  applyCharterRefinement,
  buildCharterRefinementPrompt,
  planCharterDeterministic,
} from '../OfficeEngagementPlanner';
import {
  approveCharter as approveCharterRule,
  attachGateAssessment,
  decideEngagement as decideEngagementRule,
} from '../OfficeArbService';
import { evaluateOfficeQualityGates } from '../officeQualityGates';
import { createOfficeEngagement } from '../officeEngagementFactory';
import type {
  OfficeActor,
  OfficeArbDecision,
  OfficeArbVerdict,
  OfficeCharter,
  OfficeEngagement,
  OfficeEngagementPriority,
} from '../OfficeTypes';

/** Un proyecto, con lo poco que estas operaciones necesitan saber de él. */
export interface EngagementProjectRef {
  readonly id: string;
  readonly initiativeIds?: string[];
  readonly linkedBusinessProjects?: string[];
}

export interface EngagementWritePort {
  save(engagement: OfficeEngagement): Promise<PersistenceResult<OfficeEngagement>>;
  remove(
    projectId: string,
    engagementId: string,
    expectedRevision: number,
  ): Promise<PersistenceResult<void>>;
  recordArbDecision(
    engagement: OfficeEngagement,
    decision: OfficeArbDecision,
  ): Promise<PersistenceResult<void>>;
}

/** Pedirle al modelo un charter mejor. Devuelve el texto crudo; puede fallar. */
export type CharterRefinementPort = (prompt: string) => Promise<string>;

export interface EngagementOperationDeps {
  readonly writes: EngagementWritePort;
  /** Se llama con el estado a mostrar antes de confirmarlo. */
  readonly onDraft?: (engagement: OfficeEngagement) => void;
}

export interface OfficeOperationResult {
  ok: boolean;
  engagement?: OfficeEngagement;
  reason?: string;
  /**
   * Cómo terminó la escritura, cuando la operación hizo alguna.
   *
   * Existe porque «no se pudo guardar» y «las reglas dijeron que no» piden
   * cosas distintas de quien lo lee: lo primero se reintenta o se recarga, lo
   * segundo no se reintenta nunca. Ausente significa que no se llegó a
   * escribir — la operación se rechazó antes.
   */
  persistence?: PersistenceStatus;
}

/**
 * Por qué una escritura no confirmada no es un éxito, dicho una sola vez.
 *
 * El mensaje nombra la acción que quien lo lee puede tomar, no el código de
 * PostgreSQL: un conflicto se recarga, un permiso no se reintenta, y sin red el
 * trabajo quedó en el espejo local.
 */
export const describePersistenceFailure = (
  result: PersistenceResult<unknown>,
  engagement: OfficeEngagement,
): OfficeOperationResult => ({
  ok: false,
  engagement,
  persistence: result.status,
  reason: result.status === 'conflict'
    ? 'Otra sesión modificó este encargo. Recarga antes de volver a intentarlo.'
    : result.status === 'permission-denied'
      ? 'Tu rol no permite guardar este cambio.'
      : result.status === 'offline'
        ? 'Sin conexión: el cambio quedó sólo en este dispositivo.'
        : result.message ?? 'No se pudo guardar el cambio.',
});

/**
 * Muestra, escribe, y se queda con lo que devolvió el servidor.
 *
 * Lo último no es detalle: lo enviado lleva el testigo de revisión anterior, y
 * la Oficina escribe en cada transición, así que quedarse con él convierte la
 * siguiente escritura en un conflicto garantizado.
 */
const persist = async (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
): Promise<PersistenceResult<OfficeEngagement>> => {
  deps.onDraft?.(engagement);
  const result = await deps.writes.save(engagement);
  if (result.success && result.data) deps.onDraft?.(result.data);
  return result;
};

const confirmed = (
  result: PersistenceResult<OfficeEngagement>,
  fallback: OfficeEngagement,
): OfficeOperationResult => (
  result.success
    ? { ok: true, engagement: result.data ?? fallback, persistence: result.status }
    : describePersistenceFailure(result, fallback)
);

/* ── Intake ──────────────────────────────────────────────────────────────── */

export interface CreateEngagementCommand {
  projectId: string;
  title: string;
  brief: string;
  initiativeIds?: string[];
  businessProjectIds?: string[];
  priority?: OfficeEngagementPriority;
  dueAt?: string;
  maxDeliverables?: number;
  /** Salta el refinamiento por IA (pruebas y modo sin conexión). */
  deterministicOnly?: boolean;
}

export const createEngagementOperation = async (
  deps: EngagementOperationDeps & { readonly refineCharter?: CharterRefinementPort },
  project: EngagementProjectRef,
  command: CreateEngagementCommand,
  actor: OfficeActor,
): Promise<OfficeOperationResult> => {
  const scaffold = planCharterDeterministic({
    title: command.title,
    brief: command.brief,
    maxDeliverables: command.maxDeliverables,
  });

  let charter: OfficeCharter = scaffold;
  if (!command.deterministicOnly && deps.refineCharter) {
    try {
      const raw = await deps.refineCharter(
        buildCharterRefinementPrompt({ title: command.title, brief: command.brief }, scaffold),
      );
      charter = applyCharterRefinement(scaffold, raw).charter;
    } catch {
      // El charter determinista es un plan completo y ejecutable.
    }
  }

  const created = createOfficeEngagement({
    projectId: command.projectId,
    title: command.title,
    brief: command.brief,
    // El entregable hereda las iniciativas de su atención salvo que la intake
    // las haya estrechado. Qué pasa si no queda ninguna lo decide la fábrica.
    initiativeIds: command.initiativeIds ?? project.initiativeIds ?? [],
    businessProjectIds: command.businessProjectIds ?? project.linkedBusinessProjects ?? [],
    charter,
    priority: command.priority,
    dueAt: command.dueAt,
    createdBy: actor,
  });
  if (created.outcome === 'rejected') {
    return { ok: false, reason: created.rejection.message };
  }

  return confirmed(await persist(deps, created.engagement), created.engagement);
};

/* ── Gobernanza ──────────────────────────────────────────────────────────── */

export const approveCharterOperation = async (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
  actor: OfficeActor,
): Promise<OfficeOperationResult> => {
  const result = approveCharterRule(engagement, actor);
  if (!result.ok) return { ok: false, reason: result.reason };
  // Una aprobación que no se guardó no es una aprobación: el paso siguiente es
  // ejecutar, y ejecutar sobre un charter que el servidor no tiene aprobado es
  // justo lo que la regla de gobierno impide.
  return confirmed(await persist(deps, result.engagement), result.engagement);
};

export const evaluateGatesOperation = async (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
  project: Parameters<typeof evaluateOfficeQualityGates>[0],
): Promise<OfficeOperationResult> => {
  const updated = attachGateAssessment(engagement, evaluateOfficeQualityGates(project));
  return confirmed(await persist(deps, updated), updated);
};

/**
 * La decisión del comité.
 *
 * Dos escrituras para una sola decisión, y el orden importa mientras sigan
 * siendo dos.
 *
 * El registro inmutable va **primero**. Era al revés, y el comentario que
 * acompañaba al código llamaba «best-effort» a la segunda escritura y sostenía
 * que un rechazo sólo significaba que la decisión «nunca fue autoritativa, que
 * es el resultado correcto». No lo era: la primera escritura ya había guardado
 * el espejo `arbDecisions` dentro del documento del encargo, así que la
 * pantalla mostraba una decisión firmada que el registro a prueba de
 * manipulación —el único que una auditoría acepta— no tenía. De los dos estados
 * intermedios posibles, ése es el peor: no pierde el dato, lo inventa.
 *
 * Con este orden el estado intermedio que queda es el honesto: la decisión
 * consta en el registro y el encargo no ha transicionado, que es un encargo
 * pendiente de aplicar una decisión existente. Se puede reintentar sin firmar
 * dos veces, porque el registro es sólo-creación.
 *
 * Sigue sin ser atómico, y no puede serlo desde el navegador: son dos RPC. La
 * transacción es `api.decide_engagement` — ADR-102, tarea F2-01. Esto es lo
 * correcto **hasta** que exista.
 */
export const decideEngagementOperation = async (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
  input: { verdict: OfficeArbVerdict; rationale: string; actor: OfficeActor },
): Promise<OfficeOperationResult> => {
  const result = decideEngagementRule(engagement, input);
  if (!result.ok) return { ok: false, reason: result.reason };

  if (result.decision) {
    const recorded = await deps.writes.recordArbDecision(result.engagement, result.decision);
    if (!recorded.success) {
      return {
        ok: false,
        engagement,
        persistence: recorded.status,
        reason: recorded.status === 'permission-denied'
          ? 'Tu rol no permite firmar decisiones del comité.'
          : 'No se pudo registrar la decisión del ARB. El encargo no ha cambiado de estado.',
      };
    }
  }

  const persisted = await persist(deps, result.engagement);
  if (!persisted.success) {
    return {
      ...describePersistenceFailure(persisted, result.engagement),
      reason: 'La decisión quedó registrada, pero el encargo no pudo transicionar. '
        + 'Vuelve a intentarlo: el registro del comité no se duplica.',
    };
  }
  return { ok: true, engagement: persisted.data ?? result.engagement, persistence: persisted.status };
};

/**
 * Borrar.
 *
 * `onRestore` existe porque el borrado optimista tiene un modo de fallo propio:
 * un encargo que sigue en la base y ha desaparecido de la pantalla es peor que
 * un borrado que falla, porque lo siguiente que hace quien lo ve es volver a
 * crearlo.
 */
export const deleteEngagementOperation = async (
  deps: EngagementOperationDeps & { readonly onRestore?: (engagement: OfficeEngagement) => void },
  engagement: OfficeEngagement,
): Promise<OfficeOperationResult> => {
  const removed = await deps.writes.remove(
    engagement.projectId,
    engagement.id,
    // La revisión del snapshot que se está viendo, no la de la última lectura.
    engagement.revision ?? 0,
  );
  if (!removed.success) {
    deps.onRestore?.(engagement);
    return describePersistenceFailure(removed, engagement);
  }
  return { ok: true, persistence: removed.status };
};
