/**
 * Pre-processor that extracts structurally-relevant signals from a project's
 * free-form context (description, projectContext bullets, prior artifacts) so
 * diagram prompts receive a focused, machine-friendly digest instead of the
 * full unbounded narrative.
 *
 * Why this exists
 * ────────────────
 * Diagram artifacts (especially "Diagrama de Integración") were failing to
 * produce useful output because the prompt drowned the model in 30-80
 * unstructured context bullets. Token budget got spent on conversational
 * filler instead of the integrations / actors / boundaries the diagram needs
 * to render. By extracting and surfacing those signals up-front we:
 *   1. Preserve token budget for actual generation (more space for thinking
 *      and structured output).
 *   2. Increase diagram quality on saturated infra (the model latches onto
 *      explicit signals faster than it scans free text).
 *   3. Stay deterministic: extraction runs locally, no AI hop.
 *
 * Signal vocabulary
 * ─────────────────
 * Each diagram type prefers a different blend of signals. Examples:
 *   - mermaid-c4-context     → external systems, primary user types
 *   - mermaid-c4-container   → internal containers, data stores, queues
 *   - mermaid-graph (integ.) → APIs, external systems, protocols, queues
 *   - mermaid-erd            → entities, relationships
 *   - mermaid-sequence       → actors, sync vs async interactions
 *   - hybrid-text-diagram    → full process flow (actors + decisions)
 *
 * The extractor stays vocabulary-driven and additive — adding a keyword
 * never breaks an existing diagram type.
 */

import type { ArtifactType, Project } from '../../types';

export interface DiagramSignal {
    /** Short label suitable for inline display (e.g. node label). */
    label: string;
    /** Source bucket the signal came from. */
    source: 'description' | 'context' | 'artifact';
    /** Optional category to help downstream prompts pick the right semantic role. */
    category?: 'actor' | 'system' | 'integration' | 'data' | 'messaging' | 'process' | 'protocol' | 'boundary';
}

export interface ExtractedDiagramContext {
    actors: DiagramSignal[];
    systems: DiagramSignal[];
    integrations: DiagramSignal[];
    dataStores: DiagramSignal[];
    messaging: DiagramSignal[];
    protocols: DiagramSignal[];
    processes: DiagramSignal[];
    boundaries: DiagramSignal[];
    /** Compact freeform list (sorted by relevance) used as catch-all signal. */
    keywords: string[];
}

const ACTOR_PATTERNS = [
    /\b(usuario|cliente|asegurado|paciente|m[eé]dico|operador|administrador|admin|agente|broker|comit[eé]|gerencia|directiv[oa]|empleado|consultor|analista|aprobador|stakeholder)s?\b/gi,
];

const INTEGRATION_PATTERNS = [
    /\b(api|apis|gateway|rest|graphql|grpc|webhook|webhooks|integraci[oó]n(?:es)?|conector(?:es)?|interfaz|interfase|interfaces|edi|swift|hl7|fhir|edifact|iso\s*20022)\b/gi,
];

const DATA_STORE_PATTERNS = [
    /\b(base\s+de\s+datos|database|bd\b|postgres(?:ql)?|mysql|oracle|sql\s*server|mongo(?:db)?|redis|cassandra|dynamodb|cosmos\s*db|s3|blob\s+storage|datalake|lakehouse|data\s*warehouse|warehouse|snowflake|bigquery|elastic(?:search)?|hadoop|cache|file\s+storage|nas|repositorio\s+de\s+datos)\b/gi,
];

const MESSAGING_PATTERNS = [
    /\b(kafka|rabbit(?:mq)?|sqs|sns|service\s*bus|event\s*hub|event\s*grid|pub[\s/_-]*sub|pubsub|jms|amqp|mqtt|cola|colas|topic|tópico|t[oó]picos|broker\s+de\s+mensajes|stream|streaming|kinesis|dapr|nats)\b/gi,
];

const PROTOCOL_PATTERNS = [
    /\b(https?|tls|tcp|udp|amqp|mqtt|grpc|websocket|sftp|ftp|smtp|oauth|oidc|saml|jwt)\b/gi,
];

const PROCESS_PATTERNS = [
    /\b(flujo|workflow|orquestaci[oó]n|coreograf[ií]a|proceso|tr[aá]mite|pipeline|saga|jornada|onboarding|emisi[oó]n|cotizaci[oó]n|reclamaci[oó]n|liquidaci[oó]n|approval|aprobaci[oó]n|conciliaci[oó]n|facturaci[oó]n|cobranza)s?\b/gi,
];

const BOUNDARY_PATTERNS = [
    /\b(dmz|on[\s-]*prem|nube|cloud|aws|azure|gcp|google\s+cloud|vpc|subred|red\s+privada|red\s+p[uú]blica|sandbox|preprod|prod(?:ucci[oó]n)?|staging|qa|tenant|tenant\s+a|tenant\s+b|multi[\s-]*tenant|partner|tercero|tercer[oa]s|legacy|core)\b/gi,
];

