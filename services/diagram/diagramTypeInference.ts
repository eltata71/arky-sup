/**
 * Diagram archetype inference.
 *
 * Phase 2 introduces the explicit `metadata.diagramType` field on
 * `DiagramIR`. Until every generator emits it, we need a deterministic way
 * to derive the archetype from the artifact type, the node kinds and the
 * IR semantic signals. This module is the single source of truth for that
 * derivation — both the renderer and the quality gates call it so the
 * heuristic stays consistent.
 *
 * The inference is intentionally conservative:
 *  1. Honour `ir.metadata.diagramType` when already set.
 *  2. Honour the artifact type when it maps unambiguously to an archetype.
 *  3. Otherwise, fall back to heuristics over node kinds and labels.
 *  4. Return `'generic'` when nothing else matches — never throw.
 *
 * The function is pure: it never mutates the IR. Callers that want to
 * persist the inferred type should explicitly clone the metadata.
 */

import type { ArtifactType } from '../../types';
import type { DiagramIR } from '../../lib/diagram';

export type DiagramTypeId = NonNullable<NonNullable<DiagramIR['metadata']>['diagramType']>;

const ARTIFACT_TYPE_MAP: Partial<Record<ArtifactType, DiagramTypeId>> = {
    'mermaid-c4-context': 'c4-context',
    'mermaid-c4-container': 'c4-container',
    'mermaid-c4-component': 'c4-component',
    'mermaid-c4-deployment': 'c4-deployment',
    'mermaid-erd': 'erd',
    'mermaid-sequence': 'sequence',
    'sdd-domain-model': 'erd',
    'sdd-event-storming': 'data-flow',
};

const C4_NODE_KINDS = new Set([
    'person', 'system', 'softwaresystem', 'container', 'component',
    'deployment_node', 'enterprise_boundary', 'system_boundary',
]);

// BPMN keywords: anchored to BPMN-specific vocabulary so generic terms
// like "gateway" (which also appears as "API Gateway" in integration
// diagrams) do not over-match. We require explicit BPMN cues such as
// `bpmn`, `swimlane`, `exclusive gateway`, `parallel gateway`, `start
// event`, `end event`, or unambiguous Spanish process verbs.
const BPMN_KEYWORDS = /\b(bpmn|swimlane|exclusive\s+gateway|parallel\s+gateway|start\s+event|end\s+event|user\s+task|service\s+task|business\s+process|proceso\s+(de|bpmn))\b/i;
const VALUE_STREAM_KEYWORDS = /\b(value\s*stream|vsm|flujo\s+de\s+valor|lead\s*time)\b/i;
const INTEGRATION_KEYWORDS = /\b(integraci|integration|ipaas|esb|kafka|sqs|sftp|jdbc|api\s*gateway|adapter|orchestrator|mensajer)\b/i;
const DATA_FLOW_KEYWORDS = /\b(data\s*flow|etl|stream|ingest|warehouse|datalake|pipeline|cdc)\b/i;
// Deployment keywords require the word "deployment" / "despliegue" itself
// or unambiguous infrastructure cues like "kubernetes pod" / "vm host".
// Standalone "cluster" is ambiguous (Kafka Cluster is integration), so it
// is intentionally excluded.
const DEPLOYMENT_KEYWORDS = /\b(deployment\s+(node|view|diagram)|despliegue|kubernetes\s+(pod|cluster|namespace)|vm\s+(host|node)|hypervisor|bare\s*metal)\b/i;

function classifyByTitleOrTechnology(ir: DiagramIR): DiagramTypeId | null {
    const haystack = [
        ir.metadata?.title ?? '',
        ...ir.nodes.map((n) => `${n.label} ${n.technology ?? ''}`),
    ].join(' ');
    if (BPMN_KEYWORDS.test(haystack)) return 'bpmn-process';
    if (VALUE_STREAM_KEYWORDS.test(haystack)) return 'value-stream';
    if (DEPLOYMENT_KEYWORDS.test(haystack)) return 'deployment';
    if (INTEGRATION_KEYWORDS.test(haystack)) return 'integration';
    if (DATA_FLOW_KEYWORDS.test(haystack)) return 'data-flow';
    return null;
}

function classifyByNodeKinds(ir: DiagramIR): DiagramTypeId | null {
    const lowered = ir.nodes
        .map((n) => (n.kind ?? '').toLowerCase().trim())
        .filter(Boolean);
    const c4 = lowered.filter((k) => C4_NODE_KINDS.has(k));
    if (c4.length === 0) return null;
    if (c4.includes('component')) return 'c4-component';
    if (c4.includes('container')) return 'c4-container';
    if (c4.includes('deployment_node')) return 'c4-deployment';
    if (c4.includes('person') || c4.includes('system') || c4.includes('softwaresystem')) {
        return 'c4-context';
    }
    return null;
}

export interface DiagramTypeInferenceInput {
    ir: DiagramIR;
    artifactType?: ArtifactType;
}

export function inferDiagramType(input: DiagramTypeInferenceInput): DiagramTypeId {
    const existing = input.ir.metadata?.diagramType;
    if (existing) return existing;

    if (input.artifactType && ARTIFACT_TYPE_MAP[input.artifactType]) {
        return ARTIFACT_TYPE_MAP[input.artifactType]!;
    }

    const byKind = classifyByNodeKinds(input.ir);
    if (byKind) return byKind;

    const byKeyword = classifyByTitleOrTechnology(input.ir);
    if (byKeyword) return byKeyword;

    return 'generic';
}

/**
 * Convenience: derive the archetype and return a shallow IR clone with
 * `metadata.diagramType` populated. The original IR is never mutated; if
 * the field was already set the IR is returned as-is.
 */
export function annotateDiagramType(
    ir: DiagramIR,
    artifactType?: ArtifactType,
): DiagramIR {
    if (ir.metadata?.diagramType) return ir;
    const diagramType = inferDiagramType({ ir, artifactType });
    return {
        ...ir,
        metadata: {
            ...(ir.metadata ?? {}),
            diagramType,
        },
    };
}
