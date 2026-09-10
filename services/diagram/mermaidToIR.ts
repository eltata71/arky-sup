/**
 * Deterministic Mermaid → DiagramIR parser.
 *
 * Goal: replace the AI-based `geminiService.parseMermaidToReactFlow` hop (AI
 * hop #2) with a pure-TypeScript parser that never depends on an LLM.  The
 * parser is intentionally pragmatic — it accepts the dialects Arky 10 emits
 * today (flowchart, graph, sequenceDiagram, classDiagram, erDiagram, C4*,
 * stateDiagram) and degrades gracefully for exotica: unknown headers yield a
 * single synthesized node with the raw text as description, so downstream
 * renderers can still show *something* while surfacing a quality lint issue.
 *
 * The parser does NOT use mermaid's own parse API because mermaid ships as a
 * heavy DOM-bound module and we only need the minimal AST.  Keeping the
 * parser in our own tree also lets us evolve the IR freely.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRGroup, DiagramIRNode, NodeShape } from '../../lib/diagram';
import {
    canonicalKindForRole,
    resolveSemanticRole,
    repairDiagramIRSemantics,
} from '../../lib/semanticRoleResolver';

const SHAPE_SYNTAX: Array<{ open: string; close: string; shape: NodeShape }> = [
    { open: '[[', close: ']]', shape: 'tab-box' },
    { open: '((', close: '))', shape: 'cloud' },
    { open: '([', close: '])', shape: 'rectangle' },
    { open: '[(', close: ')]', shape: 'cylinder' },
    { open: '{{', close: '}}', shape: 'hexagon' },
    { open: '>',  close: ']',  shape: 'rectangle' },
    { open: '[',  close: ']',  shape: 'rectangle' },
    { open: '(',  close: ')',  shape: 'rectangle' },
    { open: '{',  close: '}',  shape: 'diamond' },
];

const EDGE_OPERATORS = [
    { op: '===', relation: 'data-flow' },
    { op: '==>', relation: 'data-flow' },
    { op: '-->', relation: 'default' },
    { op: '-.->', relation: 'async' },
    { op: '..>', relation: 'async' },
    // Trailing half of the inline-label dotted syntax "A -. label .-> B".
    // Treated as async so the dotted-edge semantics are preserved.
    { op: '.->', relation: 'async' },
    { op: '-->|', relation: 'default' },
    { op: '---', relation: 'dependency' },
    { op: '--x', relation: 'dependency' },
    { op: '--o', relation: 'dependency' },
    { op: '->>', relation: 'default' },
    { op: '-->>', relation: 'async' },
    { op: '-)', relation: 'async' },
    { op: '--)', relation: 'async' },
    { op: '->', relation: 'default' },
] as const;

type Relation = DiagramIREdge['relation'];

interface ParseContext {
    nodes: Map<string, DiagramIRNode>;
    edges: DiagramIREdge[];
    groups: DiagramIRGroup[];
    title?: string;
    sourceFormat: NonNullable<DiagramIR['metadata']>['sourceFormat'];
    edgeCounter: number;
    /**
     * Mermaid dialect detected by `detectHeader` (`'flowchart' | 'c4container' |
     * 'sequencediagram' | …`). The semantic-role resolver uses it to decide
     * whether the `process` fallback is legitimate (BPMN/VSM/flowchart) or
     * whether `generic` is safer (C4, sequence, classDiagram).
     */
    diagramKind?: string;
}

function stripQuotes(s: string): string {
    const t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
}

function stripBrTags(label: string): string {
    return label.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
}

function parseNodeDeclaration(token: string, ctx: ParseContext): { id: string; label?: string; shape?: NodeShape } {
    for (const { open, close, shape } of SHAPE_SYNTAX) {
        const openIdx = token.indexOf(open);
        if (openIdx === -1) continue;
        const closeIdx = token.lastIndexOf(close);
        if (closeIdx === -1 || closeIdx <= openIdx) continue;
        const id = token.slice(0, openIdx).trim();
        const rawLabel = token.slice(openIdx + open.length, closeIdx);
        const label = stripBrTags(stripQuotes(rawLabel));
        upsertNode(ctx, id, label, shape);
        return { id, label, shape };
    }
    const id = token.trim();
    upsertNode(ctx, id);
    return { id };
}

