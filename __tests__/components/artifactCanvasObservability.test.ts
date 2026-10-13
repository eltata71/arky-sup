import { describe, expect, it } from 'vitest';
import { buildGenerationObservabilityAlert } from '../../components/artifactCanvasObservability';
import { en } from '../../lib/i18n/locales/en';
import { es } from '../../lib/i18n/locales/es';
import { translate } from '../../lib/i18n/translate';

describe('ArtifactCanvas generation observability alert', () => {
    it('uses the selected language for a visible diagnostic', () => {
        const alert = buildGenerationObservabilityAlert({
            traceStatus: 'failed',
            hasDisplayFlowNodes: true,
            lastDiagramErrorReason: 'invalid-model',
            t: (key, replacements) => translate({ es, en }, 'en', key, replacements),
        });
        expect(alert?.title).toBe('Generation errors recorded');
        expect(alert?.detail).toBe('Technical reason: invalid-model.');
    });

    it('surfaces a hard diagnostic when the persisted artifact has no visible nodes', () => {
        const alert = buildGenerationObservabilityAlert({
            traceStatus: 'clean',
            renderStatus: 'invalid',
            hasDisplayFlowNodes: false,
            renderDiagnosticsSummary: 'Etapa render: sin nodos visibles',
        });

        expect(alert).toMatchObject({
            tone: 'rose',
            title: 'No hay contenido visible para el artefacto',
            detail: 'Etapa render: sin nodos visibles',
        });
    });

    it('keeps fallback generation visible even when the skeleton rendered', () => {
        const alert = buildGenerationObservabilityAlert({
            traceStatus: 'fallback',
            traceErrorCount: 1,
            renderStatus: 'ready',
            hasDisplayFlowNodes: true,
            lastDiagramErrorReason: 'skeleton-fallback',
        });

        expect(alert).toMatchObject({
            tone: 'amber',
            title: 'Se usó un fallback renderizable',
            detail: 'Motivo técnico: skeleton-fallback.',
        });
    });

    it('stays quiet for clean renderable artifacts', () => {
        const alert = buildGenerationObservabilityAlert({
            traceStatus: 'clean',
            renderStatus: 'ready',
            hasDisplayFlowNodes: true,
        });

        expect(alert).toBeNull();
    });

    it('uses the informational blue tone when render is OK but trace has notes', () => {
        const alert = buildGenerationObservabilityAlert({
            traceStatus: 'warning',
            traceErrorCount: 1,
            renderStatus: 'ready',
            hasDisplayFlowNodes: true,
        });

        expect(alert).toMatchObject({
            tone: 'blue',
            title: 'Generación completada con notas',
        });
        // Body must NOT mislead the user into thinking the render failed.
        expect(alert?.body).not.toContain('advertencias');
    });
});
