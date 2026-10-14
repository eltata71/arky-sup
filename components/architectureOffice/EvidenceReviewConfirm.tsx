import React, { useCallback, useState } from 'react';
import { ShieldQuestion } from 'lucide-react';
import { useOffice } from '../../context/OfficeContext';
import { useToast } from '../../context/ToastContext';
import { useAppContext } from '../../context/AppContext';
import type { OfficeTask } from '../../services/architectureOffice';
import { Button } from '../ui';

interface EvidenceReviewConfirmProps {
  task: OfficeTask;
}

/**
 * Una revisión aprobada sin la crítica del especialista (plan de agentes, 17.1).
 *
 * Dice que nadie revisó el contenido —sólo la evidencia determinista— y deja
 * que una persona lo confirme con su nombre. Una vez confirmada, dice quién y
 * cuándo: la firma es lo que la diferencia de una revisión hecha.
 */
export const EvidenceReviewConfirm: React.FC<EvidenceReviewConfirmProps> = ({ task }) => {
  const { confirmReview } = useOffice();
  const { addToast } = useToast();
  const { t } = useAppContext();
  const [busy, setBusy] = useState(false);
  const review = task.review;

  const confirm = useCallback(async () => {
    setBusy(true);
    const result = await confirmReview(task.engagementId, task.id);
    setBusy(false);
    addToast(
      result.ok ? t('reviewConfirm.done') : result.reason ?? t('reviewConfirm.failed'),
      result.ok ? 'success' : 'error',
    );
  }, [confirmReview, task.engagementId, task.id, addToast, t]);

  if (!review || review.basis !== 'evidence-only' || review.verdict !== 'approved') return null;

  if (review.humanConfirmation) {
    return (
      <p className="text-2xs text-gray-500 dark:text-gray-400">
        {t('reviewConfirm.confirmedBy', { name: review.humanConfirmation.by.name })}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 dark:border-amber-900/60 dark:bg-amber-950/30">
      <ShieldQuestion className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
      <span className="min-w-0 flex-1 text-2xs text-amber-800 dark:text-amber-200">{t('reviewConfirm.notice')}</span>
      {task.status === 'awaiting-review' && (
        <Button variant="secondary" size="sm" onClick={() => { void confirm(); }} disabled={busy}>
          {t('reviewConfirm.action')}
        </Button>
      )}
    </div>
  );
};

export default EvidenceReviewConfirm;
