import React from 'react';
import type { MemoryEntry, MemoryPriority } from '../../types';
import { MEMORY_PRIORITY_LABEL_ES } from '../../services/memory';
import { PencilIcon, TrashIcon, DocumentArrowUpIcon, XMarkIcon, CheckCircleIcon, ArrowPathIcon } from '../Icons';
import { PRIORITY_BADGE_CLASSES, buildPreviewMeta } from './memoryEntryModel';

import { EntryMetaLine, PrioritySelector } from './MemoryEntryViews';

interface ViewEntryProps { entry: MemoryEntry; isDerived: boolean; onEdit: () => void; onDelete: () => void; onBack: () => void; }
export const ViewEntry: React.FC<ViewEntryProps> = ({ entry, isDerived, onEdit, onDelete, onBack }) => {
    const { chars, words } = buildPreviewMeta(entry.text);
    return (
        <div className="flex flex-1 flex-col">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span>Detalle de la entrada</span>
                <span aria-hidden>·</span>
                <span>{chars.toLocaleString()} caracteres</span>
                <span aria-hidden>·</span>
                <span>{words.toLocaleString()} palabras</span>
                <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PRIORITY_BADGE_CLASSES[entry.priority]}`}>
                    Prioridad {MEMORY_PRIORITY_LABEL_ES[entry.priority]}
                </span>
                {isDerived && (
                    <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">Derivado</span>
                )}
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <EntryMetaLine entry={entry} />
            </div>
            <article className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-[15px] leading-relaxed text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100">
                <p className="whitespace-pre-wrap break-words">{entry.text}</p>
            </article>
            <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.05]">
                    Volver a la lista
                </button>
                {!isDerived && (
                    <>
                        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400">
                            <PencilIcon className="h-4 w-4" /> Modificar
                        </button>
                        <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 px-3 py-2 text-sm font-bold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10">
                            <TrashIcon className="h-4 w-4" /> Eliminar
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

interface EditEntryProps {
    draft: string;
    onChange: (value: string) => void;
    priority: MemoryPriority;
    onPriorityChange: (priority: MemoryPriority) => void;
    isSaving: boolean;
    onSave: () => void;
    onCancel: () => void;
}
export const EditEntry: React.FC<EditEntryProps> = ({ draft, onChange, priority, onPriorityChange, isSaving, onSave, onCancel }) => (
    <div className="flex flex-1 flex-col">
        <div className="mb-1 flex items-center justify-between">
            <label htmlFor="memory-edit-textarea" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Contenido</label>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{draft.length.toLocaleString()} caracteres</span>
        </div>
        <textarea
            id="memory-edit-textarea"
            value={draft}
            onChange={(event) => onChange(event.target.value)}
            rows={10}
            className="flex-1 resize-y rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-900 transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-white/10 dark:bg-gray-800 dark:text-white"
            placeholder="Edita el contenido de la entrada de memoria…"
        />
        <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Prioridad</span>
            <PrioritySelector value={priority} onChange={onPriorityChange} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.05]">
                Cancelar
            </button>
            <button type="button" onClick={onSave} disabled={isSaving} className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-500 dark:hover:bg-primary-400">
                {isSaving ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
                Guardar cambios
            </button>
        </div>
    </div>
);

interface CreateEntryProps {
    draft: string;
    onChange: (value: string) => void;
    priority: MemoryPriority;
    onPriorityChange: (priority: MemoryPriority) => void;
    isSaving: boolean;
    onSave: () => void;
    onCancel: () => void;
    onPickFile: () => void;
    isExtracting: boolean;
    extractedSuggestions: { value: string; accepted: boolean }[];
    extractionFileName: string | null;
    onUpdateSuggestion: (index: number, patch: Partial<{ value: string; accepted: boolean }>) => void;
    onClearSuggestions: () => void;
}

export const CreateEntry: React.FC<CreateEntryProps> = ({
    draft, onChange, priority, onPriorityChange, isSaving, onSave, onCancel, onPickFile, isExtracting,
    extractedSuggestions, extractionFileName, onUpdateSuggestion, onClearSuggestions,
}) => (
    <div className="flex flex-1 flex-col">
        <div className="mb-1 flex items-center justify-between">
            <label htmlFor="memory-create-textarea" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Contenido (opcional si vas a subir un documento)
            </label>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{draft.length.toLocaleString()} caracteres</span>
        </div>
        <textarea
            id="memory-create-textarea"
            value={draft}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
            className="resize-y rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-900 transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-white/10 dark:bg-gray-800 dark:text-white"
            placeholder="Digita la nota o apunte que quieres guardar como memoria…"
        />
        <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Prioridad</span>
            <PrioritySelector value={priority} onChange={onPriorityChange} />
            <span className="text-[11px] text-slate-500 dark:text-slate-400">(por omisión: media — aplica a todas las entradas que guardes ahora)</span>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-primary-300 bg-primary-50/40 p-4 dark:border-primary-500/30 dark:bg-primary-500/[0.06]">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-bold text-primary-900 dark:text-primary-100">Cargar desde documento</p>
                    <p className="mt-1 max-w-sm text-xs text-primary-800/80 dark:text-primary-200/80">
                        Sube un PDF, Word, Google Doc, texto o markdown. La IA analizará el contenido y propondrá los apuntes relevantes para guardar.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onPickFile}
                    disabled={isExtracting}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-500 dark:hover:bg-primary-400"
                >
                    {isExtracting ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <DocumentArrowUpIcon className="h-4 w-4" />}
                    {isExtracting ? 'Analizando…' : 'Subir documento'}
                </button>
            </div>
            {extractionFileName && !isExtracting && (
                <p className="mt-2 text-[11px] font-medium text-primary-800/70 dark:text-primary-200/70">
                    Documento analizado: <span className="font-bold">{extractionFileName}</span>
                </p>
            )}
        </div>

        {extractedSuggestions.length > 0 && (
            <div className="mt-3 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Apuntes propuestos por la IA</p>
                    <button type="button" onClick={onClearSuggestions} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                        <XMarkIcon className="inline h-3 w-3" /> Descartar todos
                    </button>
                </div>
                <ul className="space-y-2">
                    {extractedSuggestions.map((suggestion, idx) => (
                        <li key={idx} className={`rounded-xl border p-2.5 transition ${suggestion.accepted ? 'border-primary-300 bg-primary-50/50 dark:border-primary-500/30 dark:bg-primary-500/[0.08]' : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]'}`}>
                            <label className="flex items-start gap-2">
                                <input
                                    type="checkbox"
                                    checked={suggestion.accepted}
                                    onChange={(event) => onUpdateSuggestion(idx, { accepted: event.target.checked })}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                />
                                <textarea
                                    value={suggestion.value}
                                    onChange={(event) => onUpdateSuggestion(idx, { value: event.target.value })}
                                    rows={2}
                                    className="flex-1 resize-y rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-white/10 dark:bg-gray-800 dark:text-slate-100"
                                />
                            </label>
                        </li>
                    ))}
                </ul>
            </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.05]">
                Cancelar
            </button>
            <button type="button" onClick={onSave} disabled={isSaving || isExtracting} className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-500 dark:hover:bg-primary-400">
                {isSaving ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
                Guardar
            </button>
        </div>
    </div>
);