function upsertNode(ctx: ParseContext, id: string, label?: string, shape?: NodeShape): DiagramIRNode {
    const cleanId = id.trim();
    if (!cleanId) {
        const fallbackId = `node_${ctx.nodes.size + 1}`;
        const resolvedLabel = label ?? fallbackId;
        const role = resolveSemanticRole({
            label: resolvedLabel,
            shape,
            diagramKind: ctx.diagramKind,
        });
        const node: DiagramIRNode = {
            id: fallbackId,
            label: resolvedLabel,
            kind: canonicalKindForRole(role),
            semanticRole: role,
        };
        if (shape) node.shape = shape;
        ctx.nodes.set(fallbackId, node);
        return node;
    }
    const existing = ctx.nodes.get(cleanId);
    if (existing) {
        if (label && !existing.label) existing.label = label;
        if (shape && !existing.shape) existing.shape = shape;
        return existing;
    }
    const resolvedLabel = label ?? cleanId;
    const role = resolveSemanticRole({
        label: resolvedLabel,
        shape,
        diagramKind: ctx.diagramKind,
    });
    const node: DiagramIRNode = {
        id: cleanId,
        label: resolvedLabel,
        kind: canonicalKindForRole(role),
        semanticRole: role,
    };
    if (shape) node.shape = shape;
    ctx.nodes.set(cleanId, node);
    return node;
}

function pushEdge(ctx: ParseContext, sourceId: string, targetId: string, label: string | undefined, relation: Relation) {
    ctx.edgeCounter += 1;
    ctx.edges.push({
        id: `e${ctx.edgeCounter}`,
        source: sourceId.trim(),
        target: targetId.trim(),
        label: label?.trim() || 'Relaciona',
        relation,
    });
}

function detectRelationFromOp(op: string): Relation {
    const lookup = EDGE_OPERATORS.find(e => e.op === op);
    return (lookup?.relation as Relation) ?? 'default';
}

/**
 * Parse a flowchart/graph body.  Supports:
 *   A[Label] --> B(OtherLabel)
 *   A -->|label| B
 *   A -.-> B
 *   subgraph Name ... end
 */
