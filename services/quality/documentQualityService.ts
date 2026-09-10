/**
 * Document quality scoring.
 *
 * Pure-TS heuristics (no AI) that look at a Markdown/plain-text document and
 * produce per-dimension scores + issues. Used for documents, hybrids and the
 * "document layer" of any artifact that carries narrative content.
 *
 * Heuristics intentionally err on the side of leniency: missing optional
 * sections degrade the score gradually rather than failing the artifact.
 */

import { parseMarkdownTables, type MarkdownTable } from '../../lib/markdownTables';
import type {
  ArtifactQualityIssue,
  ArtifactQualityScope,
} from './artifactQualityModel';

export interface DocumentDimensionScores {
  readonly [dimensionId: string]: number;
}

export interface DocumentQualitySnapshot {
  scores: DocumentDimensionScores;
  issues: ArtifactQualityIssue[];
  wordCount: number;
  hasStructure: boolean;
  tables: MarkdownTable[];
  tableCompleteness: number;
}

const clamp = (n: number, min = 0, max = 100): number => Math.max(min, Math.min(max, n));

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/gm;

const SECTION_KEYWORDS = {
  objective: [
    'objetivo', 'objetivos', 'objective', 'goal', 'goals', 'proposito', 'propósito', 'purpose',
  ],
  scope: ['alcance', 'scope', 'in scope', 'fuera de alcance', 'out of scope'],
  context: ['contexto', 'context', 'background', 'antecedentes'],
  assumptions: ['supuestos', 'assumptions', 'premisas'],
  risks: ['riesgos', 'risks', 'mitigaciones', 'mitigation'],
  decisions: ['decisiones', 'decisions', 'adr', 'architecture decision'],
  traceability: ['trazabilidad', 'traceability', 'matriz de trazabilidad'],
  acceptance: ['criterios de aceptación', 'criterios de aceptacion', 'acceptance criteria', 'definition of done', 'dod'],
  glossary: ['glosario', 'glossary', 'ubiquitous language'],
};

type SectionKey = keyof typeof SECTION_KEYWORDS;

const norm = (value: string): string => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const detectSections = (content: string): Record<SectionKey, boolean> => {
  const haystackHeadings: string[] = [];
  const re = /^(#{1,6})\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) haystackHeadings.push(norm(match[2]));
  const haystackBody = norm(content);

  const detect = (terms: readonly string[]): boolean => {
    const normalisedTerms = terms.map(norm);
    if (haystackHeadings.some((h) => normalisedTerms.some((t) => h.includes(t)))) return true;
    return normalisedTerms.some((t) => haystackBody.includes(`**${t}`)
      || haystackBody.includes(`${t}:`)
      || haystackBody.includes(`${t} `));
  };

  const result = {} as Record<SectionKey, boolean>;
  (Object.keys(SECTION_KEYWORDS) as SectionKey[]).forEach((key) => {
    result[key] = detect(SECTION_KEYWORDS[key]);
  });
  return result;
};

const countHeadings = (content: string): { total: number; h1: number; h2plus: number } => {
  let total = 0;
  let h1 = 0;
  let h2plus = 0;
  let match: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((match = HEADING_RE.exec(content)) !== null) {
    total += 1;
    if (match[1].length === 1) h1 += 1;
    else h2plus += 1;
  }
  return { total, h1, h2plus };
};

const wordCount = (content: string): number => {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
};

const sentenceLengths = (content: string): number[] => {
  const stripped = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\|.*\|/g, ' ');
  return stripped
    .split(/[.!?]+/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 0);
};

const tableCompletenessRatio = (tables: MarkdownTable[]): number => {
  if (tables.length === 0) return 1;
  let totalCells = 0;
  let filled = 0;
  for (const table of tables) {
    for (const row of table.rows) {
      for (const cell of row) {
        totalCells += 1;
        const trimmed = (cell ?? '').trim();
        if (trimmed && trimmed !== '-' && trimmed.toLowerCase() !== 'n/a') filled += 1;
      }
    }
  }
  if (totalCells === 0) return 0;
  return filled / totalCells;
};

const issue = (
  id: string,
  code: string,
  severity: ArtifactQualityIssue['severity'],
  scope: ArtifactQualityScope,
  message: string,
  recommendation: string,
  dimensionId?: string,
  autoFixable = false,
): ArtifactQualityIssue => ({ id, code, severity, scope, message, recommendation, dimensionId, autoFixable });

