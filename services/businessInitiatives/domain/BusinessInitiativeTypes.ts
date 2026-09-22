/**
 * Domain model of the Business Initiative — the top of the hierarchy.
 *
 * An initiative is the *motivation layer* of the platform: the pressure the
 * business is under, the goals it wants to reach and the outcomes it will
 * measure. It is deliberately not a project. One initiative can be served by
 * several architecture engagements, and it stays open while its outcomes are
 * still being measured, long after those engagements close.
 *
 * That distinction drives the shape below:
 *
 *  - `need` and `driver` capture *why*, in the business's own words.
 *  - `objectives` and `expectedOutcomes` capture *what good looks like*.
 *  - `kpis` and `milestones` are how progress is proved, not asserted.
 *  - Nothing here describes *how* it will be built — that is what the
 *    architecture engagements underneath it are for.
 *
 * `code` (`NEG-YYYY-NNN`) is the join key with `Project.linkedBusinessProjects`
 * and predates this entity, so initiatives created now stay compatible with the
 * links projects already carry.
 *
 * Everything is plain data: no React, no Firestore, no AI.
 */

/** Bumped when a stored initiative needs migrating. */
export const BUSINESS_INITIATIVE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * The life of an initiative runs past delivery on purpose: architecture hands
 * over a solution, but the business only knows whether the initiative worked
 * once the outcomes have been measured. `delivered` is "built"; `realized` is
 * "it did what we said it would".
 */
import type { BusinessInitiativeCode } from '../../../lib/eaTerminology';

export type InitiativeStatus =
  | 'draft'
  | 'proposed'
  | 'approved'
  | 'in-progress'
  | 'on-hold'
  | 'delivered'
  | 'realized'
  | 'cancelled';

export type InitiativePriority = 'critical' | 'high' | 'medium' | 'low';

/** Roadmap horizon — the now/next/later framing planners actually use. */
export type InitiativeHorizon = 'now' | 'next' | 'later';

export type InitiativeRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type InitiativeStakeholderKind =
  | 'sponsor'
  | 'business-owner'
  | 'architecture-lead'
  | 'stakeholder';

export type InitiativeDocumentKind =
  | 'business-case'
  | 'requirement'
  | 'regulation'
  | 'analysis'
  | 'minutes'
  | 'other';

export type InitiativeMilestoneStatus = 'pending' | 'at-risk' | 'met' | 'missed';

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/** A result the business expects, and how it will know it happened. */
export interface InitiativeOutcome {
  id: string;
  statement: string;
  /** How the outcome is evidenced. Empty means "not yet agreed". */
  measure?: string;
}

/**
 * A measurable indicator. `baseline` and `target` are what make it an
 * indicator rather than a wish — a KPI with neither cannot show progress, and
 * the UI says so instead of drawing a meaningless bar.
 */
export interface InitiativeKpi {
  id: string;
  name: string;
  unit: string;
  baseline?: number;
  target?: number;
  current?: number;
  measuredAt?: string;
}

export interface InitiativeStakeholder {
  id: string;
  name: string;
  /** Free-text job title. `kind` carries the role in the initiative. */
  role: string;
  kind: InitiativeStakeholderKind;
  email?: string;
}

export interface InitiativeRisk {
  id: string;
  description: string;
  level: InitiativeRiskLevel;
  mitigation?: string;
}

/**
 * A supporting document.
 *
 * The platform has no binary storage — Firebase Storage is not part of the
 * stack and adding it for this would be a much larger change than the feature
 * warrants. So a document is either a **link** to where it already lives
 * (SharePoint, Drive, Confluence) or **pasted text** captured inline. Both are
 * first-class: the link keeps the source of truth where the business keeps it,
 * and the pasted text makes a decision auditable when there is no link.
 */
export interface InitiativeDocument {
  id: string;
  name: string;
  kind: InitiativeDocumentKind;
  url?: string;
  /** Inline content, for a document that exists nowhere else. */
  content?: string;
  notes?: string;
  addedAt: string;
  addedBy: string;
  /**
   * Un archivo subido a Storage, cuando el documento no existe en otro sitio.
   *
   * Se guarda la **ruta**, nunca una URL: los dos cubos son privados y lo único
   * que abre un objeto es una URL firmada, que caduca. Una URL persistida sería
   * un enlace roto en cuanto expire, o —si no expirara— un objeto privado con
   * una puerta pública guardada en la base de datos.
   *
   * `objectId` y `sha256` son la identidad del binario: con ellos se puede
   * comprobar que lo que se descarga es lo que se subió, y es lo que permite
   * reconciliar el registro con el almacenamiento sin adivinar.
   */
  file?: InitiativeDocumentFile;
}

