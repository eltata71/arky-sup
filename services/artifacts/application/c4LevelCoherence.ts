/**
 * Coherencia entre niveles C4 (plan de diagramas, 4.2).
 *
 * Con la 4.1 un nodo de contexto puede declarar qué diagrama de contenedores
 * lo detalla. Esta puerta comprueba que el detalle cuente la misma historia:
 * los contenedores deben aparecer dentro del sistema que el nivel de arriba
 * dice que detallan. Si el contexto habla de «Core de pólizas» y el diagrama
 * de contenedores dibuja su API fuera de ese límite —o no tiene ningún límite
 * con ese nombre—, los dos niveles ya no describen el mismo sistema.
 *
 * Tres decisiones:
 *
 * 1. **Avisa y no bloquea.** Un aviso con la referencia al nodo, en el panel de
 *    calidad; no baja la puntuación ni llega al preflight de exportación. Un
 *    diagrama a medio hacer es un estado legítimo.
 * 2. **El nombre lo decide el grafo de conocimiento.** Si el límite del
 *    detalle y el nodo de arriba son «el mismo sistema» lo responde
 *    `isSameEntityName`, la regla con la que el grafo consolida entidades
 *    (sin acentos, sin mayúsculas, singular y plural). Una segunda definición
 *    de «el mismo nombre» sería una que acaba discrepando del grafo.
 * 3. **Los tipos C4 se leen del texto.** La migración del IR normaliza
 *    `Container` a un tipo genérico; el texto Mermaid C4 es la fuente, y el IR
 *    guardado sólo se usa si el texto no se puede leer.
 *
 * También se informan aquí los enlaces de detalle rotos del propio diagrama:
 * lo roto se informa, nunca se descarta.
 */

import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR } from '../../../lib/diagram';
import { isSameEntityName } from '../../architectureKnowledgeGraph/ArchitectureGraphNormalization';
import { resolveEditableDiagramIR, type DiagramQualityReport } from '../../diagram';
import { c4LevelOf, resolveDetailLinks } from './diagramDetailLinks';

export type C4CoherenceCode =
  | 'C4_DETAIL_PARENT_MISSING'
  | 'C4_ELEMENT_OUTSIDE_PARENT'
  | 'C4_DETAIL_LINK_BROKEN';

export interface C4CoherenceWarning {
  readonly code: C4CoherenceCode;
  /** El nodo al que se refiere el aviso: en este diagrama, o en el de arriba. */
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly message: string;
  readonly recommendation: string;
}

type ProjectArtifact = Pick<Artifact, 'id' | 'versionGroupId' | 'version' | 'name' | 'type' | 'content' | 'representation' | 'ir'>;

/** Qué elementos deben caer dentro del límite, según el nivel del detalle. */
const LEVEL_ELEMENTS = {
  container: { kind: /^container(db|queue)?$/i, semanticType: 'c4-container', noun: 'contenedor' },
  component: { kind: /^component(db|queue)?$/i, semanticType: 'component', noun: 'componente' },
} as const;

/** El texto C4 primero: conserva `Container`, que la migración del IR borra. */
const readC4IR = (artifact: ProjectArtifact): DiagramIR | null =>
  resolveEditableDiagramIR({ type: artifact.type, representation: artifact.representation, content: artifact.content, ir: undefined })
  ?? resolveEditableDiagramIR(artifact);

const latestByGroup = (artifacts: readonly ProjectArtifact[]): ProjectArtifact[] => {
  const latest = new Map<string, ProjectArtifact>();
  for (const candidate of artifacts) {
    const groupId = candidate.versionGroupId || candidate.id;
    const current = latest.get(groupId);
    if (!current || candidate.version > current.version) latest.set(groupId, candidate);
  }
  return [...latest.values()];
};

/** Los nodos de otros diagramas del proyecto que dicen detallarse en éste. */
const findParents = (artifact: ProjectArtifact, artifacts: readonly ProjectArtifact[]) => {
  const ownGroup = artifact.versionGroupId || artifact.id;
  const parents: Array<{ artifact: ProjectArtifact; nodeId: string; label: string }> = [];
  for (const candidate of latestByGroup(artifacts)) {
    if ((candidate.versionGroupId || candidate.id) === ownGroup) continue;
    for (const node of candidate.ir?.nodes ?? []) {
      if (node.detailArtifactGroupId === ownGroup) parents.push({ artifact: candidate, nodeId: node.id, label: node.label });
    }
  }
  return parents;
};

