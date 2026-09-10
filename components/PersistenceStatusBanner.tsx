import React from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export const PersistenceStatusBanner: React.FC = () => {
  const { persistenceStatus, persistenceMessage } = useAppContext();

  if (!persistenceMessage || persistenceStatus === 'ready') return null;

  const isSaving = persistenceStatus === 'saving';
  const isDegraded = persistenceStatus === 'degraded';
  const Icon = isSaving ? Loader2 : isDegraded ? CloudOff : persistenceStatus === 'error' ? AlertTriangle : CheckCircle2;
  const classes = isSaving
    ? 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950 dark:text-blue-100'
    : isDegraded
      ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-100'
      : 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900/60 dark:bg-rose-950 dark:text-rose-100';

  return (
    <div className={`mx-4 mt-3 rounded-xl border px-4 py-3 shadow-sm ${classes}`} role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 flex-none ${isSaving ? 'animate-spin' : ''}`} aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">
            {isSaving ? 'Guardando…' : isDegraded ? 'Pendiente de sincronizar' : 'Error al guardar'}
          </p>
          <p className="mt-0.5 text-sm opacity-90">{persistenceMessage}</p>
        </div>
      </div>
    </div>
  );
};
