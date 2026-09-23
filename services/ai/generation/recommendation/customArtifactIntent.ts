/**
 * Intent analysis and catalogue scoring for "Artefacto a solicitud".
 *
 * Pure and deterministic: tokenises the request, scores it against eight
 * intents and ranks every catalogue template for it. The local ranker is the
 * first half of the recommendation and its safety net, so it has to work with
 * no model at all. Moved verbatim out of the engine in F5-01 (corte 4).
 */
import type { ArchitecturalView, ArtifactTemplate, ArtifactType } from '../../../../types';

export type CustomArtifactIntent = 'process' | 'data' | 'integration' | 'executive' | 'deployment' | 'sequence' | 'structure' | 'requirements';

export interface CustomArtifactIntentAnalysis {
    tokens: string[];
    scores: Record<CustomArtifactIntent, number>;
    primaryIntent: CustomArtifactIntent;
}

export interface CustomRecommendationCatalogCandidate {
    name: string;
    type: ArtifactType;
    phase: string;
    architecturalView: ArchitecturalView;
    representation: ArtifactTemplate['representation'];
    objective: string;
    score: number;
}

export interface CustomRecommendationContext {
    projectBrief: {
        name: string;
        description: string;
        totalContextItems: number;
        totalArtifacts: number;
    };
    relevantProjectContext: string[];
    artifactInventory: string[];
    catalogCandidates: CustomRecommendationCatalogCandidate[];
    heuristicTemplateName: string;
    deterministicIntent: CustomArtifactIntentAnalysis;
}

export const RECOMMENDATION_STOP_WORDS = new Set([
    'a', 'al', 'algo', 'ante', 'arquitectura', 'artefacto', 'asi', 'con', 'como', 'cual', 'cuando', 'de', 'del', 'desde',
    'diagrama', 'documento', 'el', 'en', 'es', 'esa', 'ese', 'esta', 'este', 'esto', 'flujo', 'generar', 'hacer', 'ia',
    'ilustre', 'la', 'las', 'lo', 'los', 'mas', 'mi', 'necesito', 'o', 'opcion', 'para', 'por', 'que', 'se', 'sin',
    'solicitud', 'solicitar', 'su', 'sus', 'un', 'una', 'usuario', 'workflow', 'the', 'and', 'for', 'to', 'of', 'in',
]);

export function normalizeRecommendationText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

export function tokenizeRecommendationText(value: string): string[] {
    return normalizeRecommendationText(value)
        .split(/[^a-z0-9]+/i)
        .map(token => token.trim())
        .filter(token => token.length >= 3 && !RECOMMENDATION_STOP_WORDS.has(token));
}

export function uniqueTokens(value: string): Set<string> {
    return new Set(tokenizeRecommendationText(value));
}

export function countTokenOverlap(text: string, tokens: Set<string>): number {
    if (tokens.size === 0) return 0;
    const textTokens = uniqueTokens(text);
    let matches = 0;
    for (const token of tokens) {
        if (textTokens.has(token)) matches += 1;
    }
    return matches;
}

export const INTENT_KEYWORDS: Record<CustomArtifactIntent, readonly string[]> = {
    process: ['flujo', 'workflow', 'proceso', 'paso', 'tramite', 'prescripcion', 'aprobacion', 'orquestacion', 'operativa', 'actividad', 'bpmn'],
    data: ['dato', 'datos', 'entidad', 'dominio', 'erd', 'catalogo', 'diccionario', 'informacion', 'modelo', 'dfd', 'logical', 'dataflow'],
    integration: ['api', 'integracion', 'conecta', 'externo', 'servicio', 'evento', 'mensajeria', 'interoperabilidad', 'webhook'],
    executive: ['comite', 'gerencia', 'directivo', 'ejecutivo', 'decision', 'aprobar', 'beneficio', 'riesgo', 'roi'],
    deployment: ['despliegue', 'infraestructura', 'cloud', 'kubernetes', 'ambiente', 'red', 'servidor', 'nube', 'devops'],
    sequence: ['secuencia', 'llamada', 'llamadas', 'mensaje', 'mensajes', 'conversacion', 'request', 'respuesta', 'cronologico', 'tiempo'],
    structure: ['modulo', 'modulos', 'sistema', 'sistemas', 'componente', 'componentes', 'actor', 'actores', 'interaccion', 'interacciones', 'dependencia', 'dependencias', 'mapa'],
    requirements: ['brecha', 'brechas', 'gap', 'gaps', 'requerimiento', 'requerimientos', 'requisito', 'requisitos', 'funcional', 'funcionales', 'nfr', 'rnf', 'pendiente', 'pendientes', 'cobertura', 'cubrir', 'faltante', 'faltantes', 'trazabilidad', 'srs'],
};

