import { useState } from 'react';

interface GenerationPreviewProps {
  text: string;
  title: string;
}

/** Lienzo provisional: el contenido que llega, en sólo lectura y con cursor; nunca editable. */
export function GenerationPreview({ text, title }: GenerationPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const cursor = <span aria-hidden="true" className="motion-safe:animate-pulse">▍</span>;
  return (
    <div className="mt-2">
      <pre
        data-generation-partial
        aria-label="Vista previa en curso"
        className={`${expanded ? 'max-h-[60vh]' : 'max-h-40'} overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200`}
      >
        {expanded ? text : text.slice(-1200)}{cursor}
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Reducir' : 'Ampliar'} la vista previa de ${title}`}
        className="mt-1 text-xs text-primary-700 underline dark:text-primary-300"
      >
        {expanded ? 'Reducir' : 'Ampliar'}
      </button>
    </div>
  );
}
