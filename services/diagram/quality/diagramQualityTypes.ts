/**
 * The shapes the quality report is made of, and the two arithmetic helpers
 * every part of it uses.
 *
 * Its own module because all four halves of the analysis reference these: the
 * canvas conversion, the lint rules, the scoring and the orchestrator. Leaving
 * them in any one of those would have made the other three depend on it for a
 * reason that has nothing to do with what it does.
 */

import type { DiagramArchetype, DiagramSuggestion } from '../diagramTypeQualityGates';
import type { LayoutQualityMetrics } from '../layoutQualityService';
import type { VisualQualityGateResult } from '../visualQualityGate';

type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface DiagramLintIssue {
    id: string;
    code: string;
    severity: Severity;
    message: string;
    recommendation: string;
}

export interface DiagramScoreBreakdown {
    claridadSemantica: number;
    consistenciaArquitectonica: number;
    jerarquiaVisual: number;
    legibilidad: number;
    narrativa: number;
    atractivoVisual: number;
    preparacionEjecutiva: number;
    preparacionTecnica: number;
    exportabilidad: number;
    mantenibilidadPipeline: number;
}

export interface DiagramQualityReport {
    score: number;
    breakdown: DiagramScoreBreakdown;
    issues: DiagramLintIssue[];
    summary: string;
    /**
     * Detected archetype of the diagram (context, container, integration,
     * process, data…). Used by `suggestions` to filter and explain the
     * recommendations.
     */
    archetype?: DiagramArchetype;
    /**
     * Archetype-specific suggestions enriched with category, severity,
     * justification and a recommended action. Empty when no rule fires.
     */
    suggestions?: DiagramSuggestion[];
    /**
     * Phase 2 — real-positions layout metrics. Present only when the
     * caller supplied `layoutRects` to `analyzeDiagramQuality`. Exposes
     * the actual bounding box, density, overlap detection and export crop
     * risk so the inspector / export modal can react to live layout
     * problems instead of relying on the pseudo grid.
     */
    layoutMetrics?: LayoutQualityMetrics;
    /**
     * Visual Quality Gate 2.0 summary. Present when layout-aware inputs are
     * supplied or when the caller explicitly forwards runtime render signals.
     */
    visualGate?: VisualQualityGateResult;
}

export interface DiagramPreflightCheck {
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
}

export interface DiagramPreflightReport {
    ready: boolean;
    checks: DiagramPreflightCheck[];
}

/** Keeps a dimension inside the 0–100 the rubric is defined over. */
export const clamp = (n: number, min = 0, max = 100): number => Math.max(min, Math.min(max, n));

/** A field counts as present only when it carries something to read. */
export const hasText = (v?: string | null): boolean => (v ?? '').trim().length > 0;
