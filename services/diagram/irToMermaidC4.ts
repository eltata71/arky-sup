/**
 * DiagramIR → Mermaid **C4** serializer (plan de diagramas, 6.1).
 *
 * `irToMermaid` emits a flowchart, always. For a C4 artifact that was a silent
 * change of notation: the model answered a C4 container diagram, the engine
 * flattened it to `flowchart TB`, and the content stored under
 * `mermaid-c4-container` was not C4 at all. It also dropped every technology
 * and description on the way, which are the two things a C4 element exists
 * to carry.
 *
 * This writes the dialect the artifact type names, in the argument order
 * Mermaid's C4 macros define and `mermaidToIR` reads back:
 *
 *   Person(alias, label, descr)            System(alias, label, descr)
 *   Container(alias, label, techn, descr)  Component(alias, label, techn, descr)
 *   Rel(from, to, label, techn)
 *
 * `System` takes no technology argument in Mermaid — a fourth argument there is
 * a sprite — so a system's technology travels inside its description instead.
 *
 * Deterministic; no LLM calls. What C4 notation cannot express (data
 * classification, compliance, the story) is not lost: the IR is persisted
 * beside the content and remains the canvas's source.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';

export type C4DiagramLevel = 'context' | 'container' | 'component' | 'deployment';

const C4_TYPE_LEVELS: Record<string, C4DiagramLevel> = {
    'mermaid-c4-context': 'context',
    'mermaid-c4-container': 'container',
    'mermaid-c4-component': 'component',
    'mermaid-c4-deployment': 'deployment',
};

const C4_HEADERS: Record<C4DiagramLevel, string> = {
    context: 'C4Context',
    container: 'C4Container',
    component: 'C4Component',
    deployment: 'C4Deployment',
};

/** The C4 level an artifact type names, or `null` when it is not a C4 type. */
export function c4LevelOfArtifactType(type: string): C4DiagramLevel | null {
    return C4_TYPE_LEVELS[type] ?? null;
}

const EXTERNAL_SEMANTIC_TYPES = new Set(['external-system', 'external-provider']);
const DATA_SEMANTIC_TYPES = new Set(['database', 'document-repository']);
const PERSON_SEMANTIC_TYPES = new Set(['human-actor', 'business-role']);

