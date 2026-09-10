import React, { useMemo } from 'react';
import { Badge, EmptyState } from '../ui';
import { DocumentTextIcon, ExclamationTriangleIcon } from '../Icons';
import { extractOutline, OutlineSection } from '../../utils/markdownOutline';

interface DocumentOutlineProps {
    /** Raw markdown content of the document artifact. */
    content: string;
    /** Optional map of sectionId -> open comment count. */
    commentCounts?: Record<string, number>;
    /** Invoked when the user activates a section (e.g. to scroll the document). */
    onNavigate?: (section: OutlineSection) => void;
    /** Currently-focused section id (for highlight). */
    activeSectionId?: string;
}

/**
 * Table of contents for a document artifact. Renders heading hierarchy,
 * a completion estimate, empty-section warnings and per-section comment
 * counts. Section activation is delegated to the parent via `onNavigate`
 * so the same component works with paginated and continuous document views.
 */
export const DocumentOutline: React.FC<DocumentOutlineProps> = ({
    content,
    commentCounts,
    onNavigate,
    activeSectionId,
}) => {
    const { sections, completion } = useMemo(() => extractOutline(content), [content]);
    const emptyCount = useMemo(() => sections.filter((s) => s.isEmpty).length, [sections]);
    const completionPct = Math.round(completion * 100);

    if (sections.length === 0) {
        return (
            <EmptyState
                icon={<DocumentTextIcon className="h-5 w-5" />}
                title="Sin estructura de secciones"
                description="Este documento no tiene encabezados Markdown. Agrega títulos (#, ##, ###) para habilitar la navegación por secciones."
            />
        );
    }

    return (
        <nav className="flex flex-col gap-3" aria-label="Tabla de contenido del documento">
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-medium text-gray-600 dark:text-gray-300">Completitud</span>
                    <span className="tabular-nums font-semibold text-gray-900 dark:text-white">{completionPct}%</span>
                </div>
                <div
                    className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={completionPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Completitud del documento: ${completionPct}%`}
                >
                    <div
                        className={
                            'h-full rounded-full ' +
                            (completionPct >= 80 ? 'bg-green-500' : completionPct >= 50 ? 'bg-amber-500' : 'bg-red-500')
                        }
                        style={{ width: `${completionPct}%` }}
                    />
                </div>
                {emptyCount > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-300">
                        <ExclamationTriangleIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                        {emptyCount} sección{emptyCount === 1 ? '' : 'es'} sin contenido por completar
                    </p>
                )}
            </div>

            <ol className="flex flex-col gap-0.5">
                {sections.map((section) => {
                    const count = commentCounts?.[section.id] ?? 0;
                    const isActive = section.id === activeSectionId;
                    return (
                        <li key={section.id}>
                            <button
                                type="button"
                                onClick={() => onNavigate?.(section)}
                                aria-current={isActive ? 'true' : undefined}
                                className={
                                    'group w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ' +
                                    (isActive
                                        ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300'
                                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800')
                                }
                                style={{ paddingLeft: `${0.5 + (section.level - 1) * 0.75}rem` }}
                            >
                                <span className="flex-1 truncate">{section.title}</span>
                                {section.isEmpty && (
                                    <span
                                        className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0"
                                       
                                        aria-label="Sección vacía"
                                    />
                                )}
                                {count > 0 && (
                                    <Badge tone="warning" size="xs" aria-label={`${count} comentarios abiertos`}>
                                        {count}
                                    </Badge>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};

export default DocumentOutline;