function parseFlowchart(body: string, ctx: ParseContext) {
    const groupStack: { id: string; label: string; nodeIds: string[] }[] = [];
    const lines = body.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.replace(/\s*%%.*$/, '').trim();
        if (!line) continue;
        if (line.startsWith('subgraph')) {
            const rest = line.slice('subgraph'.length).trim();
            const match = rest.match(/^([A-Za-z0-9_]+)?\s*\[?\s*"?([^\]"]+)?"?\s*\]?$/);
            const id = (match?.[1] ?? `group_${ctx.groups.length + 1}`).trim();
            const label = (match?.[2] ?? id).trim();
            groupStack.push({ id, label, nodeIds: [] });
            continue;
        }
        if (line === 'end') {
            const g = groupStack.pop();
            if (g && g.nodeIds.length > 0) {
                ctx.groups.push({ id: g.id, label: g.label, nodeIds: Array.from(new Set(g.nodeIds)) });
                for (const nodeId of g.nodeIds) {
                    const node = ctx.nodes.get(nodeId);
                    if (node && !node.group) node.group = g.label;
                }
            }
            continue;
        }
        if (/^(style|classDef|linkStyle|direction|click|class|%)/i.test(line)) continue;

        // 1) "A -- label --> B" / "A -. label .-> B" / "A == label ==> B"
        //    Mermaid lets authors write the label INSIDE the arrow body.  This
        //    must be tried before the generic operator regex because both
        //    halves of the link contain the same operator characters. The
        //    trailing op for dotted edges is ".->" (single dot + arrow) — NOT
        //    "..>", which is a different async dialect handled separately.
        const inlineLabel = line.match(
            /(.+?)\s*(==|--|-\.|\.\.)\s*([^>|=\-.][^|]*?)\s*(==>|-->|\.->|\.\.>|===)\s*(.+)/
        );
        if (inlineLabel) {
            const [, left, leadingOp, label, trailingOp, right] = inlineLabel;
            const source = parseNodeDeclaration(left.trim(), ctx);
            const target = parseNodeDeclaration(right.trim(), ctx);
            // Pick the operator that carries semantic meaning. The trailing
            // arrow always wins (it carries the arrowhead semantics), with
            // the leading op as a fallback for legacy "A -- label --> B".
            const op = trailingOp || leadingOp;
            pushEdge(ctx, source.id, target.id, label, detectRelationFromOp(op));
            if (groupStack.length > 0) {
                groupStack[groupStack.length - 1].nodeIds.push(source.id, target.id);
            }
            continue;
        }

        const opMatch = line.match(/(.+?)(===|==>|-->|-\.->|\.\.>|---|--x|--o|-->>|->>|--\)|-\)|->)(?:\|([^|]+)\|)?\s*(.+)/);
        if (opMatch) {
            const [, left, op, label, right] = opMatch;
            const source = parseNodeDeclaration(left.trim(), ctx);
            const target = parseNodeDeclaration(right.trim(), ctx);
            pushEdge(ctx, source.id, target.id, label, detectRelationFromOp(op));
            if (groupStack.length > 0) {
                groupStack[groupStack.length - 1].nodeIds.push(source.id, target.id);
            }
            continue;
        }

        const declMatch = line.match(/^([A-Za-z0-9_]+)\s*[[({<][^\n]+$/);
        if (declMatch) {
            const node = parseNodeDeclaration(line, ctx);
            if (groupStack.length > 0) {
                groupStack[groupStack.length - 1].nodeIds.push(node.id);
            }
        }
    }
}

function normalizeSequenceEndpoint(raw: string, aliases: Map<string, string>, ctx: ParseContext): string {
    const token = stripQuotes(raw.trim());
    const aliased = aliases.get(token) ?? aliases.get(normalizeLooseKey(token));
    if (aliased) return aliased;

    // Mermaid sequence diagrams often omit explicit participant declarations.
    // When the endpoint is a quoted/display label or contains spaces, create a
    // stable canvas-safe id and preserve the human label on the node.
    const id = /^[A-Za-z0-9_.:-]+$/.test(token)
        ? token
        : `seq_${token
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || `node_${ctx.nodes.size + 1}`}`;
    aliases.set(token, id);
    aliases.set(normalizeLooseKey(token), id);
    upsertNode(ctx, id, token);
    return id;
}

function normalizeLooseKey(value: string): string {
    return stripQuotes(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function parseSequenceParticipant(line: string): { idToken: string; label: string; shape: NodeShape } | null {
    const match = line.match(/^(participant|actor)\s+(.+)$/i);
    if (!match) return null;
    const keyword = match[1].toLowerCase();
    const body = match[2].trim();
    const asMatch = body.match(/^(.+?)\s+as\s+(.+)$/i);
    const idToken = stripQuotes((asMatch ? asMatch[1] : body).trim());
    const label = stripQuotes((asMatch ? asMatch[2] : body).trim());
    return { idToken, label, shape: keyword === 'actor' ? 'person' : 'rectangle' };
}

function parseSequenceMessage(line: string): { src: string; op: string; tgt: string; label: string } | null {
    // Supports Mermaid activation suffixes (`A->>+B`, `B-->>-A`) and relaxed
    // endpoint tokens so AI output with quoted labels or hyphenated ids still
    // becomes a visible IR instead of an empty canvas.
    const match = line.match(/^(.+?)\s*(-->>|->>|--\)|-\)|->|-->)([+-]?)\s*(.+?)\s*:\s*(.+)$/);
    if (!match) return null;
    return {
        src: match[1].trim(),
        op: match[2],
        tgt: match[4].trim(),
        label: stripQuotes(match[5].trim()),
    };
}

function parseSequence(body: string, ctx: ParseContext) {
    const lines = body.split('\n');
    const aliases = new Map<string, string>();
    for (const rawLine of lines) {
        const line = rawLine.replace(/\s*%%.*$/, '').trim();
        if (!line) continue;
        if (/^(autonumber|activate|deactivate|note\b|rect\b|end\b|alt\b|else\b|opt\b|loop\b|par\b|and\b|critical\b|break\b)/i.test(line)) {
            continue;
        }

        const participant = parseSequenceParticipant(line);
        if (participant) {
            const id = normalizeSequenceEndpoint(participant.idToken, aliases, ctx);
            aliases.set(participant.idToken, id);
            aliases.set(participant.label, id);
            aliases.set(normalizeLooseKey(participant.idToken), id);
            aliases.set(normalizeLooseKey(participant.label), id);
            const node = upsertNode(ctx, id, participant.label, participant.shape);
            node.label = participant.label;
            node.shape = participant.shape;
            continue;
        }

        const message = parseSequenceMessage(line);
        if (message) {
            const src = normalizeSequenceEndpoint(message.src, aliases, ctx);
            const tgt = normalizeSequenceEndpoint(message.tgt, aliases, ctx);
            pushEdge(ctx, src, tgt, message.label, detectRelationFromOp(message.op));
        }
    }
}

function parseClassDiagram(body: string, ctx: ParseContext) {
    for (const rawLine of body.split('\n')) {
        const line = rawLine.replace(/\s*%%.*$/, '').trim();
        if (!line) continue;
        const classLine = line.match(/^class\s+([A-Za-z0-9_]+)\b/);
        if (classLine) upsertNode(ctx, classLine[1], classLine[1], 'rectangle');
        const inheritance = line.match(/^([A-Za-z0-9_]+)\s*(<\|--|--\|>|o--|--o|\*--|--\*|<--|-->|<\.\.|\.\.>)\s*([A-Za-z0-9_]+)\s*(?::\s*(.+))?$/);
        if (inheritance) {
            const [, a, op, b, lbl] = inheritance;
            upsertNode(ctx, a);
            upsertNode(ctx, b);
            pushEdge(ctx, a, b, lbl, op.includes('<|') || op.includes('|>') ? 'inheritance' : 'dependency');
        }
    }
}

function parseErDiagram(body: string, ctx: ParseContext) {
    // ER cardinality tokens we recognise. The middle "--" can also be ".." for
    // optional relationships, so we accept both. The captured cardinality
    // string is appended to the edge label so reviewers see it on the canvas.
    const ER_REL = /^([A-Za-z0-9_]+)\s+([|}o\\\][a-z]?)([-.]{2})([|}o\\\][a-z]?)\s+([A-Za-z0-9_]+)\s*:\s*(.+)$/i;
    // Conservative fallback (preserves previous behaviour when the regex above
    // misses an exotic cardinality token).
    const ER_REL_FALLBACK = /^([A-Za-z0-9_]+)\s*([|}o]+[-.]{2}[|}o]+)\s*([A-Za-z0-9_]+)\s*:\s*(.+)$/;

    for (const rawLine of body.split('\n')) {
        const line = rawLine.replace(/\s*%%.*$/, '').trim();
        if (!line) continue;
        const entityBlock = line.match(/^([A-Za-z0-9_]+)\s*\{.*$/);
        if (entityBlock) {
            upsertNode(ctx, entityBlock[1], entityBlock[1], 'rectangle');
            continue;
        }
        const rel = line.match(ER_REL) ?? line.match(ER_REL_FALLBACK);
        if (rel) {
            const a = rel[1];
            const b = rel.length === 7 ? rel[5] : rel[3];
            const lbl = rel[rel.length - 1];
            upsertNode(ctx, a);
            upsertNode(ctx, b);
            pushEdge(ctx, a, b, lbl, 'data-flow');
        }
    }
}

