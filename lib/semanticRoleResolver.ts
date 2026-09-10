/**
 * Canonical semantic role resolver.
 *
 * This module is the single source of truth for "what colour / icon / shape
 * does this node deserve?". It is consumed by:
 *  - `services/diagram/mermaidToIR.ts` (parser fallback)
 *  - `services/diagram/index.ts` (`reactFlowJsonToIR` import path)
 *  - `services/diagram/irToReactFlow.ts` (renderer payload)
 *  - `services/diagram/qualityGate.ts` (defensive repair pass)
 *  - `lib/diagramTokens.ts` (palette resolution at render time)
 *
 * Why a dedicated module?
 *
 * The legacy heuristic lived in three places (`detectSemanticRole`,
 * `inferKindFromLabel`, `CustomNode.detectShape`) with slightly different
 * keyword sets and **different fallbacks**. The fallback in `mermaidToIR`
 * used to default unknown nodes to `process`, which produced the visible
 * regression: actors / personas / providers (especially in insurance
 * vocabulary) rendered as pink "process" cards instead of person cards.
 *
 * The resolver enforces this precedence:
 *
 *   1. **Structural C4 syntax** (`Person`, `Person_Ext`, `ContainerDb`,
 *      `ContainerQueue`, `SystemDb`, …). Highest priority — if the source
 *      Mermaid said `Person(...)`, the result is always `person`.
 *   2. **Explicit shape signal** (`shape: 'person'`, `shape: 'cylinder'`,
 *      …). A persisted IR that already carries a shape wins over label
 *      guessing.
 *   3. **`kind` field** when it matches a canonical role (`'person'`,
 *      `'data'`, `'gateway'`, …) or a well-known alias (`'db'`,
 *      `'softwaresystem'`, …).
 *   4. **`technology` hint** (e.g. `"PostgreSQL 15"`, `"Kafka"`).
 *   5. **Label patterns** — Spanish and English keyword dictionaries.
 *   6. Fallback: **`'generic'`** (never `'process'`). `process` is only
 *      assigned when there is a positive signal that the node represents
 *      an activity / task / workflow step.
 *
 * Insurance-domain actors (`asegurado`, `proveedor médico`, `corredor`,
 * `broker`, …) are explicit `person` triggers because the original bug
 * report surfaced on insurance C4 diagrams.
 */

import type { DiagramIR, DiagramIRNode, NodeShape } from './diagram';

export type SemanticRole =
    | 'person'
    | 'system'
    | 'gateway'
    | 'data'
    | 'messaging'
    | 'external'
    | 'service'
    | 'process'
    | 'generic';

export interface ResolveSemanticRoleInput {
    label?: string;
    /** The IR `kind` field — often a C4 kind (`'Person'`, `'ContainerDb'`) or a canonical role. */
    kind?: string;
    /** Explicit shape signal from a persisted IR or a C4 parser. */
    shape?: NodeShape | string;
    /** Free-text technology hint (e.g. `'PostgreSQL 15'`, `'Kafka 3.4'`). */
    technology?: string;
    /** Optional canonical type label (renderers sometimes pass `node.data.type`). */
    type?: string;
    /**
     * Previously-resolved semantic role from a persisted IR. When set to a
     * non-generic value the resolver trusts it unless a stronger signal
     * (strong C4 kind, person shape) explicitly overrides it.
     */
    semanticRole?: SemanticRole;
    /**
     * Diagram dialect / kind. When `'process' | 'bpmn' | 'vsm' | 'flowchart'`
     * and the label matches a process verb, the result may legitimately be
     * `process`. For C4 dialects the resolver biases away from `process`.
     */
    diagramKind?: string;
}

/**
 * Reserved verbs that *positively* identify a node as a process step. The
 * dictionary keeps backwards-compatibility with the legacy parser
 * (`producci[oó]n`, `fabricaci[oó]n`, `ensamble`, `empaque`, `pedido`,
 * `solicitud`, `orden`, `atenci[oó]n`, …) so existing VSM / BPMN diagrams
 * keep classifying as `process` after this refactor.
 *
 * Imperative verb stems (`valida`, `aprueba`, `revisa`, `verifica`,
 * `procesa`, `genera`) are included so flowchart steps that read like
 * "Valida documentación", "Aprueba póliza", "Genera reporte" are
 * classified as process even when no noun form appears.
 */
