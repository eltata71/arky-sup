import { describe, expect, it, vi } from 'vitest';
import { __test__, geminiService } from '../../services/geminiService';
import { Settings } from '../../types';
import type { ArtifactGenerationPhaseEvent } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

const {
    buildCustomArtifactRecommendationContext,
    buildHeuristicCustomArtifactRecommendation,
    buildDeterministicArtifactFallback,
    buildHybridMarkdownFromMermaid,
    analyzeCustomArtifactIntent,
    normalizeTemplateContract,
    buildOnDemandArtifactName,
    calibrateRecommendationConfidence,
    deduplicateOnDemandArtifactName,
    emitGenerationPhase,
    buildOnDemandDocumentReinforcement,
    CUSTOM_RECOMMENDATION_TIMEOUT_MS,
    CUSTOM_RECOMMENDATION_MAX_RETRIES,
} = __test__;

const project: Project = {
    id: 'health-001',
    name: 'Modernización de plataforma clínica',
    description: 'Proyecto para interoperabilidad sanitaria, seguridad del paciente e integración con farmacias.',
    projectContext: [
        'El canal de admisión captura datos demográficos del paciente.',
        'La prescripción electrónica debe validar interacciones, dosis, cobertura y autorización antes de dispensar medicamentos.',
        'La arquitectura debe considerar auditoría clínica, trazabilidad y cumplimiento regulatorio.',
        'Existen integraciones con farmacia, aseguradora, expediente clínico y notificaciones al paciente.',
    ],
    artifacts: [
        {
            id: 'a1',
            versionGroupId: 'vg1',
            version: 1,
            name: 'Diagrama de Integración',
            type: 'mermaid-graph',
            phase: 'Fase 2: Diseño Conceptual y Lógico',
            architecturalView: 'Vista Lógica y de Diseño',
            objective: 'Visualizar integraciones entre expediente clínico, farmacia y autorizador.',
            keyConcepts: [],
            representation: 'diagram',
            content: '',
            createdAt: '2026-05-01T00:00:00.000Z',
        },
    ],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
};

