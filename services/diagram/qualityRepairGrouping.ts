/**
 * The grouping repair of `autoRepairDiagramIR` (full scope only, 8.1b),
 * moved out of `qualityRepair.ts` when 8.4a made every repair record what it
 * wrote. The groups it writes are derived and the rubric does not score them.
 */
import type { DiagramIR, DiagramIRGroup } from '../../lib/diagram';
import { detectSemanticRole, type SemanticRole } from '../../lib/diagramTokens';
import { noteDerivedGroups } from './quality/derivedContent';
import type { QualityRepairChange } from './qualityRepair';

const ROLE_GROUP_LABEL: Record<SemanticRole, string> = {
    person: 'Actores',
    gateway: 'Capa de borde',
    service: 'Servicios',
    process: 'Procesos',
    messaging: 'Mensajería',
    data: 'Datos',
    external: 'Sistemas externos',
    system: 'Sistemas',
    generic: 'Componentes',
};

/**
 * Improve visual hierarchy. When the model emits one huge swimlane (the common
 * low-score case reported by users), split it into readable chunks; when no
 * groups exist, synthesize semantic buckets by role.
 */
export function repairGrouping(ir: DiagramIR, applied: QualityRepairChange[]): void {
    if (ir.nodes.length < 5) return;

    const nodeIds = new Set(ir.nodes.map((node) => node.id));
    const validGroups = ir.groups
        .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => nodeIds.has(id)) }))
        .filter((group) => group.nodeIds.length > 0);

    if (validGroups.length > 0) {
        const readableGroups: DiagramIRGroup[] = [];
        const splitTargets: string[] = [];

        for (const group of validGroups) {
            if (group.nodeIds.length <= 8) {
                readableGroups.push(group);
                continue;
            }

            splitTargets.push(group.id);
            for (let offset = 0; offset < group.nodeIds.length; offset += 6) {
                const chunk = group.nodeIds.slice(offset, offset + 6);
                const index = Math.floor(offset / 6) + 1;
                readableGroups.push({
                    id: `${group.id}-p${index}`,
                    label: `${group.label} · ${index}`,
                    nodeIds: chunk,
                });
            }
        }

        if (splitTargets.length > 0) {
            noteDerivedGroups(ir, ir.groups, readableGroups.map((g) => g.id));
            ir.groups = readableGroups;
            const groupByNode = new Map(readableGroups.flatMap((group) => group.nodeIds.map((nodeId) => [nodeId, group.label] as const)));
            for (const node of ir.nodes) {
                const groupLabel = groupByNode.get(node.id);
                if (groupLabel) node.group = groupLabel;
            }
            applied.push({
                code: 'DENSE_GROUP_SPLIT',
                description: `Divididos ${splitTargets.length} grupo(s) densos en secciones legibles de hasta 6 nodos.`,
                targetIds: splitTargets,
            });
        }
        return;
    }

    const buckets = new Map<SemanticRole, string[]>();
    for (const node of ir.nodes) {
        const role = detectSemanticRole(node.label ?? '', node.kind);
        if (!buckets.has(role)) buckets.set(role, []);
        buckets.get(role)!.push(node.id);
    }
    const groups: DiagramIRGroup[] = [];
    let i = 1;
    for (const [role, ids] of buckets) {
        if (ids.length < 2) continue;
        groups.push({ id: `group-${i++}`, label: ROLE_GROUP_LABEL[role], nodeIds: ids });
    }
    if (groups.length === 0) return;
    noteDerivedGroups(ir, ir.groups, [...ir.groups.map((g) => g.id), ...groups.map((g) => g.id)]);
    ir.groups.push(...groups);
    // Sync `node.group` so renderers/quality computations see the grouping.
    const labelById = new Map<string, string>();
    for (const g of groups) for (const id of g.nodeIds) labelById.set(id, g.label);
    for (const node of ir.nodes) {
        if (!node.group && labelById.has(node.id)) node.group = labelById.get(node.id);
    }
    applied.push({
        code: 'GROUPING_SYNTHESIZED',
        description: `Creados ${groups.length} grupo(s) por rol semántico.`,
        targetIds: groups.map((g) => g.id),
    });
}

