import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import React from 'react';
import { useAppContext } from '../../context/AppContext';
import type { MemoryEntry, MemoryPriority } from '../../types';
import { MEMORY_PRIORITIES, MEMORY_PRIORITY_LABEL_ES } from '../../services/memory';
import { PencilIcon, TrashIcon, EyeIcon, SparklesIcon, CpuChipIcon, MagnifyingGlassIcon } from '../Icons';
import { PRIORITY_BADGE_CLASSES, buildPreviewMeta, deriveEntryHeadline, formatEntryTimestamp, PREVIEW_LINES, type RenderableEntry } from './memoryEntryModel';

/** Selector compacto de prioridad (Alta/Media/Baja) usado en tarjetas y formularios. */
export const PrioritySelector: React.FC<{
    value: MemoryPriority;
    onChange: (priority: MemoryPriority) => void;
    disabled?: boolean;
    compact?: boolean;
}> = ({ value, onChange, disabled, compact }) => {
    const { t } = useAppContext();
    return (
    <div className={`inline-flex items-center gap-1 ${compact ? '' : 'rounded-xl border border-slate-200 p-1 dark:border-white/10'}`} role="group" aria-label={t('mem.priorityLabel')}>
        {MEMORY_PRIORITIES.map((priority) => {
            const isActive = priority === value;
            return (
                <button
                    key={priority}
                    type="button"
                    disabled={disabled}
                    onClick={() => { if (!isActive) onChange(priority); }}
                    title={t("uiTemplate.prioridad-p0.b54266", { p0: String(MEMORY_PRIORITY_LABEL_ES[priority].toLowerCase()) })}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        isActive
                            ? PRIORITY_BADGE_CLASSES[priority]
                            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-300'
                    }`}
                >
                    {MEMORY_PRIORITY_LABEL_ES[priority]}
                </button>
            );
        })}
    </div>
    );
};

/** Línea de metadatos de una nota: fecha/hora de creación y autor. */
export const EntryMetaLine: React.FC<{ entry: MemoryEntry }> = ({ entry }) => {
  const t = useUiTranslation();
    const created = formatEntryTimestamp(entry.createdAt);
    const updated = formatEntryTimestamp(entry.updatedAt ?? null);
    return (
        <>
            <span>{created ? t("uiTemplate.creada-p0.f388c4", { p0: String(created) }) : t("uiExpr.sin-fecha-nota-previa-al-reg.706410")}</span>
            {updated && (
                <>
                    <span aria-hidden>•</span>
                    <span>{t("ui.editada.c6b8ef")} {updated}</span>
                </>
            )}
            {entry.authorName && (
                <>
                    <span aria-hidden>•</span>
                    <span>{t("ui.por.34b983")} {entry.authorName}</span>
                </>
            )}
        </>
    );
};

interface ListViewProps {
    entries: RenderableEntry[];
    totalCount: number;
    search: string;
    onSearchChange: (value: string) => void;
    onView: (item: RenderableEntry) => void;
    onEdit: (item: RenderableEntry) => void;
    onDelete: (item: RenderableEntry) => void;
    onChangePriority: (item: RenderableEntry, priority: MemoryPriority) => void;
    scopeLabel: string;
    isArtifactSelectionMissing: boolean;
}

export const ListView: React.FC<ListViewProps> = ({
    entries, totalCount, search, onSearchChange, onView, onEdit, onDelete, onChangePriority, scopeLabel, isArtifactSelectionMissing,
}) => {
    const { t } = useAppContext();
    if (isArtifactSelectionMissing) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
                <CpuChipIcon className="h-10 w-10 text-slate-400" />
                <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">{t('mem.selectArtifact')}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('mem.selectArtifactHint')}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col min-h-0">
            <div className="relative mb-3">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder={t("uiTemplate.buscar-en-p0.813f98", { p0: String(scopeLabel) })}
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-white/10 dark:bg-gray-800 dark:text-white"
                />
            </div>

            {totalCount === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
                    <SparklesIcon className="h-10 w-10 text-slate-400" />
                    <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">{t('mem.noRecords')}</p>
                    <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{t('mem.noRecordsHint')}</p>
                </div>
            ) : entries.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">{t("ui.no-hay-resultados-para.3796f3")}{search}".</p>
            ) : (
                <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
                    {entries.map((item) => (
                        <MemoryCard
                            key={item.entry.id}
                            item={item}
                            onView={() => onView(item)}
                            onEdit={() => onEdit(item)}
                            onDelete={() => onDelete(item)}
                            onChangePriority={(priority) => onChangePriority(item, priority)}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
};

interface MemoryCardProps {
    item: RenderableEntry;
    onView: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onChangePriority: (priority: MemoryPriority) => void;
}

const MemoryCard: React.FC<MemoryCardProps> = ({ item, onView, onEdit, onDelete, onChangePriority }) => {
    const { t } = useAppContext();
    const { entry, isDerived } = item;
    const headline = deriveEntryHeadline(entry.text);
    const { chars, words, isLong } = buildPreviewMeta(entry.text);
    const body = entry.text.trim();

    return (
        <li className="group rounded-2xl border border-slate-200 bg-white p-3.5 transition hover:border-primary-300 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-primary-500/40">
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{headline}</p>
                        {isDerived && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">{t('mem.derived')}</span>
                        )}
                        <PrioritySelector value={entry.priority} onChange={onChangePriority} disabled={isDerived} compact />
                    </div>
                    <p
                        className="text-xs leading-relaxed text-slate-600 dark:text-slate-300"
                        style={{
                            display: '-webkit-box',
                            WebkitLineClamp: PREVIEW_LINES,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                        }}
                    >
                        {body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <EntryMetaLine entry={entry} />
                        <span aria-hidden>•</span>
                        <span>{chars.toLocaleString()} {t("ui.car.f1cd9d")}</span>
                        <span aria-hidden>•</span>
                        <span>{words.toLocaleString()} {t("ui.pal.7b6f04")}</span>
                        {isLong && (
                            <button
                                type="button"
                                onClick={onView}
                                className="font-bold text-primary-600 transition hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200"
                            >
                                {t("ui.ver-completo.2c8c74")}
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <ActionButton label={t('mem.view')} icon={<EyeIcon className="h-4 w-4" />} onClick={onView} />
                    <ActionButton label={t('mem.edit')} icon={<PencilIcon className="h-4 w-4" />} onClick={onEdit} disabled={isDerived} />
                    <ActionButton label={t('mem.delete')} icon={<TrashIcon className="h-4 w-4" />} onClick={onDelete} variant="danger" disabled={isDerived} />
                </div>
            </div>
        </li>
    );
};

const ActionButton: React.FC<{ label: string; icon: React.ReactNode; onClick: () => void; variant?: 'default' | 'danger'; disabled?: boolean }> = ({ label, icon, onClick, variant = 'default', disabled }) => { const t = useUiTranslation(); return (
    <button
        type="button"
        onClick={onClick}
        aria-label={disabled ? t("uiTemplate.p0-no-disponible.f2688b", { p0: String(label) }) : label}
        disabled={disabled}
        className={`rounded-lg p-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
            variant === 'danger'
                ? 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white'
        }`}
    >
        {icon}
    </button>
); };