const SECTION_DIMENSION_MAP: Record<SectionKey, string> = {
  objective: 'doc.objective',
  scope: 'doc.scope',
  context: 'doc.context',
  assumptions: 'doc.assumptions',
  risks: 'doc.risks',
  decisions: 'doc.decisions',
  traceability: 'doc.traceability',
  acceptance: 'doc.acceptance',
  glossary: 'doc.terminology',
};

const SECTION_LABEL_ES: Record<SectionKey, string> = {
  objective: 'Objetivo',
  scope: 'Alcance',
  context: 'Contexto',
  assumptions: 'Supuestos',
  risks: 'Riesgos',
  decisions: 'Decisiones',
  traceability: 'Trazabilidad',
  acceptance: 'Criterios de aceptación',
  glossary: 'Glosario',
};

const READABILITY_TOO_LONG = 30;

export const analyzeDocumentQuality = (content: string, options?: {
  expectsTraceability?: boolean;
  expectsExecutiveTone?: boolean;
  expectsTables?: boolean;
}): DocumentQualitySnapshot => {
  const opts = {
    expectsTraceability: false,
    expectsExecutiveTone: false,
    expectsTables: false,
    ...options,
  };

  const trimmed = content.trim();
  const words = wordCount(content);
  const headings = countHeadings(content);
  const sections = detectSections(content);
  const tables = parseMarkdownTables(content);
  const tableScore = tableCompletenessRatio(tables);
  const sentLens = sentenceLengths(content);
  const issues: ArtifactQualityIssue[] = [];

  if (!trimmed) {
    issues.push(issue('doc-empty', 'DOC_EMPTY', 'critical', 'document',
      'El documento está vacío.',
      'Genera o pega contenido antes de evaluar la calidad.',
      'doc.exportability'));
  }

  // ── Per-dimension scoring ────────────────────────────────────────────────
  const scores: Record<string, number> = {};

  // doc.headings — total + balance
  scores['doc.headings'] = (() => {
    if (!trimmed) return 0;
    if (headings.total === 0) {
      issues.push(issue('doc-headings-missing', 'DOC_NO_HEADINGS', 'high', 'document',
        'El documento no tiene encabezados.',
        'Agrega secciones jerárquicas con # y ## para mejorar la navegación.',
        'doc.headings', true));
      return 25;
    }
    if (headings.h1 === 0) {
      issues.push(issue('doc-headings-no-h1', 'DOC_NO_H1', 'medium', 'document',
        'Falta un título principal (H1).',
        'Agrega un encabezado # con el nombre del artefacto al inicio.',
        'doc.headings', true));
    }
    let score = 50 + Math.min(40, headings.total * 6);
    if (headings.h2plus >= 3) score += 8;
    return clamp(score);
  })();

  // doc.objective / scope / context / assumptions / risks / decisions / traceability / acceptance
  (Object.keys(SECTION_DIMENSION_MAP) as SectionKey[]).forEach((key) => {
    const dimensionId = SECTION_DIMENSION_MAP[key];
    if (sections[key]) {
      scores[dimensionId] = Math.max(scores[dimensionId] ?? 0, 85);
    } else {
      const severity: ArtifactQualityIssue['severity'] = key === 'objective' ? 'high'
        : key === 'scope' || key === 'risks' || key === 'acceptance' ? 'medium'
        : 'low';
      const required = opts.expectsTraceability && key === 'traceability';
      scores[dimensionId] = required ? 25 : Math.max(scores[dimensionId] ?? 0, key === 'objective' ? 40 : 55);
      issues.push(issue(
        `doc-section-${key}`,
        `DOC_MISSING_SECTION_${key.toUpperCase()}`,
        required ? 'high' : severity,
        'document',
        `Falta la sección "${SECTION_LABEL_ES[key]}".`,
        `Agrega un encabezado dedicado a ${SECTION_LABEL_ES[key].toLowerCase()} para mejorar la trazabilidad.`,
        dimensionId,
        true,
      ));
    }
  });

  // doc.tables — completeness of detected tables
  scores['doc.tables'] = (() => {
    if (tables.length === 0) {
      if (opts.expectsTables) {
        issues.push(issue('doc-tables-missing', 'DOC_MISSING_TABLE', 'high', 'table',
          'El artefacto se esperaba como tabular pero no contiene tablas Markdown.',
          'Agrega una tabla Markdown con encabezados claros y al menos 1 fila.',
          'doc.tables', true));
        return 30;
      }
      return 80; // not applicable
    }
    const incomplete = tables.filter((t) => t.rows.length === 0).length;
    if (incomplete > 0) {
      issues.push(issue('doc-tables-empty-rows', 'DOC_TABLE_NO_ROWS', 'medium', 'table',
        `${incomplete} tabla(s) declaradas no tienen filas de datos.`,
        'Completa al menos una fila de datos por tabla antes de exportar.',
        'doc.tables'));
    }
    if (tableScore < 0.6) {
      issues.push(issue('doc-tables-incomplete', 'DOC_TABLE_INCOMPLETE', 'medium', 'table',
        'Las tablas tienen demasiadas celdas vacías.',
        'Rellena las celdas faltantes o márcalas como N/A explícitamente.',
        'doc.tables'));
    }
    return clamp(40 + Math.round(tableScore * 55));
  })();

  // doc.readability
  scores['doc.readability'] = (() => {
    if (!trimmed) return 0;
    if (sentLens.length === 0) return 50;
    const avg = sentLens.reduce((a, b) => a + b, 0) / sentLens.length;
    const longRatio = sentLens.filter((l) => l > READABILITY_TOO_LONG).length / sentLens.length;
    let score = 90 - Math.max(0, (avg - 22) * 2) - longRatio * 30;
    if (words < 60) score -= 25;
    if (longRatio > 0.4) {
      issues.push(issue('doc-readability-long', 'DOC_LONG_SENTENCES', 'low', 'document',
        'Hay frases largas que afectan la legibilidad.',
        'Divide las frases > 30 palabras en oraciones más cortas.',
        'doc.readability'));
    }
    return clamp(Math.round(score));
  })();

  // doc.terminology — penalise TBD/TODO/FIXME presence
  scores['doc.terminology'] = (() => {
    if (!trimmed) return 0;
    const issues_count = (content.match(/\b(TBD|TODO|FIXME|PENDIENTE|XXX)\b/gi) ?? []).length;
    const score = 90 - issues_count * 8;
    if (issues_count > 0) {
      issues.push(issue('doc-terminology-tbd', 'DOC_TBD_TOKENS', 'medium', 'document',
        `Se encontraron ${issues_count} marcador(es) "TBD/TODO/FIXME".`,
        'Resuelve o elimina los marcadores antes de presentar.',
        'doc.terminology', true));
    }
    return clamp(score);
  })();

  // doc.executive
  scores['doc.executive'] = (() => {
    if (!trimmed) return 0;
    const hasObjective = sections.objective ? 25 : 0;
    const hasContext = sections.context ? 15 : 0;
    const hasDecisions = sections.decisions ? 15 : 0;
    const hasRisks = sections.risks ? 10 : 0;
    const conciseBonus = words >= 80 && words <= 1200 ? 15 : words > 3000 ? -10 : 5;
    const tablesBonus = tables.length > 0 ? 8 : 0;
    const baseline = opts.expectsExecutiveTone ? 25 : 35;
    return clamp(Math.round(baseline + hasObjective + hasContext + hasDecisions + hasRisks + conciseBonus + tablesBonus));
  })();

  // doc.technical
  scores['doc.technical'] = (() => {
    if (!trimmed) return 0;
    const hasAcceptance = sections.acceptance ? 15 : 0;
    const hasAssumptions = sections.assumptions ? 10 : 0;
    const hasTraceability = sections.traceability ? 15 : 0;
    const hasTables = tables.length > 0 ? 10 : 0;
    const codeFences = (content.match(/```/g) ?? []).length / 2;
    const codeBonus = Math.min(15, codeFences * 5);
    return clamp(Math.round(35 + hasAcceptance + hasAssumptions + hasTraceability + hasTables + codeBonus));
  })();

  // doc.exportability — based on size + structure
  scores['doc.exportability'] = (() => {
    if (!trimmed) return 0;
    if (words < 20) {
      issues.push(issue('doc-export-too-short', 'DOC_TOO_SHORT', 'high', 'export',
        'El contenido es demasiado corto para una exportación profesional.',
        'Genera al menos 60 palabras de contenido antes de exportar.',
        'doc.exportability'));
      return 30;
    }
    if (words < 60) return 60;
    if (words > 6000) return 75;
    return 90;
  })();

  return {
    scores,
    issues,
    wordCount: words,
    hasStructure: headings.total > 0 && Object.values(sections).some(Boolean),
    tables,
    tableCompleteness: tableScore,
  };
};
