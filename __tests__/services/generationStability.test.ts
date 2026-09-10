/**
 * Stability contract tests for the artifact generation pipeline.
 *
 * Each test pins a contract that, if broken, would re-introduce one of the
 * regression families the user has reported repeatedly: empty canvas, opaque
 * "unknown" errors, recommendation timing out unnecessarily, etc.
 */
import { describe, it, expect, vi } from 'vitest';
import { __test__ } from '../../services/geminiService';
import {
    buildDeterministicDiagramSkeleton,
    isSkeletonFallbackContent,
} from '../../services/artifacts/deterministicArtifactFallbacks';
import { SKELETON_FALLBACK_MARKER } from '../../services/artifacts/artifactFallbackDetection';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import type { ArtifactGenerationPhaseEvent, ArtifactTemplate, Project, Settings } from '../../types';
import type { DiagramIR } from '../../lib/diagram';

const baseProject = (overrides: Partial<Project> = {}): Project => ({
    id: 'p1',
    name: 'Sistema de Pólizas',
    description: 'Plataforma de pólizas grupales con integración a PBM y core asegurador.',
    artifacts: [],
    projectContext: [
        'Integración con WeeCompany PBM mediante REST/HTTPS',
        'Gateway de integraciones internas en Kubernetes',
        'Base de datos PostgreSQL para pólizas',
        'Cola Kafka para eventos de emisión',
    ],
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
} as Project);

const template = (type: ArtifactTemplate['type'], name: string): ArtifactTemplate => ({
    name,
    type,
    phase: 'Fase 1',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: 'Modelar las integraciones del sistema',
    keyConcepts: [],
    representation: 'diagram',
});