const SYSTEM_PATTERNS = [
    /\b(crm|erp|core|core\s+banking|core\s+seguros|sistema\s+core|hospital(?:ario)?|portal|m[oó]vil|app|aplicaci[oó]n|web\s+app|microservicio[s]?|servicio[s]?|monolito|frontend|backend|bff|adminstrador|backoffice|salesforce|sap|oracle\s+ebs|workday|hubspot|stripe|braintree|paypal|twilio|whatsapp|datadog|new\s+relic|splunk|grafana|prometheus|kubernetes|k8s|docker|openshift|elastic\s+kubernetes|eks|aks|gke)\b/gi,
];

interface CollectorOptions {
    /** Cap on raw matches per bucket (prevents pathological inputs). */
    maxPerBucket?: number;
}

function dedupe(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const norm = value.trim().toLowerCase();
        if (norm.length === 0) continue;
        if (seen.has(norm)) continue;
        seen.add(norm);
        result.push(value.trim());
    }
    return result;
}

function harvest(text: string, patterns: RegExp[], opts: CollectorOptions = {}): string[] {
    const max = opts.maxPerBucket ?? 12;
    const out: string[] = [];
    for (const pattern of patterns) {
        // Reset lastIndex to avoid stateful regexes leaking across calls.
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            out.push(match[0]);
            if (out.length >= max) break;
        }
        if (out.length >= max) break;
    }
    return dedupe(out).slice(0, max);
}

function asSignals(
    matches: string[],
    source: DiagramSignal['source'],
    category: DiagramSignal['category'],
): DiagramSignal[] {
    return matches.map((label) => ({ label, source, category }));
}

/**
 * Extract signals from arbitrary project text. The function is pure and
 * idempotent so callers can run it whenever the project context changes
 * without worrying about side effects.
 */
export function extractDiagramContextFromText(
    text: string,
    source: DiagramSignal['source'],
): Omit<ExtractedDiagramContext, 'keywords'> {
    if (!text || text.length === 0) {
        return {
            actors: [],
            systems: [],
            integrations: [],
            dataStores: [],
            messaging: [],
            protocols: [],
            processes: [],
            boundaries: [],
        };
    }
    return {
        actors:       asSignals(harvest(text, ACTOR_PATTERNS),       source, 'actor'),
        systems:      asSignals(harvest(text, SYSTEM_PATTERNS),      source, 'system'),
        integrations: asSignals(harvest(text, INTEGRATION_PATTERNS), source, 'integration'),
        dataStores:   asSignals(harvest(text, DATA_STORE_PATTERNS),  source, 'data'),
        messaging:    asSignals(harvest(text, MESSAGING_PATTERNS),   source, 'messaging'),
        protocols:    asSignals(harvest(text, PROTOCOL_PATTERNS),    source, 'protocol'),
        processes:    asSignals(harvest(text, PROCESS_PATTERNS),     source, 'process'),
        boundaries:   asSignals(harvest(text, BOUNDARY_PATTERNS),    source, 'boundary'),
    };
}

function mergeBuckets(...buckets: ExtractedDiagramContext[]): ExtractedDiagramContext {
    const merged: ExtractedDiagramContext = {
        actors: [], systems: [], integrations: [], dataStores: [],
        messaging: [], protocols: [], processes: [], boundaries: [],
        keywords: [],
    };
    const dedupeSignals = (signals: DiagramSignal[]): DiagramSignal[] => {
        const seen = new Set<string>();
        const out: DiagramSignal[] = [];
        for (const signal of signals) {
            const key = signal.label.trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(signal);
        }
        return out;
    };
    for (const bucket of buckets) {
        merged.actors.push(...bucket.actors);
        merged.systems.push(...bucket.systems);
        merged.integrations.push(...bucket.integrations);
        merged.dataStores.push(...bucket.dataStores);
        merged.messaging.push(...bucket.messaging);
        merged.protocols.push(...bucket.protocols);
        merged.processes.push(...bucket.processes);
        merged.boundaries.push(...bucket.boundaries);
        merged.keywords.push(...bucket.keywords);
    }
    merged.actors = dedupeSignals(merged.actors).slice(0, 8);
    merged.systems = dedupeSignals(merged.systems).slice(0, 12);
    merged.integrations = dedupeSignals(merged.integrations).slice(0, 10);
    merged.dataStores = dedupeSignals(merged.dataStores).slice(0, 8);
    merged.messaging = dedupeSignals(merged.messaging).slice(0, 8);
    merged.protocols = dedupeSignals(merged.protocols).slice(0, 8);
    merged.processes = dedupeSignals(merged.processes).slice(0, 10);
    merged.boundaries = dedupeSignals(merged.boundaries).slice(0, 8);
    merged.keywords = dedupe(merged.keywords).slice(0, 16);
    return merged;
}

/**
 * Extract signals from a full Project (description + projectContext + prior
 * artifacts metadata).
 *
 * This is the primary entry point used by `geminiService` to build a focused
 * pre-prompt for diagram generation. It is intentionally cheap so it can run
 * on every diagram call without latency concerns.
 */