const clean = (value: string | undefined): string =>
    (value ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();

const quote = (value: string | undefined): string => `"${clean(value)}"`;

interface NodeTraits {
    person: boolean;
    external: boolean;
    data: boolean;
    queue: boolean;
    /** The model named the C4 element itself (`System`, `Container_Ext`…). */
    declared: string;
}

function traitsOf(node: DiagramIRNode): NodeTraits {
    const kind = (node.kind ?? '').toLowerCase();
    const semantic = node.semanticType ?? '';
    return {
        person: kind.startsWith('person') || node.shape === 'person' || PERSON_SEMANTIC_TYPES.has(semantic),
        external: /_ext$/.test(kind)
            || kind === 'external'
            || kind === 'externalsystem'
            || node.trust === 'external'
            || node.trust === 'partner'
            || node.trust === 'public'
            || EXTERNAL_SEMANTIC_TYPES.has(semantic),
        data: /db$/.test(kind) || kind === 'data' || node.shape === 'cylinder' || DATA_SEMANTIC_TYPES.has(semantic),
        queue: /queue$/.test(kind) || kind === 'messaging' || semantic === 'messaging',
        declared: kind.replace(/_ext$/, ''),
    };
}

/**
 * Which C4 macro an IR node becomes at a given level. The node's own C4 kind
 * wins when the model wrote one, because it is the model's claim about the
 * element; the semantic role decides otherwise.
 *
 * Only the forms `mermaidToIR` accepts are emitted — there is no
 * `SystemDb_Ext` here, because the parser would drop the element.
 *
 * The canvas and the export name the element from this same answer
 * (`notationContract`, 8.4c), so the stereotype a node shows is the macro its
 * text is written with.
 */
export function c4MacroFor(node: DiagramIRNode, level: C4DiagramLevel): string {
    const t = traitsOf(node);
    if (t.person) return t.external ? 'Person_Ext' : 'Person';

    const declaresSystem = t.declared.startsWith('system') || t.declared === 'softwaresystem';
    const declaresContainer = t.declared.startsWith('container');
    const storage = t.data ? 'Db' : t.queue ? 'Queue' : '';

    if (level === 'context' || declaresSystem) {
        return t.external ? 'System_Ext' : `System${storage}`;
    }
    if (t.external) return declaresContainer ? 'Container_Ext' : 'System_Ext';
    if (level === 'component' && !declaresContainer) return `Component${storage}`;
    return `Container${storage}`;
}

/** Mermaid C4 aliases are identifiers; IR ids may carry hyphens or dots. */
function buildAliases(ir: DiagramIR): Map<string, string> {
    const aliases = new Map<string, string>();
    const taken = new Set<string>();
    const reserve = (id: string) => {
        const base = id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'n';
        let alias = base;
        let n = 2;
        while (taken.has(alias)) alias = `${base}_${n++}`;
        taken.add(alias);
        aliases.set(id, alias);
    };
    for (const node of ir.nodes) reserve(node.id);
    for (const group of ir.groups) if (!aliases.has(group.id)) reserve(group.id);
    return aliases;
}

function renderElement(node: DiagramIRNode, level: C4DiagramLevel, alias: string): string {
    const macro = c4MacroFor(node, level);
    const takesTechnology = /^(Container|Component)/.test(macro);
    if (takesTechnology && node.technology) {
        // A four-argument call is how the parser tells technology from
        // description, so the description slot is never left empty.
        return `${macro}(${alias}, ${quote(node.label)}, ${quote(node.technology)}, ${quote(node.description || node.technology)})`;
    }
    const description = !takesTechnology && node.technology && !macro.startsWith('Person')
        ? [clean(node.description), `[${clean(node.technology)}]`].filter(Boolean).join(' ')
        : node.description;
    return description
        ? `${macro}(${alias}, ${quote(node.label)}, ${quote(description)})`
        : `${macro}(${alias}, ${quote(node.label)})`;
}

function renderRelation(edge: DiagramIREdge, aliases: Map<string, string>): string | null {
    const source = aliases.get(edge.source);
    const target = aliases.get(edge.target);
    if (!source || !target) return null;
    // `Rel` without a label is dropped by the parser; the protocol is the
    // most honest stand-in, and a generic verb only when there is nothing.
    const label = clean(edge.label) || clean(edge.protocol) || 'Se relaciona con';
    const protocol = clean(edge.protocol);
    const macro = edge.direction === 'bidirectional' ? 'BiRel' : 'Rel';
    const repeatsProtocol = protocol && label.toLowerCase().includes(protocol.toLowerCase());
    return protocol && !repeatsProtocol
        ? `${macro}(${source}, ${target}, ${quote(label)}, ${quote(protocol)})`
        : `${macro}(${source}, ${target}, ${quote(label)})`;
}

function boundaryOpener(level: C4DiagramLevel, groupKind: string | undefined): string {
    if (level === 'deployment') return 'Deployment_Node';
    if (level === 'context') return groupKind === 'enterprise' ? 'Enterprise_Boundary' : 'System_Boundary';
    if (level === 'component') return 'Container_Boundary';
    return groupKind === 'enterprise' ? 'Enterprise_Boundary' : 'System_Boundary';
}

/** Serialises an IR in the C4 dialect of `level`. */
export function irToMermaidC4(ir: DiagramIR, level: C4DiagramLevel): string {
    const aliases = buildAliases(ir);
    const lines: string[] = [C4_HEADERS[level]];
    const title = clean(ir.metadata?.title);
    if (title) lines.push(`    title ${title}`);

    const nodesById = new Map(ir.nodes.map((node) => [node.id, node]));
    const placed = new Set<string>();

    for (const group of ir.groups) {
        // A node belongs to its first boundary: C4 elements are not repeated.
        const members = group.nodeIds.filter((id) => nodesById.has(id) && !placed.has(id));
        if (members.length === 0) continue;
        lines.push(`    ${boundaryOpener(level, group.kind)}(${aliases.get(group.id)}, ${quote(group.label)}) {`);
        for (const id of members) {
            placed.add(id);
            lines.push(`        ${renderElement(nodesById.get(id)!, level, aliases.get(id)!)}`);
        }
        lines.push('    }');
    }

    for (const node of ir.nodes) {
        if (placed.has(node.id)) continue;
        lines.push(`    ${renderElement(node, level, aliases.get(node.id)!)}`);
    }

    for (const edge of ir.edges) {
        const rel = renderRelation(edge, aliases);
        if (rel) lines.push(`    ${rel}`);
    }

    return lines.join('\n');
}
