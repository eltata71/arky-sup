/**
 * Silent IR migration — upgrades older `DiagramIR` payloads to the schema
 * expected by the redesigned diagram pipeline.
 *
 * Triggered by `extractIRFromArtifact` and persistence layers when an artifact
 * stored before the redesign is opened.  The migration is intentionally
 * conservative:
 *
 *   - No information is destroyed (every field is preserved when present).
 *   - Missing metadata is back-filled with sensible defaults.
 *   - Node `kind` values are normalised to the canonical taxonomy used by the
 *     renderer (`person | gateway | service | ...`).
 *   - `metadata.schemaVersion` is set so future migrations can short-circuit.
 *
 * Callers receive the migrated IR plus a `migrated` flag and a list of
 * applied changes.  The flag is useful for the UI: persistence layers can
 * write the upgraded IR back to Firestore so the migration only happens once.
 */

import type { DiagramIR, DiagramIRGroup, DiagramIRNode } from '../../lib/diagram';
import { detectSemanticRole } from '../../lib/diagramTokens';

/**
 * Schema versions:
 *  - 1  Legacy: kind aliases, no canonical taxonomy, dangling refs possible.
 *  - 2  Canonical kinds + dangling-edge / group cleanup + metadata bootstrap.
 *  - 3  Phase 2: governance/architecture fields on nodes/edges/groups
 *       (owner, domain, compliance, criticality, security, sla, etc.).
 *       The migration is purely additive: every legacy IR is still valid
 *       under v3 because all new fields are optional. We bump the marker so
 *       persistence layers can short-circuit when they encounter a v3 IR.
 */
export const IR_SCHEMA_VERSION = 3 as const;

const CANONICAL_KINDS = new Set([
    'person', 'system', 'gateway', 'data', 'messaging',
    'external', 'service', 'process', 'generic',
]);

const KIND_ALIASES: Record<string, string> = {
    actor: 'person',
    user: 'person',
    customer: 'person',
    db: 'data',
    database: 'data',
    cache: 'data',
    storage: 'data',
    queue: 'messaging',
    broker: 'messaging',
    topic: 'messaging',
    event: 'messaging',
    api: 'gateway',
    proxy: 'gateway',
    bff: 'gateway',
    'load-balancer': 'gateway',
    saas: 'external',
    'third-party': 'external',
    partner: 'external',
    microservice: 'service',
    backend: 'service',
    worker: 'service',
    lambda: 'service',
    job: 'process',
    pipeline: 'process',
    workflow: 'process',
};

export interface MigrationResult {
    ir: DiagramIR;
    migrated: boolean;
    changes: string[];
}

function isMigrated(ir: DiagramIR): boolean {
    const version = (ir.metadata as { schemaVersion?: number } | undefined)?.schemaVersion;
    return typeof version === 'number' && version >= IR_SCHEMA_VERSION;
}

function normaliseKind(kind: string | undefined): string {
    if (!kind) return 'generic';
    const lower = kind.toLowerCase().trim();
    if (CANONICAL_KINDS.has(lower)) return lower;
    if (KIND_ALIASES[lower]) return KIND_ALIASES[lower];
    // Heuristic fall-back: detect a role from the kind text alone.
    return detectSemanticRole(kind ?? '', kind);
}

function normaliseNodes(ir: DiagramIR, changes: string[]): DiagramIRNode[] {
    return ir.nodes.map((node) => {
        const next: DiagramIRNode = { ...node };
        if (!next.kind) {
            next.kind = detectSemanticRole(next.label ?? '', undefined);
            changes.push(`node:${next.id}: assigned canonical kind "${next.kind}"`);
        } else if (!CANONICAL_KINDS.has(next.kind.toLowerCase())) {
            const normalised = normaliseKind(next.kind);
            if (normalised !== next.kind) {
                changes.push(`node:${next.id}: kind "${next.kind}" → "${normalised}"`);
                next.kind = normalised;
            }
        }
        return next;
    });
}

function dropDanglingEdges(ir: DiagramIR, changes: string[]): DiagramIR['edges'] {
    const ids = new Set(ir.nodes.map((n) => n.id));
    let dropped = 0;
    const cleaned = ir.edges.filter((e) => {
        const ok = ids.has(e.source) && ids.has(e.target);
        if (!ok) dropped += 1;
        return ok;
    });
    if (dropped > 0) changes.push(`edges: dropped ${dropped} with dangling endpoint(s)`);
    return cleaned;
}

function dropDanglingGroupRefs(nodes: DiagramIRNode[], groups: DiagramIRGroup[], changes: string[]): DiagramIRGroup[] {
    const ids = new Set(nodes.map((n) => n.id));
    let dropped = 0;
    const cleaned = groups
        .map((g) => {
            const valid = g.nodeIds.filter((id) => ids.has(id));
            if (valid.length !== g.nodeIds.length) dropped += g.nodeIds.length - valid.length;
            return { ...g, nodeIds: valid };
        })
        .filter((g) => g.nodeIds.length > 0);
    if (dropped > 0) changes.push(`groups: dropped ${dropped} dangling node reference(s)`);
    return cleaned;
}

