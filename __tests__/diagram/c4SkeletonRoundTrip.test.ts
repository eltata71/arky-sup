import { describe, it, expect } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import { buildDeterministicDiagramSkeleton } from '../../services/artifacts/domain/deterministicArtifactFallbacks';
import { extractIRFromArtifact } from '../../services/diagram';
import { resolveRenderableDiagram } from '../../services/diagram/resolveRenderableDiagram';
import type { ArtifactTemplate } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

const project: Project = {
    id: 'p1',
    name: 'Sistema',
    description: 'Sistema en construcción',
    projectContext: [],
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

const makeTemplate = (type: ArtifactTemplate['type'], name: string): ArtifactTemplate => ({
    name,
    type,
    phase: 'Fase 2',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: 'Test',
    keyConcepts: [],
    representation: 'diagram',
});

describe('C4 deterministic skeleton — round trip', () => {
    const types: Array<{ t: ArtifactTemplate['type']; name: string; rep: 'diagram' | 'hybrid' }> = [
        { t: 'mermaid-c4-context', name: 'Context', rep: 'diagram' },
        { t: 'mermaid-c4-container', name: 'Container', rep: 'diagram' },
        { t: 'mermaid-c4-component', name: 'Component', rep: 'diagram' },
        { t: 'mermaid-c4-deployment', name: 'Deployment', rep: 'diagram' },
        { t: 'hybrid-text-diagram', name: 'Mapa de Flujo de Valor', rep: 'hybrid' },
    ];

    for (const { t, name, rep } of types) {
        it(`${t} skeleton parses to non-empty IR`, () => {
            const skeleton = buildDeterministicDiagramSkeleton(project, makeTemplate(t, name));
            const ir = mermaidToIR(skeleton);
            // For hybrid the skeleton has markdown around the fence; extractIRFromArtifact handles it.
            const irFromArtifact = extractIRFromArtifact({ content: skeleton, representation: rep, type: t });
            console.log(`[${t}] direct nodes=${ir.nodes.length} edges=${ir.edges.length} | extract nodes=${irFromArtifact?.nodes.length ?? 0}`);
            expect(irFromArtifact).not.toBeNull();
            expect((irFromArtifact?.nodes.length ?? 0)).toBeGreaterThanOrEqual(2);
        });

        it(`${t} skeleton renders through resolveRenderableDiagram`, () => {
            const skeleton = buildDeterministicDiagramSkeleton(project, makeTemplate(t, name));
            const artifact: Artifact = {
                id: 'a1',
                versionGroupId: 'vg1',
                version: 1,
                createdAt: new Date().toISOString(),
                name,
                type: t,
                content: skeleton,
                phase: 'F2',
                architecturalView: 'Vista Lógica y de Diseño',
                objective: 'Test',
                keyConcepts: [],
                representation: rep,
            };
            const result = resolveRenderableDiagram(artifact, { audience: 'technical' });
            console.log(`[${t}] resolveRenderableDiagram status=${result.status} renderNodes=${result.counters.renderNodes}`);
            expect(result.reactFlow.nodes.length).toBeGreaterThanOrEqual(2);
            expect(result.status).toBe('ready');
        });
    }
});