export function analyzeCustomArtifactIntent(idea: string): CustomArtifactIntentAnalysis {
    const normalizedIdea = normalizeRecommendationText(idea);
    const tokens = tokenizeRecommendationText(idea);
    const tokenSet = new Set(tokens);
    const scores = (Object.keys(INTENT_KEYWORDS) as CustomArtifactIntent[]).reduce((acc, intent) => {
        const exactMatches = INTENT_KEYWORDS[intent].filter(keyword => tokenSet.has(keyword)).length;
        const phraseMatches = INTENT_KEYWORDS[intent].filter(keyword => normalizedIdea.includes(keyword)).length;
        acc[intent] = exactMatches * 2 + phraseMatches;
        return acc;
    }, {} as Record<CustomArtifactIntent, number>);

    const primaryIntent = (Object.keys(scores) as CustomArtifactIntent[])
        .sort((a, b) => scores[b] - scores[a] || a.localeCompare(b))[0] ?? 'process';

    return { tokens: Array.from(new Set(tokens)).slice(0, 24), scores, primaryIntent };
}

export function isStructuralOverviewRequest(normalizedIdea: string): boolean {
    const hasOverviewScope = /\b(todo|todos|todas|mapa|represent(e|ar)|visualiz(a|ar)|panorama|vista\s+general)\b/.test(normalizedIdea);
    const structuralSignals = [
        /\bmodulo(s)?\b/,
        /\bsistema(s)?\b/,
        /\bcomponente(s)?\b/,
        /\bactor(es)?\b/,
        /\binteraccion(es)?\b/,
        /\bdependencia(s)?\b/,
    ].filter(pattern => pattern.test(normalizedIdea)).length;
    return structuralSignals >= 2 && (hasOverviewScope || /\binteraccion(es)?\b/.test(normalizedIdea));
}

export function isExplicitSequenceRequest(normalizedIdea: string): boolean {
    return /\b(secuencia|cronologico|paso\s+a\s+paso|linea\s+de\s+tiempo|llamada(s)?|mensaje(s)?|request|respuesta|conversacion)\b/.test(normalizedIdea)
        && !isStructuralOverviewRequest(normalizedIdea);
}


export function isExplicitDocumentRequest(normalizedIdea: string): boolean {
    return /\b(documento|informe|reporte|tabla|matriz|listado|lista|catalogo|inventario|especificacion|srs)\b/.test(normalizedIdea);
}

export function isExplicitDiagramRequest(normalizedIdea: string): boolean {
    return /\b(diagrama|diagramar|visual|visualizar|mapa|flujo|bpmn|erd|c4|secuencia)\b/.test(normalizedIdea);
}

