/**
 * The Proyecto de Arquitectura — the aggregate at the middle of the hierarchy.
 *
 * `lib/eaTerminology.ts` names four levels, and three of them had a module:
 * `businessInitiatives`, `architectureOffice` and `artifacts`. The one that
 * gives the product its name had none. Its type lived in the 1.268-line
 * `types.ts`, its persistence in a 1.379-line `firestoreService`, its rules in
 * `AppContext`, and its most important invariant — that an attention always
 * belongs to an initiative — in a React component.
 *
 * This file is the model. `architectureProjectFactory.ts` is the only way to
 * build one, and it is what enforces the invariant.
 */

import type { MemoryEntry } from '../../../types';
import type { Artifact, ArtifactSummary } from '../../../lib/artifacts';

// El resumen del índice es un contrato sin comportamiento que leen el
// portafolio y el proyecto: vive en `lib/artifacts` (ADR-106 §6).
export type { ArtifactSummary } from '../../../lib/artifacts';

export type AttentionStatus =
  | 'discovery'
  | 'design'
  | 'review'
  | 'delivered'
  | 'on-hold'
  | 'cancelled';

export type AttentionPriority = 'critical' | 'high' | 'medium' | 'low';

export type AttentionMilestoneStatus = 'pending' | 'at-risk' | 'met' | 'missed';

/**
 * A dated commitment of the architecture response.
 *
 * Deliberately the same four states as an initiative milestone: the two levels
 * are reported side by side in the same steering meeting, and a project whose
 * milestone is "retrasado" while the initiative above says "at-risk" would make
 * the reader translate between two vocabularies for the same fact.
 */
export interface AttentionMilestone {
  id: string;
  name: string;
  dueAt: string;
  status: AttentionMilestoneStatus;
  completedAt?: string;
}

export type AttentionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * A risk of the architecture response.
 *
 * It is not the initiative's risk: the business risk of not attending the need
 * lives above. This is what could stop *this* project from landing — and it is
 * what the initiative inherits, which is why the rollup counts the severe ones.
 */
export interface AttentionRisk {
  id: string;
  description: string;
  level: AttentionRiskLevel;
  mitigation?: string;
}

export type AttentionContributionState = 'planned' | 'in-progress' | 'delivered' | 'blocked';

/**
 * What this project moves in the initiative it serves.
 *
 * The link between the two levels was already an id (`initiativeIds`), so the
 * portfolio always knew *that* a project answers an initiative. What it could
 * not answer is the question a sponsor actually asks — *what does this project
 * change for me, and how much of my initiative depends on it*. A hierarchy that
 * cannot answer that reduces the initiative to a folder.
 *
 * `outcomeId` and `kpiId` point into the initiative's own `expectedOutcomes`
 * and `kpis`. They are ids, never restated text, for the reason the whole
 * portfolio uses ids: a copied statement survives the outcome being rewritten
 * and starts lying quietly. A reference that no longer resolves is **reported**
 * by the rollup, never dropped.
 */
export interface AttentionContribution {
  id: string;
  /** The initiative this contribution is about — the canonical id, never a code. */
  initiativeId: string;
  /** What this project changes for that initiative, in one sentence. */
  statement: string;
  /** The initiative outcome it serves, when one has been agreed. */
  outcomeId?: string;
  /** The initiative KPI it moves, when one has been agreed. */
  kpiId?: string;
  /**
   * How much of the initiative's advance rides on this contribution, 1..100.
   *
   * Optional because a weight nobody has thought about is worse than none: the
   * rollup weights every project equally while no weight is declared, and says
   * so, rather than inventing a distribution that would look measured.
   */
  weight?: number;
  state: AttentionContributionState;
  note?: string;
}

/**
 * How an architecture attention is tracked.
 *
 * The middle level of the hierarchy used to carry no state at all: a project
 * either existed or it did not, and the only signal of progress was how many
 * artifacts it happened to contain. That is enough to work in, and not enough
 * to report on — a steering meeting asks when it lands, who leads it, how far
 * along it is, what could stop it and what it changes for the business need
 * above.
 *
 * Additive and optional: a legacy project without this block still loads, and
 * the UI shows "sin seguimiento" rather than inventing a status.
 */
export interface ProjectAttentionTracking {
  /** Stage of the architecture response, not of the business need. */
  status: AttentionStatus;
  priority: AttentionPriority;
  /** Person accountable for the architecture. Free text — no user directory. */
  architectureLead?: string;
  startDate?: string;
  targetEndDate?: string;
  /** One line the lead writes about why it is where it is. */
  healthNote?: string;
  /**
   * Declared advance, 0..100.
   *
   * Absent means nobody has declared it, which is **not** zero — the same rule
   * `kpiProgress` holds to one level up. A screen that renders an undeclared
   * project as "0 %" reports a team that has done nothing.
   */
  progress?: number;
  milestones?: AttentionMilestone[];
  risks?: AttentionRisk[];
  /** What this project moves in each initiative it answers. */
  contributions?: AttentionContribution[];
}


/**
 * La raíz del agregado Proyecto (F4-04, ADR-106 §6).
 *
 * Es lo que `api.save_project` guarda y lo que su revisión protege: el nombre,
 * las iniciativas a las que responde, su seguimiento, su memoria y sus paquetes
 * de publicación. **No contiene artefactos**: desde ADR-106 el Artefacto es raíz
 * de su propio agregado y se escribe con sus comandos. La fábrica construye
 * esto, las reglas de seguimiento lo leen, y la ruta de escritura sólo acepta
 * esto — así ninguna escritura del proyecto puede llevar, ni borrar, un
 * artefacto.
 */
