import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { ArtifactInspectorPanel } from '../../../components/artifacts/ArtifactInspectorPanel';
import type { Artifact } from '../../../types';

function buildArtifact(partial: Partial<Artifact> = {}): Artifact {
    return {
        id: 'a1',
        versionGroupId: 'g1',
        version: 2,
        createdAt: new Date().toISOString(),
        name: 'Documento de Arquitectura',
        type: 'markdown',
        phase: 'Diseño',
        architecturalView: 'Vista Lógica y de Diseño',
        content: '# Resumen\n\ntexto\n\n## Pendiente\n',
        objective: 'objetivo',
        keyConcepts: [],
        representation: 'document',
        ...partial,
    };
}

const author = { id: 'u1', name: 'Ada' };

describe('ArtifactInspectorPanel', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('renders the four core tabs', () => {
        render(<ArtifactInspectorPanel artifact={buildArtifact()} projectId="p1" author={author} />);
        expect(screen.getByRole('tab', { name: 'Estado' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Calidad' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Comentarios/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Revisión' })).toBeInTheDocument();
    });

    it('shows the Secciones tab for document artifacts', () => {
        render(<ArtifactInspectorPanel artifact={buildArtifact()} projectId="p1" author={author} />);
        expect(screen.getByRole('tab', { name: 'Secciones' })).toBeInTheDocument();
    });

    it('hides the Secciones tab for pure diagram artifacts', () => {
        const diagram = buildArtifact({ representation: 'diagram', type: 'mermaid-graph' });
        render(<ArtifactInspectorPanel artifact={diagram} projectId="p1" author={author} />);
        expect(screen.queryByRole('tab', { name: 'Secciones' })).not.toBeInTheDocument();
    });

    it('defaults to the Estado tab and shows artifact metadata', () => {
        render(<ArtifactInspectorPanel artifact={buildArtifact()} projectId="p1" author={author} />);
        expect(screen.getByText('v2')).toBeInTheDocument();
    });

    it('switches to the Comentarios tab and renders the thread composer', () => {
        render(<ArtifactInspectorPanel artifact={buildArtifact()} projectId="p1" author={author} />);
        fireEvent.click(screen.getByRole('tab', { name: /Comentarios/ }));
        expect(screen.getByRole('button', { name: 'Publicar comentario' })).toBeInTheDocument();
    });

    it('switches to the Calidad tab and renders the formal ArtifactQualityReport', () => {
        render(<ArtifactInspectorPanel artifact={buildArtifact()} projectId="p1" author={author} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Calidad' }));
        // The formal report is always available — no "missing metric" path.
        expect(screen.getByText('Reporte de calidad formal')).toBeInTheDocument();
        expect(screen.getByText(/Dimensiones evaluadas/)).toBeInTheDocument();
        expect(screen.getByText('Exportabilidad por familia')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('drills into a section comment thread from the outline', () => {
        render(<ArtifactInspectorPanel artifact={buildArtifact()} projectId="p1" author={author} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Secciones' }));
        // Click a heading from the document outline.
        fireEvent.click(screen.getByRole('button', { name: /Resumen/ }));
        // The section-scoped comment view appears with a back affordance.
        expect(screen.getByText('Comentando la sección')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Todas las secciones/ })).toBeInTheDocument();
        // Posting here anchors the comment to the section.
        fireEvent.change(screen.getByLabelText('Nuevo comentario'), { target: { value: 'Falta detalle' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publicar comentario' }));
        expect(screen.getByText('Falta detalle')).toBeInTheDocument();
    });

    it('returns from a section thread to the full outline', () => {
        render(<ArtifactInspectorPanel artifact={buildArtifact()} projectId="p1" author={author} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Secciones' }));
        fireEvent.click(screen.getByRole('button', { name: /Resumen/ }));
        fireEvent.click(screen.getByRole('button', { name: /Todas las secciones/ }));
        // Back to the outline — the progressbar is shown again.
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('derives the quality score from the formal report, not from generationTrace', () => {
        // generationTrace carries a stale score; the panel must ignore it and
        // surface the deterministic ArtifactQualityReport score instead.
        const scored = buildArtifact({
            generationTrace: {
                id: 't', source: 'on-demand', status: 'clean',
                startedAt: 'now', decisions: [], errors: [],
                quality: { score: 88, reachedTarget: false },
            },
        });
        render(<ArtifactInspectorPanel artifact={scored} projectId="p1" author={author} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Calidad' }));
        const progressbar = screen.getByRole('progressbar');
        const score = Number(progressbar.getAttribute('aria-valuenow'));
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        // The stale generationTrace value (88) is not what drives the panel.
        expect(progressbar.getAttribute('aria-valuenow')).not.toBe('88');
    });
});
