import React from 'react';
import { ExclamationTriangleIcon } from '../../Icons';

interface DiagramErrorPanelProps {
  title: string;
  body: string;
  onRetry?: () => void;
  onViewText?: () => void;
  onAutoFix?: () => void;
  mermaidSource?: string | null;
}

/** Attempts to extract an offending line number from a mermaid/parse error. */
const extractMermaidErrorLine = (message: string | null | undefined): number | null => {
  if (!message) return null;
  const m = message.match(/\bline\s+(\d+)\b/i) ?? message.match(/\(\s*(\d+)\s*:/i);
  return m ? Number(m[1]) : null;
};

/** Slice a source text around the offending line for quick visual triage. */
const sliceMermaidContext = (
  source: string | null,
  line: number | null,
  radius = 2,
): Array<{ n: number; text: string; offending: boolean }> | null => {
  if (!source || !line || line < 1) return null;
  const lines = source.split('\n');
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line - 1 + radius + 1);
  return lines.slice(start, end).map((text, idx) => {
    const n = start + idx + 1;
    return { n, text, offending: n === line };
  });
};

export const DiagramErrorPanel: React.FC<DiagramErrorPanelProps> = ({
  title,
  body,
  onRetry,
  onViewText,
  onAutoFix,
  mermaidSource,
}) => {
  const line = extractMermaidErrorLine(body);
  const ctx = sliceMermaidContext(mermaidSource ?? null, line);
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
        <ExclamationTriangleIcon className="w-8 h-8 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="max-w-md">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-line">{body}</p>
        {line && <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">Línea probable: {line}</p>}
        {ctx && (
          <pre className="mt-3 text-left text-[11px] font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 overflow-x-auto">
            {ctx.map(({ n, text, offending }) => (
              <div
                key={n}
                className={offending ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}
              >
                {String(n).padStart(3, ' ')} │ {text || ' '}
              </div>
            ))}
          </pre>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onAutoFix && (
          <button
            onClick={onAutoFix}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg shadow-sm"
          >
            Auto-Reparar
          </button>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg shadow-sm"
          >
            Reintentar
          </button>
        )}
        {onViewText && (
          <button
            onClick={onViewText}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-sm font-medium rounded-lg"
          >
            Ver como documento
          </button>
        )}
      </div>
    </div>
  );
};

export default DiagramErrorPanel;
