/**
 * Accessibility validation for the publication pipeline (Task 7).
 *
 * The service grades artifact content against a set of content-derived
 * accessibility checks (heading hierarchy, equivalent text for diagrams, table
 * headers, navigable structure, readable export content, legible titles). It
 * produces a score, issues, recommendations and a blocking verdict tied to the
 * profile's accessibility level.
 *
 * It checks what can be checked deterministically from artifact content; the
 * publication UI and export adapters are built to satisfy the UI-level WCAG
 * concerns (visible focus, ARIA labels, dark-mode, non-colour-only severity) by
 * construction. Every function is total — it never throws.
 */

import type { Artifact } from '../../types';
import { newPrefixedId } from '../../lib/ids';
import {
  clampPublicationScore,
  type PublicationAccessibilityCode,
  type PublicationAccessibilityIssue,
  type PublicationAccessibilityLevel,
  type PublicationAccessibilityReport,
  type PublicationAction,
  type PublicationSeverity,
  type PublicationVerdict,
} from './PublicationPipelineTypes';
import { trackPublicationEvent } from './PublicationObservability';

const auditId = (): string => newPrefixedId('pubacc');

const isDiagram = (artifact: Artifact): boolean =>
  artifact.representation === 'diagram' || artifact.representation === 'hybrid';

const SEVERITY_PENALTY: Record<PublicationSeverity, number> = {
  critical: 40,
  high: 18,
  medium: 9,
  low: 4,
  info: 0,
};

/** Extract markdown ATX heading levels in document order. */
const headingLevels = (content: string): number[] => {
  const levels: number[] = [];
  for (const line of content.split('\n')) {
    const match = /^(#{1,6})\s+\S/.exec(line.trim());
    if (match) levels.push(match[1].length);
  }
  return levels;
};

/** Detect markdown tables and whether each has a header + separator row. */
const tablesWithoutHeaders = (content: string): number => {
  const lines = content.split('\n');
  let missing = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const row = lines[i].trim();
    const next = lines[i + 1].trim();
    const looksLikeRow = row.startsWith('|') && row.endsWith('|') && row.includes('|', 1);
    const looksLikeSeparator = /^\|?[\s:|-]+\|?$/.test(next) && next.includes('-');
    if (looksLikeRow && looksLikeSeparator) {
      const headerCells = row.split('|').slice(1, -1).map((c) => c.trim());
      if (headerCells.some((c) => c.length === 0)) missing += 1;
      i += 1; // skip the separator row
    }
  }
  return missing;
};

interface AccessibilityCheck {
  code: PublicationAccessibilityCode;
  severity: PublicationSeverity;
  message: string;
  recommendation: string;
}

/** Run the content-derived accessibility checks for a single artifact. */
const checkArtifact = (artifact: Artifact): AccessibilityCheck[] => {
  const checks: AccessibilityCheck[] = [];
  const content = typeof artifact.content === 'string' ? artifact.content : '';
  const trimmed = content.trim();

  // 15 — readable export content.
  if (trimmed.length === 0) {
    checks.push({
      code: 'readable-in-export',
      severity: 'critical',
      message: 'El artefacto no tiene contenido legible para exportar.',
      recommendation: 'Genera o edita el contenido antes de incluir el artefacto en un paquete.',
    });
    return checks; // nothing else is meaningful on empty content
  }

  // 7 — reasonable title length.
  const name = (artifact.name ?? '').trim();
  if (name.length < 3 || name.length > 120) {
    checks.push({
      code: 'title-length',
      severity: 'low',
      message: `El título "${name}" tiene una longitud poco legible (${name.length} caracteres).`,
      recommendation: 'Usa un título descriptivo de entre 3 y 120 caracteres.',
    });
  }

  if (!isDiagram(artifact)) {
    // 1 — heading hierarchy.
    const levels = headingLevels(content);
    if (levels.length === 0) {
      checks.push({
        code: 'heading-hierarchy',
        severity: 'medium',
        message: 'El documento no tiene encabezados que estructuren su lectura.',
        recommendation: 'Añade encabezados Markdown (#, ##, ###) para crear una jerarquía navegable.',
      });
    } else {
      for (let i = 1; i < levels.length; i += 1) {
        if (levels[i] - levels[i - 1] > 1) {
          checks.push({
            code: 'heading-hierarchy',
            severity: 'medium',
            message: 'La jerarquía de encabezados salta niveles (p. ej. de H1 a H3).',
            recommendation: 'No omitas niveles de encabezado; baja de uno en uno para mantener la navegación.',
          });
          break;
        }
      }
      // 8 — navigable structure.
      if (levels.length < 2 && trimmed.length > 600) {
        checks.push({
          code: 'navigable-structure',
          severity: 'low',
          message: 'El documento es extenso pero tiene una sola sección.',
          recommendation: 'Divide el contenido en secciones con encabezados para facilitar la navegación.',
        });
      }
    }

    // 4 — tables with headers.
    const missingHeaders = tablesWithoutHeaders(content);
    if (missingHeaders > 0) {
      checks.push({
        code: 'table-headers',
        severity: 'medium',
        message: `${missingHeaders} tabla(s) tienen celdas de encabezado vacías.`,
        recommendation: 'Completa los encabezados de cada columna para que las tablas sean accesibles.',
      });
    }
  } else {
    // 2 — equivalent text for diagrams.
    const objective = (artifact.objective ?? '').trim();
    const narrative = artifact.ir?.metadata?.narrative;
    const narrativeText = typeof narrative === 'string'
      ? narrative
      : (narrative?.summary ?? '');
    if (objective.length < 24 && narrativeText.trim().length < 24) {
      checks.push({
        code: 'diagram-alt-text',
        severity: 'high',
        message: 'El diagrama no tiene una descripción textual equivalente suficiente.',
        recommendation: 'Añade un objetivo o una narrativa que describa el diagrama para lectores de pantalla.',
      });
    }
  }

  return checks;
};

