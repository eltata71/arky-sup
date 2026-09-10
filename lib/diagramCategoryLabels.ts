/**
 * Human-readable category labels for diagram nodes and edges.
 *
 * Why a separate module?
 *
 * The IR carries a `semanticType` enum (`legacy-system`, `integration-platform`,
 * `cloud-service`, …) that the renderer needs to translate into a short Spanish
 * label visible on the node card. Doing the translation inside the renderer
 * leaks vocabulary into multiple components (CustomNode, the legend, the
 * inspector) and makes the badge inconsistent between views.
 *
 * The functions here are pure, side-effect free, and safe to call from any
 * layer — including tests and prompts. They are the single source of truth
 * for the user-facing taxonomy.
 */

import type { DiagramIREdge, DiagramIRNode } from './diagram';
import { resolveSemanticRole, type SemanticRole } from './semanticRoleResolver';

export type NodeSemanticType = NonNullable<DiagramIRNode['semanticType']>;
export type EdgeSemanticType = NonNullable<DiagramIREdge['semanticType']>;

/**
 * Spanish category label per semantic type. Kept short (≤ 22 chars) so the
 * badge never wraps on a 256px-wide node card. Mirrors the taxonomy listed
 * in `types.ts` (DiagramIRNode.semanticType).
 */
const NODE_CATEGORY_LABELS: Record<NodeSemanticType, string> = {
    'human-actor':           'Actor',
    'business-role':         'Rol de Negocio',
    'internal-system':       'Sistema',
    'external-system':       'Sistema Externo',
    'legacy-system':         'Sistema Legacy',
    'application':           'Aplicación',
    'portal':                'Portal / Canal',
    'api':                   'API',
    'service':               'Servicio',
    'microservice':          'Microservicio',
    'component':             'Componente',
    'c4-container':          'Contenedor',
    'database':              'Base de Datos',
    'document-repository':   'Repositorio Doc.',
    'integration-platform':  'Integración',
    'messaging':             'Mensajería',
    'cloud-service':         'Servicio Cloud',
    'security-service':      'Seguridad',
    'notification-service':  'Notificaciones',
    'rules-engine':          'Motor de Reglas',
    'business-process':      'Proceso',
    'external-provider':     'Proveedor Externo',
    'digital-channel':       'Canal Digital',
    'batch-file':            'Batch / Archivo',
    'report':                'Reporte',
    'dashboard':             'Dashboard',
    'data-product':          'Producto de Datos',
    'analytics-system':      'Analítica',
    'generic':               'Genérico',
};

/** English variants used by the audience projector when audience === 'technical-en'. */
const NODE_CATEGORY_LABELS_EN: Record<NodeSemanticType, string> = {
    'human-actor':           'Actor',
    'business-role':         'Business Role',
    'internal-system':       'System',
    'external-system':       'External System',
    'legacy-system':         'Legacy System',
    'application':           'Application',
    'portal':                'Portal / Channel',
    'api':                   'API',
    'service':               'Service',
    'microservice':          'Microservice',
    'component':             'Component',
    'c4-container':          'Container',
    'database':              'Database',
    'document-repository':   'Doc Repository',
    'integration-platform':  'Integration',
    'messaging':             'Messaging',
    'cloud-service':         'Cloud Service',
    'security-service':      'Security',
    'notification-service':  'Notifications',
    'rules-engine':          'Rules Engine',
    'business-process':      'Process',
    'external-provider':     'External Provider',
    'digital-channel':       'Digital Channel',
    'batch-file':            'Batch / File',
    'report':                'Report',
    'dashboard':             'Dashboard',
    'data-product':          'Data Product',
    'analytics-system':      'Analytics',
    'generic':               'Generic',
};

/**
 * Edge category labels — used by the dynamic legend and the inspector. The
 * short forms double as edge badges when the source/target labels carry no
 * protocol metadata.
 */
const EDGE_CATEGORY_LABELS: Record<EdgeSemanticType, string> = {
    'rest-api':         'REST API',
    'soap':             'SOAP',
    'graphql':          'GraphQL',
    'event':            'Evento',
    'async-messaging':  'Mensajería Asíncrona',
    'batch':            'Batch',
    'file-transfer':    'Transferencia Archivo',
    'query':            'Consulta',
    'publish':          'Publicación',
    'subscribe':        'Suscripción',
    'authentication':   'Autenticación',
    'authorization':    'Autorización',
    'notification':     'Notificación',
    'data-transfer':    'Transferencia de Datos',
    'synchronization':  'Sincronización',
    'orchestration':    'Orquestación',
    'composition':      'Composición',
    'dependency':       'Dependencia',
    'business-flow':    'Flujo de Negocio',
    'data-flow':        'Flujo de Datos',
    'control-flow':     'Flujo de Control',
    'generic':          'Relación',
};

