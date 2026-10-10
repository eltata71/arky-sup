/**
 * El plan de transición de un proyecto (11.4, TOGAF fases B–D y E–F).
 *
 * Tres listas de ids y nada más: los elementos de la línea base y del objetivo
 * apuntan a elementos del inventario empresarial **por id**, y cada meseta
 * apunta a un hito del seguimiento **por id**. Ni el nombre de un elemento ni
 * la fecha de un hito se copian aquí: una copia sobrevive al cambio y empieza a
 * mentir. La clasificación conservar / eliminar / nuevo / modificar tampoco se
 * guarda; se calcula (`services/enterpriseRepository/application/gapAnalysis`).
 *
 * Puro: sin E/S, sin React, con el reloj fuera.
 */

import type { ProjectAttentionTracking } from './ArchitectureProjectTypes';

/** Lo que se quiere que sea distinto en el objetivo. Ausente = sin cambio deseado. */
export interface TransitionDesiredState {
  lifecycle?: 'candidate' | 'active' | 'deprecated' | 'retired';
  maturity?: 1 | 2 | 3 | 4 | 5;
  /** Ids de las aplicaciones que deberían soportar la capacidad. */
  supportedByIds?: string[];
}

export interface TransitionElement {
  /** Id del elemento del inventario. */
  itemId: string;
  /** Sólo tiene sentido en el objetivo. */
  desired?: TransitionDesiredState;
}

export interface TransitionWorkPackage {
  id: string;
  name: string;
  /** Elementos del inventario que este paquete crea, cambia o retira. */
  itemIds: string[];
  startAt?: string;
  endAt?: string;
}

export interface TransitionPlateau {
  id: string;
  name: string;
  /** Hito del seguimiento que marca la llegada a la meseta. Su fecha es la del hito. */
  milestoneId?: string;
  workPackages: TransitionWorkPackage[];
}

export interface TransitionPlan {
  baseline: TransitionElement[];
  target: TransitionElement[];
  /** En orden de llegada: la posición es el orden, nadie lo escribe aparte. */
  plateaus: TransitionPlateau[];
}

export const emptyTransitionPlan = (): TransitionPlan => ({ baseline: [], target: [], plateaus: [] });

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};
const iso = (value: unknown): string | undefined =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(text).filter((v): v is string => Boolean(v)))] : [];
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object') : [];

const LIFECYCLES = ['candidate', 'active', 'deprecated', 'retired'] as const;

const readDesired = (raw: unknown): TransitionDesiredState | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const supported = ids(r.supportedByIds);
  const desired: TransitionDesiredState = {
    ...(LIFECYCLES.includes(r.lifecycle as (typeof LIFECYCLES)[number]) ? { lifecycle: r.lifecycle as TransitionDesiredState['lifecycle'] } : {}),
    ...([1, 2, 3, 4, 5].includes(r.maturity as number) ? { maturity: r.maturity as TransitionDesiredState['maturity'] } : {}),
    ...(supported.length ? { supportedByIds: supported } : {}),
  };
  return Object.keys(desired).length ? desired : undefined;
};

const readElements = (value: unknown, withDesired: boolean): TransitionElement[] => {
  const seen = new Set<string>();
  const out: TransitionElement[] = [];
  for (const entry of records(value)) {
    const itemId = text(entry.itemId);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    const desired = withDesired ? readDesired(entry.desired) : undefined;
    out.push({ itemId, ...(desired ? { desired } : {}) });
  }
  return out;
};

/** Lee lo almacenado: lo válido se conserva, lo demás se descarta. Sin nada que decir devuelve `undefined`. */
export const normalizeTransitionPlan = (input: unknown): TransitionPlan | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const plateaus: TransitionPlateau[] = records(raw.plateaus).flatMap((entry, index) => {
    const name = text(entry.name);
    if (!name) return [];
    const workPackages: TransitionWorkPackage[] = records(entry.workPackages).flatMap((wp, wpIndex) => {
      const wpName = text(wp.name);
      if (!wpName) return [];
      return [{
        id: text(wp.id) ?? `paquete-${index + 1}-${wpIndex + 1}`,
        name: wpName,
        itemIds: ids(wp.itemIds),
        ...(iso(wp.startAt) ? { startAt: iso(wp.startAt) } : {}),
        ...(iso(wp.endAt) ? { endAt: iso(wp.endAt) } : {}),
      }];
    });
    const milestoneId = text(entry.milestoneId);
    return [{ id: text(entry.id) ?? `meseta-${index + 1}`, name, ...(milestoneId ? { milestoneId } : {}), workPackages }];
  });
  const plan: TransitionPlan = {
    baseline: readElements(raw.baseline, false),
    target: readElements(raw.target, true),
    plateaus,
  };
  return plan.baseline.length || plan.target.length || plan.plateaus.length ? plan : undefined;
};