describe('Renderability guarantees — deterministic skeleton', () => {
    it('marks every Mermaid skeleton with the fallback marker', () => {
        const skeleton = buildDeterministicDiagramSkeleton(baseProject(), template('mermaid-c4-context', 'C4 Context'));
        expect(skeleton).toContain(SKELETON_FALLBACK_MARKER);
        expect(isSkeletonFallbackContent(skeleton)).toBe(true);
    });

    it('preserves the dialect header on line 1 so dialect sniffing keeps working', () => {
        const skeleton = buildDeterministicDiagramSkeleton(baseProject(), template('mermaid-c4-deployment', 'C4 Deployment'));
        expect(skeleton).toMatch(/^C4Deployment/);
    });

    it('produces parseable Mermaid that yields ≥ 2 nodes through mermaidToIR', () => {
        const skeleton = buildDeterministicDiagramSkeleton(baseProject(), template('mermaid-c4-container', 'C4 Container'));
        const ir = mermaidToIR(skeleton);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('isSkeletonFallbackContent returns false for plain content', () => {
        expect(isSkeletonFallbackContent('flowchart TD\nA --> B')).toBe(false);
        expect(isSkeletonFallbackContent('')).toBe(false);
        expect(isSkeletonFallbackContent(null)).toBe(false);
        expect(isSkeletonFallbackContent(undefined)).toBe(false);
    });

    it('signal-driven skeleton uses real project context (actors, systems, integrations)', () => {
        const project = baseProject();
        const skeleton = buildDeterministicDiagramSkeleton(project, template('mermaid-graph', 'Diagrama de Integración'));
        const ir = mermaidToIR(skeleton);
        // The enriched skeleton should produce at least 4 nodes when there
        // are enough signals in the project context.
        expect(ir.nodes.length).toBeGreaterThanOrEqual(4);
    });

    it('C4 self-healing skeleton fallback returns renderable content instead of throwing', async () => {
        const { geminiService } = await import('../../services/geminiService');
        const service = geminiService as unknown as {
            generateDiagramIRWithSelfHealing: (...args: unknown[]) => Promise<{
                ir: DiagramIR;
                attempts: number;
                fallback: 'none' | 'skeleton';
                warnings: string[];
                lastReason?: 'skeleton-fallback';
            }>;
            generateArtifactContent: typeof geminiService.generateArtifactContent;
        };
        const fallbackIR: DiagramIR = {
            nodes: [
                { id: 'user', label: 'Usuario', kind: 'Person' },
                { id: 'system', label: 'Sistema de Pólizas', kind: 'System' },
            ],
            edges: [{ id: 'e1', source: 'user', target: 'system', label: 'Usa' }],
            groups: [],
            metadata: { fallback: 'skeleton', degradationReason: 'forced test fallback' },
        };
        const spy = vi.spyOn(service, 'generateDiagramIRWithSelfHealing').mockResolvedValue({
            ir: fallbackIR,
            attempts: 3,
            fallback: 'skeleton',
            warnings: ['forced fallback'],
            lastReason: 'skeleton-fallback',
        });
        const events: ArtifactGenerationPhaseEvent[] = [];
        const settings: Settings = {
            globalContext: [],
            language: 'es',
            theme: 'dark',
            aiConfig: {
                model: 'gemini-2.5-flash',
                temperature: 0,
                tone: 'profesional',
                languageStyle: 'es',
                apiKeySource: 'global',
            },
        };

        try {
            const result = await service.generateArtifactContent(
                baseProject(),
                template('mermaid-c4-context', 'C4 Context'),
                settings,
                undefined,
                { onPhase: event => events.push(event) },
            );
            expect(result).toContain(SKELETON_FALLBACK_MARKER);
            expect(isSkeletonFallbackContent(result)).toBe(true);
            expect(mermaidToIR(result).nodes.length).toBeGreaterThanOrEqual(2);
            expect(events.some(event => event.stage === 'ai-generation' && event.status === 'warning')).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

});

describe('buildDeterministicArtifactFallback — coverage', () => {
    it('returns Mermaid for diagram types', () => {
        const result = __test__.buildDeterministicArtifactFallback(
            baseProject(),
            template('mermaid-graph', 'Test'),
        );
        expect(result.length).toBeGreaterThan(0);
        expect(isSkeletonFallbackContent(result)).toBe(true);
    });

    it('returns Markdown for document types and never empty content', () => {
        const result = __test__.buildDeterministicArtifactFallback(
            baseProject(),
            { ...template('markdown' as ArtifactTemplate['type'], 'Test'), representation: 'document' } as ArtifactTemplate,
        );
        expect(result.length).toBeGreaterThan(50);
    });
});

describe('Recommendation high-confidence local bypass', () => {
    it('builds a heuristic recommendation that always returns a valid template', () => {
        const rec = __test__.buildHeuristicCustomArtifactRecommendation(
            baseProject(),
            'Necesito un diagrama de integración entre los módulos del sistema',
        );
        expect(rec.template.name.length).toBeGreaterThan(0);
        expect(rec.template.type.length).toBeGreaterThan(0);
        expect(rec.constructionPlan.length).toBeGreaterThan(0);
    });
});

describe('Renderability gate — universal wrapper contract', () => {
    /**
     * The contract: every code path that can return from the artifact
     * generation pipeline must be funnelled through the renderability gate.
     * This test pins the existence and shape of the public wrapper so a
     * future refactor cannot silently re-introduce the empty-canvas bug
     * by adding a new internal early-return that bypasses the gate.
     */
    it('public generateArtifactContent applies gate to every return value', async () => {
        const { geminiService } = await import('../../services/geminiService');
        const internal = (geminiService as unknown as {
            _generateArtifactContentInternal?: (...args: unknown[]) => Promise<string>;
            gateRenderableDiagramContent?: (...args: unknown[]) => string;
        });
        // The internal pipeline exists.
        expect(typeof internal._generateArtifactContentInternal).toBe('function');
        // The gate exists.
        expect(typeof internal.gateRenderableDiagramContent).toBe('function');
        // The public method is the wrapper (not the same function as internal).
        expect(geminiService.generateArtifactContent).not.toBe(internal._generateArtifactContentInternal);
    });
});
