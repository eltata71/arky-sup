/**
 * C4 Model formal validation by level.
 *
 * Gap 9 — adds per-level strict rules on top of the generic archetype
 * suggestions. Each level (Context / Container / Component / Deployment)
 * has rules that are too specific to fit in the generic gates. The
 * validator self-filters by `metadata.diagramType` (or the artifact-type
 * inference fallback) so non-C4 diagrams are never penalised.
 *
 * Inspired by Simon Brown's C4 Model: https://c4model.com/
 */

import type { DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';

export type C4ValidationCode =
    | 'C4_CTX_MISSING_SOI'
    | 'C4_CTX_MISSING_ACTORS_OR_EXTERNAL'
    | 'C4_CTX_LEAKED_INTERNALS'
    | 'C4_CTX_LANGUAGE_TOO_TECHNICAL'
    | 'C4_CON_MISSING_CONTAINERS'
    | 'C4_CON_MISSING_TECHNOLOGY'
    | 'C4_CON_MISSING_PROTOCOL'
    | 'C4_COMP_MULTI_CONTAINER'
    | 'C4_COMP_MISSING_RESPONSIBILITIES'
    | 'C4_COMP_LEAKED_EXTERNAL_ACTORS'
    | 'C4_DEP_MISSING_RUNTIME_NODES'
    | 'C4_DEP_MISSING_ENVIRONMENT'
    | 'C4_DEP_MISSING_NETWORK_ZONE';

export interface C4ValidationIssue {
    id: string;
    code: C4ValidationCode;
    severity: 'critical' | 'high' | 'medium' | 'low';
    level: 'context' | 'container' | 'component' | 'deployment';
    message: string;
    recommendation: string;
    affectedIds?: string[];
}

// Heuristics --------------------------------------------------------------

// "System of interest" candidates: anything explicitly labelled as the
// system in scope, the system itself, or with kind/semanticType matching
// internal-system / application / c4 kinds.
function isSystemOfInterest(n: DiagramIRNode): boolean {
    const kind = String(n.kind ?? '').toLowerCase();
    const sem = String(n.semanticType ?? '').toLowerCase();
    if (kind === 'system' || kind === 'softwaresystem' || kind === 'system_main') return true;
    if (sem === 'internal-system' || sem === 'application') return true;
    return false;
}

function isExternalActorOrSystem(n: DiagramIRNode): boolean {
    const kind = String(n.kind ?? '').toLowerCase();
    const sem = String(n.semanticType ?? '').toLowerCase();
    if (kind === 'person' || kind === 'person_ext') return true;
    if (kind === 'system_ext' || kind === 'externalsystem' || kind === 'external') return true;
    if (sem === 'human-actor' || sem === 'business-role') return true;
    if (sem === 'external-system' || sem === 'external-provider') return true;
    return false;
}

// Internal C4 detail that shouldn't leak into Context diagrams.
const CONTEXT_LEAK_RE = /\b(component|class|table|column|pod|dto|repository|repo|controller|service\s*class|orm|module|sidecar|jpa|hibernate)\b/i;

// Tech-jargon detector for Context language quality.
const CONTEXT_JARGON_RE = /\b(rest|grpc|kafka|sql|nosql|jdbc|http|https|api|json|xml|amqp|fhir|x12|hl7)\b/i;

function isContainerKind(n: DiagramIRNode): boolean {
    const kind = String(n.kind ?? '').toLowerCase();
    const sem = String(n.semanticType ?? '').toLowerCase();
    return (
        kind === 'container' || kind === 'containerdb' || kind === 'containerqueue'
        || sem === 'application' || sem === 'service' || sem === 'microservice'
        || sem === 'api' || sem === 'database' || sem === 'messaging'
        || sem === 'integration-platform' || sem === 'c4-container'
    );
}

function isTechnicalContainer(n: DiagramIRNode): boolean {
    const sem = String(n.semanticType ?? '').toLowerCase();
    return [
        'application', 'service', 'microservice', 'api',
        'database', 'messaging', 'integration-platform', 'c4-container',
    ].includes(sem);
}

function edgeHasProtocolHint(e: DiagramIREdge): boolean {
    const blob = `${e.protocol ?? ''} ${e.label ?? ''}`.toLowerCase();
    return /\b(rest|https?|grpc|soap|jdbc|amqp|kafka|sqs|webhook|websocket|graphql|sftp|smtp|tcp|udp|odbc)\b/.test(blob);
}

// Level inference --------------------------------------------------------

export type C4Level = 'context' | 'container' | 'component' | 'deployment' | null;

export function inferC4Level(ir: DiagramIR, artifactType?: string): C4Level {
    const dt = ir.metadata?.diagramType;
    if (dt === 'c4-context') return 'context';
    if (dt === 'c4-container') return 'container';
    if (dt === 'c4-component') return 'component';
    if (dt === 'c4-deployment') return 'deployment';
    const at = (artifactType ?? '').toLowerCase();
    if (at === 'mermaid-c4-context') return 'context';
    if (at === 'mermaid-c4-container') return 'container';
    if (at === 'mermaid-c4-component') return 'component';
    if (at === 'mermaid-c4-deployment') return 'deployment';
    return null;
}

// Validators per level ---------------------------------------------------

function validateContext(ir: DiagramIR): C4ValidationIssue[] {
    const out: C4ValidationIssue[] = [];
    const soi = ir.nodes.filter(isSystemOfInterest);
    if (soi.length === 0) {
        out.push({
            id: 'c4-ctx-missing-soi',
            code: 'C4_CTX_MISSING_SOI',
            severity: 'high',
            level: 'context',
            message: 'El diagrama de Contexto C4 no declara un sistema en scope (System of Interest).',
            recommendation: 'Agrega el sistema principal con kind=System (o semanticType=internal-system / application).',
        });
    }
    const actors = ir.nodes.filter(isExternalActorOrSystem);
    if (actors.length === 0) {
        out.push({
            id: 'c4-ctx-missing-actors',
            code: 'C4_CTX_MISSING_ACTORS_OR_EXTERNAL',
            severity: 'high',
            level: 'context',
            message: 'El diagrama de Contexto C4 no incluye actores ni sistemas externos.',
            recommendation: 'Agrega al menos un actor humano (Person) o sistema externo (System_Ext) — un contexto sin entorno no comunica.',
        });
    }
    const internalLeaks = ir.nodes.filter((n) => CONTEXT_LEAK_RE.test(`${n.label} ${n.description ?? ''} ${n.kind ?? ''}`));
    if (internalLeaks.length > 0) {
        out.push({
            id: 'c4-ctx-leaked-internals',
            code: 'C4_CTX_LEAKED_INTERNALS',
            severity: 'medium',
            level: 'context',
            message: `El contexto incluye detalle interno (${internalLeaks.length} nodo(s): componentes/clases/tablas/pods).`,
            recommendation: 'Mueve los componentes / clases / tablas / pods / DTOs / repositorios al diagrama de Componentes (L3) y mantén el Contexto en nivel de negocio.',
            affectedIds: internalLeaks.map((n) => n.id),
        });
    }
    const edgesWithJargon = ir.edges.filter((e) => CONTEXT_JARGON_RE.test(`${e.label ?? ''} ${e.protocol ?? ''}`));
    if (edgesWithJargon.length > 0 && edgesWithJargon.length / Math.max(1, ir.edges.length) >= 0.5) {
        out.push({
            id: 'c4-ctx-language-too-technical',
            code: 'C4_CTX_LANGUAGE_TOO_TECHNICAL',
            severity: 'low',
            level: 'context',
            message: `${edgesWithJargon.length} relación(es) usan jerga técnica (REST/HTTPS/Kafka…) impropia de un Contexto.`,
            recommendation: 'Cambia las etiquetas por verbos de negocio ("Consulta póliza", "Notifica al cliente"); deja los protocolos para Container/Component.',
            affectedIds: edgesWithJargon.slice(0, 8).map((e) => e.id),
        });
    }
    return out;
}

function validateContainer(ir: DiagramIR): C4ValidationIssue[] {
    const out: C4ValidationIssue[] = [];
    const containers = ir.nodes.filter(isContainerKind);
    if (containers.length === 0) {
        out.push({
            id: 'c4-con-missing-containers',
            code: 'C4_CON_MISSING_CONTAINERS',
            severity: 'high',
            level: 'container',
            message: 'El diagrama de Containers C4 no declara contenedores (aplicaciones, servicios, bases, colas, integraciones).',
            recommendation: 'Modela cada contenedor con kind=Container/ContainerDb/ContainerQueue o semanticType=application/service/database/messaging.',
        });
    }
    const noTech = containers.filter((n) => !n.technology && isTechnicalContainer(n));
    if (noTech.length > 0) {
        out.push({
            id: 'c4-con-missing-technology',
            code: 'C4_CON_MISSING_TECHNOLOGY',
            severity: 'medium',
            level: 'container',
            message: `${noTech.length} contenedor(es) técnicos sin tecnología declarada.`,
            recommendation: 'Declara la tecnología como tercer argumento de Container() ("Spring Boot 3", "PostgreSQL 15", "Kafka 3.6").',
            affectedIds: noTech.slice(0, 8).map((n) => n.id),
        });
    }
    const techEdges = ir.edges.filter((e) => {
        const src = ir.nodes.find((n) => n.id === e.source);
        const tgt = ir.nodes.find((n) => n.id === e.target);
        return (src && isContainerKind(src)) || (tgt && isContainerKind(tgt));
    });
    const noProtocol = techEdges.filter((e) => !edgeHasProtocolHint(e));
    if (techEdges.length > 0 && noProtocol.length > 0 && noProtocol.length / techEdges.length >= 0.3) {
        out.push({
            id: 'c4-con-missing-protocol',
            code: 'C4_CON_MISSING_PROTOCOL',
            severity: 'medium',
            level: 'container',
            message: `${noProtocol.length} relación(es) técnicas no declaran protocolo (REST/JDBC/AMQP/…).`,
            recommendation: 'Agrega el protocolo como cuarto argumento de Rel() o en el campo "protocolo" del inspector.',
            affectedIds: noProtocol.slice(0, 8).map((e) => e.id),
        });
    }
    return out;
}

function validateComponent(ir: DiagramIR): C4ValidationIssue[] {
    const out: C4ValidationIssue[] = [];

    // Multi-container detection: when components clearly span more than
    // one container (group label or `n.group`), the diagram lost focus.
    const groups = new Set<string>();
    for (const n of ir.nodes) if (n.group) groups.add(n.group);
    if (groups.size > 1) {
        out.push({
            id: 'c4-comp-multi-container',
            code: 'C4_COMP_MULTI_CONTAINER',
            severity: 'medium',
            level: 'component',
            message: `El diagrama de Componentes C4 modela ${groups.size} contenedores distintos en una sola vista.`,
            recommendation: 'C4 Component es una vista interna de UN contenedor; modela los otros contenedores en un diagrama separado.',
        });
    }
    const undescribed = ir.nodes.filter((n) => !n.description || n.description.trim().length === 0);
    if (undescribed.length > Math.max(1, Math.floor(ir.nodes.length / 3))) {
        out.push({
            id: 'c4-comp-missing-responsibilities',
            code: 'C4_COMP_MISSING_RESPONSIBILITIES',
            severity: 'medium',
            level: 'component',
            message: `${undescribed.length} componente(s) no declaran responsabilidad.`,
            recommendation: 'Agrega una descripción de 1-2 frases por componente (qué hace y para quién).',
            affectedIds: undescribed.slice(0, 8).map((n) => n.id),
        });
    }
    const externalActors = ir.nodes.filter(isExternalActorOrSystem);
    if (externalActors.length > 2) {
        out.push({
            id: 'c4-comp-leaked-external-actors',
            code: 'C4_COMP_LEAKED_EXTERNAL_ACTORS',
            severity: 'low',
            level: 'component',
            message: `${externalActors.length} actores/sistemas externos en un diagrama de Componentes.`,
            recommendation: 'Mantén el foco interno: limita actores externos a 1-2 (los que entran o salen del contenedor). El resto pertenece a Container/Context.',
            affectedIds: externalActors.slice(0, 8).map((n) => n.id),
        });
    }
    return out;
}

function validateDeployment(ir: DiagramIR): C4ValidationIssue[] {
    const out: C4ValidationIssue[] = [];

    const RUNTIME_RE = /\b(node|deployment|kubernetes|k8s|vm|pod|container|runtime|server|instance)\b/i;
    const ENV_RE = /\b(prod|production|stage|staging|dev|development|qa|test|sandbox|ambient|entorno|env)\b/i;
    const NETWORK_RE = /\b(network|vpc|subnet|zone|región|region|red|dmz|firewall|ingress|egress)\b/i;

    const hasRuntime = ir.nodes.some((n) => RUNTIME_RE.test(`${n.kind ?? ''} ${n.label} ${n.technology ?? ''}`));
    if (!hasRuntime) {
        out.push({
            id: 'c4-dep-missing-runtime-nodes',
            code: 'C4_DEP_MISSING_RUNTIME_NODES',
            severity: 'high',
            level: 'deployment',
            message: 'El diagrama de Deployment C4 no declara nodos de runtime (Kubernetes, VM, Pod, Server…).',
            recommendation: 'Modela los nodos físicos/lógicos donde corren los contenedores (Deployment_Node()).',
        });
    }
    const hasEnv = ir.nodes.some((n) => ENV_RE.test(`${n.label} ${n.description ?? ''} ${n.kind ?? ''}`))
        || ir.groups.some((g) => ENV_RE.test(`${g.label} ${g.purpose ?? ''}`));
    if (!hasEnv) {
        out.push({
            id: 'c4-dep-missing-environment',
            code: 'C4_DEP_MISSING_ENVIRONMENT',
            severity: 'medium',
            level: 'deployment',
            message: 'El diagrama de Deployment C4 no diferencia el ambiente (Prod / Stage / Dev).',
            recommendation: 'Usa un boundary o un nodo top-level que indique el ambiente ("Producción", "Staging").',
        });
    }
    const hasNet = ir.nodes.some((n) => NETWORK_RE.test(`${n.label} ${n.kind ?? ''} ${n.description ?? ''}`))
        || ir.groups.some((g) => NETWORK_RE.test(`${g.label} ${g.purpose ?? ''}`) || g.boundaryType === 'network');
    if (!hasNet) {
        out.push({
            id: 'c4-dep-missing-network-zone',
            code: 'C4_DEP_MISSING_NETWORK_ZONE',
            severity: 'low',
            level: 'deployment',
            message: 'El diagrama de Deployment C4 no muestra zonas de red (VPC, subnet, DMZ).',
            recommendation: 'Agrupa los contenedores por zona de red (VPC, subnet, DMZ, región) para que la topología sea legible.',
        });
    }
    return out;
}

// Public entry point -----------------------------------------------------

export function validateC4(ir: DiagramIR, artifactType?: string): C4ValidationIssue[] {
    const level = inferC4Level(ir, artifactType);
    if (!level) return [];
    if (level === 'context') return validateContext(ir);
    if (level === 'container') return validateContainer(ir);
    if (level === 'component') return validateComponent(ir);
    if (level === 'deployment') return validateDeployment(ir);
    return [];
}
