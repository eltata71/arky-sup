/**
 * Navegar de un nivel C4 al siguiente (plan de diagramas, 4.1).
 *
 * El conjunto de diagramas de un proyecto era una colección de imágenes: el
 * contexto nombraba un sistema y nada llevaba del sistema a sus contenedores.
 * Un nodo puede ahora declarar qué artefacto lo detalla, y el lienzo lo abre
 * con un doble clic.
 *
 * Cuatro reglas, las del portafolio:
 *
 * 1. **Un enlace es un id, nunca un nombre.** Se guarda el `versionGroupId`
 *    del artefacto de detalle: sobrevive a sus versiones nuevas y abre siempre
 *    la última.
 * 2. **Sólo se enlaza lo que existe.** El selector ofrece los diagramas del
 *    proyecto y el plan rechaza cualquier otro id, así que no hay forma de
 *    escribir un enlace a la nada.
 * 3. **Un enlace roto se informa, nunca se descarta.** Si el artefacto de
 *    detalle desaparece, el enlace sigue en el nodo y se lista como roto hasta
 *    que alguien lo cambie o lo quite.
 * 4. **Se guarda pasando por el motor de patches**, como versión nueva con su
 *    nota: un `update-node` más, visible en el historial.
 *
 * Nada aquí escribe: el lienzo versiona con lo que devuelve `planDetailLink`.
 */

import type { ArtifactType } from '../../../types';
import type { Artifact, ArtifactChangeNote } from '../../../lib/artifacts';
import { isDiagramArtifactType, isHybridArtifactType } from '../../../lib/artifacts/artifactKind';
import type { DiagramIR, DiagramPatch } from '../../../lib/diagram';
import { applySemanticPatch, resolveEditableDiagramIR } from '../../diagram';

export type C4Level = 'context' | 'container' | 'component' | 'deployment';

const C4_LEVEL_BY_TYPE: Partial<Record<ArtifactType, C4Level>> = {
  'mermaid-c4-context': 'context',
  'mermaid-c4-container': 'container',
  'mermaid-c4-component': 'component',
  'mermaid-c4-deployment': 'deployment',
};

/** El nivel que detalla a cada uno. Componentes y despliegue no tienen siguiente. */
const NEXT_LEVEL: Partial<Record<C4Level, C4Level>> = {
  context: 'container',
  container: 'component',
};

export const C4_LEVEL_LABEL: Record<C4Level, string> = {
  context: 'C4 · Contexto',
  container: 'C4 · Contenedores',
  component: 'C4 · Componentes',
  deployment: 'C4 · Despliegue',
};

export const c4LevelOf = (type: ArtifactType | string): C4Level | null =>
  C4_LEVEL_BY_TYPE[type as ArtifactType] ?? null;

/** El nivel C4 que se espera debajo de este artefacto, si lo hay. */
export const expectedDetailLevel = (type: ArtifactType | string): C4Level | null => {
  const level = c4LevelOf(type);
  return level ? NEXT_LEVEL[level] ?? null : null;
};

type LinkableSource = Pick<Artifact, 'id' | 'versionGroupId' | 'version' | 'name' | 'type'>;

export interface DetailLinkCandidate {
  readonly groupId: string;
  /** La última versión del grupo: la que se abre. */
  readonly artifactId: string;
  readonly name: string;
  readonly type: ArtifactType;
  /** «C4 · Contenedores», o null si no es un diagrama C4. */
  readonly levelLabel: string | null;
  /** Es el nivel C4 que se espera debajo del diagrama actual. */
  readonly recommended: boolean;
}

const isLinkableDiagram = (type: ArtifactType | string): boolean =>
  isDiagramArtifactType(type) || isHybridArtifactType(type);

/** La última versión de cada grupo de artefactos del proyecto. */
const latestByGroup = (artifacts: readonly LinkableSource[]): Map<string, LinkableSource> => {
  const latest = new Map<string, LinkableSource>();
  for (const candidate of artifacts) {
    const groupId = candidate.versionGroupId || candidate.id;
    const current = latest.get(groupId);
    if (!current || candidate.version > current.version) latest.set(groupId, candidate);
  }
  return latest;
};

/**
 * Los diagramas del proyecto que pueden detallar un nodo de `source`: la
 * última versión de cada uno, sin el propio diagrama, con el nivel C4 que se
 * espera debajo primero.
 */
export const listDetailLinkCandidates = (
  source: Pick<Artifact, 'id' | 'versionGroupId' | 'type'>,
  artifacts: readonly LinkableSource[],
): DetailLinkCandidate[] => {
  const ownGroup = source.versionGroupId || source.id;
  const expected = expectedDetailLevel(source.type);
  const candidates: DetailLinkCandidate[] = [];
  for (const [groupId, latest] of latestByGroup(artifacts)) {
    if (groupId === ownGroup || !isLinkableDiagram(latest.type)) continue;
    const level = c4LevelOf(latest.type);
    candidates.push({
      groupId,
      artifactId: latest.id,
      name: latest.name,
      type: latest.type,
      levelLabel: level ? C4_LEVEL_LABEL[level] : null,
      recommended: expected !== null && level === expected,
    });
  }
  return candidates.sort((a, b) =>
    Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name, 'es'));
};

