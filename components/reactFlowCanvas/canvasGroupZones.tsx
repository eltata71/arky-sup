/**
 * Group zones — the labelled boundary boxes drawn behind a cluster of nodes.
 *
 * `buildGroupZoneNodes` derives the boxes from laid-out content nodes and
 * `GroupZoneNode` paints one. They move together because the shape of the node
 * data is the contract between them; splitting them would put that contract
 * across a module boundary for no gain.
 */

import React from 'react';
import type { Node } from 'reactflow';
import type { DiagramIRGroup } from '../../lib/diagram';
import { resolveGroupSemanticStyle } from '../../services/diagram/groupSemantics';
// Shared with the layout: a zone is sized from the same node box the
// layout reserved, so the two must read the same constants.
import { NODE_HEIGHT, NODE_WIDTH, isFiniteCanvasPosition } from './canvasLayout';

export interface GroupKindHint {
    label: string;
    kind?: DiagramIRGroup['kind'];
    purpose?: string;
    boundaryType?: string;
    owner?: string;
    trust?: string;
    id?: string;
}

// Build group zone nodes from laid-out content nodes
export const buildGroupZoneNodes = (
    layoutedNodes: Node[],
    groupHints: Map<string, GroupKindHint> = new Map(),
): Node[] => {
    const groupMap = new Map<string, Node[]>();
    layoutedNodes.forEach(n => {
        const g = (n.data as { group?: string }).group;
        if (g) {
            if (!groupMap.has(g)) groupMap.set(g, []);
            groupMap.get(g)!.push(n);
        }
    });
    if (groupMap.size === 0) return [];

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

    const zoneNodes: Node[] = [];
    let colorIdx = 0;

    groupMap.forEach((members, groupName) => {
        const finiteMembers = members.filter(n => isFiniteCanvasPosition(n.position));
        if (finiteMembers.length === 0) return;
        // Per-node dimensions: content-adaptive cards ship their real size in
        // `data.width/height`; fall back to the preset for legacy payloads.
        const dimsOf = (n: Node): { w: number; h: number } => {
            const data = (n.data ?? {}) as { width?: number; height?: number };
            return {
                w: data.width ?? n.width ?? NODE_WIDTH,
                h: data.height ?? n.height ?? NODE_HEIGHT,
            };
        };
        const hint = groupHints.get(groupName);
        const semanticStyle = resolveGroupSemanticStyle(hint?.kind, colorIdx);
        const minX = Math.min(...finiteMembers.map(n => n.position.x)) - semanticStyle.padX;
        const minY = Math.min(...finiteMembers.map(n => n.position.y)) - semanticStyle.padTop;
        const maxX = Math.max(...finiteMembers.map(n => n.position.x + dimsOf(n).w)) + semanticStyle.padX;
        const maxY = Math.max(...finiteMembers.map(n => n.position.y + dimsOf(n).h)) + semanticStyle.padBottom;
        if (!hint?.kind) colorIdx++;
        zoneNodes.push({
            id: `__group__${groupName}`,
            type: 'groupZone',
            position: { x: minX, y: minY },
            data: {
                label: groupName,
                color: semanticStyle.color,
                isDark,
                kind: hint?.kind,
                // Gap 7: persist the boundary metadata on the group zone so
                // `toDiagramIR` can recover purpose/boundaryType/owner/trust
                // without re-querying the previous IR.
                purpose: hint?.purpose,
                boundaryType: hint?.boundaryType,
                owner: hint?.owner,
                trust: hint?.trust,
                groupId: hint?.id,
            },
            style: { width: maxX - minX, height: maxY - minY },
            selectable: false,
            draggable: false,
            zIndex: semanticStyle.zIndex,
        });
    });
    return zoneNodes;
};

// GroupZone custom node — renders a labelled translucent background rectangle
export const GroupZoneNode: React.FC<{ data: { label: string; color: { light: string; dark: string; border: string }; isDark: boolean }; style?: React.CSSProperties }> = ({ data, style }) => {
    const bg = data.isDark ? data.color.dark : data.color.light;
    return (
        <div
            style={{
                width: style?.width ?? '100%',
                height: style?.height ?? '100%',
                background: bg,
                border: `1.5px dashed ${data.color.border}`,
                borderRadius: 16,
                position: 'relative',
                pointerEvents: 'none',
            }}
        >
            <span
                style={{
                    position: 'absolute',
                    top: 8,
                    left: 14,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: data.color.border,
                    opacity: 0.85,
                    pointerEvents: 'none',
                    userSelect: 'none',
                }}
            >
                {data.label}
            </span>
        </div>
    );
};