const PROCESS_VERB_PATTERN =
    /\b(process|workflow|pipeline|job|batch|task|paso|etapa|fase|actividad|aprobaci[oó]n|aprueba|aprobar|revisi[oó]n|revisa|revisar|validaci[oó]n|valida(?:r)?|verificaci[oó]n|verifica(?:r)?|inspecci[oó]n|inspecciona|despacho|despacha|recepci[oó]n|env[ií]o|env[ií]a|entrega|tramite|tr[aá]mite|gesti[oó]n|gestiona|operaci[oó]n|orquestaci[oó]n|orquesta|ejecuci[oó]n|ejecuta|emisi[oó]n|emite|liquidaci[oó]n|liquida|reclamaci[oó]n|reclama|cotizaci[oó]n|cotiza|adjudicaci[oó]n|adjudica|preparar|prepara|preparaci[oó]n|capturar|captura|capturaci[oó]n|registrar|registra|registro\s+de|generar|genera|producci[oó]n|fabricaci[oó]n|fabrica|ensamble|ensambla|empaque|empaca|pedido|solicitud|orden|atenci[oó]n|atiende|atender|control|controla|procesa|procesar)\b/i;

/**
 * Dictionary of person / actor terms. Insurance-domain vocabulary is included
 * because the original regression appeared on C4 diagrams for insurance
 * systems.
 */
/**
 * Person / actor dictionary. Reserved for HUMAN roles only. Buildings,
 * organizations and external systems (farmacia, hospital, clínica) used to
 * leak into this pattern and ended up classified as actors on the canvas —
 * they now belong in `PROVIDER_EXTERNAL_PATTERN` so the badge reads
 * "Proveedor Externo" instead of "Actor".
 */
const PERSON_PATTERN =
    /\b(person|persona|actor|user|usuario|customer|cliente|stakeholder|admin|administrador|developer|desarrollador|auditor|analyst|analista|supervisor|coordinator|coordinador|operator|operador|insured|asegurado|policyholder|afiliado|member|miembro|patient|paciente|beneficiar(?:y|io)|broker|corredor|agent|agente|prescriptor|prescriber|medical\s+provider|m[eé]dico|doctor|farmac[eé]utico|employer|empleador|empresa\s+cliente)\b/i;

const GATEWAY_PATTERN =
    /\b(api\s*gateway|api\s+gw|gateway|bff|api\s+facade|ingress|reverse\s+proxy|edge\s+(?:proxy|service)|load\s*-?\s*balanc(?:er|ing)?|pasarela|proxy)\b/i;

const DATA_PATTERN =
    /\b(database|db|sql|postgres|postgresql|mysql|mariadb|oracle|mongodb?|mongo|cassandra|cosmos|dynamodb|redis|memcached|elasticsearch|opensearch|warehouse|data\s*warehouse|data\s*lake|datalake|s3|blob\s+storage|object\s+storage|storage|directorio\s+activo|active\s+directory|backup|repositorio|almac[eé]n\s+de\s+datos|base\s+de\s+datos|bases?\s+de\s+datos|datos\s+(?:maestros|hist[oó]ricos)|persistencia)\b/i;

const MESSAGING_PATTERN =
    /\b(queue|kafka|topic|broker|stream|streaming|event\s*bus|event\s*hub|pub.?sub|sns|sqs|rabbit(?:mq)?|service\s+bus|cola(?:\s+de\s+\w+)?|bus\s+de\s+eventos|notificaciones?)\b/i;

const EXTERNAL_PATTERN =
    /\b(third(?:-|\s)?party|partner|tercero|external|externa|externo|saas|cloud\s+(?:provider|service)|stripe|twilio|sendgrid|mailgun|paypal)\b/i;