/**
 * Los avisos de coherencia de `artifact` frente a los niveles que lo enlazan,
 * más los enlaces de detalle rotos que él mismo tenga.
 */
export const assessC4LevelCoherence = (
  artifact: ProjectArtifact,
  artifacts: readonly ProjectArtifact[],
): C4CoherenceWarning[] => {
  const warnings: C4CoherenceWarning[] = [];

  for (const link of resolveDetailLinks(artifact.ir, artifacts)) {
    if (link.status !== 'broken') continue;
    warnings.push({
      code: 'C4_DETAIL_LINK_BROKEN',
      nodeId: link.nodeId,
      nodeLabel: link.nodeLabel,
      message: `«${link.nodeLabel}» enlaza a un diagrama de detalle que ya no está en el proyecto.`,
      recommendation: 'Cambia o quita el enlace en «Niveles C4».',
    });
  }

  const level = c4LevelOf(artifact.type);
  const rule = level === 'container' || level === 'component' ? LEVEL_ELEMENTS[level] : null;
  if (!rule) return warnings;
  const parents = findParents(artifact, artifacts);
  if (parents.length === 0) return warnings;
  const ir = readC4IR(artifact);
  if (!ir) return warnings;

  const elements = ir.nodes.filter((node) => rule.kind.test(node.kind ?? '') || node.semanticType === rule.semanticType);
  for (const parent of parents) {
    const boundaries = ir.groups.filter((group) => isSameEntityName(group.label, parent.label));
    if (boundaries.length === 0) {
      warnings.push({
        code: 'C4_DETAIL_PARENT_MISSING',
        nodeId: parent.nodeId,
        nodeLabel: parent.label,
        message: `«${parent.artifact.name}» dice que este diagrama detalla «${parent.label}», pero ningún límite de este diagrama se llama así.`,
        recommendation: `Agrupa los ${rule.noun}es en un límite llamado «${parent.label}», o revisa el enlace en «${parent.artifact.name}».`,
      });
      continue;
    }
    const inside = new Set(boundaries.flatMap((group) => group.nodeIds));
    for (const element of elements) {
      if (inside.has(element.id) || boundaries.some((group) => element.group === group.id || element.group === group.label)) continue;
      warnings.push({
        code: 'C4_ELEMENT_OUTSIDE_PARENT',
        nodeId: element.id,
        nodeLabel: element.label,
        message: `El ${rule.noun} «${element.label}» no aparece dentro de «${parent.label}», el sistema que detalla este diagrama según «${parent.artifact.name}».`,
        recommendation: `Muévelo dentro del límite «${parent.label}», o márcalo como externo si no le pertenece.`,
      });
    }
  }
  return warnings;
};

type DiagramLintIssue = DiagramQualityReport['issues'][number];

const SEVERITY: Record<C4CoherenceCode, DiagramLintIssue['severity']> = {
  C4_DETAIL_PARENT_MISSING: 'medium',
  C4_ELEMENT_OUTSIDE_PARENT: 'medium',
  C4_DETAIL_LINK_BROKEN: 'low',
};

/** Los avisos, en la forma del informe de calidad. El id lleva el nodo. */
export const toC4CoherenceIssues = (warnings: readonly C4CoherenceWarning[]): DiagramLintIssue[] =>
  warnings.map((warning) => ({
    id: `c4-coherence:${warning.code}:${warning.nodeId}`,
    code: warning.code,
    severity: SEVERITY[warning.code],
    message: warning.message,
    recommendation: warning.recommendation,
    fixable: false,
  }));

/**
 * El informe de calidad con los avisos de coherencia añadidos al final. No
 * toca la puntuación ni la puerta visual: es un aviso, no una penalización. Un
 * informe ausente se queda ausente — sin diagrama pintado no hay panel.
 */
export const withC4Coherence = (
  report: DiagramQualityReport | null,
  warnings: readonly C4CoherenceWarning[],
): DiagramQualityReport | null => {
  if (!report || warnings.length === 0) return report;
  return { ...report, issues: [...report.issues, ...toC4CoherenceIssues(warnings)] };
};
