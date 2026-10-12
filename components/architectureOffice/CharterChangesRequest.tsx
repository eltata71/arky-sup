import React, { useCallback, useState } from 'react';
import { MessageSquareWarning } from 'lucide-react';
import { useOffice } from '../../context/OfficeContext';
import { useToast } from '../../context/ToastContext';
import { useAppContext } from '../../context/AppContext';
import { Button } from '../ui';
import { Modal } from '../ui/Modal';

interface CharterChangesRequestProps {
  engagementId: string;
}

export const CharterChangesRequest: React.FC<CharterChangesRequestProps> = ({ engagementId }) => {
  const { requestCharterChanges } = useOffice();
  const { addToast } = useToast();
  const { t } = useAppContext();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setReason('');
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    const result = await requestCharterChanges(engagementId, reason);
    setBusy(false);
    addToast(
      result.ok ? t('charterChanges.sent') : result.reason ?? t('charterChanges.failed'),
      result.ok ? 'success' : 'error',
    );
    if (result.ok) close();
  }, [engagementId, reason, requestCharterChanges, addToast, close, t]);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <MessageSquareWarning className="mr-1.5 h-4 w-4" aria-hidden />
        {t('charterChanges.open')}
      </Button>
      <Modal isOpen={open} onClose={close} widthClass="max-w-lg">
        {({ titleId }) => (
          <div className="space-y-3">
            <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
              {t('charterChanges.title')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('charterChanges.help')}</p>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-100">
              {t('charterChanges.reasonLabel')}
              <textarea
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2 text-sm dark:border-gray-600 dark:bg-gray-900"
                rows={4}
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={close}>
                {t('charterChanges.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={submit} loading={busy} disabled={reason.trim() === ''}>
                {t('charterChanges.send')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