/**
 * Resolve the badge text for a node. Precedence:
 *
 *   1. **Technology hint** when it carries information AND no better category
 *      is available (e.g. `"Java, Spring Boot"`, `"PostgreSQL 15"`).
 *   2. **`semanticType`** mapped through {@link NODE_CATEGORY_LABELS}.
 *   3. **Soft fallback** derived from `role`. This is what removes the visible
 *      "GENERIC" badge regression — when the role is `'system'` we badge as
 *      `"Sistema"` instead of letting `kind` (often `"Generic"`) bleed through.
 *   4. **Raw `kind`** — last resort, only when there's literally no
 *      classification signal upstream.
 *
 * The function is pure and never returns `undefined` — the caller can always
 * render the result without a null-guard.
 */
export function resolveNodeCategoryLabel(
    node: Pick<DiagramIRNode, 'kind' | 'label' | 'technology' | 'semanticType' | 'semanticRole' | 'shape' | 'description'>,
    opts: { language?: 'es' | 'en'; preferTechnology?: boolean } = {},
): string {
    const dictionary = opts.language === 'en' ? NODE_CATEGORY_LABELS_EN : NODE_CATEGORY_LABELS;

    // 1) When a technology hint exists, prefer it for the badge — it is the
    //    most specific information available (e.g. "MuleSoft", "Java 17").
    //    Skip when the technology is itself a generic placeholder.
    if (opts.preferTechnology !== false && node.technology && node.technology.trim().length > 0) {
        const tech = node.technology.trim();
        if (!/^(generic|n\/a|none|unknown|placeholder)$/i.test(tech)) {
            return tech;
        }
    }

    // 2) Use the semantic type when set. We fall through on `'generic'` so
    //    the role/kind fallback can still inject signal.
    if (node.semanticType && node.semanticType !== 'generic') {
        return dictionary[node.semanticType] ?? dictionary.generic;
    }

    // 3) Derive a meaningful badge from the role even when semanticType is
    //    missing or `'generic'`. Avoids the "GENERIC" badge regression on
    //    legacy IR that pre-dates the semanticType field.
    const role: SemanticRole = node.semanticRole ?? resolveSemanticRole({
        label: node.label,
        kind: node.kind,
        shape: node.shape,
        technology: node.technology,
    });
    const roleLabel = labelForRole(role, dictionary);
    if (roleLabel) return roleLabel;

    // 4) Last resort: the raw kind, if any. Filters obvious noise like
    //    `'Generic'` that the AI sometimes drops in.
    if (node.kind && !/^generic$/i.test(node.kind)) {
        return node.kind;
    }
    return dictionary.generic;
}

function labelForRole(role: SemanticRole, dictionary: Record<NodeSemanticType, string>): string | null {
    switch (role) {
        case 'person':    return dictionary['human-actor'];
        case 'system':    return dictionary['internal-system'];
        case 'external':  return dictionary['external-system'];
        case 'data':      return dictionary['database'];
        case 'messaging': return dictionary['messaging'];
        case 'gateway':   return dictionary['api'];
        case 'service':   return dictionary['service'];
        case 'process':   return dictionary['business-process'];
        case 'generic':   return null;
        default:          return null;
    }
}

/**
 * Resolve the badge text for an edge. Precedence:
 *
 *   1. **Protocol field** when set ("REST/HTTPS", "Kafka", …).
 *   2. **`semanticType`** mapped through {@link EDGE_CATEGORY_LABELS}.
 *   3. **`relation` fallback** ("async" → "Asíncrono", …).
 *
 * Returns `null` when the edge has neither protocol nor metadata so the
 * renderer can decide whether to fall back to the raw label or hide the
 * badge entirely.
 */
export function resolveEdgeCategoryLabel(
    edge: Partial<Pick<DiagramIREdge, 'protocol' | 'semanticType' | 'relation' | 'label'>>,
): string | null {
    if (edge.protocol && edge.protocol.trim().length > 0) {
        return edge.protocol.trim();
    }
    if (edge.semanticType && edge.semanticType !== 'generic') {
        return EDGE_CATEGORY_LABELS[edge.semanticType] ?? null;
    }
    switch (edge.relation) {
        case 'async':       return 'Asíncrono';
        case 'data-flow':   return 'Flujo de Datos';
        case 'dependency':  return 'Dependencia';
        case 'inheritance': return 'Composición';
        case 'sync':        return 'Sincrónico';
        default:            return null;
    }
}

/**
 * Lookup helper used by the dynamic legend.
 */
export function getNodeCategoryLabel(type: NodeSemanticType, language: 'es' | 'en' = 'es'): string {
    return (language === 'en' ? NODE_CATEGORY_LABELS_EN : NODE_CATEGORY_LABELS)[type] ?? type;
}

export function getEdgeCategoryLabel(type: EdgeSemanticType): string {
    return EDGE_CATEGORY_LABELS[type] ?? type;
}
