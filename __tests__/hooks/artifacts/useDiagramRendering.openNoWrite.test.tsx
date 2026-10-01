/**
 * Abrir un diagrama no escribe en él (plan de diagramas, 8.1d).
 *
 * El plan de layout que elige ELK se guardaba en el artefacto en cuanto se
 * resolvía: una lectura producía una revisión, chocaba con una edición real en
 * otra pestaña y, para quien sólo puede leer, era una escritura rechazada. El
 * plan se queda en memoria; sólo la elección explícita de una persona se guarda.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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

describe('useDiagramRendering — abrir no escribe', () => {
    it('el plan de ELK se publica en memoria y el artefacto no se toca', async () => {
        const plan = { backend: 'elk', algorithm: 'layered', direction: 'LR', density: 'normal', orthogonal: true, rationale: 'prueba' };
        irToReactFlowSmart.mockResolvedValue({
            plan,
            nodes: [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 300, y: 0 } }, { id: 'c', position: { x: 600, y: 0 } }],
            edges: [],
        });
        const updateArtifact = vi.fn();
        const captured: { result: UseDiagramRenderingResult | null } = { result: null };
        const Probe: React.FC = () => {
            captured.result = useDiagramRendering({
                artifact,
                project: { id: 'p1', artifacts: [artifact] } as unknown as Project,
                settings: {} as Settings,
                viewMode: 'diagram',
                audience: 'technical',
                mermaidCode: artifact.content,
                updateArtifact,
                setViewMode: vi.fn(),
                onContentFixed: vi.fn(),
            });
            return null;
        };
        render(<Probe />);
        await waitFor(() => expect(captured.result?.layoutPlan?.backend).toBe('elk'));
        expect(updateArtifact).not.toHaveBeenCalled();
    });
});
