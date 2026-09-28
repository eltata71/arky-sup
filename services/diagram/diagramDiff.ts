/**
 * Qué cambió entre dos versiones de un diagrama, dicho en diagrama (plan de
 * diagramas, 1.3).
 *
 * El historial comparaba el **texto** Mermaid línea a línea: reordenar dos
 * declaraciones aparecía como un cambio, y renombrar un nodo aparecía como
 * tres líneas tachadas en las que había que adivinar qué caja era. Esto
 * compara el modelo: nodos, conexiones y agrupaciones, por identidad.
 *
 * Cuatro decisiones:
 *
 * 1. **El orden no es un cambio.** Todo se compara como conjunto; dos IR con
 *    los mismos elementos en otro orden son idénticos.
 * 2. **La geometría no es un cambio.** Mover una caja es layout, no
 *    arquitectura: las posiciones no se comparan.
 * 3. **Una regeneración no es «todo nuevo».** Si un nodo cambió de id pero su
 *    etiqueta es la misma —y única a ambos lados—, es el mismo nodo. Se
 *    informa cuántos se reidentificaron así, porque es una inferencia y no
 *    un hecho registrado.
 * 4. **Una conexión se identifica por sus extremos**, no por su id: los ids de
 *    conexión cambian con cada regeneración y sus extremos no. Si entre los
 *    mismos extremos sólo cambió la etiqueta, es un cambio, no un borrado más
 *    una alta.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRGroup, DiagramIRNode } from '../../lib/diagram';

export type DiagramDiffField =
  | 'label'
  | 'kind'
  | 'technology'
  | 'description'
  | 'criticality'
  | 'protocol'
  | 'members';

export interface DiagramFieldChange {
  readonly field: DiagramDiffField;
  readonly before: string;
  readonly after: string;
}

export interface DiagramDiffNode {
  readonly id: string;
  readonly label: string;
}

export interface DiagramDiffEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface DiagramDiff {
  /** Ningún cambio semántico: los mismos elementos, quizá en otro orden o en otro sitio. */
  readonly identical: boolean;
  readonly nodes: {
    readonly added: readonly DiagramDiffNode[];
    readonly removed: readonly DiagramDiffNode[];
    readonly changed: readonly (DiagramDiffNode & { readonly changes: readonly DiagramFieldChange[] })[];
  };
  readonly edges: {
    readonly added: readonly DiagramDiffEdge[];
    readonly removed: readonly DiagramDiffEdge[];
    readonly changed: readonly (DiagramDiffEdge & { readonly changes: readonly DiagramFieldChange[] })[];
  };
  readonly groups: {
    readonly added: readonly DiagramDiffNode[];
    readonly removed: readonly DiagramDiffNode[];
    readonly changed: readonly (DiagramDiffNode & { readonly changes: readonly DiagramFieldChange[] })[];
  };
  /** Nodos emparejados por etiqueta porque su id cambió (decisión 3). */
  readonly reidentified: number;
}

const norm = (value: string | undefined): string => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const text = (value: string | undefined): string => (value ?? '').trim();
const byLabel = <T extends { label: string }>(a: T, b: T): number => a.label.localeCompare(b.label, 'es');

const fieldChanges = <T>(
  before: T,
  after: T,
  fields: readonly (keyof T & DiagramDiffField)[],
): DiagramFieldChange[] => fields.flatMap((field) => {
  const a = text(before[field] as string | undefined);
  const b = text(after[field] as string | undefined);
  return a === b ? [] : [{ field, before: a, after: b }];
});

/**
 * Empareja por clave primaria y, lo que quede, por una clave secundaria que
 * sea única a ambos lados. Devuelve los pares y los que quedaron solos.
 */
function pair<T>(
  before: readonly T[],
  after: readonly T[],
  primary: (item: T) => string,
  secondary: (item: T) => string,
): { pairs: Array<[T, T]>; removed: T[]; added: T[]; bySecondary: number } {
  const afterByPrimary = new Map(after.map((item) => [primary(item), item]));
  const pairs: Array<[T, T]> = [];
  const matchedAfter = new Set<T>();
  const removed: T[] = [];
  for (const item of before) {
    const match = afterByPrimary.get(primary(item));
    if (match && !matchedAfter.has(match)) {
      pairs.push([item, match]);
      matchedAfter.add(match);
    } else {
      removed.push(item);
    }
  }
  let added = after.filter((item) => !matchedAfter.has(item));

  const counts = (items: readonly T[]) => {
    const map = new Map<string, number>();
    for (const item of items) map.set(secondary(item), (map.get(secondary(item)) ?? 0) + 1);
    return map;
  };
  const removedCounts = counts(removed);
  const addedCounts = counts(added);
  let bySecondary = 0;
  const stillRemoved: T[] = [];
  for (const item of removed) {
    const key = secondary(item);
    const match = key && removedCounts.get(key) === 1 && addedCounts.get(key) === 1
      ? added.find((candidate) => secondary(candidate) === key)
      : undefined;
    if (match) {
      pairs.push([item, match]);
      added = added.filter((candidate) => candidate !== match);
      bySecondary += 1;
    } else {
      stillRemoved.push(item);
    }
  }
  return { pairs, removed: stillRemoved, added, bySecondary };
}