const SERVICE_PATTERN =
    /\b(service|microservice|servicio|micro|backend|worker|lambda|cloud\s+function|function\s+as\s+a\s+service|faas|module|m[oó]dulo)\b/i;

const SYSTEM_PATTERN =
    /\b(software\s*system|system|sistema|plataforma|platform|core\s+system|core\s+de|portal|application|aplicaci[oó]n|context|dominio|domain|crm|erp|tms|wms)\b/i;
const LEGACY_PATTERN =
    /\b(as\/?400|i\s*series|iseries|ibm\s*i|legacy|gmd|simasec|mainframe|mvs|cobol|cics|host\s+legacy|sistema\s+legacy)\b/i;
const INTEGRATION_PATTERN =
    /\b(mulesoft|mule\s*soft|integration\s+platform|plataforma\s+de\s+integraci[oó]n|esb|ipaas|boomi|informatica|workato|tibco|webmethods|wso2|apigee|kong|anypoint)\b/i;
const AWS_SERVICE_PATTERN =
    /\b(api\s*gateway|cognito|lambda|dynamodb|cloudfront|eventbridge|sqs|sns|ses|s3|aws|amazon\s+(?:s3|ses|sqs|sns|lambda|cognito|rds|dynamodb|eventbridge|cloudfront)|cloudwatch|step\s+functions|fargate|ecs|eks|aurora|kinesis|glue|athena|redshift|secrets\s+manager|kms)\b/i;
const AZURE_SERVICE_PATTERN =
    /\b(azure|microsoft\s+azure|service\s+bus|event\s+hub|cosmos\s*db|blob\s+storage|app\s+service|aks|functions\s+app|app\s+gateway)\b/i;
const GCP_SERVICE_PATTERN = /\b(gcp|google\s+cloud|bigquery|pub\/?sub|cloud\s+run|gke|firestore|cloud\s+storage)\b/i;
const PORTAL_PATTERN = /\b(portal|benefits\s*direct|canal\s+digital|self[\s-]?service|web\s+app)\b/i;
/**
 * Documentary / file-store repositories. Box is the canonical example for
 * insurance/PBM workflows, but the pattern also matches generic intranet /
 * SharePoint / repositorio documental wording.
 */
const DOCUMENT_REPO_PATTERN =
    /\b(box|sharepoint|repositorio\s+documental|document\s+repository|gestor\s+documental|onedrive|alfresco|nuxeo|file\s+share|fileshare|file\s+server)\b/i;
/**
 * Healthcare / PBM / insurance domain dictionary — adds positive signals that
 * help differentiate human actors, providers, and business-process nodes in
 * insurance C4 diagrams. Used by `inferNodeSemanticType` to assign richer
 * categories than the bare `system`/`person`/`generic` triplet.
 */
/**
 * Insurance / PBM / healthcare actor dictionary (HUMAN actors only). Mirrors
 * `PERSON_PATTERN` but used by `inferNodeSemanticType` so the granular
 * `semanticType` ends up as `'human-actor'` for these labels even when the
 * raw `kind` was a generic `'System'` or `'Container'`.
 *
 * Buildings / organizations / external systems (farmacia, hospital, clínica,
 * red de farmacias) deliberately live in `PROVIDER_EXTERNAL_PATTERN` —
 * classifying them as actors used to put a person avatar on a system card,
 * which is the regression visible on the PBM container diagrams.
 */
const PBM_ACTOR_PATTERN =
    /\b(asegurado|policyholder|afiliado|miembro|member|paciente|patient|prescriptor|prescriber|doctor|m[eé]dico\s+(?:prescriptor|tratante|de\s+cabecera)?|farmac[eé]utico|broker|corredor|administrador|admin\s+palic|auditor|operador|empleador|sponsor|usuario\s+final)\b/i;
