/**
 * The cinematic overlay walks the diagram's own story.
 *
 * This component used to derive its walk with a private BFS over the IR, and
 * it honoured authored scenes only through a `scenes` prop that the canvas
 * filled from a field nobody ever set. So an architect who wrote a narrative
 * got a topological order anyway — the guided reading showed a sequence
 * nobody had chosen, which is the one thing a presentation mode must not do.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';

import type { DiagramIR, DiagramNarrative } from '../../lib/diagram';
import PresentationMode from '../../components/PresentationMode';

const ir = (narrative?: DiagramNarrative): DiagramIR => ({
    nodes: [
        { id: 'cliente', label: 'Cliente', kind: 'person' },
        { id: 'api', label: 'API', kind: 'service' },
        { id: 'cobro', label: 'Pasarela', kind: 'external' },
    ],
    edges: [
        { id: 'e1', source: 'cliente', target: 'api', label: 'solicita' },
        { id: 'e2', source: 'api', target: 'cobro', label: 'cobra' },
    ],
    groups: [],
    metadata: narrative ? { narrative } : {},
});

const renderOverlay = (diagram: DiagramIR) => {
    const onSceneChange = vi.fn();
    render(
        <ReactFlowProvider>
            <PresentationMode
                open
                onClose={vi.fn()}
                ir={diagram}
                nodes={[]}
                edges={[]}
                onSceneChange={onSceneChange}
            />
        </ReactFlowProvider>,
    );
    return { onSceneChange };
};

describe('PresentationMode', () => {
    it('counts the authored scenes rather than the topological levels', async () => {
        renderOverlay(ir({
            summary: 'El cobro depende de un proveedor externo.',
            scenes: [
                { id: 'sc-1', title: 'La solicitud', focusNodeIds: ['cliente', 'api'], focusEdgeIds: ['e1'] },
                { id: 'sc-2', title: 'El cobro', focusNodeIds: ['cobro'], focusEdgeIds: ['e2'] },
            ],
        }));
        // The written titles, not the "Paso N" the derivation would produce.
        expect(await screen.findByText('La solicitud', {}, { timeout: 3000 })).toBeInTheDocument();
        expect(screen.getAllByText((_, node) => node?.textContent === 'Escena 1 / 2').length).toBeGreaterThan(0);
    });

    it('derives the walk when nobody wrote one', async () => {
        renderOverlay(ir());
        expect(await screen.findByText('Paso 1', {}, { timeout: 3000 })).toBeInTheDocument();
    });

    it('does not treat the repair pass synthesis as a written walk', async () => {
        renderOverlay(ir({ summary: 'Flujo centrado en Cliente.', source: 'derived' }));
        expect(await screen.findByText('Paso 1', {}, { timeout: 3000 })).toBeInTheDocument();
    });
});
