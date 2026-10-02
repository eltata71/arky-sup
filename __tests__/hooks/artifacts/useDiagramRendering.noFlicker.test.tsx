/**
 * Sin parpadeo, y con las rutas de ELK (plan de diagramas, 8.3d).
 *
 * El lienzo pintaba el layout síncrono de dagre y saltaba al de ELK un
 * instante después: el diagrama parecía reordenarse solo. Ahora, cuando toca
 * una pasada de ELK, el lienzo espera tras el esqueleto —sin pintar ni un
 * fotograma del layout provisional— y, si ELK tarda demasiado, muestra el de
 * dagre en vez de esperar sin fin.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../../services/architectureProjects';
import type { Settings } from '../../../types';

const irToReactFlowSmart = vi.hoisted(() => vi.fn());
vi.mock('../../../services/diagram/irToReactFlow', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../services/diagram/irToReactFlow')>()),
    irToReactFlowSmart,
}));

import { useDiagramRendering, type UseDiagramRenderingResult } from '../../../hooks/artifacts/useDiagramRendering';

const artifact = {
    id: 'a1',
    name: 'Flujo',
    type: 'mermaid-graph',
    representation: 'diagram',
    content: 'flowchart LR\n  a[Portal] --> b[API]\n  b --> c[(Base)]',
    ir: {
        nodes: [
            { id: 'a', label: 'Portal', kind: 'service' },
            { id: 'b', label: 'API', kind: 'service' },
            { id: 'c', label: 'Base', kind: 'data' },
        ],
        edges: [
            { id: 'e1', source: 'a', target: 'b', label: 'Llama' },
            { id: 'e2', source: 'b', target: 'c', label: 'Guarda' },
        ],
        groups: [],
    },
} as unknown as Artifact;

const route = { points: [{ x: 260, y: 40 }, { x: 300, y: 40 }], sourceAt: { x: 0, y: 0 }, targetAt: { x: 300, y: 0 } };
const elkResult = {
    plan: { backend: 'elk', algorithm: 'layered', direction: 'LR', density: 'normal', orthogonal: true, rationale: 'prueba' },
    nodes: [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 300, y: 0 } }, { id: 'c', position: { x: 600, y: 0 } }],
    edges: [{ id: 'e1', source: 'a', target: 'b', data: { route } }],
};

const mount = () => {
    const seen: UseDiagramRenderingResult[] = [];
    const Probe: React.FC = () => {
        const result = useDiagramRendering({
            artifact,
            project: { id: 'p1', artifacts: [artifact] } as unknown as Project,
            settings: {} as Settings,
            viewMode: 'diagram',
            audience: 'technical',
            mermaidCode: artifact.content,
            updateArtifact: vi.fn(),
            setViewMode: vi.fn(),
            onContentFixed: vi.fn(),
        });
        seen.push(result);
        return null;
    };
    render(<Probe />);
    return seen;
};

afterEach(() => {
    irToReactFlowSmart.mockReset();
    vi.useRealTimers();
});

describe('useDiagramRendering — sin parpadeo (8.3d)', () => {
    it('desde el primer render espera a ELK: nunca expone el layout provisional', async () => {
        irToReactFlowSmart.mockResolvedValue(elkResult);
        const seen = mount();
        expect(seen[0].isLoading).toBe(true);
        expect(seen[0].loadingMessage).toBe('Calculando la disposición del diagrama…');
        await waitFor(() => expect(seen.at(-1)!.isLoading).toBe(false));
        // Cada render que dejó ver el lienzo lo hizo ya con las posiciones de ELK.
        for (const r of seen.filter((x) => !x.isLoading)) {
            expect(r.displayFlowNodes.find((n) => n.id === 'b')?.position).toEqual({ x: 300, y: 0 });
        }
    });

    it('las aristas llevan la ruta que ELK calculó', async () => {
        irToReactFlowSmart.mockResolvedValue(elkResult);
        const seen = mount();
        await waitFor(() => expect(seen.at(-1)!.isLoading).toBe(false));
        const edge = seen.at(-1)!.displayFlowEdges.find((e) => e.id === 'e1');
        expect((edge?.data as { route?: unknown }).route).toEqual(route);
    });

    it('si ELK tarda demasiado, enseña el layout de dagre en vez de esperar sin fin', async () => {
        vi.useFakeTimers();
        irToReactFlowSmart.mockReturnValue(new Promise(() => {}));
        const seen = mount();
        expect(seen.at(-1)!.isLoading).toBe(true);
        await act(async () => { vi.advanceTimersByTime(1600); });
        expect(seen.at(-1)!.isLoading).toBe(false);
        expect(seen.at(-1)!.displayFlowNodes.length).toBe(3);
    });

    it('si ELK falla, enseña el layout de dagre', async () => {
        irToReactFlowSmart.mockRejectedValue(new Error('sin WASM'));
        const seen = mount();
        await waitFor(() => expect(seen.at(-1)!.isLoading).toBe(false));
        expect(seen.at(-1)!.displayFlowNodes.length).toBe(3);
    });
});
