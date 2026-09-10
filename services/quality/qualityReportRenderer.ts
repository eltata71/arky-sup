/**
 * Render an ArtifactQualityReport as a Markdown block that can be appended to
 * a DOCX/PDF/HTML export when the user opts in to "include quality report".
 */

import {
  tierLabel,
  type ArtifactQualityReport,
  type ArtifactQualityDimension,
} from './artifactQualityModel';

const dimensionGroupLabel = (scope: ArtifactQualityDimension['scope']): string => {
  switch (scope) {
    case 'document': return 'Documento';
    case 'diagram': return 'Diagrama';
    case 'table': return 'Tablas';
    case 'matrix': return 'Matrices';
    case 'traceability': return 'Trazabilidad';
    case 'hybrid': return 'Híbrido';
    case 'export': return 'Exportación';
  }
};

export const renderQualityReportMarkdown = (report: ArtifactQualityReport): string => {
  const lines: string[] = [];
  lines.push('## Reporte de calidad');
  lines.push('');
  lines.push(`- **Puntaje global**: ${report.score.value}/100 — ${tierLabel(report.score.tier)}`);
  lines.push(`- **Perfil aplicado**: ${report.profile.label}`);
  lines.push(`- **Evaluado**: ${new Date(report.evaluatedAt).toLocaleString()}`);
  if (report.document) {
    lines.push(`- **Documento**: ${report.document.score}/100 · ${report.document.wordCount} palabras`);
  }
  if (report.diagram) {
    lines.push(`- **Diagrama**: ${report.diagram.score}/100 · ${report.diagram.issueCount} hallazgo(s)`);
  }
  if (report.tables) {
    lines.push(`- **Tablas**: ${report.tables.count} detectadas · ${(report.tables.completeness * 100).toFixed(0)}% completas`);
  }
  lines.push('');
  lines.push('### Dimensiones evaluadas');
  lines.push('');
  lines.push('| Dimensión | Ámbito | Score | Peso |');
  lines.push('|---|---|---|---|');
  for (const d of report.dimensions) {
    lines.push(`| ${d.label} | ${dimensionGroupLabel(d.scope)} | ${d.score}/100 | ${d.weight} |`);
  }
  lines.push('');

  if (report.issues.length > 0) {
    lines.push('### Hallazgos');
    lines.push('');
    for (const issue of report.issues.slice(0, 12)) {
      lines.push(`- **[${issue.severity.toUpperCase()}]** ${issue.message}`);
      lines.push(`  - _Recomendación_: ${issue.recommendation}`);
    }
    lines.push('');
  }

  if (report.recommendations.length > 0) {
    lines.push('### Próximos pasos');
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`- **${rec.title}** — ${rec.detail}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};
