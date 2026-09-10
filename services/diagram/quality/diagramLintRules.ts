/**
 * The lint rules — what is actually wrong with a diagram.
 *
 * Separate from the scoring because they answer different questions. A lint
 * issue names a specific defect at a specific node or edge; a score is a
 * judgement about the whole. Mixing them is how a rubric ends up unable to
 * explain its own number.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRNode } from '../../../lib/diagram';
import { detectTechBadge } from '../../../lib/diagramTechBadges';
import { hasText, type DiagramLintIssue } from './diagramQualityTypes';

const ACTION_VERB_RE = /^(?:[A-Z][a-záéíóúñ]+|[a-záéíóúñ]+)(?:a|e|ea|ía|ará|an|ar)\b/; // Spanish verb heuristic
const ACTION_VERB_EN_RE = /^(?:[A-Z]?[a-z]+)(?:s|es|ed|ing)?\b/;
const PROTOCOL_HINTS_RE = /\b(http|https|rest|grpc|soap|graphql|webhook|websocket|sftp|smtp|kafka|amqp|jdbc|odbc|tcp|udp)\b/i;

export function edgeHasProtocolHint(edge: DiagramIREdge): boolean {
    return PROTOCOL_HINTS_RE.test(`${edge.label ?? ''} ${edge.protocol ?? ''}`);
}

export function nodeHasTechBadge(node: DiagramIRNode): boolean {
    return !!detectTechBadge(node.label, `${node.technology ?? ''} ${node.kind ?? ''}`);
}

export function isActionableEdgeLabel(label: string | undefined): boolean {
    if (!label) return false;
    const trimmed = label.trim();
    if (!trimmed || trimmed.length < 2) return false;
    if (PROTOCOL_HINTS_RE.test(trimmed)) return true;
    if (ACTION_VERB_RE.test(trimmed)) return true;
    if (ACTION_VERB_EN_RE.test(trimmed)) return true;
    return false;
}

export function collectIssues(diagram: DiagramIR): DiagramLintIssue[] {
    const issues: DiagramLintIssue[] = [];
    const nodeIds = new Set(diagram.nodes.map(n => n.id));

    // High-signal status issues that the resolver / UI consume directly to
    // explain *why* the score is low without reading every individual lint.
    if (diagram.nodes.length === 0) {
        issues.push({
            id: 'empty-ir',
            code: 'EMPTY_IR',
            severity: 'critical',
            message: 'El diagrama llegó vacío del generador (cero nodos).',
            recommendation: 'Pulsa Regenerar para reintentar con menos contexto, o Generar esqueleto base.',
        });
    }
    if (diagram.metadata?.fallback === 'skeleton') {
        issues.push({
            id: 'skeleton-fallback',
            code: 'SKELETON_FALLBACK',
            severity: 'high',
            message: 'Esqueleto base — el modelo agotó los reintentos y se generó una estructura mínima local.',
            recommendation: 'Edita los nodos manualmente o pulsa Regenerar con más contexto del proyecto.',
        });
    }

    // Structural
    diagram.edges.forEach((e) => {
        if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
            issues.push({
                id: `edge-ref-${e.id}`,
                code: 'EDGE_INVALID_REFERENCE',
                severity: 'critical',
                message: `La conexión ${e.id} apunta a nodos inexistentes.`,
                recommendation: 'Regenera o corrige source/target para mantener trazabilidad semántica.',
            });
        }
        if (!hasText(e.label)) {
            issues.push({
                id: `edge-label-${e.id}`,
                code: 'EDGE_MISSING_LABEL',
                severity: 'medium',
                message: `La conexión ${e.id} no tiene etiqueta descriptiva.`,
                recommendation: 'Agrega protocolo/acción (ej. REST/HTTPS, Evento, Batch).',
            });
        }
        if (!edgeHasProtocolHint(e)) {
            issues.push({
                id: `edge-protocol-${e.id}`,
                code: 'EDGE_PROTOCOL_MISSING',
                severity: 'low',
                message: `La conexión ${e.id} no explicita protocolo/canal.`,
                recommendation: 'Incluye protocolo o canal (REST/HTTPS, Kafka, SQS, Batch, Archivo).',
            });
        }
        if (e.label && e.label.length > 40) {
            issues.push({
                id: `edge-label-long-${e.id}`,
                code: 'EDGE_LABEL_TOO_LONG',
                severity: 'low',
                message: `La etiqueta de la conexión ${e.id} excede 40 caracteres.`,
                recommendation: 'Abrevia con un verbo + objeto corto (≤ 4 palabras).',
            });
        }
    });

    diagram.nodes.forEach((n) => {
        if (!hasText(n.label)) {
            issues.push({
                id: `node-label-${n.id}`,
                code: 'NODE_MISSING_LABEL',
                severity: 'high',
                message: `El nodo ${n.id} no tiene nombre visible.`,
                recommendation: 'Define un label claro y orientado a negocio o tecnología.',
            });
        }
        if (!hasText(n.description)) {
            issues.push({
                id: `node-description-${n.id}`,
                code: 'NODE_MISSING_DESCRIPTION',
                severity: 'low',
                message: `El nodo ${n.label || n.id} no tiene descripción funcional.`,
                recommendation: 'Incluye 1-2 frases para mejorar legibilidad y transferencia de contexto.',
            });
        }
        if (hasText(n.label) && n.label.trim() === n.id.trim()) {
            issues.push({
                id: `node-label-eq-id-${n.id}`,
                code: 'NODE_LABEL_EQ_ID',
                severity: 'low',
                message: `El nodo ${n.id} usa su identificador como label.`,
                recommendation: 'Usa un nombre legible (ej. "API de Clientes") en lugar del id técnico.',
            });
        }
        if (hasText(n.label) && n.label.length > 32) {
            issues.push({
                id: `node-label-long-${n.id}`,
                code: 'NODE_LABEL_TOO_LONG',
                severity: 'low',
                message: `El nodo ${n.label} supera 32 caracteres.`,
                recommendation: 'Acorta a ≤ 24 caracteres o mueve detalle a descripción.',
            });
        }
        const semanticKind = (n.semanticType ?? n.kind ?? '').toLowerCase();
        if (semanticKind === 'generic' || semanticKind === 'unknown' || semanticKind === 'component') {
            issues.push({
                id: `node-generic-${n.id}`,
                code: 'NODE_GENERIC_CLASSIFICATION',
                severity: 'medium',
                message: `El nodo ${n.label || n.id} quedó con clasificación genérica.`,
                recommendation: 'Refina el tipo semántico (actor, sistema, API, base de datos, integración, etc.).',
            });
        }
    });

    // Narrative — a written story that no longer resolves against the diagram
    // it describes. The walk still plays, and plays something other than what
    // was written: a scene silently loses half its nodes and the reader is
    // shown a step the architect never composed. Reported rather than dropped,
    // which is the rule the whole portfolio's broken references already follow.
    const narrative = diagram.metadata?.narrative;
    if (narrative && typeof narrative !== 'string' && narrative.source !== 'derived') {
        const edgeIds = new Set(diagram.edges.map(e => e.id));
        const stale = new Set<string>();
        for (const scene of narrative.scenes ?? []) {
            for (const id of scene.focusNodeIds ?? []) if (!nodeIds.has(id)) stale.add(id);
            for (const id of scene.focusEdgeIds ?? []) if (!edgeIds.has(id)) stale.add(id);
        }
        for (const callout of narrative.callouts ?? []) {
            if (!nodeIds.has(callout.targetId) && !edgeIds.has(callout.targetId)) stale.add(callout.targetId);
        }
        if (stale.size > 0) {
            issues.push({
                id: 'narrative-stale-refs',
                code: 'NARRATIVE_STALE_REFERENCE',
                severity: 'high',
                message: `La narrativa apunta a ${stale.size} elemento(s) que ya no existen: ${Array.from(stale).slice(0, 5).join(', ')}.`,
                recommendation: 'Actualiza las escenas y los callouts, o reescribe la narrativa para el diagrama actual.',
            });
        }
    }

    // Orphans
    const connected = new Set<string>();
    diagram.edges.forEach((e) => { connected.add(e.source); connected.add(e.target); });
    diagram.nodes.forEach((n) => {
        if (!connected.has(n.id) && diagram.nodes.length > 1) {
            issues.push({
                id: `orphan-${n.id}`,
                code: 'ORPHAN_NODE',
                severity: 'high',
                message: `El nodo ${n.label || n.id} está aislado del flujo principal.`,
                recommendation: 'Conecta el nodo o elimínalo para evitar ruido visual.',
            });
        }
    });

    return issues;
}
