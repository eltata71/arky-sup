import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import { useState } from 'react';

interface GenerationPreviewProps {
  text: string;
  title: string;
}

/** Lienzo provisional: el contenido que llega, en sólo lectura y con cursor; nunca editable. */
export function GenerationPreview({ text, title }: GenerationPreviewProps) {
  const t = useUiTranslation();
  const [expanded, setExpanded] = useState(false);
  const cursor = <span aria-hidden="true" className="motion-safe:animate-pulse">▍</span>;
  return (
    <div className="mt-2">
      <pre
        data-generation-partial
        aria-label={t("ui.vista-previa-en-curso.536a40")}
        className={`${expanded ? 'max-h-[60vh]' : 'max-h-40'} overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200`}
      >
        {expanded ? text : text.slice(-1200)}{cursor}
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={t("uiTemplate.p0-la-vista-previa-de-p1.338778", { p0: String(expanded ? 'Reducir' : 'Ampliar'), p1: String(title) })}
        className="mt-1 text-xs text-primary-700 underline dark:text-primary-300"
      >
        {expanded ? t("uiExpr.reducir.0c6bd6") : t("uiExpr.ampliar.00686c")}
      </button>
    </div>
  );
}
