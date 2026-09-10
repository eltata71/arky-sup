/**
 * Diagram pipeline telemetry — captures a single snapshot describing every
 * measurable aspect of the IR + render outcome.
 *
 * The user explicitly requested this in the regression report (item 15:
 * "Mejorar observabilidad y trazabilidad"). Instead of scattering counters
 * across services, this module exposes one pure function that takes the
 * IR (and optionally the quality report) and returns a stable object that
 * can be logged, persisted on the artifact, or rendered in a debug panel.
 *
 * No information sensitive to the user is recorded — only structural
 * counts and aggregate quality numbers.
 */

import type { DiagramIR } from '../../lib/diagram';
import type { DiagramQualityReport } from './quality/diagramQualityService';
import type { DiagramArchetype } from './diagramTypeQualityGates';
import { detectDiagramArchetype } from './diagramTypeQualityGates';

export interface DiagramTelemetrySnapshot {
    /** ISO timestamp of the snapshot. */
    capturedAt: string;
    artifactId?: string;
    artifactType?: string;
    archetype: DiagramArchetype;
    schemaVersion: 'v1';

    // Structural counts
    nodeCount: number;
    edgeCount: number;
    groupCount: number;

    // Classification quality
    genericNodes: number;
    nodesWithSemanticType: number;
    nodesWithTechnology: number;
    nodesWithDescription: number;
    nodesWithoutGroup: number;
    orphanNodes: number;

    // Integration / edge quality
    edgesWithProtocol: number;
    edgesWithSemanticType: number;
    edgesWithCriticality: number;
    edgesWithSensitivity: number;
    edgesWithDirection: number;
    edgesMissingLabel: number;

    // Diagnostic flags from the metadata
    isSkeletonFallback: boolean;
    isPlaceholder: boolean;
    degradationReason?: string;
    repairHistoryEntries: number;
    sourceFormat?: string;

    // Quality summary (only when a report was provided)
    qualityScore?: number;
    qualityIssues?: number;
    qualityCritical?: number;
    qualityHigh?: number;
    qualitySuggestions?: number;
}

export interface BuildTelemetryOptions {
    artifactId?: string;
    artifactType?: string;
    quality?: DiagramQualityReport;
}

const isOrphan = (id: string, edges: DiagramIR['edges']): boolean =>
    !edges.some((e) => e.source === id || e.target === id);

export function buildDiagramTelemetry(ir: DiagramIR, opts: BuildTelemetryOptions = {}): DiagramTelemetrySnapshot {
    const { quality, artifactId, artifactType } = opts;

    let genericNodes = 0;
    let nodesWithSemanticType = 0;
    let nodesWithTechnology = 0;
    let nodesWithDescription = 0;
    let nodesWithoutGroup = 0;
    let orphanNodes = 0;

    for (const n of ir.nodes) {
        if ((n.semanticType ?? 'generic') === 'generic' && (n.semanticRole ?? 'generic') === 'generic') {
            genericNodes++;
        }
        if (n.semanticType && n.semanticType !== 'generic') nodesWithSemanticType++;
        if (n.technology && n.technology.trim().length > 0) nodesWithTechnology++;
        if (n.description && n.description.trim().length > 0) nodesWithDescription++;
        if (!n.group) nodesWithoutGroup++;
        if (isOrphan(n.id, ir.edges)) orphanNodes++;
    }

    let edgesWithProtocol = 0;
    let edgesWithSemanticType = 0;
    let edgesWithCriticality = 0;
    let edgesWithSensitivity = 0;
    let edgesWithDirection = 0;
    let edgesMissingLabel = 0;

    for (const e of ir.edges) {
        if (e.protocol && e.protocol.trim().length > 0) edgesWithProtocol++;
        if (e.semanticType && e.semanticType !== 'generic') edgesWithSemanticType++;
        if (e.criticality) edgesWithCriticality++;
        if (e.dataSensitivity) edgesWithSensitivity++;
        if (e.direction) edgesWithDirection++;
        if (!e.label || e.label.trim().length === 0) edgesMissingLabel++;
    }

    const metadata = ir.metadata ?? {};
    const isSkeletonFallback = metadata.fallback === 'skeleton';
    const isPlaceholder = metadata.degradationReason === 'no-parseable-content'
        || metadata.title === 'Marcador de posición'
        || ir.nodes.some((n) => n.id === 'placeholder-info' || n.id === 'placeholder-action');

    const snapshot: DiagramTelemetrySnapshot = {
        capturedAt: new Date().toISOString(),
        artifactId,
        artifactType,
        archetype: detectDiagramArchetype(ir),
        schemaVersion: 'v1',
        nodeCount: ir.nodes.length,
        edgeCount: ir.edges.length,
        groupCount: ir.groups.length,
        genericNodes,
        nodesWithSemanticType,
        nodesWithTechnology,
        nodesWithDescription,
        nodesWithoutGroup,
        orphanNodes,
        edgesWithProtocol,
        edgesWithSemanticType,
        edgesWithCriticality,
        edgesWithSensitivity,
        edgesWithDirection,
        edgesMissingLabel,
        isSkeletonFallback,
        isPlaceholder,
        degradationReason: metadata.degradationReason,
        repairHistoryEntries: metadata.repairHistory?.length ?? 0,
        sourceFormat: metadata.sourceFormat,
    };

    if (quality) {
        snapshot.qualityScore = quality.score;
        snapshot.qualityIssues = quality.issues.length;
        snapshot.qualityCritical = quality.issues.filter((i) => i.severity === 'critical').length;
        snapshot.qualityHigh = quality.issues.filter((i) => i.severity === 'high').length;
        snapshot.qualitySuggestions = quality.suggestions?.length ?? 0;
    }

    return snapshot;
}

/**
 * Format the telemetry snapshot as a human-readable multi-line string —
 * suitable for the debug toggle in the toolbar / developer console.
 */
export function formatTelemetrySnapshot(snapshot: DiagramTelemetrySnapshot): string {
    const lines: string[] = [];
    lines.push(`[${snapshot.archetype}] ${snapshot.nodeCount} nodos · ${snapshot.edgeCount} aristas · ${snapshot.groupCount} grupos`);
    lines.push(`  · clasificación: ${snapshot.nodesWithSemanticType}/${snapshot.nodeCount} con tipo semántico (${snapshot.genericNodes} genéricos)`);
    lines.push(`  · contratos:    ${snapshot.edgesWithProtocol}/${snapshot.edgeCount} con protocolo, ${snapshot.edgesWithCriticality} con criticidad`);
    lines.push(`  · narrativa:    ${snapshot.edgeCount - snapshot.edgesMissingLabel}/${snapshot.edgeCount} aristas etiquetadas`);
    if (snapshot.orphanNodes > 0) lines.push(`  · huérfanos:    ${snapshot.orphanNodes} nodos sin conexiones`);
    if (snapshot.isSkeletonFallback) lines.push('  · ⚠ fallback skeleton activo');
    if (snapshot.isPlaceholder) lines.push('  · ⚠ placeholder de error');
    if (snapshot.degradationReason) lines.push(`  · degradación: ${snapshot.degradationReason}`);
    if (typeof snapshot.qualityScore === 'number') {
        lines.push(`  · score: ${snapshot.qualityScore}/100 · ${snapshot.qualityIssues ?? 0} hallazgos · ${snapshot.qualitySuggestions ?? 0} sugerencias`);
    }
    return lines.join('\n');
}
