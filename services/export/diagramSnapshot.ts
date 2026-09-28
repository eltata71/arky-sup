/**
 * El diagrama tal como lo ve la persona, en la forma que necesita un PDF
 * vectorial (plan de diagramas, 2.4).
 *
 * Se toma del lienzo y no se recalcula: el layout de pantalla puede venir de
 * ELK, de posiciones movidas a mano o de un ajuste del usuario, y un PDF que
 * dibujara otra disposición sería otro diagrama con el mismo nombre.
 *
 * Tipos estructurales a propósito: este fichero no importa ReactFlow ni el
 * pipeline de diagramas, porque `services/export` está en el arranque.
 */

export interface DiagramSnapshotNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DiagramSnapshotEdge {
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly dashed: boolean;
}

export interface DiagramSnapshot {
  readonly nodes: readonly DiagramSnapshotNode[];
  readonly edges: readonly DiagramSnapshotEdge[];
  /** El resumen accesible, en párrafos: la segunda página del PDF. */
  readonly summary: readonly string[];
  /** La marca, cuando el artefacto viaja en un paquete que la declara (2.3). */
  readonly owner?: string;
  readonly confidentiality?: string;
}

interface FlowNodeLike {
  id: string;
  position?: { x: number; y: number };
  positionAbsolute?: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  data?: unknown;
}

interface FlowEdgeLike {
  source: string;
  target: string;
  label?: unknown;
  animated?: boolean;
  style?: { strokeDasharray?: string | number };
  data?: unknown;
}

const DEFAULT_W = 160;
const DEFAULT_H = 64;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const field = (data: unknown, key: string): unknown =>
  data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** De los nodos y conexiones del lienzo a la instantánea. `null` si no hay nada que dibujar. */
export function snapshotFromFlow(
  nodes: readonly FlowNodeLike[],
  edges: readonly FlowEdgeLike[],
  summary: readonly string[] = [],
): DiagramSnapshot | null {
  const drawn = nodes
    .map((node): DiagramSnapshotNode | null => {
      const at = node.positionAbsolute ?? node.position;
      if (!at || !finite(at.x) || !finite(at.y)) return null;
      return {
        id: node.id,
        label: text(field(node.data, 'label')) || node.id,
        x: at.x,
        y: at.y,
        width: finite(node.width) && node.width > 0 ? node.width : DEFAULT_W,
        height: finite(node.height) && node.height > 0 ? node.height : DEFAULT_H,
      };
    })
    .filter((node): node is DiagramSnapshotNode => node !== null);
  if (drawn.length === 0) return null;

  const ids = new Set(drawn.map((node) => node.id));
  return {
    nodes: drawn,
    edges: edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        label: text(edge.label) || text(field(edge.data, 'label')),
        dashed: Boolean(edge.animated || edge.style?.strokeDasharray || field(edge.data, 'relation') === 'async'),
      })),
    summary,
  };
}