export function scoreTemplateForCustomRecommendation(
    template: ArtifactTemplate,
    idea: string,
    projectSignal: string,
    intentAnalysis: CustomArtifactIntentAnalysis,
): number {
    const ideaTokens = uniqueTokens(idea);
    const projectTokens = uniqueTokens(projectSignal);
    const templateText = `${template.name} ${template.objective} ${template.type} ${template.phase} ${template.architecturalView} ${template.keyConcepts.map(c => `${c.term} ${c.definition}`).join(' ')}`;
    const normalizedIdea = normalizeRecommendationText(idea);
    const normalizedTemplateName = normalizeRecommendationText(template.name);

    let score = countTokenOverlap(templateText, ideaTokens) * 6;
    score += countTokenOverlap(templateText, projectTokens) * 1.5;

    if (intentAnalysis.scores.process > 0) {
        if (normalizedTemplateName.includes('proceso de negocio')) score += 32;
        if (normalizedTemplateName.includes('flujo de valor')) score += 20;
        if (template.architecturalView === 'Vista de Proceso e Interacción') score += 12;
        if (template.type === 'hybrid-text-diagram') score += 8;
    }
    if (intentAnalysis.scores.data > 0) {
        if (normalizedTemplateName.includes('flujo de datos')) score += /flujo\s+de\s+datos|dfd|data\s+flow/.test(normalizedIdea) ? 54 : 24;
        if (normalizedTemplateName.includes('dominio') || normalizedTemplateName.includes('datos')) score += 12;
        if (template.architecturalView === 'Vista de Datos') score += 12;
        if (template.type === 'mermaid-erd' || template.type === 'sdd-domain-model') score += 10;
    }
    if (intentAnalysis.scores.integration > 0) {
        if (normalizedTemplateName.includes('integracion')) score += 28;
        if (template.type === 'mermaid-graph' || template.type === 'mermaid-c4-container') score += 10;
    }
    if (intentAnalysis.scores.structure > 0) {
        if (template.type === 'mermaid-c4-container') score += 32;
        if (template.type === 'mermaid-graph') score += 30;
        if (normalizedTemplateName.includes('integracion')) score += 22;
        if (template.architecturalView === 'Vista Lógica y de Diseño') score += 14;
        if (template.architecturalView === 'Vista de Contexto y Negocio') score += 8;
    }
    if (intentAnalysis.scores.executive > 0) {
        if (normalizedTemplateName.includes('resumen ejecutivo')) score += 24;
        if (template.type === 'presentation-executive') score += 18;
        if (template.architecturalView === 'Vista de Contexto y Negocio') score += 8;
    }
    if (intentAnalysis.scores.requirements > 0) {
        if (normalizedTemplateName.includes('matriz de trazabilidad')) score += 46;
        if (normalizedTemplateName.includes('especificacion de requerimientos')) score += 40;
        if (normalizedTemplateName.includes('requisitos no funcionales')) score += 24;
        if (normalizedTemplateName.includes('requisitos de negocio')) score += 16;
        if (template.architecturalView === 'Vista SDD') score += 14;
        if (template.representation === 'document') score += 12;
    }
    if (intentAnalysis.scores.deployment > 0) {
        if (template.type === 'mermaid-c4-deployment') score += 28;
        if (template.architecturalView === 'Vista Física y de Despliegue') score += 14;
    }
    const structuralOverview = isStructuralOverviewRequest(normalizedIdea);
    const explicitSequence = isExplicitSequenceRequest(normalizedIdea);
    if (intentAnalysis.scores.sequence > 0) {
        if (template.type === 'mermaid-sequence') score += explicitSequence ? 28 : 8;
        if (template.architecturalView === 'Vista de Proceso e Interacción') score += explicitSequence ? 10 : 3;
    }
    if (structuralOverview && template.type === 'mermaid-sequence') {
        score -= 36;
    }

    const explicitDocument = isExplicitDocumentRequest(normalizedIdea);
    const explicitDiagram = isExplicitDiagramRequest(normalizedIdea);
    if (template.representation === 'diagram') score += explicitDiagram ? 8 : 0;
    if (template.representation === 'hybrid') score += normalizedIdea.includes('explicar') || normalizedIdea.includes('comunicar') ? 6 : 0;
    if (explicitDocument && !explicitDiagram) {
        if (template.representation === 'document') score += 30;
        if (template.representation === 'hybrid') score += 8;
        if (template.representation === 'diagram') score -= 34;
    }
    if (/\b(tabla|matriz|listado|lista)\b/.test(normalizedIdea) && !/\b(base\s+de\s+datos|modelo\s+de\s+datos|erd|entidad(es)?|diccionario\s+de\s+datos)\b/.test(normalizedIdea)) {
        if (template.representation === 'document') score += 14;
        if (template.representation === 'diagram') score -= 18;
    }

    return score;
}