export function extractDiagramSignals(project: Project): ExtractedDiagramContext {
    const description = (project?.description ?? '').trim();
    const contextItems = (project?.projectContext ?? []).filter(Boolean) as string[];
    const artifactSignal = (project?.artifacts ?? [])
        .map(a => `${a.name ?? ''} ${a.objective ?? ''}`)
        .join(' ');

    const fromDescription = {
        ...extractDiagramContextFromText(description, 'description'),
        keywords: [] as string[],
    };
    const fromContext = {
        ...extractDiagramContextFromText(contextItems.join(' \n '), 'context'),
        keywords: [] as string[],
    };
    const fromArtifacts = {
        ...extractDiagramContextFromText(artifactSignal, 'artifact'),
        keywords: [] as string[],
    };

    const merged = mergeBuckets(fromDescription, fromContext, fromArtifacts);

    // Build a compact keyword bag for catch-all use, prioritising the most
    // frequent and most relevant signals across all buckets.
    const keywordBag = new Map<string, number>();
    const tally = (signals: DiagramSignal[], weight = 1) => {
        for (const s of signals) {
            const key = s.label.trim().toLowerCase();
            if (!key) continue;
            keywordBag.set(key, (keywordBag.get(key) ?? 0) + weight);
        }
    };
    tally(merged.systems, 3);
    tally(merged.integrations, 3);
    tally(merged.dataStores, 2);
    tally(merged.messaging, 2);
    tally(merged.processes, 2);
    tally(merged.actors, 2);
    tally(merged.boundaries, 1);
    tally(merged.protocols, 1);

    merged.keywords = Array.from(keywordBag.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([key]) => key)
        .slice(0, 16);

    return merged;
}

/**
 * Map a diagram artifact type to the buckets that matter for that dialect.
 * Keeps the prompt-side rendering small and focused — no need to dump every
 * bucket into every diagram, only the ones the renderer actually needs.
 */
export function selectRelevantBuckets(type: ArtifactType): Array<keyof ExtractedDiagramContext> {
    const t = type as string;
    if (t === 'mermaid-c4-context') {
        return ['actors', 'systems', 'integrations', 'boundaries'];
    }
    if (t === 'mermaid-c4-container') {
        return ['actors', 'systems', 'integrations', 'dataStores', 'messaging', 'boundaries'];
    }
    if (t === 'mermaid-c4-component') {
        return ['systems', 'integrations', 'dataStores', 'messaging'];
    }
    if (t === 'mermaid-c4-deployment') {
        return ['systems', 'boundaries', 'dataStores', 'protocols'];
    }
    if (t === 'mermaid-erd') {
        return ['dataStores', 'systems', 'processes'];
    }
    if (t === 'mermaid-sequence') {
        return ['actors', 'systems', 'integrations', 'protocols', 'messaging'];
    }
    if (t === 'mermaid-state') {
        return ['processes', 'systems'];
    }
    if (t === 'mermaid-graph') {
        return ['systems', 'integrations', 'dataStores', 'messaging', 'protocols', 'boundaries'];
    }
    if (t === 'mermaid-gantt') {
        return ['processes'];
    }
    if (t === 'react-flow-graph') {
        return ['systems', 'integrations', 'dataStores', 'messaging', 'actors', 'boundaries'];
    }
    if (t === 'hybrid-text-diagram') {
        return ['actors', 'systems', 'processes', 'integrations'];
    }
    return ['systems', 'integrations', 'actors'];
}

const BUCKET_LABELS: Record<keyof ExtractedDiagramContext, string> = {
    actors:       'Actores',
    systems:      'Sistemas / Aplicaciones',
    integrations: 'Integraciones / APIs',
    dataStores:   'Datos / Almacenamiento',
    messaging:    'Mensajería / Eventos',
    protocols:    'Protocolos',
    processes:    'Procesos / Flujos',
    boundaries:   'Fronteras / Ambientes',
    keywords:     'Términos relevantes',
};

/**
 * Render the extracted signals as a compact Markdown block ready to be
 * embedded inside a Gemini prompt. Empty buckets are omitted so the model
 * doesn't waste attention on placeholders.
 */
export function renderDiagramSignals(
    signals: ExtractedDiagramContext,
    type: ArtifactType,
): string {
    const buckets = selectRelevantBuckets(type);
    const sections: string[] = [];
    for (const bucket of buckets) {
        const value = signals[bucket];
        if (Array.isArray(value) && value.length > 0) {
            const labels = (value as DiagramSignal[] | string[])
                .map((entry) => (typeof entry === 'string' ? entry : entry.label))
                .filter(Boolean);
            if (labels.length === 0) continue;
            sections.push(`- ${BUCKET_LABELS[bucket]}: ${labels.join(', ')}`);
        }
    }
    if (sections.length === 0) return '';
    return `\nPRE-PROCESSED DIAGRAM SIGNALS (deterministic extraction — use as ground truth before improvising):\n${sections.join('\n')}\n`;
}
