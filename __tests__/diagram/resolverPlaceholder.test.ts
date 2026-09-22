import { describe, it, expect } from 'vitest';
import { resolveRenderableDiagram } from '../../services/diagram/resolveRenderableDiagram';
import { buildDiagramPreflightReport } from '../../services/diagram/quality/diagramQualityService';
import type { Artifact } from '../../lib/artifacts';

const baseArtifact = (over: Partial<Artifact> = {}): Artifact => ({
    id: 'a1',
    versionGroupId: 'vg1',
    version: 1,
    createdAt: new Date().toISOString(),
    name: 'Test',
    type: 'mermaid-c4-container',
    content: '',
    phase: 'F2',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: 'Test',
    keyConcepts: [],
    representation: 'diagram',
    ...over,
});

describe('resolveRenderableDiagram — placeholder safety net', () => {
    it('returns a renderable placeholder when content is empty', () => {
        const result = resolveRenderableDiagram(baseArtifact({ content: '' }), { audience: 'technical' });
        expect(result.status).toBe('repairable');
        expect(result.reactFlow.nodes.length).toBeGreaterThanOrEqual(2);
        expect(result.quality).not.toBeNull();
        expect(result.repairActions.length).toBeGreaterThan(0);
    });

    it('returns a renderable placeholder when content is unparseable garbage', () => {
        const result = resolveRenderableDiagram(
            baseArtifact({ content: 'esto no es mermaid ni nada renderizable' }),
            { audience: 'technical' },
        );
        expect(result.status).toBe('repairable');
        expect(result.reactFlow.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('still uses real IR when content is valid', () => {
        const result = resolveRenderableDiagram(
            baseArtifact({
                content: `C4Container
    Person(u, "Cliente", "Usuario")
    Container(api, "API", "Node", "REST")
    Rel(u, api, "Usa", "HTTPS")`,
            }),
            { audience: 'technical' },
        );
        expect(result.status).toBe('ready');
        expect(result.reactFlow.nodes.length).toBeGreaterThanOrEqual(2);
        // Not the placeholder
        expect(result.reactFlow.nodes.find(n => n.id === 'placeholder-info')).toBeUndefined();
    });

    it('placeholder uses dialect-specific copy', () => {
        const result = resolveRenderableDiagram(
            baseArtifact({ type: 'mermaid-c4-component', content: 'invalid' }),
            { audience: 'technical' },
        );
        const placeholderNode = result.reactFlow.nodes.find(n => n.id === 'placeholder-info');
        expect(placeholderNode).toBeDefined();
        expect(String(placeholderNode?.data.description ?? '')).toMatch(/C4 Componente/);
    });

    it('placeholder IR is hard-blocked by the export preflight', () => {
        const result = resolveRenderableDiagram(baseArtifact({ content: '' }), { audience: 'technical' });
        expect(result.ir).not.toBeNull();
        const preflight = buildDiagramPreflightReport(result.ir!, result.quality ?? undefined);
        expect(preflight.ready).toBe(false);
        const stateCheck = preflight.checks.find((c) => c.id === 'generation-state');
        expect(stateCheck?.status).toBe('fail');
    });
});