const PROVIDER_EXTERNAL_PATTERN =
    /\b(palic|pbm|farmacia|pharmacy|red\s+de\s+farmacias|farmacia[\s-]*dispensador|cl[ií]nica|clinica|hospital|aseguradora|insurer|payer|emr|ehr|history\s+exchange|hie|aetna|cigna|express\s+scripts|optum|caremark|sistema\s+externo|external\s+system|external\s+provider|sistema[\s-]*m[eé]dico|m[eé]dico\s+externo|pos[\s-]*farmacia|sistema[\s-]*pos[\s-]*farmacia)\b/i;
const NOTIFICATION_SERVICE_PATTERN =
    /\b(notification|notificaci[oó]n|amazon\s+ses|mailgun|sendgrid|twilio|smtp|push\s+notification|notificaciones|sms\s+gateway|email\s+gateway)\b/i;
const SECURITY_SERVICE_PATTERN =
    /\b(cognito|iam|oauth2?|openid|sso|single\s+sign|auth0|okta|keycloak|secret\s+manager|vault|kms|security\s+token|jwt|wallet|identity\s+provider)\b/i;
const RULES_ENGINE_PATTERN =
    /\b(rules?\s+engine|motor\s+de\s+reglas|drools|odm|decision\s+engine|policy\s+engine)\b/i;
const ANALYTICS_PATTERN =
    /\b(analytics|anal[ií]tic[oa]s?|bi\b|business\s+intelligence|tableau|power\s*bi|looker|metabase|data\s+studio|warehouse|datawarehouse)\b/i;
const REPORT_PATTERN = /\b(report|reporte|reporting|dashboard|tablero)\b/i;
const BATCH_FILE_PATTERN =
    /\b(batch|cron|sftp|ftp|edi|archivo\s+plano|flat\s+file|cargue\s+batch|file\s+exchange|ftp\s+job)\b/i;
const SAAS_VENDOR_PATTERN =
    /\b(salesforce|workday|servicenow|stripe|paypal|datadog|new\s*relic|sentry|segment|mixpanel|hubspot|datagecko|data\s*gecko)\b/i;
const API_PATTERN =
    /\b(api|rest\s+api|graphql\s+api|soap\s+api|gateway\s+api|api\s+gateway|endpoint|servicio\s+rest|servicio\s+soap)\b/i;
const MICROSERVICE_PATTERN =
    /\b(microservice|microservicio|micro[\s-]service|workersvc|lambda|cloud\s+function|faas|function\s+as\s+a\s+service)\b/i;

/**
 * Diagram dialects whose business semantics make `process` a *valid*
 * fallback even when the label is ambiguous (VSM, BPMN, Gantt, swimlane
 * flowcharts). For everything else (C4, ERD, sequence, classDiagram) the
 * fallback is `'generic'`.
 */
const PROCESS_BIASED_DIALECT =
    /^(vsm|bpmn|gantt|journey|flowchart|graph|process)/i;

const C4_DIALECT = /^c4/i;

/**
 * Strong structural C4 kinds that are definitive — they ALWAYS win against
 * shape / label / technology heuristics. Distinct from the canonical
 * lowercase role names (which are repairable when other signals disagree).
 */
function roleFromStrongC4Kind(kindRaw: string | undefined): SemanticRole | null {
    if (!kindRaw) return null;
    const k = kindRaw.trim();
    if (!k) return null;

    // C4 element kinds — explicit syntactic markers in the Mermaid source.
    if (/^person(_ext)?$/i.test(k)) return 'person';
    if (/^actor$/i.test(k)) return 'person';
    if (/db$/i.test(k)) return 'data';
    if (/queue$/i.test(k)) return 'messaging';
    if (/^api[_\s-]?gateway$/i.test(k) || /gateway$/i.test(k)) return 'gateway';
    if (/^softwaresystem(_ext)?$/i.test(k) || /^system(_ext)?$/i.test(k)) return 'system';
    return null;
}

/**
 * Soft canonical kind aliases: lowercase role names + ambiguous C4 wrappers
 * (Container, Component, Deployment_Node) that can be REFINED by shape /
 * label / technology evidence. When the legacy IR stored `kind: 'process'`
 * but the label is "Asegurado" and the shape is `person`, the consensus
 * should win — not the historic mis-tag.
 */
