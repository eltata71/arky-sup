/**
 * Un texto reescrito, convertido en el patch mínimo sobre el IR que ya existe
 * (plan de diagramas, 1.4).
 *
 * El lienzo dibuja desde `artifact.ir`. Cuatro caminos escribían un texto nuevo
 * sin tocarlo —el copiloto al actualizar y al versionar, guardar una edición
 * del Mermaid a mano y «Mejorar con IA»—, y el servidor fusiona el parcial
 * sobre el documento guardado: el IR viejo sobrevivía y el diagrama no
 * cambiaba. Regenerar el IR desde el texto lo arreglaría a costa de lo que el
 * IR sabe y el texto no: posiciones manuales, tecnología, descripción,
 * criticidad, narrativa.
 *
 * Así que el texto nuevo se lee, se empareja con el IR actual con la misma
 * regla de identidad que la comparación (`matchDiagramIR`), y lo que difiere se
 * expresa como operaciones del motor de patches. **Sólo se toca lo que el texto
 * expresa**: elementos que aparecen o desaparecen, etiquetas, conexiones y
 * pertenencia a agrupaciones. Un campo que Mermaid no sabe escribir llega
 * vacío al leerlo, y compararlo lo borraría.
 */

import type { DiagramIR, DiagramPatchOperation } from '../../lib/diagram';
import { matchDiagramIR } from './diagramDiff';
import { applySemanticPatch } from './semanticPatchEngine';

export interface ContentReconciliation {
  readonly ir: DiagramIR;
  /** Falso cuando el texto dice lo mismo que el IR: nada que guardar. */
  readonly changed: boolean;
  /** Lo que hizo el motor, una frase por operación. */
  readonly summary: readonly string[];
}

const same = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? '').trim() === (b ?? '').trim();

export function reconcileIRWithContent(current: DiagramIR, parsed: DiagramIR): ContentReconciliation {
  const match = matchDiagramIR(current, parsed);

  const taken = new Set<string>([
    ...current.nodes.map((n) => n.id),
    ...current.edges.map((e) => e.id),
    ...current.groups.map((g) => g.id),
  ]);
  const freshId = (wanted: string): string => {
    let id = wanted;
    for (let n = 2; taken.has(id); n++) id = `${wanted}-${n}`;
    taken.add(id);
    return id;
  };

  // Id leído del texto → id en el IR actual (el del par, o el nuevo si se añade).
  const toCurrent = new Map<string, string>(match.nodes.pairs.map(([cur, next]) => [next.id, cur.id]));
  const addedNodes = match.nodes.added.map((node) => {
    const id = freshId(node.id);
    toCurrent.set(node.id, id);
    const { position: _position, ...rest } = node;
    return { ...rest, id };
  });
  const currentId = (parsedId: string) => toCurrent.get(parsedId) ?? parsedId;

  const operations: DiagramPatchOperation[] = [
    // Primero las conexiones: si se quitaran después de sus nodos, la cascada
    // ya se las habría llevado y la baja se rechazaría.
    ...match.edges.removed.map((edge): DiagramPatchOperation => ({ op: 'remove-edge', edgeId: edge.id })),
    ...match.nodes.removed.map((node): DiagramPatchOperation => ({ op: 'remove-node', nodeId: node.id })),
    ...match.nodes.pairs
      .filter(([cur, next]) => !same(cur.label, next.label))
      .map(([cur, next]): DiagramPatchOperation => ({ op: 'update-node', nodeId: cur.id, changes: { label: next.label } })),
    ...addedNodes.map((node): DiagramPatchOperation => ({ op: 'add-node', node })),
    ...match.edges.pairs
      .filter(([cur, next]) => !same(cur.label, next.label))
      .map(([cur, next]): DiagramPatchOperation => ({ op: 'update-edge', edgeId: cur.id, changes: { label: next.label } })),
    ...match.edges.added.map((edge): DiagramPatchOperation => ({
      op: 'add-edge',
      edge: { ...edge, id: freshId(edge.id), source: currentId(edge.source), target: currentId(edge.target) },
    })),
    ...match.groups.removed.map((group): DiagramPatchOperation => ({ op: 'ungroup', groupId: group.id })),
    ...match.groups.added.map((group): DiagramPatchOperation => ({
      op: 'group-nodes',
      group: { ...group, id: freshId(group.id), nodeIds: group.nodeIds.map(currentId) },
    })),
    ...match.groups.pairs.flatMap(([cur, next]): DiagramPatchOperation[] => {
      const wanted = new Set(next.nodeIds.map(currentId));
      const had = new Set(cur.nodeIds);
      const join = [...wanted].filter((id) => !had.has(id));
      const leave = [...had].filter((id) => !wanted.has(id));
      return [
        ...(join.length > 0 ? [{ op: 'add-to-group' as const, groupId: cur.id, nodeIds: join }] : []),
        ...(leave.length > 0 ? [{ op: 'remove-from-group' as const, groupId: cur.id, nodeIds: leave }] : []),
      ];
    }),
  ];

  if (operations.length === 0) return { ir: current, changed: false, summary: [] };
  const result = applySemanticPatch(current, { id: 'content-reconciliation', source: 'user', operations });
  return { ir: result.ir, changed: result.changed, summary: result.applied.map((entry) => entry.description) };
}
