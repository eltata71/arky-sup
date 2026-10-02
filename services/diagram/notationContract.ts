/**
 * What a diagram must show to be read in its notation (plan de diagramas, 8.4c).
 *
 * A C4 diagram is not boxes with names: each element says what it is
 * —«Contenedor: Node.js», «Sistema externo»—, the drawing carries a title and
 * a legend for those element types, and none of that is optional, because a
 * reader who cannot tell a container from a system cannot read the level.
 * Until 8.4c nothing required it. The canvas painted an English ribbon from
 * the node's `kind`, which the model writes as a role (`service`, `data`), so
 * most elements had none and components never did; the export frame's legend
 * listed only relation styles, and its title fell back to «Diagrama de
 * arquitectura» when the IR carried none.
 *
 * This is the one answer to «what does this element show?» — derived from
 * the same `c4MacroFor` the Mermaid C4 text is written with, so the canvas,
 * the export and the text cannot name an element three different ways — and
 * `checkNotationContract` is the verdict on what a surface presented.
 */
import type { DiagramIR, DiagramIRNode } from '../../lib/diagram';
import { c4MacroFor, type C4DiagramLevel } from './irToMermaidC4';
import type { LegendEntry } from './diagramExportFrame';
import { C4_BOUNDARY_LEGEND } from '../../lib/diagramC4Levels';

/** The title an export falls back to when it knows nothing: it names no diagram. */
export const GENERIC_DIAGRAM_TITLE = 'Diagrama de arquitectura';

const C4_LEVEL_OF_DIAGRAM_TYPE: Record<string, C4DiagramLevel> = {
    'c4-context': 'context',
    'c4-container': 'container',
    'c4-component': 'component',
    'c4-deployment': 'deployment',
};

/** The C4 level a diagram declares, or `null` when it is not a C4 diagram. */
export function c4LevelOfIR(ir: Pick<DiagramIR, 'metadata'>): C4DiagramLevel | null {
    return C4_LEVEL_OF_DIAGRAM_TYPE[ir.metadata?.diagramType ?? ''] ?? null;
}

interface C4ElementType {
    /** Spanish name of the element type, as the legend and the stereotype print it. */
    label: string;
    /** C4's conventional colours, so the legend swatch matches the notation readers know. */
    color: string;
}

const C4_ELEMENT_TYPES: Record<string, C4ElementType> = {
    Person: { label: 'Persona', color: '#08427b' },
    Person_Ext: { label: 'Persona externa', color: '#686868' },
    System: { label: 'Sistema de software', color: '#1168bd' },
    SystemDb: { label: 'Sistema de datos', color: '#1168bd' },
    SystemQueue: { label: 'Sistema de mensajería', color: '#1168bd' },
    System_Ext: { label: 'Sistema externo', color: '#999999' },
    Container: { label: 'Contenedor', color: '#438dd5' },
    ContainerDb: { label: 'Contenedor de datos', color: '#438dd5' },
    ContainerQueue: { label: 'Cola de mensajes', color: '#438dd5' },
    Container_Ext: { label: 'Contenedor externo', color: '#999999' },
    Component: { label: 'Componente', color: '#85bbf0' },
    ComponentDb: { label: 'Componente de datos', color: '#85bbf0' },
    ComponentQueue: { label: 'Componente de mensajería', color: '#85bbf0' },
};

const elementTypeOf = (node: DiagramIRNode, level: C4DiagramLevel): C4ElementType =>
    C4_ELEMENT_TYPES[c4MacroFor(node, level)] ?? C4_ELEMENT_TYPES.Container;

/**
 * The stereotype an element shows: its type and, for the types C4 gives a
 * technology slot, the technology — «Contenedor: Node.js». A missing
 * technology is left out rather than guessed.
 */
export function c4StereotypeOf(node: DiagramIRNode, level: C4DiagramLevel): string {
    const macro = c4MacroFor(node, level);
    const type = elementTypeOf(node, level).label;
    const technology = node.technology?.trim();
    return technology && /^(Container|Component)/.test(macro) ? `${type}: ${technology}` : type;
}

