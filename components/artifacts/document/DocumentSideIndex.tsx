import React from 'react';
import type { DocumentTocEntry } from '../../../hooks/artifacts/useDocumentRendering';
import { DOCUMENT_TYPE } from '../../../lib/designTokens';
import { useOptionalAppContext } from '../../../context/AppContext';

interface DocumentSideIndexProps {
  toc: DocumentTocEntry[];
  activeId: string | null;
  onNavigate: (id: string) => void;
}

/** Fixed index beside the paper: the heading hierarchy, with the section being read marked. */
export const DocumentSideIndex: React.FC<DocumentSideIndexProps> = ({ toc, activeId, onNavigate }) => {
  const t = useOptionalAppContext()?.t;
  return (
  <nav
    aria-label={t?.('doc.index.label') ?? 'Índice del documento'}
    className="hidden lg:block w-56 shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60 py-4 pl-3 pr-2"
  >
    <p className={`${DOCUMENT_TYPE.indexLabel} px-2 mb-2`}>{t?.('doc.index.title') ?? 'Contenido'}</p>
    <ol className="space-y-0.5">
      {toc.map((entry) => {
        const active = entry.id === activeId;
        return (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              aria-current={active ? 'location' : undefined}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(entry.id);
              }}
              className={`block rounded-lg px-2 py-1.5 text-[12px] leading-snug transition-colors border-l-2 ${
                entry.level === 1 ? 'font-semibold' : entry.level === 2 ? 'pl-4' : 'pl-6 text-[11.5px]'
              } ${
                active
                  ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                  : 'border-transparent text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {entry.text}
            </a>
          </li>
        );
      })}
    </ol>
  </nav>
  );
};

export default DocumentSideIndex;