export interface InitiativeDocumentFile {
  bucket: string;
  path: string;
  objectId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface InitiativeMilestone {
  id: string;
  name: string;
  dueAt: string;
  status: InitiativeMilestoneStatus;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// The initiative
// ---------------------------------------------------------------------------

export interface BusinessInitiative {
  id: string;
  schemaVersion: number;
  /** `NEG-YYYY-NNN`. The join key with the architecture projects it justifies. */
  /**
   * `NEG-YYYY-NNN`, o vacío.
   *
   * El vacío no es un descuido del tipo: un código malformado en un documento
   * guardado degrada a `''` en vez de a algo verosímil, porque un código que
   * *parece* válido rompería en silencio la unión con las atenciones que lo
   * citan. La marca obliga a que todo lo demás sea un código de verdad, y este
   * `| ''` deja escrito que el caso vacío existe y hay que tratarlo.
   */
  code: BusinessInitiativeCode | '';
  title: string;
  /** The need in the business's own words. Never rewritten by the assistant. */
  need: string;
  /** What pressure creates the need — the motivation-layer driver. */
  driver: string;
  objectives: string[];
  expectedOutcomes: InitiativeOutcome[];
  /** Business capabilities affected — the link to the capability map. */
  affectedCapabilities: string[];
  businessUnits: string[];
  status: InitiativeStatus;
  priority: InitiativePriority;
  horizon: InitiativeHorizon;
  riskLevel: InitiativeRiskLevel;
  risks: InitiativeRisk[];
  regulatoryDrivers: string[];
  kpis: InitiativeKpi[];
  milestones: InitiativeMilestone[];
  stakeholders: InitiativeStakeholder[];
  documents: InitiativeDocument[];
  /** Period the business wants the need attended in. */
  startDate?: string;
  targetEndDate?: string;
  actualEndDate?: string;
  estimatedInvestment?: number;
  /** ISO 4217, e.g. `USD`. Only meaningful alongside an investment. */
  currency?: string;
  expectedBenefit?: string;
  /** Codes of initiatives this one waits on. */
  dependsOnCodes: string[];
  notes: string[];
  /** `'ai-assisted'` when the intake assistant drafted part of the content. */
  provenance: 'manual' | 'ai-assisted';
  /** Owner. Mirrors `Project.userId` so `firestore.rules` can authorise reads. */
  userId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * El testigo de concurrencia de la fila, **no** un campo de dominio: ninguna
   * regla de iniciativa lo lee.
   *
   * Vive aquí por la misma razón que `OfficeEngagement.revision`, y el defecto
   * que cierra era idéntico línea por línea: la revisión la guardaba un
   * `Map<string, number>` dentro del cierre del repositorio, así que cualquier
   * `list()` la refrescaba para todas las iniciativas. Una pantalla con un
   * snapshot anterior guardaba con la revisión más nueva, y la guarda optimista
   * del servidor —que existe justo para detener eso— la dejaba pasar: la
   * actualización perdida no se detectaba, se confirmaba.
   *
   * Un campo funciona donde un `WeakMap` no, porque cada derivación del
   * agregado es un spread y el campo viaja solo. Ausente significa 0, y 0
   * significa «espero que la fila no exista»: el fallo va hacia el conflicto,
   * nunca hacia la escritura. No se persiste dentro del documento — es una
   * columna, y una copia dentro del JSON nacería obsoleta.
   */
  revision?: number;
}

// ---------------------------------------------------------------------------
// Derived views (pure helpers shared by the UI and the tests)
// ---------------------------------------------------------------------------

/** Statuses from which the initiative no longer consumes delivery capacity. */
export const CLOSED_INITIATIVE_STATUSES: readonly InitiativeStatus[] = Object.freeze([
  'delivered',
  'realized',
  'cancelled',
]);

export const isClosedInitiative = (status: InitiativeStatus): boolean =>
  CLOSED_INITIATIVE_STATUSES.includes(status);

/**
 * How far a KPI has travelled from its baseline toward its target, 0..1.
 *
 * Returns `null` — not 0 — when the KPI cannot be measured yet. A KPI with no
 * target is not "0 % done"; it is unanswerable, and the UI must say that
 * rather than draw an empty bar that reads as failure.
 *
 * Works for targets in either direction: "reduce response time to 5 minutes"
 * progresses downward, "raise adoption to 80 %" upward.
 */
export const kpiProgress = (kpi: InitiativeKpi): number | null => {
  const { baseline, target, current } = kpi;
  if (target === undefined || current === undefined) return null;
  if (baseline === undefined) {
    // No baseline: the best we can honestly say is current over target.
    if (target === 0) return current === 0 ? 1 : null;
    return Math.max(0, Math.min(1, current / target));
  }
  const span = target - baseline;
  if (span === 0) return current === target ? 1 : 0;
  return Math.max(0, Math.min(1, (current - baseline) / span));
};

/** KPIs that can actually be plotted — the rest need data before they mean anything. */
export const measurableKpis = (kpis: readonly InitiativeKpi[]): InitiativeKpi[] =>
  kpis.filter((kpi) => kpiProgress(kpi) !== null);

export interface InitiativeMilestoneSummary {
  total: number;
  met: number;
  missed: number;
  atRisk: number;
  pending: number;
  /** Next milestone still open, earliest first. */
  next?: InitiativeMilestone;
}

export const summarizeMilestones = (
  milestones: readonly InitiativeMilestone[],
): InitiativeMilestoneSummary => {
  let met = 0;
  let missed = 0;
  let atRisk = 0;
  let pending = 0;
  for (const milestone of milestones) {
    if (milestone.status === 'met') met += 1;
    else if (milestone.status === 'missed') missed += 1;
    else if (milestone.status === 'at-risk') atRisk += 1;
    else pending += 1;
  }
  const next = [...milestones]
    .filter((milestone) => milestone.status !== 'met' && milestone.status !== 'missed')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return { total: milestones.length, met, missed, atRisk, pending, next };
};

/**
 * Days left before `targetEndDate`. Negative when the date has passed, `null`
 * when no date was set — again, absence is not zero.
 */
export const daysRemaining = (
  targetEndDate: string | undefined,
  now: number = Date.now(),
): number | null => {
  if (!targetEndDate) return null;
  const target = Date.parse(targetEndDate);
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - now) / 86_400_000);
};

export const stakeholderOfKind = (
  initiative: BusinessInitiative,
  kind: InitiativeStakeholderKind,
): InitiativeStakeholder | undefined =>
  initiative.stakeholders.find((stakeholder) => stakeholder.kind === kind);
