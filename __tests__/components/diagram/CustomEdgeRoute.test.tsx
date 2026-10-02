/**
 * CustomEdge dibuja la ruta de ELK mientras los nodos siguen donde ELK los
 * puso, y vuelve al trazo de siempre cuando alguien arrastra uno (8.3d).
 */
import React, { useLayoutEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Position, ReactFlowProvider, useStoreApi, type EdgeProps, type Node } from 'reactflow';
import CustomEdge from '../../../components/CustomEdge';
import type { EdgeRoute } from '../../../lib/edgeRoute';

const route: EdgeRoute = {
    points: [{ x: 260, y: 40 }, { x: 280, y: 40 }, { x: 280, y: 200 }, { x: 300, y: 200 }],
    sourceAt: { x: 0, y: 0 },
    targetAt: { x: 300, y: 160 },
};

const Seed: React.FC<{ nodes: Node[] }> = ({ nodes }) => {
    const store = useStoreApi();
    useLayoutEffect(() => {
        store.getState().setNodes(nodes);
    }, [store, nodes]);
    return null;
};

const node = (id: string, x: number, y: number): Node => ({ id, position: { x, y }, data: {}, width: 260, height: 80 });

const drawn = (nodes: Node[]) => {
    const props = {
        id: 'e1', source: 'a', target: 'b',
        sourceX: 260, sourceY: 40, targetX: 300, targetY: 200,
        sourcePosition: Position.Right, targetPosition: Position.Left,
        label: 'Invoca', data: { route },
    } as unknown as EdgeProps;
    const { container } = render(
        <ReactFlowProvider>
            <Seed nodes={nodes} />
            <svg><CustomEdge {...props} /></svg>
        </ReactFlowProvider>,
    );
    return [...container.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
};

describe('CustomEdge — ruta del motor (8.3d)', () => {
    it('dibuja la polilínea ortogonal de ELK con esquinas redondeadas', () => {
        const paths = drawn([node('a', 0, 0), node('b', 300, 160)]);
        expect(paths.some((d) => d.startsWith('M 260 40') && d.includes('Q 280 40') && d.endsWith('L 300 200'))).toBe(true);
    });

    it('con un nodo arrastrado vuelve al trazo de siempre', () => {
        const paths = drawn([node('a', 0, 0), node('b', 420, 160)]);
        expect(paths.some((d) => d.includes('Q 280 40'))).toBe(false);
        expect(paths.some((d) => d.length > 0)).toBe(true);
    });
});
