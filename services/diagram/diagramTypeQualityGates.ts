/**
 * Diagram-type-specific quality gates.
 *
 * The general `diagramQualityService.analyzeDiagramQuality` returns a single
 * 10-dimension rubric that applies to every diagram. That is great for
 * scoring, but it's not enough to produce *actionable* suggestions because
 * the rules that matter depend on the diagram archetype:
 *
 *   • A **context diagram** must keep the system count low and the labels
 *     business-oriented; technical detail belongs in a container diagram.
 *   • A **container diagram** must classify every node as application,
 *     service, database, integration platform, etc.
 *   • An **integration diagram** must show source/target systems, the
 *     integration platform (MuleSoft, ESB), and at minimum hint at the
 *     protocol, sync/async mode, frequency and security on every edge.
 *   • A **process / BPMN diagram** must have a start, an end, and
 *     unambiguous responsibilities (lanes / participants).
 *   • A **data diagram** must show sources, destinations, transformations
 *     and lineage.
 *
 * The functions here return `DiagramSuggestion[]` enriched with category,
 * severity, justification and a recommended action so the UI can render
 * them as a checklist instead of a single score.
 *
 * Pure, deterministic, side-effect free. Mounts on the IR that the rest of
 * the pipeline already produces — no extra parsing required.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';

export type DiagramArchetype =
    | 'context'
    | 'container'
    | 'component'
    | 'integration'
    | 'process'
    | 'data'
    | 'deployment'
    | 'sequence'
    | 'generic';

export type SuggestionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SuggestionCategory =
    | 'classification'
    | 'integration-contract'
    | 'security'
    | 'observability'
    | 'narrative'
    | 'layout'
    | 'completeness'
    | 'process-flow'
    | 'data-lineage';

export interface DiagramSuggestion {
    id: string;
    archetype: DiagramArchetype;
    severity: SuggestionSeverity;
    category: SuggestionCategory;
    /** Short headline shown in the side panel ("Faltan protocolos en integraciones críticas"). */
    title: string;
    /** Explanation of why the rule fires — points to specific nodes/edges when relevant. */
    justification: string;
    /** Concrete next step the user can apply. */
    recommendedAction: string;
    /** Optional autofix hint — `undefined` means the user has to apply the change manually. */
    autoApplicable?: boolean;
    /** Nodes/edges referenced by the suggestion (useful for "focus" navigation). */
    affectedIds?: string[];
}

/**
 * Heuristic detection of the archetype from the IR. Reads `metadata.title`,
 * the C4 kinds present, and the predominant `semanticType` distribution.
 *
 * Returns `'generic'` when there's no strong signal — the caller can then
 * skip archetype-specific checks and rely on the general quality rules.
 */
