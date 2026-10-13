import type { ArtifactGenerationTraceStatus } from '../lib/artifacts';
import { spanishFallback, type Translator } from '../lib/i18n/spanishFallback';

/**
 * Banner tone vocabulary:
 *   - `rose`  → user must act (canvas empty, generation failed).
 *   - `amber` → user should review (fallback used; partial render).
 *   - `blue`  → informational only (render OK, but trace recorded
 *               non-blocking warnings — e.g. autoclosed JSON, schema retry).
 */
export interface GenerationObservabilityAlert {
    tone: 'amber' | 'rose' | 'blue';
    title: string;
    body: string;
    detail?: string;
}

export const buildGenerationObservabilityAlert = ({
    traceStatus,
    traceErrorCount = 0,
    renderStatus,
    hasDisplayFlowNodes,
    hasVisibleFallbackContent = false,
    activeViewMode = 'diagram',
    renderDiagnosticsSummary,
    lastDiagramErrorReason,
    t = spanishFallback,
}: {
    traceStatus?: ArtifactGenerationTraceStatus;
    traceErrorCount?: number;
    renderStatus?: string;
    hasDisplayFlowNodes: boolean;
    hasVisibleFallbackContent?: boolean;
    activeViewMode?: string;
    renderDiagnosticsSummary?: string | null;
    lastDiagramErrorReason?: string;
    t?: Translator;
}): GenerationObservabilityAlert | null => {
    const specializedRendererFailed = renderStatus === 'repairable' || renderStatus === 'invalid';
    const userCanSeeSomething = hasDisplayFlowNodes || hasVisibleFallbackContent;

    if (!userCanSeeSomething) {
        return {
            tone: 'rose',
            title: t('observability.emptyTitle'),
            body: t('observability.emptyBody'),
            detail: renderDiagnosticsSummary ?? (renderStatus ? t('observability.renderAndView', { status: renderStatus, view: activeViewMode }) : t('observability.view', { view: activeViewMode })),
        };
    }

    if (specializedRendererFailed) {
        return {
            tone: 'amber',
            title: t('observability.degradedTitle'),
            body: t('observability.degradedBody'),
            detail: renderDiagnosticsSummary ?? (lastDiagramErrorReason ? t('observability.technicalReason', { reason: lastDiagramErrorReason }) : t('observability.view', { view: activeViewMode })),
        };
    }

    if (traceStatus === 'failed') {
        return {
            tone: 'rose',
            title: t('observability.failedTitle'),
            body: t('observability.failedBody'),
            detail: lastDiagramErrorReason ? t('observability.technicalReason', { reason: lastDiagramErrorReason }) : undefined,
        };
    }

    if (traceStatus === 'fallback') {
        return {
            tone: 'amber',
            title: t('observability.fallbackTitle'),
            body: t('observability.fallbackBody'),
            detail: lastDiagramErrorReason ? t('observability.technicalReason', { reason: lastDiagramErrorReason }) : undefined,
        };
    }

    if (traceStatus === 'warning' || traceErrorCount > 0) {
        return {
            tone: 'blue',
            title: t('observability.warningTitle'),
            body: t('observability.warningBody'),
            detail: traceErrorCount > 0 ? t('observability.eventCount', { count: String(traceErrorCount) }) : undefined,
        };
    }

    return null;
};
