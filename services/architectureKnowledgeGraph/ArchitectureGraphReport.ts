/**
 * Plain-text report renderer for the Architecture Knowledge Graph.
 *
 * Produces a copy-paste-friendly summary used by the "Copiar reporte" action
 * in the graph panels. Pure string building — no side effects.
 */

import type {
  ArchitectureConsistencyReport,
  ArchitectureGraph,
  ArchitectureTraceabilityReport,
} from './ArchitectureKnowledgeGraphTypes';

/** Renders a human-readable report of the graph, its issues and gaps. */
export const buildArchitectureGraphReportText = (
  graph: ArchitectureGraph,
  consistency: ArchitectureConsistencyReport,
  traceability: ArchitectureTraceabilityReport,
): string => {
  const lines: string[] = [];
  lines.push('REPORTE — GRAFO DE CONOCIMIENTO ARQUITECTÓNICO');
  lines.push(`Proyecto: ${graph.projectId}`);
  lines.push(`Construido: ${graph.lastBuiltAt}`);
  lines.push(`Salud del grafo: ${graph.quality.score}/100 — ${graph.quality.summary}`);
  lines.push('');
  lines.push('ESTADÍSTICAS');
  lines.push(`- Entidades: ${graph.statistics.entityCount}`);
  lines.push(`- Relaciones: ${graph.statistics.relationCount}`);
  lines.push(`- Artefactos que aportan: ${graph.statistics.sourceArtifactCount}`);
  lines.push(`- Entidades de baja confianza: ${graph.statistics.lowConfidenceEntityCount}`);
  lines.push(`- Posibles duplicados: ${graph.statistics.candidateDuplicateCount}`);
  lines.push(`- Entidades huérfanas: ${graph.statistics.orphanEntityCount}`);

  const byType = Object.entries(graph.statistics.byEntityType).sort((a, b) => b[1] - a[1]);
  if (byType.length > 0) {
    lines.push('');
    lines.push('ENTIDADES POR TIPO');
    for (const [type, count] of byType) lines.push(`- ${type}: ${count}`);
  }

  lines.push('');
  lines.push(`INCONSISTENCIAS (${consistency.issues.length}) — veredicto: ${consistency.verdict}`);
  for (const issue of consistency.issues.slice(0, 30)) {
    lines.push(`- [${issue.severity}] ${issue.message}`);
    lines.push(`  → ${issue.recommendation}`);
  }
  if (consistency.issues.length > 30) {
    lines.push(`  … y ${consistency.issues.length - 30} más.`);
  }

  lines.push('');
  lines.push(`VACÍOS DE TRAZABILIDAD (${traceability.gaps.length})`);
  lines.push(`- Cobertura de requerimientos: ${Math.round(traceability.requirementCoverage * 100)}%`);
  lines.push(`- Cobertura de riesgos: ${Math.round(traceability.riskCoverage * 100)}%`);
  lines.push(`- Enlaces de trazabilidad: ${traceability.linkCount}`);
  for (const gap of traceability.gaps.slice(0, 25)) {
    lines.push(`- [${gap.severity}] ${gap.message}`);
  }
  if (traceability.gaps.length > 25) {
    lines.push(`  … y ${traceability.gaps.length - 25} más.`);
  }

  return lines.join('\n');
};