/**
 * Boundary-style declarations open a logical container ("group") rather than a
 * renderable node. They are detected eagerly so the same line is not matched
 * by `declRe` later (which would pollute the IR with phantom rectangles).
 */
const BOUNDARY_KINDS = /^(Enterprise_Boundary|System_Boundary|Container_Boundary|Component_Boundary|Boundary)\b/i;

const C4_DECL_KIND_RE = /^(Person(?:_Ext)?|System(?:_Ext|Db|Queue)?|SoftwareSystem(?:_Ext)?|Container(?:_Ext|Db|Queue)?|Component(?:_Ext|Db|Queue)?|SystemDb)$/i;
const C4_REL_KIND_RE = /^(BiRel|Rel(?:_[A-Za-z]+)?)$/i;

const C4_KIND_TO_SHAPE: Array<{ test: RegExp; shape: NodeShape }> = [
    { test: /db$/i,                         shape: 'cylinder' },
    { test: /queue$/i,                      shape: 'tab-box' },
    { test: /person/i,                      shape: 'person' },
    { test: /(deployment|node)/i,           shape: 'tab-box' },
    { test: /(container|component|system)/i,shape: 'rectangle' },
];

function shapeForC4Kind(kind: string): NodeShape {
    for (const { test, shape } of C4_KIND_TO_SHAPE) {
        if (test.test(kind)) return shape;
    }
    return 'rectangle';
}