function roleFromSoftKind(kindRaw: string | undefined): SemanticRole | null {
    if (!kindRaw) return null;
    const lower = kindRaw.trim().toLowerCase();
    if (!lower) return null;

    if (lower === 'person' || lower === 'enduser' || lower === 'system_person') return 'person';
    if (lower === 'gateway') return 'gateway';
    if (lower === 'data' || lower === 'database' || lower === 'db') return 'data';
    if (lower === 'messaging' || lower === 'queue' || lower === 'topic' || lower === 'bus') return 'messaging';
    if (lower === 'external') return 'external';
    if (lower === 'service' || lower === 'microservice') return 'service';
    if (lower === 'process' || lower === 'workflow') return 'process';
    if (lower === 'system' || lower === 'softwaresystem' || lower === 'context') return 'system';
    // Ambiguous C4 wrappers — service by default but they let shape/label win.
    if (/^container(_ext)?$/i.test(lower)) return 'service';
    if (/^component(_ext)?$/i.test(lower)) return 'service';
    if (/^(deployment_node|node|container_instance)$/i.test(lower)) return 'service';
    return null;
}

/** Shape-based role inference. */
function roleFromShape(shape: string | undefined): SemanticRole | null {
    if (!shape) return null;
    const s = shape.toLowerCase();
    if (s === 'person') return 'person';
    if (s === 'cylinder') return 'data';
    if (s === 'hexagon') return 'service';
    if (s === 'cloud') return 'external';
    if (s === 'tab-box') return null; // C4 container — ambiguous, keep falling through.
    if (s === 'diamond') return null; // decisions — usually process but ambiguous.
    return null;
}

/** Technology-hint role inference. */
function roleFromTechnology(technology: string | undefined): SemanticRole | null {
    if (!technology) return null;
    const t = technology.toLowerCase();
    if (DATA_PATTERN.test(t)) return 'data';
    if (MESSAGING_PATTERN.test(t)) return 'messaging';
    if (GATEWAY_PATTERN.test(t)) return 'gateway';
    return null;
}

/** Label-pattern role inference. Person check runs first so insurance-domain
 *  actors (`Asegurado`, `Proveedor Médico`, `Corredor`, …) never fall through
 *  to `process` because of an ambiguous noun in the description. */
function roleFromLabel(label: string | undefined, diagramKind: string | undefined): SemanticRole | null {
    if (!label) return null;
    const text = label.trim();
    if (!text) return null;

    if (PERSON_PATTERN.test(text)) return 'person';
    if (GATEWAY_PATTERN.test(text)) return 'gateway';
    if (DATA_PATTERN.test(text)) return 'data';
    if (MESSAGING_PATTERN.test(text)) return 'messaging';
    if (EXTERNAL_PATTERN.test(text)) return 'external';
    if (SERVICE_PATTERN.test(text)) return 'service';
    if (SYSTEM_PATTERN.test(text)) return 'system';

    // `process` is the LAST positive signal — and only when the dialect
    // supports it or the verb is unambiguous (workflow, pipeline, …).
    if (PROCESS_VERB_PATTERN.test(text)) {
        if (!diagramKind || PROCESS_BIASED_DIALECT.test(diagramKind)) return 'process';
        // Even on C4 dialects a "workflow" label is a process step — but
        // the verb pattern is tight enough that we still trust it.
        return 'process';
    }

    return null;
}

/**
 * Resolve the canonical semantic role for a node, applying the documented
 * precedence:
 *
 *   1. **Strong C4 kind** (`Person`, `ContainerDb`, `SystemQueue`,
 *      `SoftwareSystem`, …) — definitive, always wins.
 *   2. **Person shape** — a parser that committed to `shape: 'person'` has
 *      already painted an avatar; the role must match.
 *   3. **Person label** — insurance-domain dictionary check runs early so
 *      "Asegurado", "Proveedor Médico", "Corredor" never collapse into
 *      `process`.
 *   4. **Other shape signals** (`cylinder` → data, `cloud` → external).
 *   5. **Technology hint** (`Kafka` → messaging, `PostgreSQL` → data, …).
 *   6. **Label patterns** (`API Gateway`, `Validación`, `Cola de Eventos`, …).
 *   7. **Soft canonical kind aliases** (`'process'`, `'service'`,
 *      ambiguous C4 wrappers). These are repairable when the consensus
 *      between shape / label / technology disagrees.
 *   8. Fallback: `'generic'`. Process is only assigned when there's a
 *      positive signal in the label.
 *
 * Pure, side-effect free, deterministic.
 */