export interface ProjectRoot {
  id: string;
  name: string;
  description: string;
  projectContext: string[];
  /**
   * Ids of the business initiatives this attention responds to — the
   * **canonical link** to `businessInitiatives/{initiativeId}`.
   *
   * Relations between the four levels are keys, never text. A code someone
   * typed can be misspelled, can point at an initiative that was never
   * created, and silently survives a rename; an id either resolves or is
   * reported as broken. The other two links in the hierarchy already worked
   * this way (`OfficeEngagement.projectId`, `OfficeTask.producedArtifactId`) —
   * this one was the exception.
   */
  initiativeIds?: string[];
  /**
   * Human-facing codes (`NEG-YYYY-NNN`) of those same initiatives.
   *
   * A **derived mirror**, kept because the code is what people quote in a
   * steering meeting and because projects created before `initiativeIds`
   * existed carry only this. `portfolioGraph` resolves ids first and falls
   * back to matching codes, so legacy links keep working; every write through
   * the picker refreshes both. Never treat this as the source of truth.
   */
  linkedBusinessProjects?: string[];
  /** Tracking of the attention itself. Absent on projects created before it existed. */
  attention?: ProjectAttentionTracking;
  /** Metadatos estructurados (fecha, autor, prioridad) de `projectContext`. */
  projectContextEntries?: MemoryEntry[];
  /** Notas que el agente recuerda específicamente sobre este proyecto (decisiones, preferencias, restricciones). */
  agentMemory?: string[];
  /** Metadatos estructurados (fecha, autor, prioridad) de `agentMemory`. */
  agentMemoryEntries?: MemoryEntry[];
  /** Información clave capturada durante la creación inicial del proyecto. */
  initialCapture?: string[];
  /** Metadatos estructurados (fecha, autor, prioridad) de `initialCapture`. */
  initialCaptureEntries?: MemoryEntry[];
  createdAt: string;
  updatedAt: string;
  /**
   * La revisión optimista de la fila, tal y como la devolvió la lectura
   * (F4-07). La siguiente escritura la compara: viaja con el registro que se
   * está viendo, no en un mapa del repositorio. Ausente en un proyecto que
   * todavía no se ha guardado.
   */
  revision?: number;
  /**
   * Professional publication packages: governed, accessible, auditable
   * deliverables built from the project's artifacts by the
   * `publicationPipeline` service. Additive and backwards-compatible — absent
   * on legacy projects until the first package is created.
   */
  publicationPackages?: import('../../publicationPipeline/PublicationPipelineTypes').PublicationPackage[];
}

/**
 * Lo que una pantalla ve: la raíz con sus artefactos y sus proyecciones.
 *
 * Es un **modelo de lectura**, no el agregado: los artefactos llegan de su
 * propia tabla, el índice y el contador los recalcula el servidor, y el grafo de
 * conocimiento es dato derivado con su propia RPC. Ninguno de estos campos se
 * escribe a través del proyecto. `Project` conserva el nombre porque es lo que
 * leen cuarenta módulos; el agregado es `ProjectRoot`.
 */
export interface Project extends ProjectRoot {
  /**
   * The project's artifacts — **the full documents, and only when loaded**.
   *
   * Persisted in the `projects/{id}/artifacts` subcollection, never on the
   * project document. In memory this array is populated when the project is
   * opened; on the portfolio screens it is empty and `artifactsLoaded` is
   * false. Read `artifactIndex` when all you need is "which artifacts exist"
   * — see `artifactsLoaded` for why the distinction is load-bearing.
   */
  artifacts: Artifact[];
  /**
   * Whether `artifacts` has been hydrated for this project.
   *
   * Empty-because-not-loaded and empty-because-there-are-none are different
   * facts, and conflating them is how a portfolio screen silently reports an
   * empty organisation as if it were true. Anything that counts, groups or
   * charts artifacts must consult this before believing `artifacts.length`.
   *
   * Absent on a record that predates lazy loading, which is treated as loaded:
   * that is what it was.
   */
  artifactsLoaded?: boolean;
  /**
   * Compact index of the artifacts that exist, without their content.
   *
   * The portfolio graph, the office rollups and every "how many artifacts"
   * surface need identity and version, not the document body. Loading full
   * artifacts for every project just to count them was the boot-time N+1;
   * this is the same information at roughly a hundred bytes each.
   *
   * Absent on a project whose index has not been written yet — the reader then
   * falls back to loading the artifacts themselves, so a missing index costs
   * performance and never correctness.
   */
  artifactIndex?: ArtifactSummary[];
  /** Number of artifacts, denormalised on the project document. */
  artifactCount?: number;
  /**
   * Persisted Architecture Knowledge Graph: the canonical, typed model of the
   * project's architectural knowledge (entities, relations, evidence). Built
   * by the `architectureKnowledgeGraph` service. Additive and
   * backwards-compatible — absent on legacy projects until the first rebuild.
   */
  architectureKnowledgeGraph?: import('../../architectureKnowledgeGraph').ArchitectureGraph;
}