function normalizeC4Kind(kind: string): string {
    // Preserve the meaningful prefix (Person, Container, ContainerDb…) but drop
    // boundary/external suffixes that don't affect downstream rendering.
    return kind.replace(/_Ext$/i, '').replace(/_Boundary$/i, '');
}

function splitC4Args(raw: string): string[] {
    const out: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaped = false;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (quote && ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === ',') {
            out.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim().length > 0) out.push(current.trim());
    return out;
}

function parseC4Call(line: string): { name: string; args: string[] } | null {
    // Accept optional trailing semicolon because some Mermaid generators
    // (and manual edits) emit C4 declarations as `Container(...);`.
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*;?\s*$/);
    if (!m) return null;
    const [, name, rawArgs] = m;
    const args = splitC4Args(rawArgs).map((a) => stripQuotes(a));
    return { name, args };
}

function splitC4Statements(body: string): string[] {
    const statements: string[] = [];
    let current = '';
    let parenDepth = 0;
    let quote: '"' | "'" | null = null;
    let escaped = false;

    const flush = () => {
        const trimmed = current.trim();
        if (trimmed) statements.push(trimmed);
        current = '';
    };

    // Remove Mermaid inline comments first, then tokenize char-by-char so we
    // can split statements on semicolons/newlines/braces outside argument
    // lists. This keeps multiline calls working while also supporting compact
    // one-line C4 output (e.g. Person(...); System(...); Rel(...);).
    const normalized = body
        .split('\n')
        .map((line) => line.replace(/\s*%%.*$/, ''))
        .join('\n');

    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];

        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }

        if (quote) {
            current += ch;
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }

        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }

        if (ch === '(') {
            parenDepth++;
            current += ch;
            continue;
        }

        if (ch === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            current += ch;
            continue;
        }

        // Statement delimiters only apply at top-level (outside call args).
        if (parenDepth === 0 && ch === '{') {
            current += ch;
            flush();
            continue;
        }
        if (parenDepth === 0 && ch === '}') {
            flush();
            statements.push('}');
            continue;
        }
        if (parenDepth === 0 && (ch === ';' || ch === '\n')) {
            flush();
            continue;
        }

        if (ch === '\n') {
            // Keep multiline argument lists parseable by collapsing internal
            // line breaks into spaces (parseC4Call expects one logical line).
            current += ' ';
            continue;
        }

        current += ch;
    }

    flush();
    return statements;
}

