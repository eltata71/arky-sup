import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useArtifactViewMode } from '../../../hooks/artifacts/useArtifactViewMode';
import type { Artifact } from '../../../lib/artifacts';

const documentArtifact: Artifact = {
    id: 'doc',
    versionGroupId: 'doc',
    version: 1,
    createdAt: '2026-05-11T00:00:00.000Z',
    name: 'SRS',
    type: 'markdown',
    phase: 'P',
    architecturalView: 'Vista Lógica y de Diseño',
    content: '# SRS\n\nIntroducción al sistema.',
    objective: 'Documentar',
    keyConcepts: [],
    representation: 'document',
};

const diagramArtifact: Artifact = {
    ...documentArtifact,
    id: 'diag',
    type: 'mermaid-graph',
    representation: 'diagram',
    content: 'flowchart LR\n  A --> B\n  B --> C',
};

const hybridArtifact: Artifact = {
    ...documentArtifact,
    id: 'hyb',
    type: 'hybrid-text-diagram',
    representation: 'hybrid',
    content: '# Intro\n\nNarrativa\n\n```mermaid\nflowchart TD\nA-->B\n```',
};

interface ProbeProps {
    artifact: Artifact;
    isNarrowViewport?: boolean;
    onState?: (state: { viewMode: string; capabilities: ReturnType<typeof useArtifactViewMode>['capabilities'] }) => void;
    onAction?: (api: ReturnType<typeof useArtifactViewMode>) => void;
}

const Probe: React.FC<ProbeProps> = ({ artifact, isNarrowViewport, onState, onAction }) => {
    const api = useArtifactViewMode(artifact, { isNarrowViewport });
    React.useEffect(() => {
        onState?.({ viewMode: api.viewMode, capabilities: api.capabilities });
    });
    React.useImperativeHandle(React.createRef<{ act: () => void }>(), () => ({
        act: () => onAction?.(api),
    }));
    return <div data-testid="probe" data-mode={api.viewMode} />;
};

describe('useArtifactViewMode', () => {
    it('selects the preferred view for document-only artifacts', () => {
        const { getByTestId } = render(<Probe artifact={documentArtifact} />);
        const mode = getByTestId('probe').getAttribute('data-mode');
        expect(['document', 'markdown']).toContain(mode);
    });

    it('selects diagram for diagram-only artifacts', () => {
        const { getByTestId } = render(<Probe artifact={diagramArtifact} />);
        expect(getByTestId('probe').getAttribute('data-mode')).toBe('diagram');
    });

    it('opens split for hybrid artifacts on wide viewports', () => {
        const { getByTestId } = render(<Probe artifact={hybridArtifact} isNarrowViewport={false} />);
        expect(getByTestId('probe').getAttribute('data-mode')).toBe('split');
    });

    it('does not open split for hybrid artifacts on narrow viewports', () => {
        const { getByTestId } = render(<Probe artifact={hybridArtifact} isNarrowViewport />);
        const mode = getByTestId('probe').getAttribute('data-mode');
        expect(mode).not.toBe('split');
    });

    it('clamps requested view to a safe view when the artifact cannot render it', async () => {
        let api: ReturnType<typeof useArtifactViewMode> | undefined;
        const Capture: React.FC = () => {
            api = useArtifactViewMode(documentArtifact);
            return <div data-mode={api.viewMode} />;
        };
        render(<Capture />);

        await act(async () => {
            // request a view the document-only artifact cannot honour.
            api?.setSafeViewMode('diagram');
        });
        expect(api?.viewMode).not.toBe('diagram');
        expect(['document', 'markdown']).toContain(api?.viewMode);
    });
});