export function resolveSemanticRole(input: ResolveSemanticRoleInput): SemanticRole {
    const { label, kind, shape, technology, type, diagramKind, semanticRole: persisted } = input;

    // 1) Strong structural C4 kinds — definitive (Person, ContainerDb, …).
    const fromStrongC4 = roleFromStrongC4Kind(kind);
    if (fromStrongC4) return fromStrongC4;

    // 2) Person shape — a parser already committed to drawing an avatar, so
    //    the role must agree even when the kind disagrees (legacy IR repair).
    if (shape && shape.toLowerCase() === 'person') return 'person';

    // 3) Person label dictionary (insurance domain) — protected against the
    //    `process` fallback. Runs before soft kinds so a legacy IR tagged
    //    `kind: 'process'` with label `Asegurado` repairs to `person`.
    if (label && PERSON_PATTERN.test(label)) return 'person';

    // 3.5) Persisted role from a previous resolver pass. We trust it as long
    //      as it carries information (anything but `generic`). Strong signals
    //      above can still override — that is what the repair pass needs.
    if (persisted && persisted !== 'generic') return persisted;

    // 4) Other shape signals (cylinder, cloud, hexagon).
    const fromShape = roleFromShape(shape);
    if (fromShape) return fromShape;

    // 5) `type` field used by the renderer sometimes carries the kind verbatim.
    const fromTypeStrong = roleFromStrongC4Kind(type);
    if (fromTypeStrong) return fromTypeStrong;

    // 6) Technology hint (Kafka → messaging, PostgreSQL → data, …).
    const fromTech = roleFromTechnology(technology);
    if (fromTech) return fromTech;

    // 7) Label patterns (gateway, data, messaging, …). Person handled above.
    const fromLabel = roleFromLabel(label, diagramKind);
    if (fromLabel) return fromLabel;

    // 8) Soft canonical kind aliases (`'process'`, `'service'`, Container, …).
    //    These are accepted last so other evidence can refine them.
    const fromSoftKind = roleFromSoftKind(kind);
    if (fromSoftKind) return fromSoftKind;
    const fromSoftType = roleFromSoftKind(type);
    if (fromSoftType) return fromSoftType;

    // 9) Last-resort: on process-biased dialects the legacy behaviour was to
    //    return `'process'`, which is acceptable for BPMN/VSM. For everything
    //    else the safe default is `'generic'` — `process` requires evidence.
    if (diagramKind && PROCESS_BIASED_DIALECT.test(diagramKind) && !C4_DIALECT.test(diagramKind)) {
        return 'generic';
    }

    return 'generic';
}

/**
 * Idempotent shape coercion for a node — `Person` nodes must render with the
 * `person` shape, `ContainerDb` nodes with `cylinder`, etc. Called by the
 * repair pass after the role is resolved.
 */
function shapeForRole(role: SemanticRole, current: NodeShape | undefined): NodeShape | undefined {
    if (role === 'person' && current !== 'person') return 'person';
    if (role === 'data' && (!current || current === 'rectangle')) return 'cylinder';
    return current;
}

export interface NormalizeNodeContext {
    diagramKind?: string;
    /** Whether the node was reconstructed from ReactFlow JSON (no parser hints). */
    fromReactFlowJson?: boolean;
}

export interface NormalizedNodeOutcome {
    node: DiagramIRNode;
    role: SemanticRole;
    /** Human-readable diff entries when the resolver corrected the node. */
    changes: string[];
}

