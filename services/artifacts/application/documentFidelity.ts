/**
 * Does the document answer what was asked? (plan de calidad de artefactos, 7.4c)
 *
 * `checkRequestFidelity` asks it of a diagram; a document had nothing. The
 * contract measures whether a document is *well formed* for its discipline;
 * this measures the other half, against the request — and it is
 * deterministic, costs nothing and runs on every generation.
 *
 * The honesty rule is the diagram's: **what cannot be shown is reported as
 * without evidence, never as failed or as met.** Four checks:
 *
 * - **Sections.** The discipline's required sections are there. A missing one
 *   is *fixable*: a patch can add it.
 * - **Named elements.** What the request names — in quotes, or as a proper
 *   name — appears in the document. Fixable.
 * - **Audience.** An executive request opens with an executive summary.
 *   Fixable.
 * - **Criteria.** Each acceptance criterion has evidence. Never fixable: a
 *   correction chasing a word match makes a model write words.
 */
import { disciplineForTemplate } from '../../../lib/artifacts';
import { fidelityTerms, normalizeFidelityText, requestedNames } from '../../diagram';
import { outlineOfDocument } from '../domain/documentPatchEngine';

export type DocumentFidelityKind = 'section' | 'entity' | 'audience' | 'criterion';

export interface DocumentFidelityCheck {
  kind: DocumentFidelityKind;
  status: 'ok' | 'warning';
  /** What was checked, as the request or the discipline put it. */
  target: string;
  /** One Spanish sentence for the trace and the warning. */
  message: string;
  /** Whether one section patch can close it. */
  fixable: boolean;
}

export interface DocumentFidelityReport {
  checks: DocumentFidelityCheck[];
  /** Share of checks that are `ok`; `null` when there was nothing to check. */
  score: number | null;
  warnings: DocumentFidelityCheck[];
}

export interface DocumentFidelityInput {
  templateName: string;
  content: string;
  request?: {
    userRequest?: string;
    acceptanceCriteria?: readonly string[];
    audience?: 'technical' | 'executive' | 'mixed';
  };
}

const EXECUTIVE_SUMMARY = ['resumen ejecutivo', 'executive summary'];

export function checkDocumentFidelity(input: DocumentFidelityInput): DocumentFidelityReport {
  const checks: DocumentFidelityCheck[] = [];
  const text = normalizeFidelityText(input.content ?? '');
  const headings = outlineOfDocument(input.content ?? '').map((heading) => normalizeFidelityText(heading.replace(/^#+\s*/, '')));
  const hasHeading = (keywords: readonly string[]): boolean =>
    headings.some((heading) => keywords.some((keyword) => heading.includes(normalizeFidelityText(keyword))))
    || keywords.some((keyword) => text.includes(`**${normalizeFidelityText(keyword)}`));

  for (const section of disciplineForTemplate(input.templateName)?.sections ?? []) {
    if (section.requirement !== 'required') continue;
    const ok = hasHeading(section.keywords);
    checks.push({
      kind: 'section',
      status: ok ? 'ok' : 'warning',
      target: section.label,
      message: ok ? `Tiene la sección «${section.label}».` : `Falta la sección «${section.label}» que su disciplina exige.`,
      fixable: !ok,
    });
  }

  const request = input.request;
  if (request?.userRequest) {
    for (const name of requestedNames(request.userRequest)) {
      const ok = text.includes(normalizeFidelityText(name));
      checks.push({
        kind: 'entity',
        status: ok ? 'ok' : 'warning',
        target: name,
        message: ok ? `Aparece «${name}».` : `La solicitud nombra «${name}» y el documento no lo menciona.`,
        fixable: !ok,
      });
    }
  }

  if (request?.audience === 'executive') {
    const ok = hasHeading(EXECUTIVE_SUMMARY);
    checks.push({
      kind: 'audience',
      status: ok ? 'ok' : 'warning',
      target: 'audiencia ejecutiva',
      message: ok ? 'Abre con un resumen ejecutivo.' : 'Se pidió para un público ejecutivo y el documento no tiene resumen ejecutivo.',
      fixable: !ok,
    });
  }

  for (const criterion of request?.acceptanceCriteria ?? []) {
    const terms = fidelityTerms(criterion);
    if (terms.length === 0) continue;
    const ok = terms.filter((term) => text.includes(term)).length / terms.length >= 0.6;
    checks.push({
      kind: 'criterion',
      status: ok ? 'ok' : 'warning',
      target: criterion,
      message: ok ? `Hay evidencia del criterio «${criterion}».` : `Sin evidencia del criterio «${criterion}» en el documento: revisa si se cumple.`,
      fixable: false,
    });
  }

  const warnings = checks.filter((check) => check.status === 'warning');
  return {
    checks,
    score: checks.length ? (checks.length - warnings.length) / checks.length : null,
    warnings,
  };
}

/** The instruction one correction patch is asked for: only the fixable gaps, and nothing else. */
export function describeFidelityGaps(report: DocumentFidelityReport): string | null {
  const gaps = report.warnings.filter((check) => check.fixable);
  if (gaps.length === 0) return null;
  const lines = gaps.map((check) => {
    if (check.kind === 'section') return `- Añade la sección «${check.target}», con contenido concreto del proyecto.`;
    if (check.kind === 'audience') return '- Añade al principio una sección «Resumen Ejecutivo» de 3 a 6 líneas.';
    return `- Menciona «${check.target}» donde corresponda, sin inventar datos sobre él.`;
  });
  return ['Cierra sólo estas brechas del documento, sin cambiar nada más:', ...lines].join('\n');
}