/**
 * Phase 3: infer `group.kind` for groups that arrived without one. The
 * heuristic uses the group label to pick the most semantic boundary
 * kind:
 *  - `swimlane` for labels matching BPMN participant keywords
 *  - `data` for data/warehouse/storage zones
 *  - `security` for trust/security boundaries
 *  - `external-provider` for external partners / providers
 *  - `cloud` for AWS/Azure/GCP perimeters
 *  - `integration` for iPaaS/ESB/API gateway layers
 *  - `legacy` for legacy systems
 *  - `system-boundary` for "Sistema X" / "Domain X" / "Bounded Context"
 *  - falls back to `cluster` so the renderer still draws a translucent
 *    container.
 *
 * The migration only fills in `kind` when missing; it never overrides an
 * explicit value the user / generator already set.
 */
const GROUP_KIND_HEURISTICS: Array<{ kind: NonNullable<DiagramIRGroup['kind']>; re: RegExp }> = [
    { kind: 'swimlane', re: /\b(swimlane|carril|actor|participant|lane)\b/i },
    { kind: 'data', re: /\b(data|datos|warehouse|datalake|database|storage|repositorio)\b/i },
    { kind: 'security', re: /\b(security|seguridad|trust|zona\s+(de\s+)?seguridad|dmz|perimeter)\b/i },
    { kind: 'external-provider', re: /\b(external|partner|providers?|terceros|3rd\s*party|proveedor(es)?)\b/i },
    { kind: 'cloud', re: /\b(aws|azure|gcp|cloud|nube|kubernetes|k8s)\b/i },
    { kind: 'integration', re: /\b(integration|integraci[oó]n|ipaas|esb|mule|api\s+gateway|orchestrator|adaptadores?)\b/i },
    { kind: 'legacy', re: /\b(legacy|cobol|mainframe|as400|heredado)\b/i },
    { kind: 'enterprise', re: /\b(enterprise|empresa|organizaci[oó]n|holding)\b/i },
    { kind: 'system-boundary', re: /\b(sistema|system|dominio|domain|bounded\s+context|business\s+capability|capability)\b/i },
];

function inferGroupKind(label: string): NonNullable<DiagramIRGroup['kind']> | null {
    const trimmed = label.trim();
    if (trimmed.length === 0) return null;
    for (const { kind, re } of GROUP_KIND_HEURISTICS) {
        if (re.test(trimmed)) return kind;
    }
    return null;
}

function backfillGroupKinds(groups: DiagramIRGroup[], changes: string[]): DiagramIRGroup[] {
    let touched = 0;
    const out = groups.map((g) => {
        if (g.kind) return g;
        const inferred = inferGroupKind(g.label ?? '') ?? 'cluster';
        touched += 1;
        return { ...g, kind: inferred };
    });
    if (touched > 0) changes.push(`groups: inferred kind for ${touched} group(s) without an explicit kind`);
    return out;
}

/**
 * Apply migrations to an IR.  Idempotent: passing an already-migrated IR
 * returns it unchanged.
 */
export function migrateDiagramIR(input: DiagramIR): MigrationResult {
    if (!input || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
        return { ir: input, migrated: false, changes: [] };
    }
    if (isMigrated(input)) {
        return { ir: input, migrated: false, changes: [] };
    }
    const changes: string[] = [];
    const nodes = normaliseNodes(input, changes);
    const edges = dropDanglingEdges({ ...input, nodes }, changes);
    const cleanedGroups = dropDanglingGroupRefs(nodes, input.groups ?? [], changes);
    // Phase 3: backfill group.kind when omitted so downstream renderers
    // and gates always see a semantic boundary kind.
    const groups = backfillGroupKinds(cleanedGroups, changes);
    const metadata = { ...(input.metadata ?? {}) } as NonNullable<DiagramIR['metadata']>;
    const previousVersion = metadata.schemaVersion;
    metadata.schemaVersion = IR_SCHEMA_VERSION;
    if (!metadata.generatedAt) metadata.generatedAt = new Date().toISOString();
    if (!metadata.sourceFormat) metadata.sourceFormat = 'unknown';
    if (typeof previousVersion === 'number' && previousVersion < IR_SCHEMA_VERSION) {
        changes.push(`metadata.schemaVersion: ${previousVersion} → ${IR_SCHEMA_VERSION}`);
    }

    const migrated = { ...input, nodes, edges, groups, metadata };
    return {
        ir: migrated,
        migrated: changes.length > 0 || !isMigrated(input),
        changes,
    };
}

/** Convenience: returns the migrated IR or the original when nothing changed. */
export function migrateDiagramIROrSelf(ir: DiagramIR): DiagramIR {
    return migrateDiagramIR(ir).ir;
}