/**
 * Infer the granular `semanticType` for a node. The precedence is designed
 * so very specific signals (legacy / integration platform / known cloud
 * vendor) always beat the role-derived fallback. Used by:
 *  - `normalizeDiagramNodeSemantics` (writes back into the IR)
 *  - `lib/diagramCategoryLabels` (human-readable badge text)
 *
 * Pure, deterministic. Reads label/description/kind/technology only.
 */
function inferNodeSemanticType(node: DiagramIRNode, role: SemanticRole): DiagramIRNode['semanticType'] {
    const text = `${node.label ?? ''} ${node.description ?? ''} ${node.kind ?? ''} ${node.technology ?? ''}`.toLowerCase();

    // 1) Strong domain signals — must beat the role fallback.
    if (LEGACY_PATTERN.test(text)) return 'legacy-system';
    if (INTEGRATION_PATTERN.test(text)) return 'integration-platform';
    if (DOCUMENT_REPO_PATTERN.test(text)) return 'document-repository';
    if (RULES_ENGINE_PATTERN.test(text)) return 'rules-engine';
    if (NOTIFICATION_SERVICE_PATTERN.test(text)) return 'notification-service';
    if (SECURITY_SERVICE_PATTERN.test(text)) return 'security-service';
    if (BATCH_FILE_PATTERN.test(text)) return 'batch-file';
    if (REPORT_PATTERN.test(text) && /dashboard/.test(text)) return 'dashboard';
    if (REPORT_PATTERN.test(text)) return 'report';
    if (ANALYTICS_PATTERN.test(text)) return 'analytics-system';

    // 2) Cloud vendors (AWS / Azure / GCP) — narrower than the generic
    //    "service" fallback. Saas vendors (Salesforce, Workday, …) collapse
    //    into `external-system` so the badge differentiates them from a
    //    homegrown microservice.
    if (AWS_SERVICE_PATTERN.test(text) || AZURE_SERVICE_PATTERN.test(text) || GCP_SERVICE_PATTERN.test(text)) {
        return 'cloud-service';
    }
    if (SAAS_VENDOR_PATTERN.test(text)) return 'external-system';

    // 3) Technical archetypes derived from the label / technology.
    if (/\b(queue|topic|kafka|sqs|sns|eventbridge|rabbit|service\s+bus|event\s+hub|bus\s+de\s+eventos|cola\s+de)\b/.test(text)) {
        return 'messaging';
    }
    if (/\b(db|database|postgres|oracle|dynamo|sql|mongodb|mongo|cassandra|redis|elasticsearch|opensearch|aurora|cosmos|bigquery|firestore|base\s+de\s+datos|almac[eé]n\s+de\s+datos|warehouse|data\s*lake)\b/.test(text)) {
        return 'database';
    }
    if (PORTAL_PATTERN.test(text)) return 'portal';
    if (API_PATTERN.test(text) || /\b(gateway|api\s*gw|bff)\b/.test(text)) return 'api';
    if (MICROSERVICE_PATTERN.test(text)) return 'microservice';

    // 4) Domain-actor dictionaries (insurance / PBM / healthcare).
    if (PBM_ACTOR_PATTERN.test(text)) return 'human-actor';
    if (PROVIDER_EXTERNAL_PATTERN.test(text)) return 'external-provider';

    // 5) Role-derived fallback. We never collapse to `generic` when the
    //    semantic role has positive information — `role` already tells us
    //    something useful (system / service / process / data / messaging).
    if (role === 'person') return 'human-actor';
    if (role === 'data') return 'database';
    if (role === 'messaging') return 'messaging';
    if (role === 'gateway') return 'api';
    if (role === 'external') return 'external-system';
    if (role === 'system') return 'internal-system';
    if (role === 'service') return 'service';
    if (role === 'process') return 'business-process';

    return 'generic';
}

