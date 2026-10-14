/**
 * La revisión aprobada sin crítica del especialista se ve como lo que es y se
 * confirma con un clic (plan de agentes, 17.1).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OfficeTask } from '../../services/architectureOffice';

const confirmReview = vi.fn(async () => ({ ok: true }));
const addToast = vi.fn();
vi.mock('../../context/OfficeContext', () => ({ useOffice: () => ({ confirmReview }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ t: (key: string, params?: Record<string, string>) => (params?.name ? `${key}:${params.name}` : key) }),
}));

import { EvidenceReviewConfirm } from '../../components/architectureOffice/EvidenceReviewConfirm';

const reviewTask = (overrides: Partial<OfficeTask> = {}): OfficeTask => ({
  id: 'r1',
  engagementId: 'eng-1',
  kind: 'review-artifact',
  title: 'Revisión',
  objective: '',
  assigneeId: 'elena',
  dependsOn: [],
  acceptanceCriteria: [],
  status: 'awaiting-review',
  attempts: 0,
  maxAttempts: 2,
  review: {
    reviewerId: 'elena',
    verdict: 'approved',
    basis: 'evidence-only',
    findings: [],
    summary: 'Sin crítica.',
    decidedAt: '2026-10-14T00:00:00.000Z',
  },
  ...overrides,
});

describe('EvidenceReviewConfirm', () => {
  it('dice que nadie revisó el contenido y confirma con un clic', async () => {
    render(<EvidenceReviewConfirm task={reviewTask()} />);
    expect(screen.getByText('reviewConfirm.notice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'reviewConfirm.action' }));
    await waitFor(() => expect(confirmReview).toHaveBeenCalledWith('eng-1', 'r1'));
    expect(addToast).toHaveBeenCalledWith('reviewConfirm.done', 'success');
  });

  it('confirmada, dice quién la firmó y ya no ofrece el botón', () => {
    const task = reviewTask({ status: 'completed' });
    task.review!.humanConfirmation = { by: { id: 'u', name: 'Ana', role: 'reviewer' }, at: '2026-10-14T01:00:00.000Z' };
    render(<EvidenceReviewConfirm task={task} />);
    expect(screen.getByText('reviewConfirm.confirmedBy:Ana')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('no aparece en una revisión hecha por el especialista', () => {
    const task = reviewTask();
    task.review!.basis = 'model-and-evidence';
    const { container } = render(<EvidenceReviewConfirm task={task} />);
    expect(container).toBeEmptyDOMElement();
  });
});
