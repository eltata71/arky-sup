/**
 * Layout of a diagram with zones (plan de diagramas, 8.3c).
 *
 * Each zone — a C4 boundary, a subgraph, a lane — is an ELK compound node:
 * its members stay together and two zones cannot overlap, because ELK
 * reserves the room instead of a later pass pushing clusters apart. The
 * padding ELK reserves is the one the canvas draws around the members
 * (`resolveGroupSemanticStyle`), so the zone on screen is the rectangle ELK
 * separated.
 *
 * It used to be a two-level dagre layout, chosen because the flat ELK pass
 * did not know the zones existed and scattered their members. That layout is
 * now the fallback for when ELK cannot run.
 */
import type { DiagramIR } from '../../lib/diagram';
import { layoutIR, type LayoutResult } from '../../lib/layoutEngine';
import { layoutIRWithELK } from '../../lib/elkLayoutEngine';
import type { LayoutPlan } from '../../lib/layoutSelector';
import { estimateNodeDims } from '../../lib/diagramTokens';
import { resolveGroupSemanticStyle } from './groupSemantics';

/** The padding the canvas draws around a zone's members, by group label. */
export function zonePadding(ir: DiagramIR, label: string): { top: number; left: number; bottom: number; right: number } {
    const style = resolveGroupSemanticStyle(ir.groups.find((g) => g.label === label)?.kind);
    return { top: style.padTop, left: style.padX, bottom: style.padBottom, right: style.padX };
}

export async function layoutGroupedIR(
    ir: DiagramIR,
    plan: LayoutPlan,
    densityScale: number,
): Promise<{ layout: LayoutResult; plan: LayoutPlan }> {
    const zones = new Set(ir.nodes.map((n) => n.group).filter(Boolean)).size;
    const groupedPlan: LayoutPlan = {
        ...plan,
        backend: 'elk',
        algorithm: 'layered',
        orthogonal: true,
        rationale: `Diagrama con ${zones} agrupación(es): ELK jerárquico, cada límite es un nodo compuesto (miembros juntos, zonas sin solapamiento, aristas ortogonales).`,
    };
    try {
        const layout = await layoutIRWithELK(ir, {
            preset: 'flow',
            direction: plan.direction,
            algorithm: 'layered',
            orthogonal: true,
            densityScale,
            nodeDims: (node) => estimateNodeDims(node, plan.density),
            groupOf: (node) => node.group || undefined,
            groupPadding: (label) => zonePadding(ir, label),
        });
        return { layout, plan: groupedPlan };
    } catch (err) {
        console.warn('[layoutGroupedIR] hierarchical ELK failed, falling back to grouped dagre', err);
        const layout = layoutIR(ir, {
            preset: 'flow',
            direction: plan.direction,
            density: plan.density,
            nodeDims: (node) => estimateNodeDims(node, plan.density),
        });
        return {
            layout,
            plan: { ...groupedPlan, backend: 'dagre', orthogonal: false, rationale: 'ELK no disponible: layout jerárquico por grupos con dagre.' },
        };
    }
}
