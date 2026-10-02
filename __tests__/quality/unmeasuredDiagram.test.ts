/**
 * Un diagrama sin grafo no se mide con el perfil de diagramas (plan de
 * diagramas, 8.4c).
 *
 * Un Gantt, un journey o un mindmap no tienen IR: la rúbrica de diagramas no
 * tiene qué leer y su código no es prosa. Hasta la 8.4c el informe rellenaba
 * cada dimensión con su valor por defecto y le cobraba encabezados de
 * documento, y el Gantt del banco salía con 44,5 —una cifra sin medición
 * detrás— que además ponía al refinamiento a «mejorarlo». Sin medir no es una
 * nota baja: el informe lo dice y nadie actúa sobre ella.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ArtifactTemplate, Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import { buildArtifactQualityReport } from '../../services/quality/artifactQualityService';
import { refineArtifactBeforePersistence } from '../../services/artifacts/application/artifactRefinementOrchestrator';
import { normalizeArtifactEnvelope } from '../../services/artifacts/application/artifactGenerationPipeline';
import { artifactGenerationService } from '../../services/ai/generation/artifactGenerationService';

const GANTT = 'gantt\n    title Implantación\n    dateFormat YYYY-MM-DD\n    section Preparación\n    Configuración :conf, 2026-11-02, 45d\n    Migración :mig, after conf, 60d';

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
    id: 'g', versionGroupId: 'g', version: 1, createdAt: '2026-01-01', name: 'Cronograma', type: 'mermaid-gantt',
    content: GANTT, representation: 'diagram', ...overrides,
} as unknown as Artifact);

afterEach(() => vi.restoreAllMocks());

describe('un diagrama sin grafo', () => {
    it('sale «sin medir», con el motivo, y sin hallazgos de documento', () => {
        const report = buildArtifactQualityReport(artifact());
        expect(report.score.unmeasured).toMatch(/no tiene un grafo/i);
        expect(report.score.summary).toMatch(/^Sin medir/);
        expect(report.issues.filter((i) => i.code.startsWith('DOC_'))).toEqual([]);
    });

    it('un diagrama con IR y un documento siguen midiéndose', () => {
        const withIR = artifact({ type: 'mermaid-graph', content: 'flowchart LR\n  A --> B', ir: { nodes: [{ id: 'A', label: 'A', kind: 'service' }, { id: 'B', label: 'B', kind: 'service' }], edges: [], groups: [] } } as unknown as Partial<Artifact>);
        expect(buildArtifactQualityReport(withIR).score.unmeasured).toBeUndefined();
        expect(buildArtifactQualityReport(artifact({ type: 'markdown', representation: 'document', content: '# Plan' })).score.unmeasured).toBeUndefined();
    });

    it('el refinamiento no gasta pasadas ni llamadas sobre una cifra que no mide nada', async () => {
        const template: ArtifactTemplate = {
            name: 'Cronograma', type: 'mermaid-gantt', phase: 'Diseño', architecturalView: 'Vista Lógica y de Diseño',
            objective: 'Planificar la implantación.', keyConcepts: [], representation: 'diagram',
        };
        const refine = vi.spyOn(artifactGenerationService, 'refineArtifactContent');
        const result = await refineArtifactBeforePersistence({
            project: { id: 'p', name: 'Core de vida', artifacts: [] } as unknown as Project,
            template,
            settings: { globalContext: [], language: 'es', theme: 'light', aiConfig: { model: 'gemini-2.5-flash', temperature: 0.2 } } as unknown as Settings,
            draftContent: GANTT,
            envelope: normalizeArtifactEnvelope({ artifactId: 'g', title: 'Cronograma', artifactType: 'mermaid-gantt', representation: 'diagram', rawResponse: GANTT, intent: 'on-demand', audience: 'technical' }),
            operationId: 'gantt',
            mode: 'diagram',
            targetScore: 90,
        });
        expect(result.passes).toEqual([]);
        expect(result.accepted).toBe(false);
        expect(result.content).toBe(GANTT);
        expect(result.qualityReport.score.unmeasured).toBeTruthy();
        expect(refine).not.toHaveBeenCalled();
    });
});
