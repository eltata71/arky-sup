import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext, type Project } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { type ChatMessage, groupMessagesIntoSessions, filterSessions, getSessionTitle, removeMessagesById, spliceCompactionMarker, createChatMessage, deterministicCompactionDigest, type ChatSession, type ChatHistoryFilters } from '../../services/chat';
import {
    MagnifyingGlassIcon,
    TrashIcon,
    ArrowsPointingInIcon,
    ArrowPathIcon,
    CheckCircleIcon,
    EyeIcon,
    XMarkIcon,
} from '../Icons';
import { compactChatMessages } from '../../services/ai';
import { ConfirmDialog } from '../ConfirmDialog';

interface ChatHistoryPanelProps {
    project: Project;
}

type RoleFilter = 'all' | 'user' | 'model';

interface PreviewState {
    session: ChatSession;
}

const DATE_INPUT_FORMAT = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const QUICK_RANGES = [
    { label: 'Hoy', getRange: () => ({ from: DATE_INPUT_FORMAT(new Date()), to: DATE_INPUT_FORMAT(new Date()) }) },
    { label: 'Ayer', getRange: () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return { from: DATE_INPUT_FORMAT(d), to: DATE_INPUT_FORMAT(d) };
    } },
    { label: 'Últimos 7 días', getRange: () => {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 6);
        return { from: DATE_INPUT_FORMAT(from), to: DATE_INPUT_FORMAT(to) };
    } },
    { label: 'Últimos 30 días', getRange: () => {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 29);
        return { from: DATE_INPUT_FORMAT(from), to: DATE_INPUT_FORMAT(to) };
    } },
];

const formatTime = (iso: string): string => {
    if (!iso || iso.startsWith('1970-')) return 'Sin fecha';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Sin fecha';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const formatDay = (day: string): string => {
    if (day === 'sin-fecha') return 'Sin fecha';
    const [y, m, d] = day.split('-').map(Number);
    if (!y) return day;
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
};

/**
 * Memory Center · Chat History panel.
 *
 * Loads the project chat history, groups it into logical sessions, and lets
 * the user search/filter/select sessions to either delete them or compact
 * them (the Arquitecto Agente summarises the selection into a single
 * compaction marker that replaces the originals).
 *
 * Read flow:
 *   - On mount we load the persisted history via AppContext, then group it
 *     into sessions in memory. We never mutate the source messages — every
 *     destructive op produces a new array that's persisted via
 *     `replaceChatHistory`.
 *
 * The UI is intentionally self-contained: it shows its own loading,
 * empty-state and progress indicators so the parent `MemoryCenterModal`
 * doesn't have to coordinate.
 */