function parseC4(body: string, ctx: ParseContext) {
    const boundaryStack: { id: string; label: string; nodeIds: string[]; kind?: 'system-boundary' | 'enterprise' | 'cluster' | 'cloud' }[] = [];

    for (const line of splitC4Statements(body)) {
        if (!line) continue;

        // 1) Boundary openers: register a group, never a node.
        const opensBoundary = /\{\s*$/.test(line);
        if (BOUNDARY_KINDS.test(line) && opensBoundary) {
            // Boundaries often come as `System_Boundary(x, "Label") {` and may
            // include a trailing semicolon in AI/manual output. Reuse the C4
            // call parser instead of a brittle quote-only regex.
            const boundaryLine = line.replace(/\{\s*$/, '').replace(/;\s*$/, '').trim();
            const call = parseC4Call(boundaryLine);
            const [id, label] = call?.args ?? [];
            if (call && id && label) {
                // Map the boundary's C4 type to a semantic kind so the
                // renderer can paint enterprise / system / container
                // boundaries with distinct visual treatments instead of a
                // single translucent rectangle.
                const callName = (call.name ?? '').toLowerCase();
                const kind: 'system-boundary' | 'enterprise' | 'cluster' =
                    callName.includes('enterprise')          ? 'enterprise'
                    : callName.includes('system_boundary')   ? 'system-boundary'
                    : callName.includes('container_boundary')? 'cluster'
                    : callName.includes('component_boundary')? 'cluster'
                    : 'cluster';
                boundaryStack.push({ id, label, nodeIds: [], kind });
            }
            continue;
        }

        // Deployment nodes can act as nested boundaries OR as regular
        // declaration lines (without trailing "{"). We only treat them as
        // groups when they explicitly open a block.
        if (/^(Deployment_Node|Node)\b/i.test(line) && opensBoundary) {
            const boundaryLine = line.replace(/\{\s*$/, '').replace(/;\s*$/, '').trim();
            const call = parseC4Call(boundaryLine);
            const [id, label, technology, description] = call?.args ?? [];
            if (call && id && label) {
                // Deployment nodes that name a cloud provider get the
                // `cloud` kind so the renderer surfaces the cloud
                // perimeter; everything else is a generic cluster.
                const techLower = (technology ?? '').toLowerCase();
                const labelLower = label.toLowerCase();
                const isCloud = /(aws|amazon|azure|gcp|google\s*cloud|kubernetes|docker)/.test(techLower + ' ' + labelLower);
                boundaryStack.push({ id, label, nodeIds: [], kind: isCloud ? 'cloud' : 'cluster' });
                upsertNode(ctx, id, label, 'tab-box');
                const node = ctx.nodes.get(id);
                if (node) {
                    node.kind = normalizeC4Kind(call.name);
                    if (technology) node.technology = technology;
                    if (description) node.description = description;
                    node.semanticRole = resolveSemanticRole({
                        label: node.label,
                        kind: node.kind,
                        shape: node.shape,
                        technology: node.technology,
                        diagramKind: ctx.diagramKind,
                    });
                }
                if (boundaryStack.length > 1) {
                    boundaryStack[boundaryStack.length - 2].nodeIds.push(id);
                }
            }
            continue;
        }

        // 2) Closing brace — flush current boundary into ctx.groups.
        //    Tolerates trailing whitespace / inline comments stripped above.
        if (line === '}' || /^\}\s*$/.test(line)) {
            const g = boundaryStack.pop();
            if (g && g.nodeIds.length > 0) {
                ctx.groups.push({ id: g.id, label: g.label, nodeIds: Array.from(new Set(g.nodeIds)), kind: g.kind });
                for (const nodeId of g.nodeIds) {
                    const node = ctx.nodes.get(nodeId);
                    if (node && !node.group) node.group = g.label;
                }
            }
            continue;
        }

        // 3) Skip Mermaid C4 styling/layout directives that aren't elements.
        if (/^(UpdateRelStyle|UpdateElementStyle|UpdateLayoutConfig|LAYOUT_|SHOW_)/i.test(line)) continue;

        // 4) Element declarations.
        const call = parseC4Call(line);
        if (!call) continue;

        // 4) Element declarations.
        if (C4_DECL_KIND_RE.test(call.name) || /^(Deployment_Node|Node|Container_Instance)$/i.test(call.name)) {
            const [id, label, third, fourth] = call.args;
            if (!id || !label) continue;
            const kindRaw = call.name;
            const kind = normalizeC4Kind(kindRaw);
            const isFourArg = typeof fourth === 'string' && fourth.length > 0;
            const technology = isFourArg ? third : undefined;
            const description = isFourArg ? fourth : third;

            upsertNode(ctx, id, label, shapeForC4Kind(kindRaw));
            const node = ctx.nodes.get(id);
            if (node) {
                node.kind = kind;
                if (description) node.description = description;
                if (technology) node.technology = technology;
                // Re-resolve the semantic role now that the authoritative C4
                // kind is set. This is what makes `Person(...)` become a
                // `person` even when the label by itself would not match.
                node.semanticRole = resolveSemanticRole({
                    label: node.label,
                    kind: node.kind,
                    shape: node.shape,
                    technology: node.technology,
                    diagramKind: ctx.diagramKind,
                });
            }
            if (boundaryStack.length > 0) {
                boundaryStack[boundaryStack.length - 1].nodeIds.push(id);
            }
            continue;
        }

        // 5) Relationship declarations.
        if (C4_REL_KIND_RE.test(call.name)) {
            const [source, target, label, technology] = call.args;
            if (!source || !target || !label) continue;
            const kind = call.name;
            upsertNode(ctx, source);
            upsertNode(ctx, target);
            const relation = /BiRel/i.test(kind) ? 'sync' : 'data-flow';
            const decoratedLabel = technology ? `${label} · ${technology}` : label;
            pushEdge(ctx, source, target, decoratedLabel, relation);
            if (/BiRel/i.test(kind)) {
                pushEdge(ctx, target, source, decoratedLabel, relation);
            }
        }
    }

    // Any boundary still open at EOF gets flushed to avoid losing nodes that
    // were declared inside an unmatched `{` (defensive — Mermaid usually closes
    // boundaries, but AI output sometimes omits the trailing `}`).
    while (boundaryStack.length > 0) {
        const g = boundaryStack.pop()!;
        if (g.nodeIds.length > 0) {
            ctx.groups.push({ id: g.id, label: g.label, nodeIds: Array.from(new Set(g.nodeIds)) });
            for (const nodeId of g.nodeIds) {
                const node = ctx.nodes.get(nodeId);
                if (node && !node.group) node.group = g.label;
            }
        }
    }
}

function parseState(body: string, ctx: ParseContext) {
    for (const rawLine of body.split('\n')) {
        const line = rawLine.replace(/\s*%%.*$/, '').trim();
        if (!line) continue;
        // Skip composite-state braces and standalone keywords; they're declarative
        // wrappers, not transitions or nodes we render directly.
        if (/^state\s+/i.test(line) && line.endsWith('{')) {
            const m = line.match(/^state\s+([A-Za-z0-9_]+)/i);
            if (m) upsertNode(ctx, m[1], m[1], 'tab-box');
            continue;
        }
        if (/^\}$/.test(line)) continue;
        if (/^(direction|note|hide|<<choice>>|<<fork>>|<<join>>)/i.test(line)) continue;
        // Choice / fork pseudo-states: declared with `<<choice>>` syntax. We
        // surface them as diamond-shaped nodes so the renderer differentiates
        // decisions visually. Force-override any previously inferred shape (a
        // transition line may have already created the node as a rectangle).
        const choice = line.match(/^([A-Za-z0-9_]+)\s*<<\s*(choice|fork|join)\s*>>$/i);
        if (choice) {
            const node = upsertNode(ctx, choice[1], choice[1], 'diamond');
            node.shape = 'diamond';
            continue;
        }
        const trans = line.match(/^\[?\s*([A-Za-z0-9_[\]*]+)\s*\]?\s*-->\s*\[?\s*([A-Za-z0-9_[\]*]+)\s*\]?(?:\s*:\s*(.+))?$/);
        if (trans) {
            const [, from, to, lbl] = trans;
            upsertNode(ctx, from, from, 'rectangle');
            upsertNode(ctx, to, to, 'rectangle');
            pushEdge(ctx, from, to, lbl, 'default');
        }
    }
}

function detectHeader(code: string): { kind: string; body: string; title?: string } {
    const lines = code.split('\n').map(l => l.trimEnd());
    let title: string | undefined;
    let kind = 'flowchart';
    let bodyStart = 0;
    let headerFound = false;

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (l.startsWith('---') || l.startsWith('%%{')) continue;
        // Front-matter style title: `title: My Diagram`
        const titleMatch = l.match(/^title:\s*(.+)$/i);
        if (titleMatch) { title = titleMatch[1].trim(); continue; }
        if (!headerFound) {
            const headerMatch = l.match(/^(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|C4Context|C4Container|C4Component|C4Deployment|stateDiagram(?:-v2)?|mindmap|gantt|journey)(?:\s|$)/i);
            if (headerMatch) {
                kind = headerMatch[1];
                bodyStart = i + 1;
                headerFound = true;
                continue;
            }
        } else {
            // C4 / Gantt dialects use a bare `title <text>` directive (no
            // colon) right after the header. Strip and capture before
            // returning so the body fed to parseC4 doesn't contain a stray
            // line that no parser knows what to do with.
            const c4TitleMatch = l.match(/^title\s+(.+)$/i);
            if (c4TitleMatch && /^c4|^gantt|^journey/i.test(kind)) {
                if (!title) title = c4TitleMatch[1].trim();
                bodyStart = i + 1;
                continue;
            }
            // Body has started — stop scanning so we don't accidentally
            // overwrite a title that appeared later in the file.
            break;
        }
    }
    return { kind, body: lines.slice(bodyStart).join('\n'), title };
}

