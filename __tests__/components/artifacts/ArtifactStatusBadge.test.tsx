import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { ArtifactStatusBadge, deriveArtifactStatus } from '../../../components/artifacts/ArtifactStatusBadge';
import type { Artifact } from '../../../types';

function buildArtifact(partial: Partial<Artifact>): Artifact {
    return {
        id: 'a1',
        versionGroupId: 'g1',
        version: 1,
        createdAt: new Date().toISOString(),
        name: 'X',
        type: 'markdown',
        phase: 'p',
        architecturalView: 'Vista de Contexto y Negocio',
        content: '',
        objective: '',
        keyConcepts: [],
        representation: 'document',
        ...partial,
    };
}

describe('deriveArtifactStatus', () => {
    it('returns in-progress when no artifact is provided', () => {
        expect(deriveArtifactStatus(undefined)).toBe('in-progress');
    });

    it('returns errors when generation trace failed', () => {
        const a = buildArtifact({
            generationTrace: {
                id: 't', source: 'on-demand', status: 'failed',
                startedAt: 'now', decisions: [], errors: [],
            },
        });
        expect(deriveArtifactStatus(a)).toBe('errors');
    });

    it('returns warnings for warning trace status', () => {
        const a = buildArtifact({
            generationTrace: {
                id: 't', source: 'on-demand', status: 'warning',
                startedAt: 'now', decisions: [], errors: [],
            },
        });
        expect(deriveArtifactStatus(a)).toBe('warnings');
    });

    it('returns persisted-remote when remote persistence succeeded', () => {
        const a = buildArtifact({
            generationTrace: {
                id: 't', source: 'on-demand', status: 'clean',
                startedAt: 'now', decisions: [], errors: [],
                persistence: { local: 'success', remote: 'success' },
            },
        });
        expect(deriveArtifactStatus(a)).toBe('persisted-remote');
    });

    it('returns pending-sync when remote is pending', () => {
        const a = buildArtifact({
            generationTrace: {
                id: 't', source: 'on-demand', status: 'clean',
                startedAt: 'now', decisions: [], errors: [],
                persistence: { local: 'success', remote: 'pending' },
            },
        });
        expect(deriveArtifactStatus(a)).toBe('pending-sync');
    });

    it('returns errors when there is a lastDiagramError', () => {
        const a = buildArtifact({ lastDiagramError: { reason: 'no-mermaid', attempt: 1, at: 'now' } });
        expect(deriveArtifactStatus(a)).toBe('errors');
    });
});

describe('ArtifactStatusBadge', () => {
    it('renders the label associated with the explicit status', () => {
        render(<ArtifactStatusBadge status="validated" />);
        expect(screen.getByText('Validado')).toBeInTheDocument();
    });

    it('renders an accessible label with description', () => {
        render(<ArtifactStatusBadge status="validated" />);
        const badge = screen.getByLabelText(/Estado: Validado/);
        expect(badge).toBeInTheDocument();
    });

    it('renders as a button when onClick is provided', () => {
        render(<ArtifactStatusBadge status="warnings" onClick={() => undefined} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('hides the label in compact mode', () => {
        render(<ArtifactStatusBadge status="validated" compact />);
        expect(screen.queryByText('Validado')).not.toBeInTheDocument();
        // But still accessible via aria-label.
        expect(screen.getByLabelText(/Validado/)).toBeInTheDocument();
    });
});
