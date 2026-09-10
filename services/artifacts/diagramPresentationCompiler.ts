import type { Artifact } from '../../types';
import type { DiagramIR } from '../../lib/diagram';
import { extractMermaid } from '../../utils/diagram/extractMermaid';
import type { ArtifactPresentationCallout, ArtifactPresentationDiagram } from '../../lib/artifacts/artifactPresentationModel';

export interface DiagramPresentationParts {
  diagrams: ArtifactPresentationDiagram[];
  callouts: ArtifactPresentationCallout[];
  warnings: string[];
}

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();

const extractMermaidCode = (artifact: Artifact): string | undefined => {
  const probe = extractMermaid(artifact.content ?? '', artifact.representation);
  if ('code' in probe && probe.code.trim()) return probe.code.trim();
  if (artifact.type.startsWith('mermaid') && artifact.content.trim()) return artifact.content.trim();
  return undefined;
};

const inferOrientation = (mermaid?: string): ArtifactPresentationDiagram['orientation'] => {
  if (!mermaid) return 'unknown';
  if (/\b(LR|RL)\b/.test(mermaid)) return 'LR';
  if (/\b(TD|TB|BT)\b/.test(mermaid)) return 'TD';
  return 'unknown';
};

const inferC4Level = (artifact: Artifact, mermaid?: string): ArtifactPresentationDiagram['c4Level'] => {
  const text = `${artifact.type}\n${mermaid ?? ''}`.toLowerCase();
  if (/deployment/.test(text)) return 'Deployment';
  if (/component/.test(text)) return 'Component';
  if (/container/.test(text)) return 'Container';
  if (/context|person\(|system\(/.test(text)) return 'Context';
  return undefined;
};

const inferDiagramKind = (artifact: Artifact, mermaid?: string): ArtifactPresentationDiagram['diagramKind'] => {
  const text = `${artifact.type}\n${artifact.name}\n${mermaid ?? ''}`.toLowerCase();
  if (/c4|person\(|system\(|container\(|component\(/.test(text)) return 'c4';
  if (/sequence|state|flowchart|graph|decision|inicio|fin|start|end/.test(text)) return 'process';
  if (/erd|entity|database|data|tabla|entidad/.test(text)) return 'data';
  if (/integration|api|queue|event|topic|webhook/.test(text)) return 'integration';
  return 'generic';
};

const estimateMermaidCounts = (mermaid?: string): { nodes: number; edges: number; unlabeledEdges: number } => {
  if (!mermaid) return { nodes: 0, edges: 0, unlabeledEdges: 0 };
  const edgeLines = mermaid.split(/\r?\n/).filter((line) => /-->|---|--|\.->|==>/.test(line));
  const nodeIds = new Set<string>();
  edgeLines.forEach((line) => {
    const ids = line.match(/[A-Za-z][\w-]*/g) ?? [];
    ids.filter((id) => !['graph', 'flowchart', 'subgraph', 'end', 'LR', 'TD', 'TB'].includes(id)).slice(0, 2).forEach((id) => nodeIds.add(id));
  });
  const standaloneNodes = mermaid.match(/^\s*[A-Za-z][\w-]*\s*(\[|\(|\{|\[\[)/gm) ?? [];
  standaloneNodes.forEach((line) => nodeIds.add((line.match(/[A-Za-z][\w-]*/)?.[0] ?? '').trim()));
  const unlabeledEdges = edgeLines.filter((line) => !/\|[^|]+\||:\s*[^\]]+/.test(line)).length;
  return { nodes: nodeIds.size, edges: edgeLines.length, unlabeledEdges };
};

const densityFor = (nodes: number, edges: number): ArtifactPresentationDiagram['density'] => {
  const total = nodes + edges;
  if (total <= 8) return 'simple';
  if (total <= 24) return 'balanced';
  if (total <= 45) return 'detailed';
  return 'overloaded';
};

const legendFor = (kind: ArtifactPresentationDiagram['diagramKind'], ir?: DiagramIR): ArtifactPresentationDiagram['legend'] => {
  const kinds = Array.from(new Set((ir?.nodes ?? []).map((node) => node.kind).filter(Boolean))).slice(0, 6);
  if (kinds.length > 0) {
    return kinds.map((kindValue, index) => ({ id: `legend-${index + 1}`, label: kindValue, meaning: `Elemento de tipo ${kindValue}`, tone: 'primary' as const }));
  }
  if (kind === 'c4') return [
    { id: 'legend-actor', label: 'Actor', meaning: 'Persona o sistema externo que interactúa con la solución.', tone: 'primary' },
    { id: 'legend-system', label: 'Sistema/Contenedor', meaning: 'Límite arquitectónico relevante para la decisión.', tone: 'neutral' },
    { id: 'legend-relation', label: 'Relación', meaning: 'Dependencia, integración o flujo entre elementos.', tone: 'success' },
  ];
  if (kind === 'process') return [
    { id: 'legend-step', label: 'Paso', meaning: 'Actividad dentro del flujo.', tone: 'primary' },
    { id: 'legend-decision', label: 'Decisión', meaning: 'Punto de bifurcación o validación.', tone: 'warning' },
  ];
  return [{ id: 'legend-node', label: 'Nodo', meaning: 'Elemento arquitectónico o de negocio representado.', tone: 'primary' }];
};

export const compileDiagramPresentation = (artifact: Artifact): DiagramPresentationParts => {
  const mermaid = extractMermaidCode(artifact);
  const ir = artifact.ir;
  const counts = ir ? { nodes: ir.nodes.length, edges: ir.edges.length, unlabeledEdges: ir.edges.filter((edge) => !edge.label?.trim()).length } : estimateMermaidCounts(mermaid);
  const kind = inferDiagramKind(artifact, mermaid);
  const c4Level = inferC4Level(artifact, mermaid);
  const density = densityFor(counts.nodes, counts.edges);
  const legend = legendFor(kind, ir);
  const warnings: string[] = [];

  if (counts.nodes === 0) warnings.push('El diagrama no tiene nodos detectables; no está listo para publicación profesional.');
  if (counts.unlabeledEdges > 0) warnings.push('Existen relaciones sin etiqueta; agrega intención, protocolo o dato transportado.');
  if (density === 'overloaded') warnings.push('El diagrama está sobrecargado; considera dividirlo por dominios, lanes o niveles C4.');
  if (kind === 'c4' && !(ir?.nodes ?? []).some((node) => /person|actor|external/i.test(`${node.kind} ${node.label}`)) && !/Person\(/.test(mermaid ?? '')) {
    warnings.push('Diagrama C4 sin actores externos explícitos.');
  }

  const diagram: ArtifactPresentationDiagram = {
    id: `${artifact.id}-diagram`,
    title: ir?.metadata?.title ?? artifact.name,
    purpose: artifact.objective || `Explicar ${artifact.name} para revisión ${artifact.audience ?? 'technical'}.`,
    mermaid,
    ir,
    legend,
    readingNotes: [
      kind === 'c4' && c4Level ? `Nivel C4 detectado: ${c4Level}. Lea de actores externos hacia límites internos.` : 'Lea el diagrama desde el origen del flujo hacia sus dependencias.',
      counts.edges > 0 ? 'Las relaciones describen interacción, dependencia o flujo entre nodos.' : 'No se detectaron relaciones; valide si es un inventario o falta conectividad.',
      inferOrientation(mermaid) === 'unknown' ? 'Orientación no declarada; LR suele funcionar para integración y TD para procesos.' : `Orientación detectada: ${inferOrientation(mermaid)}.`,
    ].filter(Boolean),
    density,
    orientation: inferOrientation(mermaid),
    exportSafe: counts.nodes > 0 && density !== 'overloaded',
    nodeCount: counts.nodes,
    edgeCount: counts.edges,
    c4Level,
    diagramKind: kind,
    executiveSummary: `${artifact.name} resume ${counts.nodes} elemento(s) y ${counts.edges} relación(es) para facilitar revisión y alineamiento.`,
    technicalSummary: `Tipo ${artifact.type}; fuente ${ir ? 'IR canónico' : mermaid ? 'Mermaid' : 'contenido no estructurado'}; densidad ${density}.`,
  };

  const callouts: ArtifactPresentationCallout[] = warnings.map((warning, index) => ({
    id: `diagram-warning-${index + 1}`,
    type: 'warning',
    title: 'Advertencia visual',
    content: normalize(warning),
    severity: warning.includes('no tiene nodos') ? 'critical' : 'medium',
  }));

  return { diagrams: [diagram], callouts, warnings };
};