export type NodeDetailLink =
  | {
      readonly status: 'resolved';
      readonly nodeId: string;
      readonly nodeLabel: string;
      readonly groupId: string;
      readonly target: { readonly artifactId: string; readonly name: string; readonly type: ArtifactType };
    }
  | {
      /** El artefacto enlazado ya no está en el proyecto. Se informa; el enlace sigue. */
      readonly status: 'broken';
      readonly nodeId: string;
      readonly nodeLabel: string;
      readonly groupId: string;
    };

/** Cada enlace de detalle del diagrama, resuelto contra el proyecto. */
export const resolveDetailLinks = (
  ir: Pick<DiagramIR, 'nodes'> | null | undefined,
  artifacts: readonly LinkableSource[],
): NodeDetailLink[] => {
  if (!ir?.nodes?.length) return [];
  const latest = latestByGroup(artifacts);
  const links: NodeDetailLink[] = [];
  for (const node of ir.nodes) {
    const groupId = node.detailArtifactGroupId?.trim();
    if (!groupId) continue;
    const target = latest.get(groupId);
    links.push(target
      ? {
          status: 'resolved',
          nodeId: node.id,
          nodeLabel: node.label,
          groupId,
          target: { artifactId: target.id, name: target.name, type: target.type },
        }
      : { status: 'broken', nodeId: node.id, nodeLabel: node.label, groupId });
  }
  return links;
};

/**
 * El enlace de un nodo concreto, para el doble clic. Lee `artifact.ir` y no
 * reconstruye el IR desde el texto: un artefacto sin IR todavía no ha
 * guardado ningún enlace.
 */
export const resolveNodeDetailLink = (
  artifact: Pick<Artifact, 'ir'>,
  nodeId: string,
  artifacts: readonly LinkableSource[],
): NodeDetailLink | null => {
  const node = artifact.ir?.nodes?.find((candidate) => candidate.id === nodeId);
  if (!node?.detailArtifactGroupId) return null;
  return resolveDetailLinks({ nodes: [node] }, artifacts)[0] ?? null;
};

export type DetailLinkPlan =
  | { readonly kind: 'version'; readonly draft: Artifact; readonly summary: string }
  | { readonly kind: 'no-change' }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Lo que se guarda al enlazar (o desenlazar, con `targetGroupId: null`) un
 * nodo. El cambio pasa por `applySemanticPatch` sobre el IR completo, igual
 * que «Modificar diagrama», y se guarda como versión nueva con su nota.
 *
 * El texto del artefacto no se toca: el enlace no tiene representación en
 * Mermaid, y regenerar el código desde el IR cambiaría un texto que nadie
 * pidió cambiar.
 */
export const planDetailLink = (params: {
  readonly artifact: Artifact;
  readonly nodeId: string;
  readonly targetGroupId: string | null;
  readonly artifacts: readonly LinkableSource[];
  readonly now?: () => string;
}): DetailLinkPlan => {
  const { artifact, nodeId, targetGroupId, artifacts } = params;
  const now = params.now ?? (() => new Date().toISOString());
  const ir = resolveEditableDiagramIR(artifact);
  if (!ir) return { kind: 'refused', reason: 'Este artefacto no tiene un diagrama que se pueda enlazar.' };
  const node = ir.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { kind: 'refused', reason: 'El nodo ya no existe en el diagrama.' };

  let target: DetailLinkCandidate | undefined;
  if (targetGroupId !== null) {
    if (targetGroupId === (artifact.versionGroupId || artifact.id)) {
      return { kind: 'refused', reason: 'Un diagrama no puede ser el detalle de sí mismo.' };
    }
    target = listDetailLinkCandidates(artifact, artifacts).find((candidate) => candidate.groupId === targetGroupId);
    if (!target) return { kind: 'refused', reason: 'Sólo se puede enlazar un diagrama que exista en este proyecto.' };
  }

  // `update-node` da por cambiado un nodo aunque el valor sea el mismo, así
  // que el caso sin cambios se decide aquí: si no, un clic de más crearía una
  // versión idéntica a la anterior.
  if ((node.detailArtifactGroupId ?? null) === targetGroupId) return { kind: 'no-change' };

  const patch: DiagramPatch = {
    id: `detail-link-${nodeId}`,
    source: 'user',
    operations: [{ op: 'update-node', nodeId, changes: { detailArtifactGroupId: targetGroupId ?? undefined } }],
  };
  const result = applySemanticPatch(ir, patch);
  if (!result.changed) {
    return { kind: 'refused', reason: result.rejected[0]?.message ?? 'No se pudo guardar el enlace.' };
  }
  // Quitar un enlace deja la clave en `undefined`; se borra para que el IR
  // guardado no arrastre un campo vacío.
  const nextIR: DiagramIR = {
    ...result.ir,
    nodes: result.ir.nodes.map((candidate) => {
      if (candidate.id !== nodeId || candidate.detailArtifactGroupId !== undefined) return candidate;
      const { detailArtifactGroupId: _cleared, ...rest } = candidate;
      return rest;
    }),
  };

  const summary = target
    ? `«${node.label}» se detalla en «${target.name}».`
    : `«${node.label}» ya no enlaza a un diagrama de detalle.`;
  const changeNote: ArtifactChangeNote = {
    kind: 'diagram-patch',
    basedOnVersion: artifact.version,
    changes: [summary],
    at: now(),
  };
  return { kind: 'version', draft: { ...artifact, ir: nextIR, changeNote }, summary };
};