export const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({ project }) => {
    const { loadChatHistory, replaceChatHistory, settings } = useAppContext();
    const { addToast } = useToast();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [filters, setFilters] = useState<ChatHistoryFilters>({ role: 'all' });
    const [searchInput, setSearchInput] = useState('');
    const [busyAction, setBusyAction] = useState<'delete' | 'compact' | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [preview, setPreview] = useState<PreviewState | null>(null);

    // ── Load history ────────────────────────────────────────────────────────
    const refresh = useCallback(async () => {
        setIsLoading(true);
        try {
            const history = await loadChatHistory(project.id);
            setMessages(history);
        } finally {
            setIsLoading(false);
        }
    }, [loadChatHistory, project.id]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Debounce the search input → filters.query (250ms).
    useEffect(() => {
        const handle = window.setTimeout(() => {
            setFilters((curr) => ({ ...curr, query: searchInput || undefined }));
        }, 250);
        return () => window.clearTimeout(handle);
    }, [searchInput]);

    // ── Derive sessions ─────────────────────────────────────────────────────
    const sessions = useMemo(() => groupMessagesIntoSessions(messages), [messages]);
    const filtered = useMemo(() => filterSessions(sessions, filters), [sessions, filters]);

    const sessionsByDay = useMemo(() => {
        const map = new Map<string, ChatSession[]>();
        for (const session of filtered) {
            const list = map.get(session.day) ?? [];
            list.push(session);
            map.set(session.day, list);
        }
        // Newest day first.
        return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
    }, [filtered]);

    const totals = useMemo(() => {
        const totalMessages = messages.length;
        const totalSessions = sessions.length;
        const filteredSessions = filtered.length;
        const filteredMessages = filtered.reduce((sum, s) => sum + s.messages.length, 0);
        return { totalMessages, totalSessions, filteredSessions, filteredMessages };
    }, [messages, sessions, filtered]);

    // ── Selection helpers ───────────────────────────────────────────────────
    const isSessionFullySelected = useCallback(
        (session: ChatSession): boolean =>
            session.messages.every((m) => m.id && selectedIds.has(m.id)),
        [selectedIds],
    );
    const isSessionPartiallySelected = useCallback(
        (session: ChatSession): boolean =>
            !isSessionFullySelected(session) && session.messages.some((m) => m.id && selectedIds.has(m.id)),
        [selectedIds, isSessionFullySelected],
    );

    const toggleSession = useCallback((session: ChatSession) => {
        setSelectedIds((curr) => {
            const next = new Set(curr);
            const fully = session.messages.every((m) => m.id && next.has(m.id));
            for (const m of session.messages) {
                if (!m.id) continue;
                if (fully) next.delete(m.id);
                else next.add(m.id);
            }
            return next;
        });
    }, []);

    const toggleAllVisible = useCallback(() => {
        const allIds = filtered.flatMap((s) => s.messages.map((m) => m.id).filter((id): id is string => !!id));
        setSelectedIds((curr) => {
            const allSelected = allIds.every((id) => curr.has(id));
            if (allSelected) {
                const next = new Set(curr);
                for (const id of allIds) next.delete(id);
                return next;
            }
            return new Set([...curr, ...allIds]);
        });
    }, [filtered]);

    const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

    // ── Filters ─────────────────────────────────────────────────────────────
    const applyQuickRange = (range: { from: string; to: string }) => {
        setFilters((curr) => ({ ...curr, fromDate: range.from, toDate: range.to }));
    };

    const clearFilters = () => {
        setFilters({ role: 'all' });
        setSearchInput('');
    };

    // ── Destructive actions ─────────────────────────────────────────────────
    const requestBulkDelete = useCallback(() => {
        if (selectedIds.size === 0 || busyAction) return;
        setDeleteConfirmOpen(true);
    }, [selectedIds, busyAction]);

    const handleBulkDelete = useCallback(async () => {
        setDeleteConfirmOpen(false);
        if (selectedIds.size === 0 || busyAction) return;
        setBusyAction('delete');
        try {
            const next = removeMessagesById(messages, selectedIds);
            const ok = await replaceChatHistory(project.id, next);
            if (!ok) {
                addToast('No se pudo eliminar el historial. Reintenta en unos segundos.', 'error');
                return;
            }
            setMessages(next);
            setSelectedIds(new Set());
            addToast(`Se eliminaron ${selectedIds.size} mensaje(s) del historial.`, 'success');
        } finally {
            setBusyAction(null);
        }
    }, [selectedIds, busyAction, messages, replaceChatHistory, project.id, addToast]);

    const handleBulkCompact = useCallback(async () => {
        if (selectedIds.size === 0 || busyAction) return;
        // The selection has to be contiguous within at least one session to
        // produce a clean replacement. We don't enforce that strictly here
        // because users may want to compact across days — instead we sort the
        // selected messages and let the marker take the first slot.
        const selectedMessages = messages.filter((m) => m.id && selectedIds.has(m.id));
        if (selectedMessages.length === 0) return;
        setBusyAction('compact');
        try {
            let digest = await compactChatMessages(selectedMessages, settings);
            const usedFallback = !digest;
            if (!digest) digest = deterministicCompactionDigest(selectedMessages);

            const startedAt = selectedMessages[0].timestamp ?? new Date().toISOString();
            const endedAt = selectedMessages[selectedMessages.length - 1].timestamp ?? new Date().toISOString();

            const renderedSummary = [
                `📦 **${digest.title}**`,
                '',
                digest.summary,
                digest.decisions.length > 0 ? `\n**Decisiones**\n${digest.decisions.map((d) => `- ${d}`).join('\n')}` : '',
                digest.openQuestions.length > 0 ? `\n**Pendientes**\n${digest.openQuestions.map((q) => `- ${q}`).join('\n')}` : '',
                digest.topics.length > 0 ? `\n_Temas: ${digest.topics.join(' · ')}_` : '',
            ]
                .filter(Boolean)
                .join('\n');

            const marker = createChatMessage('model', renderedSummary, {
                meta: {
                    kind: 'compaction',
                    compactedCount: selectedMessages.length,
                    compactedRange: { start: startedAt, end: endedAt },
                    compactedTopics: digest.topics,
                },
            });

            const next = spliceCompactionMarker(messages, selectedIds, marker);
            const ok = await replaceChatHistory(project.id, next);
            if (!ok) {
                addToast('No se pudo guardar la compactación. Reintenta en unos segundos.', 'error');
                return;
            }
            setMessages(next);
            setSelectedIds(new Set());
            addToast(
                usedFallback
                    ? `Se compactaron ${selectedMessages.length} mensaje(s) con resumen determinístico (la IA no estuvo disponible).`
                    : `Se compactaron ${selectedMessages.length} mensaje(s) en una sola entrada.`,
                usedFallback ? 'warning' : 'success',
            );
        } finally {
            setBusyAction(null);
        }
    }, [selectedIds, busyAction, messages, settings, replaceChatHistory, project.id, addToast]);

    // ── Render ──────────────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500 dark:text-slate-400" role="status">
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                Cargando historial de chat…
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Header stats + selection actions */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{totals.totalSessions}</span> sesion(es) ·{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{totals.totalMessages}</span> mensaje(s) ·{' '}
                    {totals.filteredSessions < totals.totalSessions && (
                        <span>filtrando {totals.filteredSessions} sesion(es)</span>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void refresh()}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                        <ArrowPathIcon className="h-3.5 w-3.5" />
                        Refrescar
                    </button>
                    <button
                        type="button"
                        onClick={toggleAllVisible}
                        disabled={filtered.length === 0}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                        Seleccionar visibles
                    </button>
                    {selectedIds.size > 0 && (
                        <button
                            type="button"
                            onClick={clearSelection}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                            <XMarkIcon className="h-3.5 w-3.5" />
                            Limpiar selección
                        </button>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-white/[0.03] sm:grid-cols-12">
                <div className="sm:col-span-5">
                    <label htmlFor="chat-history-query" className="sr-only">Buscar</label>
                    <div className="relative">
                        <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                            id="chat-history-query"
                            type="search"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Buscar por palabra clave…"
                            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                        />
                    </div>
                </div>
                <div className="sm:col-span-3">
                    <label htmlFor="chat-history-from" className="block text-2xs font-semibold uppercase tracking-widest text-slate-500">Desde</label>
                    <input
                        id="chat-history-from"
                        type="date"
                        value={filters.fromDate ?? ''}
                        onChange={(e) => setFilters((c) => ({ ...c, fromDate: e.target.value || undefined }))}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white py-1 px-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                    />
                </div>
                <div className="sm:col-span-3">
                    <label htmlFor="chat-history-to" className="block text-2xs font-semibold uppercase tracking-widest text-slate-500">Hasta</label>
                    <input
                        id="chat-history-to"
                        type="date"
                        value={filters.toDate ?? ''}
                        onChange={(e) => setFilters((c) => ({ ...c, toDate: e.target.value || undefined }))}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white py-1 px-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                    />
                </div>
                <div className="sm:col-span-1 flex items-end justify-end">
                    <button
                        type="button"
                        onClick={clearFilters}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-2xs font-medium text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                        Limpiar
                    </button>
                </div>
                <div className="sm:col-span-12 flex flex-wrap items-center gap-1.5">
                    {QUICK_RANGES.map((range) => (
                        <button
                            key={range.label}
                            type="button"
                            onClick={() => applyQuickRange(range.getRange())}
                            className="inline-flex items-center rounded-full border border-slate-200 px-2 py-0.5 text-2xs font-medium text-slate-600 hover:border-primary-300 hover:bg-primary-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                            {range.label}
                        </button>
                    ))}
                    <label className="ml-2 flex items-center gap-1.5 text-2xs font-medium text-slate-600 dark:text-slate-300">
                        <span>Rol</span>
                        <select
                            value={filters.role ?? 'all'}
                            onChange={(e) => setFilters((c) => ({ ...c, role: e.target.value as RoleFilter }))}
                            className="rounded-md border border-slate-200 bg-white py-0.5 px-1 text-2xs text-slate-700 focus:border-primary-500 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-slate-200"
                        >
                            <option value="all">Todos</option>
                            <option value="user">Usuario</option>
                            <option value="model">Arquitecto Agente</option>
                        </select>
                    </label>
                    <label className="flex items-center gap-1 text-2xs font-medium text-slate-600 dark:text-slate-300">
                        <input
                            type="checkbox"
                            checked={!!filters.onlyCompacted}
                            onChange={(e) => setFilters((c) => ({ ...c, onlyCompacted: e.target.checked || undefined, onlyUncompacted: undefined }))}
                            className="accent-primary-600"
                        />
                        Sólo compactados
                    </label>
                    <label className="flex items-center gap-1 text-2xs font-medium text-slate-600 dark:text-slate-300">
                        <input
                            type="checkbox"
                            checked={!!filters.onlyUncompacted}
                            onChange={(e) => setFilters((c) => ({ ...c, onlyUncompacted: e.target.checked || undefined, onlyCompacted: undefined }))}
                            className="accent-primary-600"
                        />
                        Sólo sin compactar
                    </label>
                </div>
            </div>

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
                <div role="region" aria-label="Acciones masivas" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary-200 bg-primary-50/70 px-3 py-2 dark:border-primary-700/50 dark:bg-primary-900/20">
                    <div className="text-xs font-semibold text-primary-700 dark:text-primary-200">
                        {selectedIds.size} mensaje(s) seleccionado(s)
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleBulkCompact()}
                            disabled={!!busyAction}
                            className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                        >
                            {busyAction === 'compact' ? (
                                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <ArrowsPointingInIcon className="h-3.5 w-3.5" />
                            )}
                            Compactar selección
                        </button>
                        <button
                            type="button"
                            onClick={requestBulkDelete}
                            disabled={!!busyAction}
                            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                            {busyAction === 'delete' ? (
                                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <TrashIcon className="h-3.5 w-3.5" />
                            )}
                            Eliminar selección
                        </button>
                    </div>
                </div>
            )}

            {/* Empty state */}
            {sessions.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                    Aún no hay historial de chat para este proyecto.
                </div>
            )}
            {sessions.length > 0 && filtered.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                    Ningún chat coincide con los filtros actuales.
                </div>
            )}

            {/* Sessions grouped by day */}
            <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                {sessionsByDay.map(([day, daySessions]) => (
                    <section key={day}>
                        <header className="sticky top-0 z-10 -mx-1 mb-1 bg-white/95 px-1 py-1 text-2xs font-bold uppercase tracking-widest text-slate-500 backdrop-blur dark:bg-slate-900/95 dark:text-slate-400">
                            {formatDay(day)} · {daySessions.length} sesion(es)
                        </header>
                        <div className="space-y-1.5">
                            {daySessions.map((session) => {
                                const fullySelected = isSessionFullySelected(session);
                                const partiallySelected = isSessionPartiallySelected(session);
                                return (
                                    <SessionRow
                                        key={session.id}
                                        session={session}
                                        fullySelected={fullySelected}
                                        partiallySelected={partiallySelected}
                                        onToggle={() => toggleSession(session)}
                                        onPreview={() => setPreview({ session })}
                                    />
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>

            {/* Session preview overlay */}
            {preview && (
                <SessionPreview
                    session={preview.session}
                    onClose={() => setPreview(null)}
                />
            )}

            <ConfirmDialog
                isOpen={deleteConfirmOpen}
                title="Eliminar mensajes"
                message={`Se eliminarán ${selectedIds.size} mensaje(s) del historial de este proyecto. La acción no se puede deshacer.`}
                confirmLabel="Eliminar"
                variant="danger"
                onConfirm={() => { void handleBulkDelete(); }}
                onCancel={() => setDeleteConfirmOpen(false)}
            />
        </div>
    );
};

interface SessionRowProps {
    session: ChatSession;
    fullySelected: boolean;
    partiallySelected: boolean;
    onToggle: () => void;
    onPreview: () => void;
}

const SessionRow: React.FC<SessionRowProps> = ({ session, fullySelected, partiallySelected, onToggle, onPreview }) => {
    const checkboxRef = React.useRef<HTMLInputElement | null>(null);
    useEffect(() => {
        if (checkboxRef.current) checkboxRef.current.indeterminate = partiallySelected;
    }, [partiallySelected]);

    return (
        <div className={`flex items-start gap-2 rounded-lg border p-2.5 transition ${
            fullySelected
                ? 'border-primary-400 bg-primary-50 dark:border-primary-600/60 dark:bg-primary-900/20'
                : 'border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20'
        }`}>
            <input
                ref={checkboxRef}
                type="checkbox"
                checked={fullySelected}
                onChange={onToggle}
                aria-label="Seleccionar sesión"
                className="mt-1 accent-primary-600"
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {session.stats.hasCompaction && (
                                <span className="mr-1 inline-flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wider text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
                                    <ArrowsPointingInIcon className="h-3 w-3" />
                                    Compactada
                                </span>
                            )}
                            {getSessionTitle(session)}
                        </p>
                        <p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">
                            {formatTime(session.startedAt)} → {formatTime(session.endedAt)}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onPreview}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                        aria-label="Ver sesión"
                    >
                        <EyeIcon className="h-3.5 w-3.5" />
                        Ver
                    </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-slate-500 dark:text-slate-400">
                    <span>{session.messages.length} mensaje(s)</span>
                    <span>{session.stats.userMessages} del usuario</span>
                    <span>{session.stats.modelMessages} del Arquitecto Agente</span>
                    <span>{(session.stats.totalCharacters / 1024).toFixed(1)} KB</span>
                </div>
            </div>
        </div>
    );
};

interface SessionPreviewProps {
    session: ChatSession;
    onClose: () => void;
}

const SessionPreview: React.FC<SessionPreviewProps> = ({ session, onClose }) => (
    <div
        role="dialog"
        aria-modal="true"
        aria-label="Vista previa de la sesión"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
    >
        <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900"
        >
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{getSessionTitle(session)}</h3>
                    <p className="text-2xs text-slate-500">{formatTime(session.startedAt)} → {formatTime(session.endedAt)}</p>
                </div>
                <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Cerrar">
                    <XMarkIcon className="h-4 w-4" />
                </button>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {session.messages.map((m) => (
                    <div key={m.id ?? `${m.role}-${m.content.slice(0, 16)}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                            m.role === 'user'
                                ? 'bg-primary-600 text-white'
                                : m.meta?.kind === 'compaction'
                                    ? 'border border-purple-300 bg-purple-50 text-purple-900 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-100'
                                    : 'bg-slate-100 text-slate-800 dark:bg-white/10 dark:text-slate-200'
                        }`}>
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-snug">{m.content}</pre>
                            {m.timestamp && !m.timestamp.startsWith('1970-') && (
                                <p className="mt-1 text-right text-2xs opacity-70">{formatTime(m.timestamp)}</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2 dark:border-white/10">
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
                    <CheckCircleIcon className="h-3.5 w-3.5" />
                    Cerrar
                </button>
            </footer>
        </div>
    </div>
);
