/**
 * El código Mermaid de un diagrama no se juzga como documento (plan de
 * diagramas, 6.5): cobrarle encabezados que no puede tener bajaba 25 puntos a
 * todos los diagramas, y más a los que menos prosa llevan en su fuente.
 */
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../lib/artifacts';
import type { DiagramIR } from '../../lib/diagram';
import { buildArtifactQualityReport } from '../../services/quality/artifactQualityService';

const ir: DiagramIR = {
    nodes: [{ id: 'a', label: 'Póliza', kind: 'service' }, { id: 'b', label: 'Beneficiario', kind: 'service' }],
    edges: [{ id: 'e', source: 'a', target: 'b', label: 'designa' }],
    groups: [],
};

const artifact = (representation: Artifact['representation']): Artifact => ({
    id: 'x', versionGroupId: 'x', version: 1, createdAt: '2026-01-01', name: 'Modelo', type: 'erd',
    content: 'erDiagram\n  POLIZA ||--o{ BENEFICIARIO : designa', representation, ir,
} as unknown as Artifact);

describe('calidad de un diagrama', () => {
    it('no recibe hallazgos de estructura documental', () => {
        const codes = buildArtifactQualityReport(artifact('diagram')).issues.map((i) => i.code);
        expect(codes.filter((c) => c.startsWith('DOC_'))).toEqual([]);
    });

    it('un híbrido sigue siendo juzgado también como documento', () => {
        const codes = buildArtifactQualityReport(artifact('hybrid')).issues.map((i) => i.code);
        expect(codes.some((c) => c.startsWith('DOC_'))).toBe(true);
    });
});
