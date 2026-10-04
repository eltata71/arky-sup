import React, { useEffect, useSyncExternalStore } from 'react';
import { aiChangeStore } from '../../services/artifacts/application/aiChangeSummary';
import { useAiChangeHighlight } from '../../hooks/artifacts/useAiChangeHighlight';
import { useAriaAnnouncer } from '../../hooks/useAriaAnnouncer';

/** Explica en una tarjeta qué cambió la IA en el último cambio (10.5). */
export const AiChangeCard: React.FC = () => {
  const change = useSyncExternalStore(aiChangeStore.subscribe, aiChangeStore.get);
  const { announce } = useAriaAnnouncer();
  useAiChangeHighlight(change?.touchedNodeIds ?? [], change?.id ?? null);

  useEffect(() => {
    if (change) announce(`La IA aplicó: ${change.headline}`);
  }, [change, announce]);

  if (!change) return null;
  return (
    <section
      aria-label="Qué cambió la IA"
      className="fixed bottom-20 left-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-primary-200 bg-white p-4 shadow-lg dark:border-primary-800 dark:bg-gray-900 md:left-24"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Qué cambió la IA</h2>
        <button
          type="button"
          onClick={() => aiChangeStore.clear(change.id)}
          className="rounded px-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-300"
        >
          Cerrar
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{change.headline}</p>
      {change.lines.length > 0 && (
        <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-4 text-xs text-gray-600 dark:text-gray-400">
          {change.lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      )}
    </section>
  );
};
