import { describe, it, expect } from 'vitest';
import { analyzeDiagramQuality, buildDiagramPreflightReport } from '../../services/diagram/quality/diagramQualityService';
import type { DiagramIR } from '../../lib/diagram';

describe('diagram preflight gates', () => {
    it('fails export when score is below 70', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'n1', label: 'A', kind: 'Unknown' },
                { id: 'n2', label: 'B', kind: 'Unknown' },
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2', label: 'x' },
            ],
            groups: [],
            metadata: {},
        };
        const quality = analyzeDiagramQuality(ir);
        const preflight = buildDiagramPreflightReport(ir, quality);
        const qualityCheck = preflight.checks.find((c) => c.id === 'quality-score');
        expect(quality.score).toBeLessThan(70);
        expect(qualityCheck?.status).toBe('fail');
        expect(preflight.ready).toBe(false);
    });
});
