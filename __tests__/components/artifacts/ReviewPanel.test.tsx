import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { ReviewPanel } from '../../../components/artifacts/ReviewPanel';
import { artifactReviewService } from '../../../services/review/artifactReviewService';

const author = { id: 'u1', name: 'Ada' };

/**
 * Approval and rejection are decisions, so they only follow a request for
 * review — see `services/review/reviewTransitions.ts`. These helpers walk the
 * artifact to the state a test needs instead of teleporting it there.
 */
const submitForReview = () =>
    fireEvent.click(screen.getByRole('button', { name: /Enviar a revisión/ }));

describe('ReviewPanel', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('shows the draft status by default', () => {
        render(<ReviewPanel artifactId="a1" projectId="p1" author={author} />);
        expect(screen.getByLabelText(/Borrador/)).toBeInTheDocument();
    });

    it('records a decision when a no-rationale transition is chosen', () => {
        const onChange = vi.fn();
        render(<ReviewPanel artifactId="a1" projectId="p1" author={author} onStatusChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /Enviar a revisión/ }));
        expect(onChange).toHaveBeenCalledWith('pending-review');
        expect(artifactReviewService.latestStatus('a1')).toBe('pending-review');
    });

    it('only offers legal transitions for the current status', () => {
        render(<ReviewPanel artifactId="a1" projectId="p1" author={author} />);
        // A draft can only be submitted; approving or rejecting something
        // nobody submitted is not a move the panel should invite.
        expect(screen.getByRole('button', { name: /Enviar a revisión/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Aprobar/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Rechazar/ })).not.toBeInTheDocument();

        submitForReview();
        expect(screen.getByRole('button', { name: /Aprobar/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Rechazar/ })).toBeInTheDocument();
    });

    it('requires a rationale before rejecting', () => {
        const onChange = vi.fn();
        render(<ReviewPanel artifactId="a1" projectId="p1" author={author} onStatusChange={onChange} />);
        submitForReview();
        onChange.mockClear();
        fireEvent.click(screen.getByRole('button', { name: /Rechazar/ }));
        // No decision yet — waiting for rationale.
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText(/Escribe una justificación/)).toBeInTheDocument();
    });

    it('completes a rejection once a rationale is supplied', () => {
        const onChange = vi.fn();
        render(<ReviewPanel artifactId="a1" projectId="p1" author={author} onStatusChange={onChange} />);
        submitForReview();
        fireEvent.click(screen.getByRole('button', { name: /Rechazar/ }));
        fireEvent.change(screen.getByLabelText(/Justificación/), { target: { value: 'No cumple NFR' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
        expect(onChange).toHaveBeenCalledWith('rejected');
        expect(artifactReviewService.latestStatus('a1')).toBe('rejected');
    });

    it('renders the decision log after a transition', () => {
        render(<ReviewPanel artifactId="a1" projectId="p1" author={author} />);
        submitForReview();
        fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));
        // The decision log lists the new status.
        expect(screen.getAllByLabelText(/Aprobado/).length).toBeGreaterThan(0);
    });

    it('reflects an existing persisted status from the service', () => {
        artifactReviewService.recordDecision({ artifactId: 'a1', projectId: 'p1', status: 'pending-review', author });
        artifactReviewService.recordDecision({ artifactId: 'a1', projectId: 'p1', status: 'approved', author });
        render(<ReviewPanel artifactId="a1" projectId="p1" author={author} />);
        expect(screen.getByText(/aprobado y listo/i)).toBeInTheDocument();
    });
});
