/**
 * Read a model's recommendation back into a `CustomArtifactRecommendation`,
 * trusting nothing: every field is checked against the catalogue's own
 * vocabulary and falls back to the matched template, and the model's
 * self-reported confidence is blended with the local ranking gap.
 * Moved out of the engine in F5-01 (corte 4).
 */
import { ARTIFACT_TEMPLATES } from '../../../../constants';
import type { ArchitecturalView, ArtifactTemplate, ArtifactType, CustomArtifactRecommendation } from '../../../../types';
import {
    buildOnDemandArtifactName,
    calibrateRecommendationConfidence,
    isCatalogTemplateName,
    normalizeTemplateContract,
} from './customArtifactHeuristics';
import type { CustomRecommendationContext } from './customArtifactIntent';

export function normalizeCustomArtifactRecommendation(
    raw: Record<string, unknown>,
    idea: string,
    context?: CustomRecommendationContext,
): CustomArtifactRecommendation {
    const artifactTypes: readonly ArtifactType[] = [
        'markdown', 'yaml', 'hybrid-text-diagram', 'mermaid-c4-context', 'mermaid-c4-container',
        'mermaid-c4-component', 'mermaid-c4-deployment', 'mermaid-erd', 'mermaid-sequence',
        'mermaid-graph', 'mermaid-state', 'mermaid-gantt', 'react-flow-graph',
        'presentation-executive', 'presentation-technical', 'sdd-brd', 'sdd-use-case',
        'sdd-user-story', 'sdd-domain-model', 'sdd-event-storming', 'sdd-glossary',
        'sdd-nfr', 'sdd-bdd', 'sdd-traceability',
    ];
    const architecturalViews: readonly ArchitecturalView[] = [
        'Vista de Contexto y Negocio',
        'Vista Lógica y de Diseño',
        'Vista de Datos',
        'Vista de Proceso e Interacción',
        'Vista Física y de Despliegue',
        'Vista de Gestión y Soporte',
        'Vista de Calidad y Validación',
        'Vista SDD',
    ];
    const phases = [...new Set(ARTIFACT_TEMPLATES.map(template => template.phase))];
    const representations: ReadonlyArray<ArtifactTemplate['representation']> = ['diagram', 'document', 'hybrid'];
    const audiences: ReadonlyArray<CustomArtifactRecommendation['audience']> = ['technical', 'executive', 'mixed'];

    const pickString = (value: unknown, fallback: string): string => {
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
    };
    const pickFrom = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
        return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
    };

    const matchedName = pickString(raw.matchedCatalogTemplateName, '');
    const matchedTemplate = ARTIFACT_TEMPLATES.find(template => template.name === matchedName);
    const fallbackTemplate = matchedTemplate ?? ARTIFACT_TEMPLATES.find(template => template.name === 'Resumen de Arquitectura') ?? ARTIFACT_TEMPLATES[0];
    const selectedType = pickFrom(raw.type, artifactTypes, fallbackTemplate.type);
    const selectedRepresentation = pickFrom(
        raw.representation,
        representations,
        selectedType.startsWith('mermaid') || selectedType === 'react-flow-graph' ? 'diagram' : selectedType === 'hybrid-text-diagram' ? 'hybrid' : 'document'
    );
    const keyConcepts = Array.isArray(raw.keyConcepts)
        ? raw.keyConcepts.slice(0, 6).map(item => {
            const concept = item as Record<string, unknown>;
            return {
                term: pickString(concept.term, 'Concepto arquitectónico'),
                definition: pickString(concept.definition, 'Concepto relevante para representar la idea solicitada.'),
            };
        })
        : [];
    const constructionPlan = Array.isArray(raw.constructionPlan)
        ? raw.constructionPlan.map(step => pickString(step, '')).filter(Boolean).slice(0, 5)
        : [];
    // Blend the model's self-reported confidence with the deterministic
    // ranking gap so the displayed percentage reflects how clearly the
    // top candidate beats the runner-up — not just the model's optimism.
    const modelConfidenceRaw = typeof raw.confidence === 'number' ? raw.confidence : 0.7;
    const calibrated = context
        ? calibrateRecommendationConfidence(
            context.catalogCandidates[0]?.score ?? 0,
            context.catalogCandidates[1]?.score ?? 0,
        )
        : modelConfidenceRaw;
    const confidenceRaw = context
        ? Number(((modelConfidenceRaw * 0.5) + (calibrated * 0.5)).toFixed(2))
        : modelConfidenceRaw;

    return {
        template: normalizeTemplateContract({
            name: (() => {
                const rawName = pickString(raw.name, '');
                if (!rawName || rawName === matchedTemplate?.name || isCatalogTemplateName(rawName)) {
                    return buildOnDemandArtifactName(matchedTemplate?.name ?? fallbackTemplate.name, idea);
                }
                return rawName.length > 96 ? `${rawName.slice(0, 93).trimEnd()}…` : rawName;
            })(),
            type: selectedType,
            phase: pickFrom(raw.phase, phases, fallbackTemplate.phase),
            architecturalView: pickFrom(raw.architecturalView, architecturalViews, fallbackTemplate.architecturalView),
            objective: pickString(raw.objective, `Representar la idea solicitada por el arquitecto: ${idea}`),
            keyConcepts: keyConcepts.length > 0 ? keyConcepts : fallbackTemplate.keyConcepts,
            representation: selectedRepresentation,
            requestContext: {
                userRequest: idea,
                rationale: pickString(raw.rationale, 'La recomendación equilibra claridad visual, trazabilidad arquitectónica y compatibilidad con el catálogo de generación.'),
                constructionPlan: constructionPlan.length > 0 ? constructionPlan : [
                    'Conceptualizar la intención del arquitecto y los mensajes clave.',
                    'Seleccionar la vista arquitectónica y representación más clara.',
                    'Generar el contenido con los estándares del proyecto y dejarlo editable en el canvas.',
                ],
                matchedCatalogTemplateName: matchedTemplate?.name,
                audience: pickFrom(raw.audience, audiences, 'mixed'),
            },
        }),
        matchedCatalogTemplateName: matchedTemplate?.name,
        rationale: pickString(raw.rationale, 'La recomendación equilibra claridad visual, trazabilidad arquitectónica y compatibilidad con el catálogo de generación.'),
        constructionPlan: constructionPlan.length > 0 ? constructionPlan : [
            'Conceptualizar la intención del arquitecto y los mensajes clave.',
            'Seleccionar la vista arquitectónica y representación más clara.',
            'Generar el contenido con los estándares del proyecto y dejarlo editable en el canvas.',
        ],
        audience: pickFrom(raw.audience, audiences, 'mixed'),
        confidence: Math.max(0, Math.min(1, confidenceRaw)),
    };
}