export type TransitionCommand =
  | { readonly type: 'add-baseline'; readonly itemId: string }
  | { readonly type: 'add-target'; readonly itemId: string; readonly desired?: TransitionDesiredState }
  | { readonly type: 'set-desired-state'; readonly itemId: string; readonly desired: TransitionDesiredState | null }
  | { readonly type: 'remove-element'; readonly side: 'baseline' | 'target'; readonly itemId: string }
  | { readonly type: 'add-plateau'; readonly id: string; readonly name: string; readonly milestoneId?: string }
  | { readonly type: 'rename-plateau'; readonly plateauId: string; readonly name: string }
  | { readonly type: 'link-plateau-milestone'; readonly plateauId: string; readonly milestoneId: string | null }
  | { readonly type: 'move-plateau'; readonly plateauId: string; readonly toIndex: number }
  | { readonly type: 'remove-plateau'; readonly plateauId: string }
  | {
    readonly type: 'add-work-package';
    readonly plateauId: string;
    readonly id: string;
    readonly name: string;
    readonly itemIds?: readonly string[];
  }
  | {
    readonly type: 'schedule-work-package';
    readonly plateauId: string;
    readonly workPackageId: string;
    readonly startAt: string | null;
    readonly endAt: string | null;
  }
  | { readonly type: 'remove-work-package'; readonly plateauId: string; readonly workPackageId: string };

export type TransitionRejection =
  | 'missing-item'
  | 'missing-name'
  | 'missing-id'
  | 'duplicate-id'
  | 'unknown-plateau'
  | 'unknown-work-package'
  | 'unknown-milestone'
  | 'invalid-date'
  | 'inverted-dates';

export type TransitionResult =
  | { readonly ok: true; readonly plan: TransitionPlan; readonly changed: boolean }
  | { readonly ok: false; readonly rejection: TransitionRejection };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `tracking` se pasa para comprobar que un hito existe: vincular una meseta a
 * un hito que no resuelve se rechaza al escribir, no se descubre al leer.
 */
export const applyTransitionCommand = (
  current: TransitionPlan | undefined,
  command: TransitionCommand,
  tracking?: Pick<ProjectAttentionTracking, 'milestones'>,
): TransitionResult => {
  const plan: TransitionPlan = structuredClone(current ?? emptyTransitionPlan());
  const fail = (rejection: TransitionRejection): TransitionResult => ({ ok: false, rejection });
  const finish = (): TransitionResult => ({ ok: true, plan, changed: !same(plan, current ?? emptyTransitionPlan()) });
  const plateau = (id: string): TransitionPlateau | undefined => plan.plateaus.find((p) => p.id === id);
  const milestoneExists = (id: string): boolean => (tracking?.milestones ?? []).some((m) => m.id === id);

  switch (command.type) {
    case 'add-baseline': {
      const itemId = text(command.itemId);
      if (!itemId) return fail('missing-item');
      if (!plan.baseline.some((e) => e.itemId === itemId)) plan.baseline.push({ itemId });
      return finish();
    }
    case 'add-target': {
      const itemId = text(command.itemId);
      if (!itemId) return fail('missing-item');
      if (!plan.target.some((e) => e.itemId === itemId)) {
        const desired = readDesired(command.desired);
        plan.target.push({ itemId, ...(desired ? { desired } : {}) });
      }
      return finish();
    }
    case 'set-desired-state': {
      const element = plan.target.find((e) => e.itemId === command.itemId);
      if (!element) return fail('missing-item');
      const desired = command.desired ? readDesired(command.desired) : undefined;
      if (desired) element.desired = desired;
      else delete element.desired;
      return finish();
    }
    case 'remove-element': {
      plan[command.side] = plan[command.side].filter((e) => e.itemId !== command.itemId);
      return finish();
    }
    case 'add-plateau': {
      const id = text(command.id);
      const name = text(command.name);
      if (!id) return fail('missing-id');
      if (!name) return fail('missing-name');
      if (plateau(id)) return fail('duplicate-id');
      const milestoneId = text(command.milestoneId);
      if (milestoneId && !milestoneExists(milestoneId)) return fail('unknown-milestone');
      plan.plateaus.push({ id, name, ...(milestoneId ? { milestoneId } : {}), workPackages: [] });
      return finish();
    }
    case 'rename-plateau': {
      const target = plateau(command.plateauId);
      if (!target) return fail('unknown-plateau');
      const name = text(command.name);
      if (!name) return fail('missing-name');
      target.name = name;
      return finish();
    }
    case 'link-plateau-milestone': {
      const target = plateau(command.plateauId);
      if (!target) return fail('unknown-plateau');
      if (command.milestoneId === null) delete target.milestoneId;
      else {
        if (!milestoneExists(command.milestoneId)) return fail('unknown-milestone');
        target.milestoneId = command.milestoneId;
      }
      return finish();
    }
    case 'move-plateau': {
      const from = plan.plateaus.findIndex((p) => p.id === command.plateauId);
      if (from < 0) return fail('unknown-plateau');
      const to = Math.max(0, Math.min(plan.plateaus.length - 1, Math.trunc(command.toIndex)));
      const [moved] = plan.plateaus.splice(from, 1);
      plan.plateaus.splice(to, 0, moved);
      return finish();
    }
    case 'remove-plateau': {
      if (!plateau(command.plateauId)) return fail('unknown-plateau');
      plan.plateaus = plan.plateaus.filter((p) => p.id !== command.plateauId);
      return finish();
    }
    case 'add-work-package': {
      const target = plateau(command.plateauId);
      if (!target) return fail('unknown-plateau');
      const id = text(command.id);
      const name = text(command.name);
      if (!id) return fail('missing-id');
      if (!name) return fail('missing-name');
      if (plan.plateaus.some((p) => p.workPackages.some((w) => w.id === id))) return fail('duplicate-id');
      target.workPackages.push({ id, name, itemIds: ids(command.itemIds) });
      return finish();
    }
    case 'schedule-work-package': {
      const target = plateau(command.plateauId);
      const wp = target?.workPackages.find((w) => w.id === command.workPackageId);
      if (!target) return fail('unknown-plateau');
      if (!wp) return fail('unknown-work-package');
      if ((command.startAt && !iso(command.startAt)) || (command.endAt && !iso(command.endAt))) return fail('invalid-date');
      if (command.startAt && command.endAt && Date.parse(command.endAt) < Date.parse(command.startAt)) return fail('inverted-dates');
      if (command.startAt) wp.startAt = command.startAt;
      else delete wp.startAt;
      if (command.endAt) wp.endAt = command.endAt;
      else delete wp.endAt;
      return finish();
    }
    case 'remove-work-package': {
      const target = plateau(command.plateauId);
      if (!target) return fail('unknown-plateau');
      if (!target.workPackages.some((w) => w.id === command.workPackageId)) return fail('unknown-work-package');
      target.workPackages = target.workPackages.filter((w) => w.id !== command.workPackageId);
      return finish();
    }
  }
};

