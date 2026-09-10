/**
 * Deterministic document repair actions.
 *
 * These are non-destructive: existing content is preserved, and the repair
 * appends or normalises sections in place. The function returns a delta so
 * the caller can show the user exactly what changed.
 */

import type { ArtifactQualityIssue } from './artifactQualityModel';

export interface DocumentRepairChange {
  id: string;
  description: string;
}

export interface DocumentRepairResult {
  content: string;
  changes: DocumentRepairChange[];
}

const SECTION_TEMPLATES: Record<string, { heading: string; body: string }> = {
  'doc.objective': {
    heading: '## Objetivo',
    body: '> _Pendiente_: describe en 1-2 frases el objetivo principal del artefacto.',
  },
  'doc.scope': {
    heading: '## Alcance',
    body: '- **Incluye:** _Pendiente_\n- **Excluye:** _Pendiente_',
  },
  'doc.context': {
    heading: '## Contexto',
    body: '> _Pendiente_: contexto de negocio y antecedentes relevantes.',
  },
  'doc.assumptions': {
    heading: '## Supuestos',
    body: '- _Pendiente_',
  },
  'doc.risks': {
    heading: '## Riesgos',
    body: '| Riesgo | Severidad | Mitigación |\n|---|---|---|\n| _Pendiente_ | _Pendiente_ | _Pendiente_ |',
  },
  'doc.decisions': {
    heading: '## Decisiones',
    body: '- _Pendiente_: registra las decisiones tomadas con justificación.',
  },
  'doc.traceability': {
    heading: '## Trazabilidad',
    body: '| Requisito | Artefacto | Cobertura |\n|---|---|---|\n| _Pendiente_ | _Pendiente_ | _Pendiente_ |',
  },
  'doc.acceptance': {
    heading: '## Criterios de aceptación',
    body: '- [ ] _Pendiente_: criterio medible y verificable.',
  },
};

const SECTION_LABELS: Record<string, string> = {
  'doc.objective': 'Objetivo',
  'doc.scope': 'Alcance',
  'doc.context': 'Contexto',
  'doc.assumptions': 'Supuestos',
  'doc.risks': 'Riesgos',
  'doc.decisions': 'Decisiones',
  'doc.traceability': 'Trazabilidad',
  'doc.acceptance': 'Criterios de aceptación',
};

const findMissingSections = (issues: readonly ArtifactQualityIssue[]): string[] => {
  const set = new Set<string>();
  for (const issue of issues) {
    if (!issue.dimensionId) continue;
    if (issue.code.startsWith('DOC_MISSING_SECTION_') && SECTION_TEMPLATES[issue.dimensionId]) {
      set.add(issue.dimensionId);
    }
  }
  return Array.from(set);
};

const ensureH1 = (content: string, fallbackTitle: string): { content: string; changed: boolean } => {
  const lines = content.split(/\r?\n/);
  if (lines.some((line) => /^#\s+\S/.test(line))) return { content, changed: false };
  const title = fallbackTitle.trim() || 'Artefacto';
  const prefix = `# ${title}`;
  return { content: `${prefix}\n\n${content.trimStart()}`, changed: true };
};

const stripTbdMarkers = (content: string): { content: string; replaced: number } => {
  const re = /\b(TBD|TODO|FIXME|XXX|PENDIENTE)\b/gi;
  let replaced = 0;
  const next = content.replace(re, (_match) => { replaced += 1; return '_Pendiente_'; });
  return { content: next, replaced };
};

const ensureTrailingNewline = (content: string): string => (content.endsWith('\n') ? content : `${content}\n`);

/**
 * Apply deterministic repairs to the document. Operations are layered:
 *  1. Ensure there is an H1.
 *  2. Append missing canonical sections detected from issues.
 *  3. Normalise TBD/TODO/FIXME markers to "_Pendiente_".
 *  4. Add a "## Próximos pasos" trailer when no acceptance/decisions exist.
 */
export const repairDocumentContent = (params: {
  content: string;
  issues: readonly ArtifactQualityIssue[];
  artifactName?: string;
  appendNextSteps?: boolean;
}): DocumentRepairResult => {
  const changes: DocumentRepairChange[] = [];
  let working = params.content ?? '';

  const h1Result = ensureH1(working, params.artifactName ?? 'Artefacto');
  if (h1Result.changed) {
    changes.push({ id: 'doc-h1-added', description: 'Se agregó un título principal (H1).' });
    working = h1Result.content;
  }

  const missing = findMissingSections(params.issues);
  if (missing.length > 0) {
    const appendix = missing
      .map((dimensionId) => {
        const template = SECTION_TEMPLATES[dimensionId];
        return `${template.heading}\n\n${template.body}`;
      })
      .join('\n\n');
    working = `${working.trimEnd()}\n\n${appendix}\n`;
    changes.push({
      id: 'doc-sections-added',
      description: `Se agregaron secciones faltantes: ${missing.map((id) => SECTION_LABELS[id]).join(', ')}.`,
    });
  }

  const tbd = stripTbdMarkers(working);
  if (tbd.replaced > 0) {
    working = tbd.content;
    changes.push({
      id: 'doc-tbd-normalised',
      description: `Se normalizaron ${tbd.replaced} marcador(es) TBD/TODO/FIXME a "_Pendiente_".`,
    });
  }

  if (params.appendNextSteps !== false) {
    const hasNextSteps = /##\s+(pr[oó]ximos pasos|next steps)/i.test(working);
    if (!hasNextSteps) {
      working = `${working.trimEnd()}\n\n## Próximos pasos\n\n- _Pendiente_: define la siguiente acción concreta.\n`;
      changes.push({ id: 'doc-next-steps-added', description: 'Se agregó la sección "Próximos pasos".' });
    }
  }

  return { content: ensureTrailingNewline(working), changes };
};

/**
 * Build a Markdown traceability table from a list of items. Used by the
 * "generar tabla de trazabilidad" action when the artifact carries the
 * source/target data structurally but lacks the rendered table.
 */
export const buildTraceabilityTable = (
  rows: ReadonlyArray<{ requirement: string; artifact: string; coverage: string }>,
): string => {
  if (rows.length === 0) {
    return SECTION_TEMPLATES['doc.traceability'].body;
  }
  const lines = [
    '| Requisito | Artefacto | Cobertura |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.requirement} | ${r.artifact} | ${r.coverage} |`),
  ];
  return lines.join('\n');
};