/**
 * What a C4 node carries to the canvas: its stereotype for the node's ribbon
 * and its element type for the canvas legend. Empty for a diagram that is not C4.
 */
export function c4NodePresentation(ir: Pick<DiagramIR, 'metadata'>, node: DiagramIRNode): { stereotype?: string; c4Element?: LegendEntry } {
    const level = c4LevelOfIR(ir);
    if (!level) return {};
    const type = elementTypeOf(node, level);
    return { stereotype: c4StereotypeOf(node, level), c4Element: { label: type.label, color: type.color } };
}

export interface NotationPresentation {
    /** The diagram's own title, then the artifact's name; `null` when neither exists. */
    title: string | null;
    /** One entry per element type present, in the order they first appear. */
    elementLegend: LegendEntry[];
    /** The stereotype of every node, by id. Empty for a diagram that is not C4. */
    stereotypes: Record<string, string>;
}

/** What a C4 diagram must present on any surface. Not C4: only the title. */
export function describeNotationPresentation(
    ir: DiagramIR,
    options: { fallbackTitle?: string } = {},
): NotationPresentation {
    const title = ir.metadata?.title?.trim() || options.fallbackTitle?.trim() || null;
    const level = c4LevelOfIR(ir);
    if (!level) return { title, elementLegend: [], stereotypes: {} };

    const stereotypes: Record<string, string> = {};
    const legend = new Map<string, LegendEntry>();
    for (const node of ir.nodes) {
        stereotypes[node.id] = c4StereotypeOf(node, level);
        const type = elementTypeOf(node, level);
        if (!legend.has(type.label)) legend.set(type.label, { label: type.label, color: type.color });
    }
    if (ir.groups.length > 0) legend.set(C4_BOUNDARY_LEGEND.label, C4_BOUNDARY_LEGEND);
    return { title, elementLegend: [...legend.values()], stereotypes };
}

/** What a surface actually showed: the frame's title and legend, and each node's chip. */
export interface PresentedNotation {
    title: string | null | undefined;
    legendLabels: readonly string[];
    stereotypes: Readonly<Record<string, string | undefined>>;
}

export interface NotationContractIssue {
    code: 'NOTATION_TITLE_MISSING' | 'NOTATION_LEGEND_INCOMPLETE' | 'NOTATION_STEREOTYPE_MISSING';
    message: string;
}

/**
 * The verdict on what a surface presented. Every C4 element type present must
 * be in the legend, every element must show its stereotype, and the title
 * must name this diagram — the generic fallback names none.
 */
export function checkNotationContract(ir: DiagramIR, presented: PresentedNotation): NotationContractIssue[] {
    const issues: NotationContractIssue[] = [];
    const title = presented.title?.trim();
    if (!title || title === GENERIC_DIAGRAM_TITLE) {
        issues.push({ code: 'NOTATION_TITLE_MISSING', message: 'El diagrama se presenta sin un título que lo nombre.' });
    }
    const expected = describeNotationPresentation(ir, { fallbackTitle: title });
    const shown = new Set(presented.legendLabels);
    const missingTypes = expected.elementLegend.map((e) => e.label).filter((label) => !shown.has(label));
    if (missingTypes.length > 0) {
        issues.push({ code: 'NOTATION_LEGEND_INCOMPLETE', message: `La leyenda no explica: ${missingTypes.join(', ')}.` });
    }
    const unnamed = Object.entries(expected.stereotypes)
        .filter(([id, stereotype]) => presented.stereotypes[id] !== stereotype)
        .map(([id]) => ir.nodes.find((n) => n.id === id)?.label ?? id);
    if (unnamed.length > 0) {
        issues.push({ code: 'NOTATION_STEREOTYPE_MISSING', message: `Sin su estereotipo C4: ${unnamed.join(', ')}.` });
    }
    return issues;
}
