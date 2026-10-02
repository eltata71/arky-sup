/**
 * Does the diagram answer what was asked? (plan de diagramas, 6.3)
 *
 * The acceptance criteria travelled in the prompt and nothing ever checked
 * them afterwards: the quality gate measures whether a diagram is *well
 * drawn* — labels, groups, cycles — and a well-drawn diagram of the wrong
 * thing passed it and was saved. This measures the other half, against the
 * request, and it is deterministic on purpose: it runs on every generation,
 * costs nothing, and its verdict can be read rather than trusted.
 *
 * Five checks, and the honesty rule that binds them: **what cannot be shown
 * is reported as unverified, never as failed or as met.** A criterion whose
 * words appear nowhere in the diagram is `sin-evidencia` — the diagram may
 * still satisfy it in a way no string match can see, and the person reading
 * the warning is the one who decides.
 *
 * - **Notation.** The saved text is in the dialect the type names. The engine
 *   degrades a failing dialect to a flowchart, and that used to reach the
 *   database with only a console line to say so.
 * - **Skeleton.** A deterministic skeleton stood in for the model.
 * - **Named elements.** What the request names — in quotes, or as a proper
 *   name — appears in the diagram.
 * - **Criteria.** Each acceptance criterion has evidence in the diagram.
 * - **Audience.** An executive diagram stays small; a technical container or
 *   component diagram declares its technologies.
 */

import type { DiagramIR } from '../../lib/diagram';
import { mermaidDialectOf } from './dialectSerialization';

export type FidelityStatus = 'ok' | 'warning';

export interface FidelityCheck {
    kind: 'dialect' | 'skeleton' | 'entity' | 'criterion' | 'audience';
    status: FidelityStatus;
    /** What was checked, as the request put it. */
    target: string;
    /** One Spanish sentence for the trace and the warning. */
    message: string;
}

export interface FidelityReport {
    checks: FidelityCheck[];
    /** Share of checks with `ok`; `null` when there was nothing to check. */
    score: number | null;
    warnings: FidelityCheck[];
}

export interface FidelityInput {
    artifactType: string;
    /** The saved diagram text (the fenced block, for a hybrid artifact). */
    content: string;
    ir: DiagramIR | null;
    request?: {
        userRequest?: string;
        acceptanceCriteria?: readonly string[];
        audience?: 'technical' | 'executive' | 'mixed';
    };
    skeleton?: boolean;
}

const EXPECTED_DIALECT: Record<string, readonly string[]> = {
    'mermaid-c4-context': ['c4context'],
    'mermaid-c4-container': ['c4container'],
    'mermaid-c4-component': ['c4component'],
    'mermaid-c4-deployment': ['c4deployment'],
    'mermaid-sequence': ['sequencediagram'],
    'mermaid-erd': ['erdiagram'],
    'mermaid-state': ['statediagram', 'statediagram-v2'],
    'mermaid-gantt': ['gantt'],
    'mermaid-graph': ['flowchart', 'graph'],
};

const DIALECT_NAME: Record<string, string> = {
    'mermaid-c4-context': 'C4 de contexto',
    'mermaid-c4-container': 'C4 de contenedores',
    'mermaid-c4-component': 'C4 de componentes',
    'mermaid-c4-deployment': 'C4 de despliegue',
    'mermaid-sequence': 'diagrama de secuencia',
    'mermaid-erd': 'diagrama entidad-relación',
    'mermaid-state': 'máquina de estados',
    'mermaid-gantt': 'diagrama de Gantt',
    'mermaid-graph': 'diagrama de flujo',
};

/** Words that carry no evidence: articles, prepositions, and the vocabulary every diagram shares. */
const STOPWORDS = new Set([
    'para', 'como', 'cada', 'entre', 'desde', 'hasta', 'sobre', 'donde', 'cuando', 'mostrar', 'muestra',
    'incluir', 'incluye', 'debe', 'deben', 'todos', 'todas', 'estar', 'tener', 'diagrama', 'nivel',
    'with', 'from', 'each', 'show', 'include', 'must', 'should', 'diagram', 'their', 'there', 'which',
    'declarar', 'nombrar', 'representar', 'indicar', 'describir', 'aparecer', 'reflejar', 'señalar',
]);

export const normalizeFidelityText = (value: string): string =>
    value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words of a criterion worth looking for: five letters or more, no stop words. */
export const fidelityTerms = (value: string): string[] =>
    normalizeFidelityText(value).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOPWORDS.has(w));

const words = fidelityTerms;

/** Everything a reader of the diagram can see or open, as one searchable text. */
function diagramText(ir: DiagramIR | null, content: string): string {
    if (!ir) return normalizeFidelityText(content);
    const narrative = ir.metadata?.narrative;
    const story = typeof narrative === 'string'
        ? narrative
        : narrative
            ? [narrative.summary, ...(narrative.scenes ?? []).flatMap((s) => [s.title, s.insight]), ...(narrative.callouts ?? []).map((c) => c.text)].join(' ')
            : '';
    return normalizeFidelityText([
        ...ir.nodes.flatMap((n) => [n.label, n.description, n.technology, n.businessMeaning, n.technicalMeaning]),
        ...ir.edges.flatMap((e) => [e.label, e.protocol, e.payload, e.businessMeaning]),
        ...ir.groups.map((g) => g.label),
        ir.metadata?.title,
        story,
        content,
    ].filter(Boolean).join(' '));
}