/**
 * Normalize a single IR node: compute the canonical role, repair the shape
 * when it disagrees with the role (e.g. `kind: 'Person'` + `shape: 'rectangle'`
 * → `shape: 'person'`), and attach the role to `node.semanticRole` for
 * downstream renderers.
 *
 * The function is non-destructive: it never overwrites a label, description,
 * technology hint, or kind that already carries information. It only fixes
 * the **visual contract** (`shape`, `semanticRole`) so the renderer can pick
 * the right palette and avatar.
 */
export function normalizeDiagramNodeSemantics(
    node: DiagramIRNode,
    context: NormalizeNodeContext = {},
): NormalizedNodeOutcome {
    const role = resolveSemanticRole({
        label: node.label,
        kind: node.kind,
        shape: node.shape,
        technology: node.technology,
        semanticRole: node.semanticRole,
        diagramKind: context.diagramKind,
    });

    const changes: string[] = [];
    const next: DiagramIRNode = { ...node };

    // Attach the resolved role for downstream renderers. Even when the role
    // is `'generic'` we set it so the renderer never re-derives it from
    // stale heuristics.
    if (next.semanticRole !== role) {
        if (next.semanticRole && next.semanticRole !== role) {
            changes.push(
                `node "${node.id}" semanticRole ${next.semanticRole} → ${role}`,
            );
        }
        next.semanticRole = role;
    }
    const semanticType = inferNodeSemanticType(next, role);
    if (next.semanticType !== semanticType) {
        next.semanticType = semanticType;
    }

    // Coerce shape to match the role when the legacy IR carries a
    // contradiction (e.g. `kind: 'Person'`, `shape: 'rectangle'`). Only set
    // the shape, never clear it — the parser may have a legitimate reason
    // to keep a `tab-box` on a container node.
    const targetShape = shapeForRole(role, next.shape);
    if (targetShape && targetShape !== next.shape) {
        changes.push(`node "${node.id}" shape ${next.shape ?? 'unset'} → ${targetShape}`);
        next.shape = targetShape;
    }

    return { node: next, role, changes };
}

export interface RepairDiagramIRSemanticsResult {
    ir: DiagramIR;
    /** Per-node change log — empty when the IR was already consistent. */
    changes: string[];
}

/**
 * Walk every node in an IR and apply `normalizeDiagramNodeSemantics`. The
 * function returns a new IR (the input is never mutated). When at least one
 * change was applied, the repair history is appended in `ir.metadata.repairHistory`
 * with the reason `'semantic-role-repair'`.
 */
export function repairDiagramIRSemantics(
    ir: DiagramIR,
    context: NormalizeNodeContext = {},
): RepairDiagramIRSemanticsResult {
    const diagramKind = context.diagramKind ?? ir.metadata?.sourceFormat;
    const allChanges: string[] = [];
    const nodes = ir.nodes.map((node) => {
        const { node: next, changes } = normalizeDiagramNodeSemantics(node, {
            ...context,
            diagramKind,
        });
        if (changes.length > 0) allChanges.push(...changes);
        return next;
    });

    if (allChanges.length === 0) {
        return { ir, changes: [] };
    }

    const repaired: DiagramIR = {
        ...ir,
        nodes,
        metadata: {
            ...ir.metadata,
            repairHistory: [
                ...(ir.metadata?.repairHistory ?? []),
                {
                    at: new Date().toISOString(),
                    reason: 'semantic-role-repair',
                    changes: allChanges,
                },
            ],
        },
    };

    return { ir: repaired, changes: allChanges };
}

/**
 * Map a resolved semantic role back to a canonical lowercase kind string.
 * Used by the Mermaid parser to populate `DiagramIRNode.kind` when the
 * Mermaid source does not declare an explicit C4 kind (i.e. classic
 * flowcharts where the parser has to guess).
 */
export function canonicalKindForRole(role: SemanticRole): string {
    switch (role) {
        case 'person':
            return 'person';
        case 'system':
            return 'system';
        case 'gateway':
            return 'gateway';
        case 'data':
            return 'data';
        case 'messaging':
            return 'messaging';
        case 'external':
            return 'external';
        case 'service':
            return 'service';
        case 'process':
            return 'process';
        case 'generic':
        default:
            return 'generic';
    }
}
