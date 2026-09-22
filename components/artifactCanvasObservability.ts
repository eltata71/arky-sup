import type { ArtifactGenerationTraceStatus } from '../lib/artifacts';

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
}: {
    traceStatus?: ArtifactGenerationTraceStatus;
    traceErrorCount?: number;
    renderStatus?: string;
    hasDisplayFlowNodes: boolean;
    hasVisibleFallbackContent?: boolean;
    activeViewMode?: string;
    renderDiagnosticsSummary?: string | null;
    lastDiagramErrorReason?: string;
}): GenerationObservabilityAlert | null => {
    const specializedRendererFailed = renderStatus === 'repairable' || renderStatus === 'invalid';
    const userCanSeeSomething = hasDisplayFlowNodes || hasVisibleFallbackContent;

    if (!userCanSeeSomething) {
        return {
            tone: 'rose',
            title: 'No hay contenido visible para el artefacto',
            body: 'La generación no puede marcarse como completada porque ninguna vista produjo contenido visible. Reintenta o copia el reporte técnico para soporte.',
            detail: renderDiagnosticsSummary ?? (renderStatus ? `Estado de render: ${renderStatus}. Vista activa: ${activeViewMode}.` : `Vista activa: ${activeViewMode}.`),
        };
    }

    if (specializedRendererFailed) {
        return {
            tone: 'amber',
            title: 'Vista especializada degradada con fallback visible',
            body: 'El artefacto tiene contenido útil, pero el renderizador especializado no pudo materializarlo de forma confiable. Se muestra una vista documental/Markdown o un placeholder accionable para evitar un canvas vacío.',
            detail: renderDiagnosticsSummary ?? (lastDiagramErrorReason ? `Motivo técnico: ${lastDiagramErrorReason}.` : `Vista activa: ${activeViewMode}.`),
        };
    }

    if (traceStatus === 'failed') {
        return {
            tone: 'rose',
            title: 'Generación con errores registrados',
            body: 'El artefacto abrió con una traza fallida. Revisa las decisiones, errores y diagnóstico antes de presentarlo o editarlo.',
            detail: lastDiagramErrorReason ? `Motivo técnico: ${lastDiagramErrorReason}.` : undefined,
        };
    }

    if (traceStatus === 'fallback') {
        return {
            tone: 'amber',
            title: 'Se usó un fallback renderizable',
            body: 'La IA no entregó una estructura completamente renderizable y el sistema sustituyó la salida por un respaldo determinístico para evitar un canvas vacío.',
            detail: lastDiagramErrorReason ? `Motivo técnico: ${lastDiagramErrorReason}.` : undefined,
        };
    }

    if (traceStatus === 'warning' || traceErrorCount > 0) {
        return {
            tone: 'blue',
            title: 'Generación completada con notas',
            body: 'El artefacto se generó y existe una vista visible, guardable y exportable. Hay observaciones menores en la traza si quieres revisar el detalle.',
            detail: traceErrorCount > 0 ? `${traceErrorCount} evento(s) registrados — revisar es opcional.` : undefined,
        };
    }

    return null;
};