/**
 * Names the request commits to: anything in quotes, and runs of capitalised
 * words («Core de Pólizas», «Motor de Reglas»). A single capitalised word is
 * left out — it is the start of every sentence.
 */
export function requestedNames(request: string): string[] {
    const names = new Set<string>();
    for (const match of request.matchAll(/["«“]([^"»”]{3,60})["»”]/g)) names.add(match[1].trim());
    const capitalised = /\b([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+(?:de|del|la|las|los|y|e)?\s*[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)+)/g;
    for (const match of request.matchAll(capitalised)) names.add(match[1].trim());
    return [...names];
}

export function checkRequestFidelity(input: FidelityInput): FidelityReport {
    const checks: FidelityCheck[] = [];
    const expected = EXPECTED_DIALECT[input.artifactType];
    if (expected) {
        const saved = mermaidDialectOf(input.content);
        const ok = expected.includes(saved);
        checks.push({
            kind: 'dialect',
            status: ok ? 'ok' : 'warning',
            target: DIALECT_NAME[input.artifactType] ?? input.artifactType,
            message: ok
                ? `Se guardó como ${DIALECT_NAME[input.artifactType]}.`
                : `Se pidió un ${DIALECT_NAME[input.artifactType]} y se guardó en otra notación (${saved || 'vacía'}): el modelo no lo produjo válido y se degradó.`,
        });
    }

    if (input.skeleton) {
        checks.push({
            kind: 'skeleton',
            status: 'warning',
            target: 'esqueleto',
            message: 'El modelo no produjo un diagrama utilizable: lo que se guardó es un esqueleto base para completar a mano.',
        });
    }

    const text = diagramText(input.ir, input.content);
    const request = input.request;
    if (request?.userRequest) {
        for (const name of requestedNames(request.userRequest)) {
            const ok = text.includes(normalizeFidelityText(name));
            checks.push({
                kind: 'entity',
                status: ok ? 'ok' : 'warning',
                target: name,
                message: ok ? `Aparece «${name}».` : `La solicitud nombra «${name}» y el diagrama no lo muestra.`,
            });
        }
    }

    for (const criterion of request?.acceptanceCriteria ?? []) {
        const terms = words(criterion);
        if (terms.length === 0) continue;
        const found = terms.filter((term) => text.includes(term)).length;
        const ok = found / terms.length >= 0.6;
        checks.push({
            kind: 'criterion',
            status: ok ? 'ok' : 'warning',
            target: criterion,
            message: ok
                ? `Hay evidencia del criterio «${criterion}».`
                : `Sin evidencia del criterio «${criterion}» en el diagrama: revisa si se cumple.`,
        });
    }

    if (input.ir && request?.audience === 'executive') {
        const ok = input.ir.nodes.length <= 10;
        checks.push({
            kind: 'audience',
            status: ok ? 'ok' : 'warning',
            target: 'audiencia ejecutiva',
            message: ok
                ? 'El tamaño es legible para un comité ejecutivo.'
                : `Se pidió para un comité ejecutivo y tiene ${input.ir.nodes.length} elementos; a partir de 10 deja de leerse en un minuto.`,
        });
    }
    if (input.ir && request?.audience === 'technical'
        && (input.artifactType === 'mermaid-c4-container' || input.artifactType === 'mermaid-c4-component')) {
        const platform = input.ir.nodes.filter((n) => !/person|external/i.test(n.kind) && n.trust !== 'external');
        const declared = platform.filter((n) => n.technology?.trim()).length;
        const ok = platform.length === 0 || declared / platform.length >= 0.75;
        checks.push({
            kind: 'audience',
            status: ok ? 'ok' : 'warning',
            target: 'audiencia técnica',
            message: ok
                ? 'Los elementos declaran su tecnología.'
                : `Se pidió para audiencia técnica y sólo ${declared} de ${platform.length} elementos declaran su tecnología.`,
        });
    }

    const warnings = checks.filter((check) => check.status === 'warning');
    return {
        checks,
        score: checks.length ? Math.round(((checks.length - warnings.length) / checks.length) * 100) / 100 : null,
        warnings,
    };
}

/**
 * What a change would lose against the request (plan de diagramas, 8.2d): the
 * checks that held before and no longer do. A refinement that scores higher
 * on the rubric and drops an element the request names is a better-drawn
 * diagram of something else — the one outcome a refinement must not have.
 * Checks are matched by kind and target; a check the change introduces is
 * not a loss.
 */
export function fidelityLosses(before: FidelityReport, after: FidelityReport): FidelityCheck[] {
    const held = new Set(before.checks.filter((c) => c.status === 'ok').map((c) => `${c.kind}::${c.target}`));
    return after.checks.filter((c) => c.status === 'warning' && held.has(`${c.kind}::${c.target}`));
}
