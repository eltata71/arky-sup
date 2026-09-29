/**
 * What a diagram generation must know about the request, in one block
 * (plan de diagramas, 6.2).
 *
 * The C4 path — the most used diagrams in the product — reached the model
 * with less context than any other: it returned before the engine resolved
 * the knowledge graph, the persona and the request, so the prompt carried the
 * catalogue objective and little else. "Hazlo para el comité ejecutivo" was
 * generated as a technical diagram; a container diagram invented new names
 * for the systems its own context diagram had already named; and nothing told
 * the model which business need the diagram served.
 *
 * This composes that context once, for any IR path:
 *
 * - the **request** as the user wrote it, its audience, its acceptance
 *   criteria and the approved plan — the thing the diagram must answer;
 * - the **output language**, which the IR path never stated;
 * - the **business motivation** of the initiatives the project answers;
 * - the **C4 level above**, so a detail reuses the names of its parent;
 * - the **persona** and the **knowledge graph**, already composed by callers.
 *
 * Everything the application did not write is fenced
 * (`wrapUntrustedContent`); the instructions about it stay outside the fence,
 * so the model reads the request as data to answer and never as orders that
 * replace its own.
 */
import type { ArtifactTemplate, Settings } from '../../../types';
import type { ArtifactBusinessMotivation } from '../../../lib/artifacts';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';

/** The diagram one level up, as the brief needs it: names, not geometry. */
export interface UpperLevelDiagram {
    name: string;
    /** Element labels, with their technology when declared: «API Reclamaciones [Spring Boot 3]». */
    elements: readonly string[];
}

export interface DiagramBriefInput {
    template: Pick<ArtifactTemplate, 'name' | 'type' | 'objective' | 'requestContext'>;
    language: Settings['language'] | undefined;
    businessMotivation?: readonly ArtifactBusinessMotivation[];
    upperLevel?: UpperLevelDiagram | null;
    /** Already composed and budgeted by `buildArtifactGenerationGraphContext`. */
    architectureGraphBlock?: string;
    /** Already composed by the Office's persona port. */
    personaInstruction?: string;
}

const AUDIENCE_LABEL: Record<string, string> = {
    executive: 'comité ejecutivo — lenguaje de negocio, sin protocolos ni siglas, 4–8 elementos',
    technical: 'arquitectos e ingenieros — tecnologías y protocolos explícitos',
    mixed: 'mixta — mensaje de negocio legible, con la tecnología justa para implementarlo',
};

/** The one sentence that fixes the language of every label, description and story. */
export function buildOutputLanguageDirective(language: Settings['language'] | undefined): string {
    return language === 'en'
        ? 'OUTPUT LANGUAGE: write every label, description and narrative in English. Ids stay ASCII kebab-case.'
        : 'IDIOMA DE SALIDA: escribe en español todas las etiquetas, descripciones y la narrativa. Los ids siguen en kebab-case ASCII; los nombres propios de productos y estándares (FHIR, X12, Kafka) no se traducen.';
}

function renderRequest(template: DiagramBriefInput['template']): string {
    const request = template.requestContext;
    if (!request?.userRequest?.trim()) return '';
    const criteria = request.generationContract?.acceptanceCriteria?.length
        ? request.generationContract.acceptanceCriteria
        : request.acceptanceCriteria ?? [];
    const plan = request.constructionPlan ?? [];
    const lines = [
        'SOLICITUD DEL USUARIO — el diagrama debe responderla directamente; no produzcas un ejemplo genérico del tipo.',
        wrapUntrustedContent('solicitud', request.userRequest.trim()),
    ];
    if (request.audience) lines.push(`Audiencia pedida: ${AUDIENCE_LABEL[request.audience] ?? request.audience}. Manda sobre cualquier otra indicación de audiencia.`);
    if (criteria.length) {
        lines.push('Criterios de aceptación — cubre cada uno; si la evidencia no alcanza para alguno, dilo en review.issues en vez de inventarlo:');
        criteria.forEach((criterion, index) => lines.push(`  ${index + 1}. ${criterion}`));
    }
    if (plan.length) {
        lines.push('Plan aprobado por el arquitecto:');
        plan.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    }
    return lines.join('\n');
}

/** The initiatives' block, fenced; shared with the base prompt of every other path. */
export function buildBusinessMotivationBlock(motivations: readonly ArtifactBusinessMotivation[] | undefined): string {
    if (!motivations?.length) return '';
    const body = motivations.map((m) => {
        const lines = [`Iniciativa: ${m.code ? `${m.code} · ` : ''}${m.title}`, `Necesidad: ${m.need}`];
        if (m.driver) lines.push(`Impulsor: ${m.driver}`);
        if (m.objectives.length) lines.push(`Objetivos: ${m.objectives.join('; ')}`);
        if (m.expectedOutcomes.length) lines.push(`Resultados esperados: ${m.expectedOutcomes.join('; ')}`);
        if (m.kpis.length) lines.push(`Indicadores: ${m.kpis.join('; ')}`);
        if (m.regulatoryDrivers.length) lines.push(`Impulsores regulatorios: ${m.regulatoryDrivers.join('; ')}`);
        return lines.join('\n');
    }).join('\n\n');
    return [
        'MOTIVACIÓN DE NEGOCIO — la razón por la que existe este proyecto. Los elementos clave del diagrama deben poder explicarse por ella; con audiencia ejecutiva, las relaciones nombran el resultado de negocio que mueven. Los impulsores regulatorios se reflejan en la clasificación de datos y el cumplimiento, sin inventar normas que no aparezcan aquí o en el proyecto.',
        wrapUntrustedContent('iniciativas', body),
    ].join('\n');
}

function renderUpperLevel(upper: UpperLevelDiagram | null | undefined): string {
    if (!upper || upper.elements.length === 0) return '';
    return [
        `NIVEL C4 SUPERIOR — «${upper.name}» ya existe en el proyecto. Reutiliza EXACTAMENTE estos nombres para los elementos que reaparezcan; no renombres ni dupliques un sistema que ya tiene nombre.`,
        wrapUntrustedContent('nivel superior', upper.elements.map((element) => `- ${element}`).join('\n')),
    ].join('\n');
}

/** The brief, or `''` when there is nothing beyond the catalogue objective to say. */
export function buildDiagramGenerationBrief(input: DiagramBriefInput): string {
    return [
        buildOutputLanguageDirective(input.language),
        input.personaInstruction?.trim() ? `VOZ Y CRITERIO:\n${input.personaInstruction.trim()}` : '',
        renderRequest(input.template),
        buildBusinessMotivationBlock(input.businessMotivation),
        renderUpperLevel(input.upperLevel),
        input.architectureGraphBlock?.trim() ?? '',
    ].filter(Boolean).join('\n\n');
}