/**
/** Diagnostic metadata produced alongside the IR. */
export interface MermaidToIRDiagnostics {
    kind: string;
    parsedNodes: number;
    parsedEdges: number;
    bodyLines: number;
    title?: string;
}

/**
 * Diagnostic-rich variant. Returns the IR plus a small report so callers can
 * decide whether the parse was a non-event (no nodes) or a real success.
 */
export function mermaidToIRWithDiagnostics(code: string): { ir: DiagramIR; diagnostics: MermaidToIRDiagnostics } {
    const ctx: ParseContext = {
        nodes: new Map(),
        edges: [],
        groups: [],
        sourceFormat: 'mermaid',
        edgeCounter: 0,
    };

    const { kind, body, title } = detectHeader(code);
    ctx.title = title;
    ctx.diagramKind = kind;

    const lower = kind.toLowerCase();
    if (lower.startsWith('flowchart') || lower.startsWith('graph')) parseFlowchart(body, ctx);
    else if (lower === 'sequencediagram') parseSequence(body, ctx);
    else if (lower === 'classdiagram') parseClassDiagram(body, ctx);
    else if (lower === 'erdiagram') parseErDiagram(body, ctx);
    else if (lower.startsWith('c4')) parseC4(body, ctx);
    else if (lower.startsWith('statediagram')) parseState(body, ctx);
    else {
        parseFlowchart(body, ctx);
    }

    const ir: DiagramIR = {
        nodes: Array.from(ctx.nodes.values()),
        edges: ctx.edges,
        groups: ctx.groups,
        metadata: {
            sourceFormat: 'mermaid',
            generatedAt: new Date().toISOString(),
            title: ctx.title,
        },
    };

    // Defensive semantic-role repair: even after the per-rule resolution
    // above, this pass catches legacy / hand-edited Mermaid where the
    // kind/label/shape disagree (e.g. someone hand-wrote `kind: 'process'`
    // on a node labelled "Asegurado"). The pass is idempotent so it's a
    // no-op when the IR is already consistent.
    const repaired = repairDiagramIRSemantics(ir, { diagramKind: ctx.diagramKind });

    const bodyLines = body.split('\n').filter((l) => l.trim().length > 0).length;
    return {
        ir: repaired.ir,
        diagnostics: {
            kind,
            parsedNodes: repaired.ir.nodes.length,
            parsedEdges: repaired.ir.edges.length,
            bodyLines,
            title: ctx.title,
        },
    };
}

/**
 * Main entry point.  Returns a DiagramIR regardless of whether parsing fully
 * succeeded — unparseable nodes simply don't appear, and downstream quality
 * analysis will flag the result. Use {@link mermaidToIRWithDiagnostics} when
 * you need the parser stats (e.g. to surface "C4Container with zero
 * Container() calls" to the UI).
 */
export function mermaidToIR(code: string): DiagramIR {
    return mermaidToIRWithDiagnostics(code).ir;
}