export type RoadmapIssue =
  | { readonly kind: 'dangling-milestone'; readonly plateauId: string; readonly milestoneId: string }
  | { readonly kind: 'plateau-without-milestone'; readonly plateauId: string }
  | { readonly kind: 'out-of-order'; readonly plateauId: string; readonly previousPlateauId: string };

export interface RoadmapPlateau {
  readonly plateau: TransitionPlateau;
  /** Fecha del hito vinculado. `null` si no hay hito o no resuelve: sin fecha, no se inventa. */
  readonly arrivesAt: string | null;
  readonly milestoneStatus: 'pending' | 'at-risk' | 'met' | 'missed' | null;
}

export interface Roadmap {
  readonly plateaus: readonly RoadmapPlateau[];
  /** Rotos, sin fecha o desordenados: se informan, nunca se descartan. */
  readonly issues: readonly RoadmapIssue[];
}

/** La hoja de ruta se deriva: el orden es el de las mesetas, las fechas las de los hitos. */
export const deriveRoadmap = (
  plan: TransitionPlan | undefined,
  tracking: Pick<ProjectAttentionTracking, 'milestones'> | undefined,
): Roadmap => {
  const milestones = new Map((tracking?.milestones ?? []).map((m) => [m.id, m]));
  const issues: RoadmapIssue[] = [];
  const plateaus: RoadmapPlateau[] = [];
  let previous: RoadmapPlateau | undefined;
  for (const plateau of plan?.plateaus ?? []) {
    const milestone = plateau.milestoneId ? milestones.get(plateau.milestoneId) : undefined;
    if (!plateau.milestoneId) issues.push({ kind: 'plateau-without-milestone', plateauId: plateau.id });
    else if (!milestone) issues.push({ kind: 'dangling-milestone', plateauId: plateau.id, milestoneId: plateau.milestoneId });
    const entry: RoadmapPlateau = { plateau, arrivesAt: milestone?.dueAt ?? null, milestoneStatus: milestone?.status ?? null };
    if (previous?.arrivesAt && entry.arrivesAt && Date.parse(entry.arrivesAt) < Date.parse(previous.arrivesAt)) {
      issues.push({ kind: 'out-of-order', plateauId: plateau.id, previousPlateauId: previous.plateau.id });
    }
    plateaus.push(entry);
    previous = entry;
  }
  return { plateaus, issues };
};
