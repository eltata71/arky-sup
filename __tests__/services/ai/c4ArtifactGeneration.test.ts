/**
 * El camino C4 recibe el mismo contexto que los demás (plan de diagramas, 6.2):
 * la audiencia pedida, el nivel superior, la persona, la motivación y el IR
 * que reemplaza. Se dobla sólo la escalera de autocorrección para leer lo que
 * se le entrega.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactTemplate, Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR } from '../../../lib/diagram';
import type { Project } from '../../../services/architectureProjects';

const selfHealing = vi.hoisted(() => vi.fn());
vi.mock('../../../services/ai/generation/diagram/diagramIRGeneration', () => ({
    generateDiagramIRWithSelfHealing: selfHealing,
}));

const { generateC4ArtifactContent } = await import('../../../services/ai/generation/diagram/c4ArtifactGeneration');
const { artifactGenerationSupport } = await import('../../../services/artifacts');

const modelIR: DiagramIR = {
    nodes: [
        { id: 'api', label: 'API Reclamaciones', kind: 'service', technology: 'Spring Boot 3' },
        { id: 'bd', label: 'BD Reclamaciones', kind: 'data', technology: 'PostgreSQL 15' },
    ],
    edges: [{ id: 'e1', source: 'api', target: 'bd', label: 'Persiste', protocol: 'JDBC' }],
    groups: [],
};

const artifact = (over: Partial<Artifact>): Artifact => ({
    id: 'a', versionGroupId: 'g', version: 1, createdAt: '2026-09-01T00:00:00.000Z', name: 'x',
    type: 'mermaid-c4-context', phase: 'F', architecturalView: 'Vista Lógica y de Diseño', content: '',
    objective: '', keyConcepts: [], representation: 'diagram', ...over,
} as Artifact);

const project = (artifacts: Artifact[]): Project => ({
    id: 'p', name: 'Reclamaciones', description: 'Plataforma', projectContext: [], artifacts,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as Project);

const template = (requestContext?: ArtifactTemplate['requestContext']): ArtifactTemplate => ({
    name: 'Contenedores', type: 'mermaid-c4-container', phase: 'F', architecturalView: 'Vista Lógica y de Diseño',
    objective: 'Descomponer', keyConcepts: [], representation: 'diagram', requestContext,
} as ArtifactTemplate);

const settings = { language: 'es', aiConfig: { model: 'gemini-2.5-flash' } } as unknown as Settings;

beforeEach(() => {
    selfHealing.mockReset();
    selfHealing.mockResolvedValue({ ir: modelIR, attempts: 1, fallback: 'none', warnings: [] });
});

describe('generateC4ArtifactContent', () => {
    it('entrega el nivel superior más reciente, no el propio diagrama', async () => {
        const older = artifact({ id: 'c1', versionGroupId: 'ctx', name: 'Contexto viejo', createdAt: '2026-08-01T00:00:00.000Z', content: 'C4Context\n    System(viejo, "Sistema Viejo")' });
        const newer = artifact({
            id: 'c2', versionGroupId: 'ctx2', name: 'Contexto de Reclamaciones', createdAt: '2026-09-10T00:00:00.000Z',
            ir: { nodes: [{ id: 'ch', label: 'Clearinghouse', kind: 'external' }, { id: 'pl', label: 'Plataforma', kind: 'system', technology: 'Java' }], edges: [], groups: [] },
        });
        const previous = artifact({ id: 'prev', versionGroupId: 'own', type: 'mermaid-c4-container', ir: modelIR });
        await generateC4ArtifactContent(project([older, newer, previous]), template(), settings, previous, { support: artifactGenerationSupport });

        const [, , , opts] = selfHealing.mock.calls[0];
        expect(opts.brief).toContain('«Contexto de Reclamaciones»');
        expect(opts.brief).toContain('- Plataforma [Java]');
        expect(opts.brief).not.toContain('Sistema Viejo');
        expect(opts.previousIR).toBe(modelIR);
    });

    it('la audiencia que pidió el usuario gana a la de la versión anterior', async () => {
        const previous = artifact({ type: 'mermaid-c4-container', audience: 'technical' });
        await generateC4ArtifactContent(project([]), template({ userRequest: 'Para el comité', audience: 'executive' }), settings, previous, { support: artifactGenerationSupport });
        const [stub, , , opts] = selfHealing.mock.calls[0];
        expect(stub.audience).toBe('executive');
        expect(opts.brief).toContain('Para el comité');
    });

    it('compone la persona sobre la petición y entrega la motivación y el grafo', async () => {
        const compose = vi.fn(() => 'Persona especializada activa: Elena');
        await generateC4ArtifactContent(project([]), template({ userRequest: 'Elena, detalla los contenedores' }), settings, undefined, {
            support: artifactGenerationSupport,
            composePersonaInstruction: compose,
            architectureGraphPromptBlock: 'GRAFO DE CONOCIMIENTO',
            businessMotivation: [{ title: 'I', need: 'Pagar en 3 días', objectives: [], expectedOutcomes: [], kpis: [], regulatoryDrivers: [] }],
        });
        expect(compose).toHaveBeenCalledWith('', 'Elena, detalla los contenedores');
        const [, , , opts] = selfHealing.mock.calls[0];
        expect(opts.brief).toContain('Persona especializada activa: Elena');
        expect(opts.brief).toContain('GRAFO DE CONOCIMIENTO');
        expect(opts.brief).toContain('Pagar en 3 días');
    });

    it('un contexto sin nivel superior no inventa uno', async () => {
        await generateC4ArtifactContent(project([]), { ...template(), type: 'mermaid-c4-context' }, settings, undefined, { support: artifactGenerationSupport });
        const [, , , opts] = selfHealing.mock.calls[0];
        expect(opts.brief).not.toMatch(/NIVEL C4 SUPERIOR/);
    });

    it('entrega el IR del modelo y devuelve C4', async () => {
        const onDiagramIR = vi.fn();
        const mermaid = await generateC4ArtifactContent(project([]), template(), settings, undefined, { support: artifactGenerationSupport, onDiagramIR });
        expect(onDiagramIR).toHaveBeenCalledWith(modelIR);
        expect(mermaid.split('\n')[0]).toBe('C4Container');
    });
});