/** Resolve the verdict for a level given the worst issue severity present. */
const resolveVerdict = (
  level: PublicationAccessibilityLevel,
  issues: PublicationAccessibilityIssue[],
): { verdict: PublicationVerdict; blocked: boolean } => {
  const has = (s: PublicationSeverity) => issues.some((i) => i.severity === s);
  if (has('critical')) return { verdict: 'blocked', blocked: true };
  if (level === 'strict' && (has('high') || has('medium'))) return { verdict: 'blocked', blocked: true };
  if (level === 'standard' && has('high')) return { verdict: 'blocked', blocked: true };
  if (issues.length > 0) return { verdict: 'warning', blocked: false };
  return { verdict: 'passed', blocked: false };
};

/**
 * Evaluate the accessibility of a set of artifacts against an accessibility
 * level. Pass a single-element array for artifact scope.
 */
export const evaluatePublicationAccessibility = (
  artifacts: Artifact[],
  level: PublicationAccessibilityLevel,
  scope: 'artifact' | 'package',
  targetId: string,
): PublicationAccessibilityReport => {
  const issues: PublicationAccessibilityIssue[] = [];

  for (const artifact of artifacts) {
    for (const check of checkArtifact(artifact)) {
      issues.push({
        id: auditId(),
        code: check.code,
        severity: check.severity,
        blocking: check.severity === 'critical',
        artifactId: artifact.id,
        artifactName: artifact.name,
        message: check.message,
        recommendation: check.recommendation,
      });
    }
  }

  // Package-level structural guarantee: an empty package cannot be accessible.
  if (artifacts.length === 0) {
    issues.push({
      id: auditId(),
      code: 'readable-in-export',
      severity: 'critical',
      blocking: true,
      message: 'El paquete no contiene artefactos legibles.',
      recommendation: 'Añade al menos un artefacto con contenido al paquete.',
    });
  }

  const penalty = issues.reduce((sum, issue) => sum + SEVERITY_PENALTY[issue.severity], 0);
  const score = clampPublicationScore(100 - penalty);
  const { verdict, blocked } = resolveVerdict(level, issues);

  const recommendations: PublicationAction[] = issues
    .filter((i) => i.severity === 'critical' || i.severity === 'high')
    .slice(0, 8)
    .map((issue) => ({
      id: auditId(),
      title: issue.message,
      detail: issue.recommendation,
      priority: issue.severity,
      ...(issue.artifactId ? { artifactId: issue.artifactId } : {}),
    }));

  trackPublicationEvent('publication.accessibility.checked',
    `Accesibilidad evaluada (${scope}): puntaje ${score}, ${issues.length} hallazgo(s).`,
    { scope, targetId, score, level });

  return {
    id: auditId(),
    scope,
    targetId,
    generatedAt: new Date().toISOString(),
    level,
    verdict,
    score,
    issues,
    recommendations,
    blocked,
  };
};