const NODE_FIELDS = ['label', 'kind', 'technology', 'description', 'criticality'] as const;
const EDGE_FIELDS = ['label', 'protocol', 'criticality'] as const;

export function diffDiagramIR(before: DiagramIR, after: DiagramIR): DiagramDiff {
  // ── Nodos
  const nodes = pair<DiagramIRNode>(before.nodes, after.nodes, (n) => n.id, (n) => norm(n.label));
  // Id de antes → id de después, para que las conexiones y los grupos hablen
  // de los mismos nodos aunque se hayan reidentificado.
  const renamed = new Map(nodes.pairs.map(([a, b]) => [a.id, b.id]));
  const toAfterId = (id: string) => renamed.get(id) ?? id;
  const labelBefore = new Map(before.nodes.map((n) => [n.id, text(n.label) || n.id]));
  const labelAfter = new Map(after.nodes.map((n) => [n.id, text(n.label) || n.id]));
  const nodeRef = (n: DiagramIRNode): DiagramDiffNode => ({ id: n.id, label: text(n.label) || n.id });

  const changedNodes = nodes.pairs
    .map(([a, b]) => ({ ...nodeRef(b), changes: fieldChanges(a, b, NODE_FIELDS) }))
    .filter((entry) => entry.changes.length > 0)
    .sort(byLabel);

  // ── Conexiones: por extremos (en ids de después) y etiqueta; luego sólo por extremos.
  const endpoints = (e: DiagramIREdge, mapped: boolean) =>
    `${mapped ? toAfterId(e.source) : e.source}→${mapped ? toAfterId(e.target) : e.target}`;
  const beforeEdges = before.edges.map((edge) => ({ edge, key: endpoints(edge, true) }));
  const afterEdges = after.edges.map((edge) => ({ edge, key: endpoints(edge, false) }));
  const edges = pair(
    beforeEdges,
    afterEdges,
    (entry) => `${entry.key}|${norm(entry.edge.label)}`,
    (entry) => entry.key,
  );
  const edgeRef = (edge: DiagramIREdge, labels: Map<string, string>): DiagramDiffEdge => ({
    from: labels.get(edge.source) ?? edge.source,
    to: labels.get(edge.target) ?? edge.target,
    label: text(edge.label),
  });
  const byEdge = (a: DiagramDiffEdge, b: DiagramDiffEdge) =>
    `${a.from}→${a.to}`.localeCompare(`${b.from}→${b.to}`, 'es');

  const changedEdges = edges.pairs
    .map(([a, b]) => ({ ...edgeRef(b.edge, labelAfter), changes: fieldChanges(a.edge, b.edge, EDGE_FIELDS) }))
    .filter((entry) => entry.changes.length > 0)
    .sort(byEdge);

  // ── Agrupaciones: por id, luego por etiqueta; los miembros, en etiquetas de nodo.
  const groups = pair<DiagramIRGroup>(before.groups, after.groups, (g) => g.id, (g) => norm(g.label));
  const members = (g: DiagramIRGroup, mapped: boolean, labels: Map<string, string>) =>
    [...new Set(g.nodeIds.map((id) => (mapped ? toAfterId(id) : id)))]
      .map((id) => labels.get(id) ?? labelBefore.get(id) ?? id)
      .sort((a, b) => a.localeCompare(b, 'es'))
      .join(', ');
  const groupRef = (g: DiagramIRGroup): DiagramDiffNode => ({ id: g.id, label: text(g.label) || g.id });
  const changedGroups = groups.pairs
    .map(([a, b]) => {
      const changes = fieldChanges(a, b, ['label'] as const);
      const was = members(a, true, labelAfter);
      const now = members(b, false, labelAfter);
      if (was !== now) changes.push({ field: 'members', before: was, after: now });
      return { ...groupRef(b), changes };
    })
    .filter((entry) => entry.changes.length > 0)
    .sort(byLabel);

  const diff: DiagramDiff = {
    identical: false,
    nodes: {
      added: nodes.added.map(nodeRef).sort(byLabel),
      removed: nodes.removed.map(nodeRef).sort(byLabel),
      changed: changedNodes,
    },
    edges: {
      added: edges.added.map((entry) => edgeRef(entry.edge, labelAfter)).sort(byEdge),
      removed: edges.removed.map((entry) => edgeRef(entry.edge, labelBefore)).sort(byEdge),
      changed: changedEdges,
    },
    groups: {
      added: groups.added.map(groupRef).sort(byLabel),
      removed: groups.removed.map(groupRef).sort(byLabel),
      changed: changedGroups,
    },
    reidentified: nodes.bySecondary,
  };
  const count = [diff.nodes, diff.edges, diff.groups]
    .reduce((total, section) => total + section.added.length + section.removed.length + section.changed.length, 0);
  return { ...diff, identical: count === 0 };
}
