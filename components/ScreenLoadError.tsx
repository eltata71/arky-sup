import React, { useState } from 'react';
// By file: the ui barrel would drag Tabs and SafeRichText into every route that can fail.
import { LoadErrorState } from './ui/LoadErrorState';
import { useOptionalObservability } from '../context/ObservabilityContext';
import { useUiText } from '../hooks/useUiText';

export interface ScreenLoadErrorProps {
  /** What could not be read, as the sentence will say it: «las iniciativas». */
  subject: string;
  /** The cause as the repository reported it. */
  error: string;
  onRetry: () => void | Promise<void>;
  className?: string;
}

/**
 * The error state of a screen whose data did not arrive (13.4): what failed,
 * «Reintentar», and «Ver diagnóstico», which opens the global observability
 * centre where the failure was recorded.
 */
export const ScreenLoadError: React.FC<ScreenLoadErrorProps> = ({ subject, error, onRetry, className }) => {
  const t = useUiText();
  const observability = useOptionalObservability();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <LoadErrorState
      className={className}
      title={t('load.errorTitle', { subject })}
      description={t('load.errorHint')}
      detail={error}
      retryLabel={retrying ? t('load.retrying') : t('load.retry')}
      onRetry={() => { void retry(); }}
      retrying={retrying}
      diagnoseLabel={observability ? t('load.diagnose') : undefined}
      onDiagnose={observability?.openCenter}
    />
  );
};

export default ScreenLoadError;
