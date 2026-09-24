/**
 * Recuperación de la proyección del grafo de conocimiento (F5-05).
 *
 * H11: la reconstrucción del grafo era un temporizador en el navegador, y
 * cerrar la pestaña la perdía sin rastro. Desde F5-04 el trabajo pendiente es
 * una fila de `api.projection_outbox` escrita en la misma transacción que el
 * artefacto. Esto es la otra mitad: quien lo procesa.
 *
 * Una sola ruta para los dos momentos en que hay que hacerlo —al arrancar, para
 * recuperar lo que quedó pendiente, y tras un cambio, para la reconstrucción
 * inmediata—, y tres reglas:
 *
 *  - **Se reconstruye desde la base, no desde la pantalla.** El proyecto se lee
 *    fresco antes de construir: el pendiente puede venir de otra pestaña u otro
 *    dispositivo, y un grafo construido con artefactos que esta pestaña no ha
 *    visto marcaría como hecha una generación que no refleja.
 *  - **Guardar y marcar son una transacción** (`save_graph_projection`): una
 *    generación ya procesada o anterior no se escribe, así que reprocesar no
 *    duplica y un evento viejo no pisa uno nuevo.
 *  - **Un fallo se anota, no se traga.** `fail_projection` deja el intento y el
 *    error en el pendiente, que sigue ahí para el próximo arranque.
 *
 * Puro respecto a React y a la E/S: todo lo que toca el mundo llega por puerto.
 */
import {
  buildArchitectureKnowledgeGraphForProject,
  type ArchitectureGraph,
  type GraphProjectionOutcome,
  type PendingGraphProjection,
} from '../architectureKnowledgeGraph';
import type { PersistenceResult } from '../persistence';
import type { Project } from './ArchitectureProjectTypes';

export interface GraphProjectionPorts {
  /** Los pendientes; `null` si la bitácora no existe en esta base todavía. */
  listPending(): Promise<PendingGraphProjection[] | null>;
  /** El proyecto tal como está en la base ahora, sin caché. */
  loadFreshProject(projectId: string): Promise<Project | undefined>;
  saveProjection(graph: ArchitectureGraph, generation: number): Promise<PersistenceResult<GraphProjectionOutcome>>;
  failProjection(projectId: string, generation: number, error: string): Promise<void>;
  /** El contexto global con el que se firma el grafo — el mismo que usa la pantalla. */
  globalContext: readonly string[];
}

export interface RecoveredGraphProjection {
  projectId: string;
  /** El grafo guardado, con la revisión que confirmó la base. */
  graph: ArchitectureGraph;
}

export interface GraphProjectionReport {
  /** `false` si la base aún no tiene la bitácora (migración sin aplicar). */
  available: boolean;
  recovered: RecoveredGraphProjection[];
  /** Pendientes que no escribieron nada porque ya estaban hechos o eran viejos. */
  skipped: string[];
  failed: { projectId: string; message: string }[];
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Error desconocido';

export async function recoverGraphProjections(
  ports: GraphProjectionPorts,
  options: { projectIds?: readonly string[] } = {},
): Promise<GraphProjectionReport> {
  const pending = await ports.listPending();
  if (pending === null) return { available: false, recovered: [], skipped: [], failed: [] };

  const wanted = options.projectIds ? new Set(options.projectIds) : null;
  const report: GraphProjectionReport = { available: true, recovered: [], skipped: [], failed: [] };

  for (const item of pending) {
    if (wanted && !wanted.has(item.projectId)) continue;
    try {
      const project = await ports.loadFreshProject(item.projectId);
      if (!project) {
        const message = 'El proyecto no se pudo leer para reconstruir su grafo.';
        await ports.failProjection(item.projectId, item.generation, message);
        report.failed.push({ projectId: item.projectId, message });
        continue;
      }
      const graph = buildArchitectureKnowledgeGraphForProject(project, {
        globalContext: [...ports.globalContext],
        previousGraph: project.architectureKnowledgeGraph,
      });
      const result = await ports.saveProjection(graph, item.generation);
      if (!result.success || !result.data) {
        const message = result.message ?? `La proyección no se confirmó (${result.status}).`;
        await ports.failProjection(item.projectId, item.generation, message);
        report.failed.push({ projectId: item.projectId, message });
        continue;
      }
      if (!result.data.applied) {
        report.skipped.push(item.projectId);
        continue;
      }
      report.recovered.push({
        projectId: item.projectId,
        graph: { ...graph, revision: result.data.revision },
      });
    } catch (error) {
      const message = describe(error);
      await ports.failProjection(item.projectId, item.generation, message).catch(() => undefined);
      report.failed.push({ projectId: item.projectId, message });
    }
  }
  return report;
}