export interface DetailLinkRow {
  readonly nodeId: string;
  readonly label: string;
  readonly link: NodeDetailLink | null;
}

/**
 * Lo que muestra el panel: cada nodo del diagrama completo —no de la vista de
 * una audiencia, que omite nodos— con su enlace, resuelto o roto.
 */
export const describeDetailLinks = (
  artifact: Pick<Artifact, 'type' | 'content' | 'representation' | 'ir'>,
  artifacts: readonly LinkableSource[],
): { readonly hasDiagram: boolean; readonly rows: readonly DetailLinkRow[] } => {
  const ir = resolveEditableDiagramIR(artifact);
  if (!ir) return { hasDiagram: false, rows: [] };
  const links = new Map(resolveDetailLinks(ir, artifacts).map((link) => [link.nodeId, link] as const));
  return {
    hasDiagram: true,
    rows: ir.nodes.map((node) => ({ nodeId: node.id, label: node.label, link: links.get(node.id) ?? null })),
  };
};

export interface C4TrailStep {
  readonly artifactId: string;
  readonly name: string;
  readonly levelLabel: string | null;
}

export interface C4Navigation {
  /** De la raíz al diagrama actual, que es el último paso. */
  readonly trail: readonly C4TrailStep[];
  /** Los nodos de este diagrama cuyo detalle se puede abrir. */
  readonly enterable: readonly { readonly nodeId: string; readonly label: string; readonly artifactId: string; readonly targetName: string }[];
  /** El diagrama del nivel de arriba, si alguno enlaza a éste. */
  readonly parentArtifactId: string | null;
}

/**
 * Dónde está un diagrama en la cadena de niveles (plan de clase mundial, 12.3).
 *
 * El camino de vuelta se **deriva** de los enlaces de detalle —el padre es el
 * diagrama cuyo nodo declara el grupo de éste—, nunca se guarda: un segundo
 * registro de «quién es mi padre» sería el que se queda viejo. Si dos
 * diagramas lo reclaman gana el de nivel más alto y, a igualdad, el primero
 * por nombre; un ciclo corta la cadena en vez de recorrerla sin fin.
 */
export const describeC4Navigation = (
  artifact: Pick<Artifact, 'id' | 'versionGroupId' | 'name' | 'type' | 'ir'>,
  artifacts: readonly (LinkableSource & Pick<Artifact, 'ir'>)[],
): C4Navigation => {
  const latest = latestByGroup(artifacts) as Map<string, LinkableSource & Pick<Artifact, 'ir'>>;
  const LEVEL_RANK: Record<C4Level, number> = { context: 0, container: 1, component: 2, deployment: 3 };
  const step = (a: Pick<Artifact, 'id' | 'name' | 'type'>): C4TrailStep => {
    const level = c4LevelOf(a.type);
    return { artifactId: a.id, name: a.name, levelLabel: level ? C4_LEVEL_LABEL[level] : null };
  };
  const parentOf = (groupId: string, seen: Set<string>) => {
    const parents = [...latest.entries()]
      .filter(([g, a]) => !seen.has(g) && a.ir?.nodes?.some((n) => n.detailArtifactGroupId?.trim() === groupId))
      .map(([, a]) => a);
    return parents.sort((a, b) =>
      (LEVEL_RANK[c4LevelOf(a.type) ?? 'deployment']) - (LEVEL_RANK[c4LevelOf(b.type) ?? 'deployment'])
      || a.name.localeCompare(b.name, 'es'))[0] ?? null;
  };

  const ownGroup = artifact.versionGroupId || artifact.id;
  const seen = new Set<string>([ownGroup]);
  const ancestors: C4TrailStep[] = [];
  let parentArtifactId: string | null = null;
  let group = ownGroup;
  for (let parent = parentOf(group, seen); parent; parent = parentOf(group, seen)) {
    group = parent.versionGroupId || parent.id;
    seen.add(group);
    ancestors.unshift(step(parent));
    parentArtifactId ??= parent.id;
  }

  const enterable = resolveDetailLinks(artifact.ir, artifacts).flatMap((link) =>
    link.status === 'resolved'
      ? [{ nodeId: link.nodeId, label: link.nodeLabel, artifactId: link.target.artifactId, targetName: link.target.name }]
      : []);
  return { trail: [...ancestors, step(artifact)], enterable, parentArtifactId };
};
