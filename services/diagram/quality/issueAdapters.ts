/**
 * Translating other validators' findings into lint issues.
 *
 * The archetype checker, the visual linter, BPMN, healthcare compliance and
 * C4 each have their own severity vocabulary. They converge here so the report
 * shows one scale rather than five, and so a severity mapping that changes has
 * exactly one place to change.
 */

import type { DiagramLintIssue } from './diagramQualityTypes';
import type { DiagramSuggestion, SuggestionSeverity } from '../diagramTypeQualityGates';
import type { VisualLintIssue } from '../diagramVisualLints';
import type { BpmnValidationIssue } from '../bpmnValidation';
import type { HealthcareComplianceIssue } from '../healthcareCompliance';
import type { C4ValidationIssue } from '../c4Validation';

/**
 * Map a DiagramSuggestion severity to the DiagramLintIssue severity scale.
 * `info` collapses to `low` so the existing scoring penalty stays correct.
 */
const SUGGESTION_TO_LINT_SEVERITY: Record<SuggestionSeverity, DiagramLintIssue['severity']> = {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
    info: 'low',
};

export function archetypeSuggestionsToIssues(suggestions: DiagramSuggestion[]): DiagramLintIssue[] {
    return suggestions.map((s) => ({
        id: `archetype-${s.id}`,
        code: `ARCHETYPE_${s.id.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`,
        severity: SUGGESTION_TO_LINT_SEVERITY[s.severity] ?? 'low',
        message: s.title,
        recommendation: s.recommendedAction,
    }));
}

/**
 * Convert visual lint findings into the standard `DiagramLintIssue` shape.
 * The visual lints already carry a stable id; we prefix it with `visual-`
 * to make the source obvious in telemetry and the inspector UI.
 */
export function visualLintsToIssues(lints: VisualLintIssue[]): DiagramLintIssue[] {
    return lints.map((lint) => ({
        id: lint.id,
        code: lint.code,
        severity: lint.severity,
        message: lint.message,
        recommendation: lint.recommendation,
    }));
}

/**
 * Map a Phase 3 BPMN / healthcare validator severity to the
 * `DiagramLintIssue` severity scale. `info` collapses to `low` so the
 * scoring penalty stays consistent with the rest of the issues.
 */
const PHASE3_SEVERITY_MAP: Record<'critical' | 'high' | 'medium' | 'low' | 'info', DiagramLintIssue['severity']> = {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
    info: 'low',
};

export function bpmnIssuesToLints(issues: BpmnValidationIssue[]): DiagramLintIssue[] {
    return issues.map((issue) => ({
        id: issue.id,
        code: issue.code,
        severity: PHASE3_SEVERITY_MAP[issue.severity] ?? 'low',
        message: issue.message,
        recommendation: issue.recommendation,
    }));
}

export function healthcareIssuesToLints(issues: HealthcareComplianceIssue[]): DiagramLintIssue[] {
    return issues.map((issue) => ({
        id: issue.id,
        code: issue.code,
        severity: PHASE3_SEVERITY_MAP[issue.severity] ?? 'low',
        message: issue.message,
        recommendation: issue.recommendation,
    }));
}

export function c4IssuesToLints(issues: C4ValidationIssue[]): DiagramLintIssue[] {
    return issues.map((issue) => ({
        id: issue.id,
        code: issue.code,
        severity: PHASE3_SEVERITY_MAP[issue.severity] ?? 'low',
        message: `C4 ${issue.level.toUpperCase()}: ${issue.message}`,
        recommendation: issue.recommendation,
    }));
}