describe('custom artifact recommendation context', () => {
    it('uses the full project context for ranking while sending a bounded digest to Gemini', () => {
        const context = buildCustomArtifactRecommendationContext(
            project,
            'Diagrama que ilustre el flujo de trabajo para la prescripción electrónica de medicamentos',
        );

        expect(context.projectBrief.totalContextItems).toBe(project.projectContext.length);
        expect(context.relevantProjectContext[0]).toMatch(/prescripción electrónica/i);
        expect(context.artifactInventory[0]).toContain('Diagrama de Integración');
        expect(context.catalogCandidates[0].name).toBe('Modelo de Proceso de Negocio (BPMN)');
        expect(context.deterministicIntent.primaryIntent).toBe('process');
        expect(context.catalogCandidates.length).toBeLessThanOrEqual(10);
    });

    it('classifies architectural intent deterministically before consulting Gemini', () => {
        const sequenceIntent = analyzeCustomArtifactIntent('Secuencia de llamadas API entre portal, autorizador, farmacia y expediente clínico');
        expect(sequenceIntent.primaryIntent).toBe('sequence');
        expect(sequenceIntent.scores.sequence).toBeGreaterThan(0);
        expect(sequenceIntent.tokens).toContain('llamadas');
    });

    it('routes structural overview requests to an integration/container diagram instead of sequence', () => {
        const idea = 'Diagrama que represente todos los módulos, sistemas, actores y sus interacciones';
        const context = buildCustomArtifactRecommendationContext(project, idea);
        const recommendation = buildHeuristicCustomArtifactRecommendation(project, idea);

        expect(context.deterministicIntent.primaryIntent).toBe('structure');
        expect(recommendation.template.type).not.toBe('mermaid-sequence');
        expect(['mermaid-graph', 'mermaid-c4-container']).toContain(recommendation.template.type);
    });

    it('honors explicit document/table requests for requirement gap analysis instead of recommending diagrams', () => {
        const idea = 'Cuáles son todas las brechas? Es decir, requerimientos funcionales y no funcionales que están pendientes de cubrir en este proyecto. Genera el resultado en un artefacto tipo documento con una tabla que contenga el listado de todas las brechas.';
        const context = buildCustomArtifactRecommendationContext(project, idea);
        const recommendation = buildHeuristicCustomArtifactRecommendation(project, idea);

        expect(context.deterministicIntent.primaryIntent).toBe('requirements');
        expect(recommendation.template.representation).toBe('document');
        expect(recommendation.template.type).not.toMatch(/^mermaid/);
        expect(['Matriz de Trazabilidad de Requisitos', 'Especificación de Requerimientos (SRS)']).toContain(recommendation.matchedCatalogTemplateName);
        expect(recommendation.template.requestContext?.userRequest).toBe(idea);
    });

    it('builds a deterministic process recommendation when Gemini times out or is unavailable', () => {
        const recommendation = buildHeuristicCustomArtifactRecommendation(
            project,
            'Diagrama que ilustre el flujo de trabajo para la prescripción electrónica de medicamentos',
        );

        expect(recommendation.matchedCatalogTemplateName).toBe('Modelo de Proceso de Negocio (BPMN)');
        expect(recommendation.template.type).toBe('hybrid-text-diagram');
        expect(recommendation.rationale).toMatch(/contexto completo del proyecto/i);
        expect(recommendation.constructionPlan.join(' ')).toMatch(/inventario de artefactos/i);
    });

    it('assigns a request-specific name to on-demand artifacts to avoid catalog-name collisions', () => {
        const idea = 'Diagrama que ilustre el flujo de trabajo para la prescripción electrónica de medicamentos';
        const recommendation = buildHeuristicCustomArtifactRecommendation(project, idea);

        expect(recommendation.template.name).toContain('Modelo de Proceso de Negocio (BPMN) —');
        expect(recommendation.template.name).toMatch(/prescripción electrónica/i);
        expect(recommendation.template.name).not.toBe(recommendation.matchedCatalogTemplateName);
    });

    it('builds bounded, descriptive on-demand names from long requests', () => {
        const name = buildOnDemandArtifactName(
            'Modelo de Proceso de Negocio (BPMN)',
            'Necesito un diagrama extremadamente detallado para explicar el flujo completo de autorización clínica con múltiples sistemas externos, validaciones y aprobaciones ejecutivas',
        );

        expect(name).toMatch(/^Modelo de Proceso de Negocio \(BPMN\) —/);
        expect(name.length).toBeLessThanOrEqual(96);
        expect(name).toMatch(/flujo completo|diagrama extremadamente/i);
    });

    it('preserves the original on-demand request in the generation template context', () => {
        const idea = 'Diagrama que ilustre el flujo de trabajo para la prescripción electrónica de medicamentos';
        const recommendation = buildHeuristicCustomArtifactRecommendation(project, idea);

        expect(recommendation.template.requestContext?.userRequest).toBe(idea);
        expect(recommendation.template.requestContext?.matchedCatalogTemplateName).toBe('Modelo de Proceso de Negocio (BPMN)');
    });

    it('wraps raw fallback Mermaid as a valid hybrid artifact with one Mermaid fence', () => {
        const template = buildHeuristicCustomArtifactRecommendation(
            project,
            'Diagrama que ilustre el flujo de trabajo para la prescripción electrónica de medicamentos',
        ).template;

        const content = buildHybridMarkdownFromMermaid(template, `flowchart LR\n    a[Inicio] --> b[Fin]`);

        expect(content).toContain('## Solicitud original');
        expect((content.match(/```mermaid/g) ?? []).length).toBe(1);
        expect(content).toContain('flowchart LR');
        expect(content).toContain('a[Inicio] --> b[Fin]');
    });

    it('normalizes AI recommendation type/representation mismatches before generation', () => {
        const template = normalizeTemplateContract({
            name: 'Proceso solicitado',
            type: 'hybrid-text-diagram',
            phase: 'Fase 1: Estratégica y de Visión de Negocio',
            architecturalView: 'Vista de Contexto y Negocio',
            objective: 'Representar proceso solicitado.',
            keyConcepts: [],
            representation: 'document',
        });

        expect(template.representation).toBe('hybrid');
    });

    it('builds an on-demand BPMN fallback that preserves the architect request and remains renderable', () => {
        const template = buildHeuristicCustomArtifactRecommendation(
            project,
            'Diagrama de flujo de trabajo de prescripción electrónica: creación de receta',
        ).template;

        const content = buildDeterministicArtifactFallback(project, template);

        expect(content).toContain('Solicitud original');
        expect(content).toMatch(/prescripción electrónica/i);
        expect(content).toContain('```mermaid');
        expect(content).toMatch(/flowchart LR/i);
    });

    it('builds non-empty compatible local artifact content when generation cannot reach Gemini', () => {
        const template = buildHeuristicCustomArtifactRecommendation(
            project,
            'Diagrama que ilustre el flujo de trabajo para la prescripción electrónica de medicamentos',
        ).template;

        const content = buildDeterministicArtifactFallback(project, template);

        expect(content).toContain('```mermaid');
        expect(content).toMatch(/flowchart/i);
        expect(content).toMatch(/Modernización de plataforma clínica/i);
    });
});

describe('recommendation tuning constants', () => {
    it('uses a thinking-friendly timeout and one safety retry', () => {
        // Guards against silent regressions to the previous off-budget,
        // zero-retry configuration that masked Gemini saturation as fallback.
        expect(CUSTOM_RECOMMENDATION_TIMEOUT_MS).toBeGreaterThanOrEqual(20000);
        expect(CUSTOM_RECOMMENDATION_MAX_RETRIES).toBeGreaterThanOrEqual(1);
    });
});

describe('calibrateRecommendationConfidence', () => {
    it('rewards a clear winner with higher confidence than a tied race', () => {
        const clearWinner = calibrateRecommendationConfidence(80, 10);
        const tightRace = calibrateRecommendationConfidence(40, 38);
        expect(clearWinner).toBeGreaterThan(tightRace);
        expect(clearWinner).toBeLessThanOrEqual(0.97);
        expect(tightRace).toBeGreaterThanOrEqual(0.55);
    });

    it('returns the floor when the top candidate has no score', () => {
        expect(calibrateRecommendationConfidence(0, 0)).toBe(0.6);
        expect(calibrateRecommendationConfidence(-10, 0)).toBe(0.6);
    });
});

describe('deduplicateOnDemandArtifactName', () => {
    it('returns the candidate untouched when no collision exists', () => {
        const result = deduplicateOnDemandArtifactName(
            'Modelo de Proceso de Negocio (BPMN) — prescripción electrónica',
            ['Vista Lógica', 'Diagrama de Datos'],
        );
        expect(result).toBe('Modelo de Proceso de Negocio (BPMN) — prescripción electrónica');
    });

    it('appends a version suffix when an artifact already uses the same name', () => {
        const candidate = 'Modelo de Proceso de Negocio (BPMN) — prescripción electrónica';
        const result = deduplicateOnDemandArtifactName(candidate, [candidate]);
        expect(result).toBe(`${candidate} (v2)`);
    });

    it('keeps incrementing the suffix on repeated collisions', () => {
        const candidate = 'Diagrama de integraciones';
        const taken = [candidate, `${candidate} (v2)`, `${candidate} (v3)`];
        const result = deduplicateOnDemandArtifactName(candidate, taken);
        expect(result).toBe(`${candidate} (v4)`);
    });
});

describe('emitGenerationPhase', () => {
    it('forwards events to the listener with timestamps and computes durations', async () => {
        const events: ArtifactGenerationPhaseEvent[] = [];
        const timings = new Map<string, number>();
        emitGenerationPhase(
            (event: ArtifactGenerationPhaseEvent) => events.push(event),
            { stage: 'recommendation', status: 'in-progress', message: 'starting' },
            timings,
        );
        // Wait a tiny bit so the duration is measurable across runtimes.
        await new Promise(resolve => setTimeout(resolve, 5));
        emitGenerationPhase(
            (event: ArtifactGenerationPhaseEvent) => events.push(event),
            { stage: 'recommendation', status: 'success', message: 'finished' },
            timings,
        );
        expect(events).toHaveLength(2);
        expect(events[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('never lets a throwing listener break the pipeline', () => {
        const listener = vi.fn(() => {
            throw new Error('boom');
        });
        expect(() => emitGenerationPhase(listener, {
            stage: 'ai-generation', status: 'success', message: 'safe',
        })).not.toThrow();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('buildOnDemandDocumentReinforcement', () => {
    it('returns an empty string for catalog templates without requestContext', () => {
        const baseTemplate = buildHeuristicCustomArtifactRecommendation(project, 'idea').template;
        expect(buildOnDemandDocumentReinforcement({ ...baseTemplate, requestContext: undefined })).toBe('');
    });

    it('emits an executive directive when the audience is executive', () => {
        const baseTemplate = buildHeuristicCustomArtifactRecommendation(project, 'comité gerencial debe aprobar la modernización del core para reducir riesgos').template;
        const reinforcement = buildOnDemandDocumentReinforcement({
            ...baseTemplate,
            requestContext: { ...(baseTemplate.requestContext ?? { userRequest: 'idea' }), audience: 'executive' },
        });
        expect(reinforcement).toContain('Audiencia ejecutiva');
        expect(reinforcement).toContain('TL;DR');
        expect(reinforcement).toContain('Validaciones recomendadas');
    });

    it('emits the technical directive when the audience is technical', () => {
        const baseTemplate = buildHeuristicCustomArtifactRecommendation(project, 'flujo técnico de validación de prescripciones electrónicas con NFRs').template;
        const reinforcement = buildOnDemandDocumentReinforcement({
            ...baseTemplate,
            requestContext: { ...(baseTemplate.requestContext ?? { userRequest: 'idea' }), audience: 'technical' },
        });
        expect(reinforcement).toContain('Audiencia técnica');
        expect(reinforcement).toContain('NFRs');
    });
});

describe('pharmacy claims on-demand fallback regression', () => {
    it('produces a BPMN-style hybrid artifact with visible markdown, Mermaid, IR and ReactFlow nodes', async () => {
        const idea = 'Se requiere ilustrar mediante un diagrama el proceso de pago de reclamos de farmacia, desde el momento en que se dispensa la receta hasta cuando finalmente la farmacia recibe el pago por parte de la compañía de seguros.';
        const recommendation = buildHeuristicCustomArtifactRecommendation(project, idea);
        const content = buildDeterministicArtifactFallback(project, recommendation.template);
        const { extractMermaid } = await import('../../utils/diagram/extractMermaid');
        const { mermaidToIR } = await import('../../services/diagram/mermaidToIR');
        const { irToReactFlow } = await import('../../services/diagram/irToReactFlow');

        expect(recommendation.template.type).toBe('hybrid-text-diagram');
        expect(content).toContain('# ');
        expect(content).toContain('## Resumen');
        expect(content).toContain('## Alcance del proceso');
        expect(content).toContain('## Actores / lanes');
        expect(content).toContain('```mermaid');
        expect(content).toMatch(/Farmacia|Aseguradora|reclamo/i);

        const extracted = extractMermaid(content, 'hybrid');
        expect(extracted.ok).toBe(true);
        if (!('code' in extracted)) {
            throw new Error(extracted.reason);
        }
        const ir = mermaidToIR(extracted.code);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(8);
        expect(ir.groups.length).toBeGreaterThanOrEqual(3);
        const flow = irToReactFlow(ir);
        expect(flow.nodes.length).toBeGreaterThan(0);
    });
});

describe('recommendCustomArtifactTemplate fallback behavior', () => {
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

    const ambiguousProject: Project = {
        ...project,
        description: 'Proyecto con contexto pendiente de clasificar.',
        projectContext: [],
        artifacts: [],
    };

    it('uses local deterministic recommendation when Gemini returns invalid JSON', async () => {
        const spy = vi.spyOn(geminiService, 'getAIClient').mockReturnValue({
            models: {
                generateContent: vi.fn().mockResolvedValue({ text: '{"matchedCatalogTemplateName":"Resumen de Arquitectura"' }),
            },
        } as unknown as ReturnType<typeof geminiService.getAIClient>);
        const events: ArtifactGenerationPhaseEvent[] = [];

        const result = await geminiService.recommendCustomArtifactTemplate(
            ambiguousProject,
            'Necesito ayuda para decidir qué producir',
            settings,
            { onPhase: event => events.push(event) },
        );

        expect(result.template.name).toBeTruthy();
        expect(result.template.requestContext?.userRequest).toMatch(/decidir qué producir/i);
        // After the tolerant parser was introduced, malformed JSON now has
        // two valid recovery paths: (1) auto-repair via `parseAiJson` (emits
        // a `reparaciones` warning), or (2) fall through to the deterministic
        // local recommendation (emits a `determinista` warning). Either path
        // is acceptable — what matters is that a visible warning event was
        // recorded so the user can inspect the trace.
        expect(events.some(event => event.status === 'warning' && /determinista|reparaciones|reparar/i.test(event.message))).toBe(true);
        spy.mockRestore();
    });

    it('uses local deterministic recommendation when Gemini throws', async () => {
        const spy = vi.spyOn(geminiService, 'getAIClient').mockReturnValue({
            models: {
                generateContent: vi.fn().mockRejectedValue({ status: 400, message: 'Invalid responseSchema field' }),
            },
        } as unknown as ReturnType<typeof geminiService.getAIClient>);

        const result = await geminiService.recommendCustomArtifactTemplate(
            ambiguousProject,
            'Necesito ayuda para decidir qué producir',
            settings,
        );

        expect(result.template.requestContext?.rationale).toMatch(/Recomendación local de respaldo/i);
        expect(result.template.representation).toBeTruthy();
        spy.mockRestore();
    });
});