export function detectDiagramArchetype(ir: DiagramIR): DiagramArchetype {
    const title = (ir.metadata?.title ?? '').toLowerCase();

    // Title-based heuristic — wins when the user (or the AI) declared the
    // intent explicitly. Spanish wording first (the app is primarily in ES).
    if (/(contexto|context)/.test(title) && !/conten/.test(title)) return 'context';
    if (/(contenedor|container)/.test(title)) return 'container';
    if (/(componente|component)/.test(title)) return 'component';
    if (/(integraci|integration)/.test(title)) return 'integration';
    if (/(proceso|process|bpmn|flujo\s+de\s+negocio|workflow)/.test(title)) return 'process';
    if (/(datos|data|lineage|linaje|erd|er\s+diagram)/.test(title)) return 'data';
    if (/(despliegue|deployment|infraestructura)/.test(title)) return 'deployment';
    if (/(secuencia|sequence)/.test(title)) return 'sequence';

    // Semantic-type heuristic — checked BEFORE the raw C4 kind heuristic so
    // a Container-level diagram that is predominantly integration / process /
    // data gets the more specific archetype. The richer semantic taxonomy
    // beats the structural C4 wrapper.
    const typeCounts = new Map<string, number>();
    for (const n of ir.nodes) {
        const t = (n.semanticType ?? '').toLowerCase();
        if (t) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    const total = ir.nodes.length || 1;
    const integrationShare =
        ((typeCounts.get('integration-platform') ?? 0)
            + (typeCounts.get('messaging') ?? 0)
            + (typeCounts.get('cloud-service') ?? 0)
            + (typeCounts.get('batch-file') ?? 0)) / total;
    if (integrationShare >= 0.35) return 'integration';
    const processShare = (typeCounts.get('business-process') ?? 0) / total;
    if (processShare >= 0.4) return 'process';
    const dataShare = ((typeCounts.get('database') ?? 0) + (typeCounts.get('data-product') ?? 0) + (typeCounts.get('analytics-system') ?? 0)) / total;
    if (dataShare >= 0.4) return 'data';

    // C4 kind hint — the structural level when the semantic types haven't
    // declared a more specific archetype.
    const kindCounts = new Map<string, number>();
    for (const n of ir.nodes) {
        const k = (n.kind ?? '').toLowerCase();
        if (k) kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
    }
    if (kindCounts.has('component')) return 'component';
    if (kindCounts.has('container') || kindCounts.has('containerdb') || kindCounts.has('containerqueue')) return 'container';
    if (kindCounts.has('softwaresystem') || kindCounts.has('person')) return 'context';
    if (kindCounts.has('deployment_node') || kindCounts.has('node')) return 'deployment';

    return 'generic';
}

const PROTOCOL_HINT_RE = /\b(http|https|rest|grpc|soap|graphql|webhook|websocket|sftp|smtp|kafka|amqp|jdbc|odbc|tcp|udp|mq|sqs|sns|edi|ftp|file)\b/i;
const SECURITY_HINT_RE = /\b(oauth|jwt|sso|tls|mtls|saml|api\s*key|token|cifrad[oa]|encrypt|firma|signature)\b/i;
const TECHNICAL_NOISE_RE = /\b(pod|namespace|repo|repository|service\s+mesh|sidecar|istio|envoy|spring|hibernate|class|dto|dao|orm)\b/i;

const isExternal = (n: DiagramIRNode): boolean =>
    n.semanticRole === 'external'
    || n.semanticType === 'external-system'
    || n.semanticType === 'external-provider'
    || n.semanticType === 'cloud-service';

const isHumanActor = (n: DiagramIRNode): boolean =>
    n.semanticRole === 'person' || n.semanticType === 'human-actor' || n.semanticType === 'business-role';

const isIntegrationCore = (n: DiagramIRNode): boolean =>
    n.semanticType === 'integration-platform' || n.semanticType === 'messaging';

const hasMeaningfulProtocol = (edge: DiagramIREdge): boolean => {
    if (edge.protocol && edge.protocol.trim().length > 0) return true;
    const label = `${edge.label ?? ''}`;
    return PROTOCOL_HINT_RE.test(label);
};

const hasSecurityHint = (edge: DiagramIREdge): boolean => SECURITY_HINT_RE.test(`${edge.label ?? ''} ${edge.protocol ?? ''} ${edge.retryPolicy ?? ''}`);

/**
 * Build archetype-specific suggestions. Returns at most ~10 items so the
 * UI list stays readable; rules are ordered by severity (critical first)
 * and de-duplicated by id.
 */
export function buildArchetypeSuggestions(ir: DiagramIR, archetype: DiagramArchetype = detectDiagramArchetype(ir)): DiagramSuggestion[] {
    const out: DiagramSuggestion[] = [];

    // Cross-archetype: nodes that the resolver EXPLICITLY classified as
    // generic. We do not penalize IR that hasn't run through the resolver
    // yet (both fields undefined) — the base lint already catches truly
    // unknown nodes via NODE_GENERIC_CLASSIFICATION.
    const genericNodes = ir.nodes.filter((n) =>
        n.semanticType === 'generic' && n.semanticRole === 'generic',
    );
    if (genericNodes.length > 0) {
        out.push({
            id: 'classification-generic-nodes',
            archetype,
            severity: genericNodes.length > 3 ? 'high' : 'medium',
            category: 'classification',
            title: `Hay ${genericNodes.length} nodo(s) con clasificación genérica`,
            justification: 'La taxonomía granular (actor, sistema externo, API, integración, base de datos…) ayuda a leer el diagrama y a generar las leyendas. Cuando el clasificador no encuentra señal, asigna "generic" y reporta el caso.',
            recommendedAction: 'Edita los nodos afectados y declara una categoría más precisa (Sistema, Sistema Externo, API, Base de Datos, Integración, etc.).',
            affectedIds: genericNodes.map((n) => n.id),
        });
    }

    // Cross-archetype rule (protocol hint missing) only fires when the
    // archetype is integration / container / component / data — diagrams
    // where the protocol is part of the contract. Pure context / process
    // diagrams shouldn't get penalised for omitting a protocol on every
    // narrative edge.
    const protocolMattersFor: DiagramArchetype[] = ['integration', 'container', 'component', 'data'];
    if (protocolMattersFor.includes(archetype)) {
        const naiveEdges = ir.edges.filter((e) => !hasMeaningfulProtocol(e) && !e.semanticType);
        // Only surface as an archetype-level aggregate when MOST edges are
        // missing the protocol — otherwise the per-edge base lint covers it.
        if (naiveEdges.length > 0 && ir.edges.length > 0 && naiveEdges.length / ir.edges.length >= 0.5) {
            out.push({
                id: 'integration-edge-protocol-missing',
                archetype,
                severity: naiveEdges.length === ir.edges.length ? 'high' : 'medium',
                category: 'integration-contract',
                title: `Relaciones sin protocolo (${naiveEdges.length} de ${ir.edges.length})`,
                justification: 'Las relaciones críticas deben indicar el mecanismo (REST/HTTPS, Kafka, SQS, Batch, EDI…) para que el lector entienda el contrato técnico.',
                recommendedAction: 'Anota el protocolo en la etiqueta o en el campo "protocolo" del inspector. Puedes empezar por las relaciones marcadas como críticas.',
                affectedIds: naiveEdges.slice(0, 8).map((e) => e.id),
            });
        }
    }

    switch (archetype) {
        case 'context':
            return [...out, ...contextSuggestions(ir, archetype)];
        case 'container':
            return [...out, ...containerSuggestions(ir, archetype)];
        case 'component':
            return [...out, ...componentSuggestions(ir, archetype)];
        case 'integration':
            return [...out, ...integrationSuggestions(ir, archetype)];
        case 'process':
            return [...out, ...processSuggestions(ir, archetype)];
        case 'data':
            return [...out, ...dataSuggestions(ir, archetype)];
        case 'deployment':
        case 'sequence':
        case 'generic':
        default:
            return out;
    }
}

function contextSuggestions(ir: DiagramIR, archetype: DiagramArchetype): DiagramSuggestion[] {
    const out: DiagramSuggestion[] = [];

    if (ir.nodes.length > 14) {
        out.push({
            id: 'context-too-many-nodes',
            archetype,
            severity: 'medium',
            category: 'narrative',
            title: 'Demasiados nodos para un diagrama de contexto',
            justification: `Un diagrama de contexto debería caber en 60 segundos de explicación. Con ${ir.nodes.length} nodos pierde foco y entra en territorio de contenedores.`,
            recommendedAction: 'Mueve los componentes técnicos a un diagrama de contenedores y deja solo el sistema principal, actores y sistemas externos.',
        });
    }
    if (ir.nodes.length === 0 || ir.nodes.filter((n) => isHumanActor(n) || isExternal(n)).length === 0) {
        out.push({
            id: 'context-missing-actors',
            archetype,
            severity: 'high',
            category: 'completeness',
            title: 'No hay actores ni sistemas externos en el diagrama de contexto',
            justification: 'Un diagrama de contexto sin actores ni sistemas externos no comunica con quién interactúa el sistema.',
            recommendedAction: 'Agrega al menos los actores humanos relevantes (asegurado, médico, administrador…) y los sistemas externos involucrados.',
        });
    }
    const technicalNoise = ir.nodes.filter((n) => TECHNICAL_NOISE_RE.test(`${n.label} ${n.description ?? ''} ${n.technology ?? ''}`));
    if (technicalNoise.length > 0) {
        out.push({
            id: 'context-technical-noise',
            archetype,
            severity: 'medium',
            category: 'narrative',
            title: 'El diagrama de contexto contiene detalle técnico',
            justification: 'Componentes de bajo nivel (pods, sidecars, repos, DTOs…) no pertenecen al nivel de contexto.',
            recommendedAction: 'Mueve esos detalles al diagrama de componentes y mantén el contexto orientado a negocio.',
            affectedIds: technicalNoise.map((n) => n.id),
        });
    }
    return out;
}

function containerSuggestions(ir: DiagramIR, archetype: DiagramArchetype): DiagramSuggestion[] {
    const out: DiagramSuggestion[] = [];

    const unclassified = ir.nodes.filter((n) => !n.semanticType || n.semanticType === 'generic');
    if (unclassified.length > 0) {
        out.push({
            id: 'container-unclassified',
            archetype,
            severity: 'medium',
            category: 'classification',
            title: `Contenedores sin clasificar (${unclassified.length})`,
            justification: 'Cada contenedor debería declarar si es una aplicación, servicio, base de datos, integración, repositorio documental, etc.',
            recommendedAction: 'Asigna un tipo semántico (aplicación / servicio / base de datos / portal / integración) y, cuando aplique, la tecnología.',
            affectedIds: unclassified.map((n) => n.id),
        });
    }
    const noTechnology = ir.nodes.filter((n) =>
        !n.technology
        && (n.semanticType === 'service' || n.semanticType === 'microservice' || n.semanticType === 'application' || n.semanticType === 'api' || n.semanticType === 'database'),
    );
    if (noTechnology.length > 0) {
        out.push({
            id: 'container-missing-tech',
            archetype,
            severity: 'low',
            category: 'classification',
            title: `Contenedores sin tecnología declarada (${noTechnology.length})`,
            justification: 'En un diagrama de contenedores la tecnología (Java/Spring, Node, PostgreSQL, etc.) suele ser parte del contrato.',
            recommendedAction: 'Declara la tecnología en el inspector — aparece como badge en el nodo.',
            affectedIds: noTechnology.slice(0, 8).map((n) => n.id),
        });
    }
    return out;
}

function componentSuggestions(ir: DiagramIR, archetype: DiagramArchetype): DiagramSuggestion[] {
    const out: DiagramSuggestion[] = [];
    const undescribed = ir.nodes.filter((n) => !n.description || n.description.trim().length === 0);
    if (undescribed.length > Math.max(1, Math.floor(ir.nodes.length / 3))) {
        out.push({
            id: 'component-missing-responsibilities',
            archetype,
            severity: 'medium',
            category: 'completeness',
            title: 'Faltan responsabilidades para los componentes',
            justification: 'A nivel de componente la descripción es lo que comunica responsabilidad. Sin ella el diagrama se vuelve decorativo.',
            recommendedAction: 'Agrega 1-2 frases de descripción a cada componente (qué hace y para quién).',
            affectedIds: undescribed.slice(0, 8).map((n) => n.id),
        });
    }
    return out;
}

function integrationSuggestions(ir: DiagramIR, archetype: DiagramArchetype): DiagramSuggestion[] {
    const out: DiagramSuggestion[] = [];

    const integrationCore = ir.nodes.find(isIntegrationCore);
    if (!integrationCore) {
        out.push({
            id: 'integration-missing-platform',
            archetype,
            severity: 'medium',
            category: 'integration-contract',
            title: 'No hay plataforma de integración explícita',
            justification: 'Un diagrama de integración suele requerir un nodo central que represente la plataforma (MuleSoft, ESB, iPaaS, broker de eventos).',
            recommendedAction: 'Si la arquitectura usa MuleSoft / Kafka / iPaaS, modela el nodo para que el flujo origen→destino quede explícito.',
        });
    }

    const noProtocol = ir.edges.filter((e) => !hasMeaningfulProtocol(e));
    if (noProtocol.length > 0) {
        out.push({
            id: 'integration-edges-without-protocol',
            archetype,
            severity: noProtocol.length === ir.edges.length ? 'high' : 'medium',
            category: 'integration-contract',
            title: `Relaciones sin protocolo (${noProtocol.length} de ${ir.edges.length})`,
            justification: 'En integraciones, el protocolo (REST/HTTPS, SOAP, Kafka, SQS, Batch, EDI…) es parte del contrato y no debe quedar implícito.',
            recommendedAction: 'Para cada relación, declara protocolo y, cuando aplique, sincronía (síncrono/async/batch).',
            affectedIds: noProtocol.slice(0, 8).map((e) => e.id),
        });
    }

    const noSecurity = ir.edges.filter((e) => (e.criticality === 'critical' || e.criticality === 'high') && !hasSecurityHint(e));
    if (noSecurity.length > 0) {
        out.push({
            id: 'integration-edges-without-security',
            archetype,
            severity: 'medium',
            category: 'security',
            title: 'Faltan controles de seguridad en relaciones críticas',
            justification: 'Las relaciones marcadas como críticas o de alta criticidad deben indicar el mecanismo de seguridad (OAuth2/JWT, mTLS, firma digital, API Key).',
            recommendedAction: 'Anota el control de seguridad en la etiqueta o en el campo "protocolo" del inspector.',
            affectedIds: noSecurity.map((e) => e.id),
        });
    }

    const noRetry = ir.edges.filter((e) => e.semanticType === 'async-messaging' && !e.retryPolicy);
    if (noRetry.length > 0) {
        out.push({
            id: 'integration-async-no-retry',
            archetype,
            severity: 'low',
            category: 'observability',
            title: 'Mensajería asíncrona sin política de reintentos',
            justification: 'Las relaciones asíncronas deberían declarar política de reintentos / DLQ para que sean operables.',
            recommendedAction: 'Declara la política de reintentos en el inspector (ej. "3 retries · exponential backoff · DLQ").',
            affectedIds: noRetry.map((e) => e.id),
        });
    }

    return out;
}

function processSuggestions(ir: DiagramIR, archetype: DiagramArchetype): DiagramSuggestion[] {
    const out: DiagramSuggestion[] = [];

    const hasStart = ir.nodes.some((n) => /(inicio|start|comienzo|trigger)/i.test(`${n.label} ${n.description ?? ''}`));
    if (!hasStart && ir.nodes.length > 0) {
        out.push({
            id: 'process-missing-start',
            archetype,
            severity: 'medium',
            category: 'process-flow',
            title: 'El proceso no tiene evento de inicio explícito',
            justification: 'Un diagrama de proceso debe declarar el evento de inicio para que el flujo sea verificable.',
            recommendedAction: 'Agrega un nodo de inicio o etiqueta el primer paso como "Inicio".',
        });
    }
    const hasEnd = ir.nodes.some((n) => /(fin|end|cierre|t[eé]rmino)/i.test(`${n.label} ${n.description ?? ''}`));
    if (!hasEnd && ir.nodes.length > 0) {
        out.push({
            id: 'process-missing-end',
            archetype,
            severity: 'low',
            category: 'process-flow',
            title: 'El proceso no tiene evento de fin explícito',
            justification: 'Un diagrama de proceso debería terminar en un estado verificable (fin, entrega, rechazo, cierre).',
            recommendedAction: 'Agrega un nodo de fin o etiqueta el último paso como "Fin".',
        });
    }

    if (ir.groups.length === 0 && ir.nodes.length >= 4) {
        out.push({
            id: 'process-no-lanes',
            archetype,
            severity: 'low',
            category: 'process-flow',
            title: 'El proceso no usa lanes / participantes',
            justification: 'En BPMN cada actividad debería pertenecer a un participante (lane) para que la responsabilidad sea explícita.',
            recommendedAction: 'Asigna cada nodo a un grupo (lane) que represente al actor responsable.',
        });
    }
    return out;
}

function dataSuggestions(ir: DiagramIR, archetype: DiagramArchetype): DiagramSuggestion[] {
    const out: DiagramSuggestion[] = [];
    const stores = ir.nodes.filter((n) =>
        n.semanticType === 'database'
        || n.semanticType === 'data-product'
        || n.semanticType === 'document-repository',
    );
    if (stores.length === 0) {
        out.push({
            id: 'data-no-stores',
            archetype,
            severity: 'medium',
            category: 'data-lineage',
            title: 'No hay almacenes de datos identificados',
            justification: 'En un diagrama de datos / linaje deben aparecer las fuentes y destinos (bases de datos, data products, repositorios).',
            recommendedAction: 'Modela las fuentes y destinos como nodos de tipo database / data-product / document-repository.',
        });
    }
    const transformations = ir.edges.filter((e) => /etl|transform|enriqu|normaliza|stream|pipeline/i.test(`${e.label ?? ''}`));
    if (transformations.length === 0 && ir.edges.length > 0) {
        out.push({
            id: 'data-no-transformations',
            archetype,
            severity: 'low',
            category: 'data-lineage',
            title: 'No hay relaciones de transformación documentadas',
            justification: 'El linaje de datos cobra valor cuando muestra ETL, enriquecimiento, normalización o streaming.',
            recommendedAction: 'Etiqueta las relaciones que representan transformaciones (ETL, normalización, agregación, enriquecimiento).',
        });
    }
    return out;
}
