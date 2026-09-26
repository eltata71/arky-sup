import { describe, it, expect } from 'vitest';
import { buildDeterministicDiagramSkeleton } from '../../services/artifacts/domain/deterministicArtifactFallbacks';
import { extractIRFromArtifact } from '../../services/diagram';
import type { ArtifactTemplate } from '../../types';
import type { Project } from '../../services/architectureProjects';

const project: Project = {
    id: 'p1',
    name: 'Plataforma',
    description: 'Sistema de prueba',
    projectContext: [],
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

const make = (type: ArtifactTemplate['type'], name: string, rep: 'diagram' | 'hybrid'): ArtifactTemplate => ({
    name,
    type,
    phase: 'F2',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: 'Test',
    keyConcepts: [],
    representation: rep,
});

describe('Workspace skeleton fallback — guarantees a renderable artifact', () => {
    const types = [
        { t: 'mermaid-c4-context', name: 'Contexto', rep: 'diagram' as const },
        { t: 'mermaid-c4-container', name: 'Contenedores (C4-N2)', rep: 'diagram' as const },
        { t: 'mermaid-c4-component', name: 'Componentes (C4-N3)', rep: 'diagram' as const },
        { t: 'mermaid-c4-deployment', name: 'Despliegue', rep: 'diagram' as const },
        { t: 'mermaid-graph', name: 'Diagrama de Integración', rep: 'diagram' as const },
        { t: 'hybrid-text-diagram', name: 'Mapa de Flujo de Valor', rep: 'hybrid' as const },
        { t: 'hybrid-text-diagram', name: 'Modelo de Proceso de Negocio (BPMN)', rep: 'hybrid' as const },
    ];

    for (const { t, name, rep } of types) {
        it(`${t} (${name}) — skeleton parses to non-empty IR`, () => {
            const skeleton = buildDeterministicDiagramSkeleton(project, make(t as ArtifactTemplate['type'], name, rep));
            const ir = extractIRFromArtifact({ content: skeleton, representation: rep, type: t as ArtifactTemplate['type'] });
            expect(ir).not.toBeNull();
            expect((ir?.nodes.length ?? 0)).toBeGreaterThanOrEqual(2);
            expect((ir?.edges.length ?? 0)).toBeGreaterThanOrEqual(1);
        });
    }
});
