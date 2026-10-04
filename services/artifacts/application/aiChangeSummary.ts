/**
 * «La IA explica qué cambió» (10.5): el resumen de un cambio de la IA, y el
 * almacén del último para que una tarjeta lo muestre.
 *
 * El resumen de un diagrama sale del **mismo** `DiagramPatchResult` que
 * `planDiagramModification` guarda (regla de ADR-006): no hay una segunda
 * lectura del cambio que pueda describir una cosa mientras la aplicación hace
 * otra. El de un documento se calcula comparando antes y después, que es lo
 * único que no puede mentir sobre lo que quedó escrito.
 */
import type { DiagramIR, PatchApplication } from '../../../lib/diagram';

export interface AiChangeSummary {
  readonly id: string;
  readonly artifactId: string;
  /** Una frase: «3 cambios · 1 nodo nuevo, 2 aristas nuevas». */
  readonly headline: string;
  /** Una frase por cambio; lo arrastrado sin pedirlo va marcado con «También:». */
  readonly lines: readonly string[];
  /** Ids de nodos del diagrama que cambiaron: lo que el lienzo resalta. */
  readonly touchedNodeIds: readonly string[];
}

let sequence = 0;
const nextId = (): string => { sequence += 1; return `ai-change-${sequence}`; };

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const joinParts = (parts: readonly string[]): string => parts.filter(Boolean).join(', ');

const keyed = <T extends { id: string }>(items: readonly T[] | undefined): Map<string, string> =>
  new Map((items ?? []).map(item => [item.id, JSON.stringify(item)]));

/** Resume lo que un patch hizo al IR, a partir del resultado del motor. */
export const summarizeDiagramChange = (params: {
  readonly artifactId: string;
  readonly before: DiagramIR;
  readonly result: { readonly ir: DiagramIR; readonly applied: readonly PatchApplication[] };
}): AiChangeSummary => {
  const { before, result } = params;
  const nodesBefore = keyed(before.nodes);
  const nodesAfter = keyed(result.ir.nodes);
  const edgesBefore = keyed(before.edges);
  const edgesAfter = keyed(result.ir.edges);

  const addedNodes = [...nodesAfter.keys()].filter(id => !nodesBefore.has(id));
  const removedNodes = [...nodesBefore.keys()].filter(id => !nodesAfter.has(id));
  const changedNodes = [...nodesAfter.keys()].filter(id => nodesBefore.has(id) && nodesBefore.get(id) !== nodesAfter.get(id));
  const addedEdges = [...edgesAfter.keys()].filter(id => !edgesBefore.has(id)).length;
  const removedEdges = [...edgesBefore.keys()].filter(id => !edgesAfter.has(id)).length;
  const changedEdges = [...edgesAfter.keys()].filter(id => edgesBefore.has(id) && edgesBefore.get(id) !== edgesAfter.get(id)).length;

  const lines = result.applied.flatMap(entry => [
    entry.description,
    ...(entry.cascaded ?? []).map(line => `También: ${line}`),
  ]);
  const counts = joinParts([
    addedNodes.length ? plural(addedNodes.length, 'nodo nuevo', 'nodos nuevos') : '',
    changedNodes.length ? plural(changedNodes.length, 'nodo modificado', 'nodos modificados') : '',
    removedNodes.length ? plural(removedNodes.length, 'nodo eliminado', 'nodos eliminados') : '',
    addedEdges ? plural(addedEdges, 'arista nueva', 'aristas nuevas') : '',
    changedEdges ? plural(changedEdges, 'arista modificada', 'aristas modificadas') : '',
    removedEdges ? plural(removedEdges, 'arista eliminada', 'aristas eliminadas') : '',
  ]);
  const operations = plural(result.applied.length, 'cambio', 'cambios');
  return {
    id: nextId(),
    artifactId: params.artifactId,
    headline: counts ? `${operations} · ${counts}` : operations,
    lines,
    // Un nodo eliminado ya no está en el lienzo: no hay nada que resaltar.
    touchedNodeIds: [...addedNodes, ...changedNodes],
  };
};

interface Section { readonly heading: string; readonly body: string[] }

const splitSections = (content: string): Section[] => {
  const sections: Section[] = [{ heading: '', body: [] }];
  for (const line of (content ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^#{1,6}\s+\S/.test(line)) sections.push({ heading: line.replace(/^#{1,6}\s+/, '').trim(), body: [] });
    else sections[sections.length - 1].body.push(line);
  }
  return sections;
};

const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line) && !/^\s*\|[\s:|-]+\|\s*$/.test(line);

/** Resume el cambio de un documento: secciones tocadas, filas y líneas nuevas. */
export const summarizeDocumentChange = (params: {
  readonly artifactId: string;
  readonly before: string;
  readonly after: string;
  /** Las frases del motor de patches, cuando el cambio vino de uno. */
  readonly applied?: readonly string[];
}): AiChangeSummary => {
  const before = splitSections(params.before);
  const after = splitSections(params.after);
  const bodyOf = (sections: readonly Section[]) => new Map(sections.map(section => [section.heading, section.body.join('\n').trim()]));
  const was = bodyOf(before);
  const now = bodyOf(after);
  const added = [...now.keys()].filter(heading => heading && !was.has(heading));
  const removed = [...was.keys()].filter(heading => heading && !now.has(heading));
  const changed = [...now.keys()].filter(heading => heading && was.has(heading) && was.get(heading) !== now.get(heading));

  const beforeLines = new Set((params.before ?? '').split('\n').map(line => line.trim()).filter(Boolean));
  const newLines = (params.after ?? '').split('\n').filter(line => line.trim() && !beforeLines.has(line.trim()));
  const rows = newLines.filter(isTableRow).length;

  const lines = [
    ...(params.applied ?? []),
    ...added.map(heading => `Sección nueva: «${heading}».`),
    ...changed.map(heading => `Sección modificada: «${heading}».`),
    ...removed.map(heading => `Sección eliminada: «${heading}».`),
  ];
  const headline = joinParts([
    added.length ? plural(added.length, 'sección nueva', 'secciones nuevas') : '',
    changed.length ? plural(changed.length, 'sección modificada', 'secciones modificadas') : '',
    removed.length ? plural(removed.length, 'sección eliminada', 'secciones eliminadas') : '',
    rows ? plural(rows, 'fila añadida', 'filas añadidas') : '',
  ]) || (newLines.length ? plural(newLines.length, 'línea nueva', 'líneas nuevas') : 'Sin cambios en el texto');
  return { id: nextId(), artifactId: params.artifactId, headline, lines, touchedNodeIds: [] };
};

type Listener = () => void;
let last: AiChangeSummary | null = null;
const listeners = new Set<Listener>();

/** El último cambio de la IA que una tarjeta puede explicar. */
export const aiChangeStore = {
  get: (): AiChangeSummary | null => last,
  set: (summary: AiChangeSummary): void => { last = summary; listeners.forEach(listener => listener()); },
  clear: (id?: string): void => {
    if (!last || (id && last.id !== id)) return;
    last = null;
    listeners.forEach(listener => listener());
  },
  subscribe: (listener: Listener): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
