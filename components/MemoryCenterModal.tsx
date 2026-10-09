import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { useAppContext, type Project } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { documentGenerationService } from '../services/ai';
import { MemoryScope, MemoryEntry, MemoryPriority } from '../types';
import type { Artifact } from '../lib/artifacts';
import {
    MEMORY_SCOPES,
    DEFAULT_MEMORY_PRIORITY,
    MEMORY_PRIORITY_LABEL_ES,
    createMemoryEntry,
    memoryEntriesToTexts,
    reconcileMemoryEntries,
    resolveMemoryExtractionScope,
    sortMemoryEntriesByRecency,
} from '../services/memory';
import {
    PlusIcon,
    CpuChipIcon,
    CheckCircleIcon,
    ArrowPathIcon,
    LightBulbIcon,
    ChatBubbleBottomCenterTextIcon,
} from './Icons';
import { ChatHistoryPanel } from './memory/ChatHistoryPanel';
import { ListView } from './memory/MemoryEntryViews';
import { CreateEntry, EditEntry, ViewEntry } from './memory/MemoryEntryForms';
import type { RenderableEntry } from './memory/memoryEntryModel';

interface MemoryCenterModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: Project;
}

type ScopeAction =
    | { mode: 'list' }
    | { mode: 'view'; entryId: string | null; derivedIndex?: number }
    | { mode: 'edit'; entryId: string }
    | { mode: 'create' };

const readFileAsBase64 = (file: File): Promise<{ name: string; type: string; base64Data: string }> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve({ name: file.name, type: file.type || 'application/octet-stream', base64Data: base64 });
        };
        reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
    });

const ACCEPTED_TYPES = '.txt,.md,.markdown,.pdf,.doc,.docx,.gdoc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

const deriveInitialCaptureFallback = (project: Project): string[] => {
    const fallback: string[] = [];
    const trimmedDescription = project.description?.trim();
    if (trimmedDescription) {
        fallback.push(`Descripción inicial del proyecto: ${trimmedDescription}`);
    }
    (project.projectContext ?? []).forEach(item => {
        const trimmed = typeof item === 'string' ? item.trim() : '';
        if (trimmed && !fallback.includes(trimmed)) fallback.push(trimmed);
    });
    return fallback;
};

export const MemoryCenterModal: React.FC<MemoryCenterModalProps> = ({ isOpen, onClose, project }) => {
    const { settings, updateSettings, runProjectCommand, updateArtifact } = useAppContext();
    const { profile } = useAuth();
    const { addToast } = useToast();

    const [activeScope, setActiveScope] = useState<MemoryScope>('global');
    const [selectedArtifactId, setSelectedArtifactId] = useState<string>(project.artifacts[0]?.id ?? '');
    const [action, setAction] = useState<ScopeAction>({ mode: 'list' });
    /** Entry awaiting the delete confirmation, or null when no dialog is open. */
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [draftPriority, setDraftPriority] = useState<MemoryPriority>(DEFAULT_MEMORY_PRIORITY);
    const [search, setSearch] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractedSuggestions, setExtractedSuggestions] = useState<{ value: string; accepted: boolean }[]>([]);
    const [extractionFileName, setExtractionFileName] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isOpen) {
            setAction({ mode: 'list' });
            setDraft('');
            setDraftPriority(DEFAULT_MEMORY_PRIORITY);
            setSearch('');
            setExtractedSuggestions([]);
            setExtractionFileName(null);
        }
    }, [isOpen]);

    useEffect(() => {
        setAction({ mode: 'list' });
        setDraft('');
        setDraftPriority(DEFAULT_MEMORY_PRIORITY);
        setSearch('');
        setExtractedSuggestions([]);
        setExtractionFileName(null);
    }, [activeScope, selectedArtifactId]);

    const currentArtifact: Artifact | undefined = useMemo(
        () => project.artifacts.find(a => a.id === selectedArtifactId),
        [project.artifacts, selectedArtifactId],
    );

    /**
     * Notas estructuradas del ámbito activo. El espejo `string[]` legacy
     * define QUÉ notas existen; los campos `*Entries` aportan los metadatos
     * (fecha/hora, autor, prioridad) de cada una.
     */
    const entryRecords = useMemo<MemoryEntry[]>(() => {
        switch (activeScope) {
            case 'global':
                return reconcileMemoryEntries(settings.globalContext, settings.globalContextEntries);
            case 'agent-base':
                return reconcileMemoryEntries(settings.agentMemory, settings.agentMemoryEntries);
            case 'project':
                return reconcileMemoryEntries(project.projectContext, project.projectContextEntries);
            case 'agent':
                return reconcileMemoryEntries(project.agentMemory, project.agentMemoryEntries);
            case 'initial-capture':
                return reconcileMemoryEntries(project.initialCapture, project.initialCaptureEntries);
            case 'artifact':
                return reconcileMemoryEntries(currentArtifact?.artifactMemory, currentArtifact?.artifactMemoryEntries);
            default:
                return [];
        }
    }, [activeScope, settings, project, currentArtifact]);

    const initialCaptureFallback = useMemo(() => deriveInitialCaptureFallback(project), [project]);

    /**
     * Para proyectos creados antes de que existiera el campo `initialCapture`,
     * derivamos entradas "fantasma" desde la descripción y el contexto inicial.
     * Son de solo lectura hasta que el usuario las materialice con "Convertir
     * en captura editable".
     */
    const showFallback = activeScope === 'initial-capture' && entryRecords.length === 0 && initialCaptureFallback.length > 0;

    const renderableEntries: RenderableEntry[] = useMemo(() => {
        const base: RenderableEntry[] = showFallback
            ? initialCaptureFallback.map((value, index) => ({
                entry: { id: `derived-${index}`, text: value, priority: DEFAULT_MEMORY_PRIORITY, createdAt: null },
                isDerived: true,
                derivedIndex: index,
            }))
            // Orden cronológico: de la nota más reciente a la más antigua.
            : sortMemoryEntriesByRecency(entryRecords).map((entry) => ({ entry, isDerived: false }));
        const term = search.trim().toLowerCase();
        if (!term) return base;
        return base.filter(({ entry }) =>
            entry.text.toLowerCase().includes(term) || (entry.authorName ?? '').toLowerCase().includes(term));
    }, [showFallback, initialCaptureFallback, entryRecords, search]);

    /**
     * Persists the scope's notes: writes BOTH the structured entries and the
     * legacy `string[]` mirror in a single update so every consumer (AI
     * prompts, legacy flows) stays consistent.
     */
    const persistRecords = useCallback(async (nextRecords: MemoryEntry[]): Promise<boolean> => {
        setIsSaving(true);
        const texts = memoryEntriesToTexts(nextRecords);
        try {
            switch (activeScope) {
                case 'global':
                    await updateSettings({ globalContext: texts, globalContextEntries: nextRecords });
                    return true;
                case 'agent-base':
                    await updateSettings({ agentMemory: texts, agentMemoryEntries: nextRecords });
                    return true;
                case 'project':
                    runProjectCommand(project.id, { kind: 'replace-memory', area: 'projectContext', texts, entries: nextRecords });
                    return true;
                case 'agent':
                    runProjectCommand(project.id, { kind: 'replace-memory', area: 'agentMemory', texts, entries: nextRecords });
                    return true;
                case 'initial-capture':
                    runProjectCommand(project.id, { kind: 'replace-memory', area: 'initialCapture', texts, entries: nextRecords });
                    return true;
                case 'artifact':
                    if (!currentArtifact) {
                        addToast('Selecciona primero un artefacto.', 'error');
                        return false;
                    }
                    updateArtifact(project.id, currentArtifact.id, { artifactMemory: texts, artifactMemoryEntries: nextRecords });
                    return true;
                default:
                    return false;
            }
        } catch (error) {
            console.error('MemoryCenterModal: failed to persist entries', error);
            addToast('No se pudo guardar el cambio. Reintenta más tarde.', 'error');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [activeScope, currentArtifact, project.id, addToast, updateArtifact, runProjectCommand, updateSettings]);

    const author = useMemo(() => ({
        authorId: profile?.uid ?? null,
        authorName: profile?.displayName ?? null,
    }), [profile?.uid, profile?.displayName]);

    const handleMaterializeFallback = useCallback(async () => {
        if (!showFallback || initialCaptureFallback.length === 0) return;
        // Las entradas derivadas provienen de la creación del proyecto: se
        // materializan sin fecha (origen legacy) para no inventar metadatos.
        const records = initialCaptureFallback.map(text => createMemoryEntry(text, { createdAt: null }));
        const ok = await persistRecords(records);
        if (ok) addToast('Captura inicial guardada como editable.', 'success');
    }, [showFallback, initialCaptureFallback, persistRecords, addToast]);

    const handleCreate = () => {
        if (activeScope === 'artifact' && !currentArtifact) {
            addToast('Selecciona un artefacto primero.', 'info');
            return;
        }
        setDraft('');
        setDraftPriority(DEFAULT_MEMORY_PRIORITY);
        setExtractedSuggestions([]);
        setExtractionFileName(null);
        setAction({ mode: 'create' });
    };

    const handleSaveNew = async () => {
        const value = draft.trim();
        const fromExtraction = extractedSuggestions.filter(s => s.accepted).map(s => s.value.trim()).filter(Boolean);
        const toAdd = [value, ...fromExtraction].filter(Boolean);
        if (toAdd.length === 0) {
            addToast('Escribe contenido o acepta al menos una sugerencia.', 'info');
            return;
        }
        const baseRecords = showFallback
            ? initialCaptureFallback.map(text => createMemoryEntry(text, { createdAt: null }))
            : entryRecords;
        const newRecords = toAdd.map(text => createMemoryEntry(text, { priority: draftPriority, ...author }));
        const ok = await persistRecords([...baseRecords, ...newRecords]);
        if (ok) {
            addToast(`${toAdd.length} entrada(s) añadida(s).`, 'success');
            setAction({ mode: 'list' });
        }
    };

    const handleSaveEdit = async (entryId: string) => {
        const value = draft.trim();
        if (!value) {
            addToast('El contenido no puede estar vacío.', 'info');
            return;
        }
        const next = entryRecords.map((entry) => entry.id === entryId
            ? { ...entry, text: value, priority: draftPriority, updatedAt: new Date().toISOString() }
            : entry);
        const ok = await persistRecords(next);
        if (ok) {
            addToast('Entrada actualizada.', 'success');
            setAction({ mode: 'list' });
        }
    };

    const handleChangePriority = async (entryId: string, priority: MemoryPriority) => {
        const next = entryRecords.map((entry) => entry.id === entryId ? { ...entry, priority } : entry);
        const ok = await persistRecords(next);
        if (ok) addToast(`Prioridad cambiada a ${MEMORY_PRIORITY_LABEL_ES[priority].toLowerCase()}.`, 'success');
    };

    const handleDelete = (entryId: string | null, isDerived: boolean) => {
        if (isDerived || !entryId) {
            addToast('Esta entrada está derivada de la creación del proyecto. Cárgala primero para gestionarla.', 'info');
            return;
        }
        setPendingDeleteId(entryId);
    };

    const confirmDelete = async () => {
        const entryId = pendingDeleteId;
        setPendingDeleteId(null);
        if (!entryId) return;
        const next = entryRecords.filter((entry) => entry.id !== entryId);
        const ok = await persistRecords(next);
        if (ok) {
            addToast('Entrada eliminada.', 'success');
            if (action.mode === 'edit' || action.mode === 'view') setAction({ mode: 'list' });
        }
    };

    const startEdit = (entryId: string) => {
        const entry = entryRecords.find((item) => item.id === entryId);
        if (!entry) return;
        setDraft(entry.text);
        setDraftPriority(entry.priority);
        setAction({ mode: 'edit', entryId });
    };

    const handleExtractFromDocument = async (file: File) => {
        try {
            setIsExtracting(true);
            setExtractionFileName(file.name);
            const filePayload = await readFileAsBase64(file);
            const extractionScopeHint = activeScope === 'artifact' && currentArtifact
                ? `Artefacto destino: "${currentArtifact.name}" (${currentArtifact.type}). Objetivo: ${currentArtifact.objective}.`
                : `Proyecto: "${project.name}". Descripción: ${project.description}.`;
            const suggestions = await documentGenerationService.extractMemoryEntriesFromDocument(filePayload, resolveMemoryExtractionScope(activeScope), extractionScopeHint, settings);
            if (suggestions.length === 0) {
                addToast('La IA no encontró información relevante en el documento para este ámbito.', 'info');
            } else {
                addToast(`Se identificaron ${suggestions.length} apunte(s). Revísalos y acepta los que quieras guardar.`, 'success');
            }
            setExtractedSuggestions(suggestions.map(value => ({ value, accepted: true })));
        } catch (error) {
            console.error('MemoryCenterModal: extraction failed', error);
            addToast('No se pudo analizar el documento. Verifica el formato o intenta de nuevo.', 'error');
        } finally {
            setIsExtracting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const onFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
            addToast('El archivo supera los 8 MB. Sube uno más liviano.', 'error');
            event.target.value = '';
            return;
        }
        handleExtractFromDocument(file);
    };

    const updateSuggestion = (index: number, patch: Partial<{ value: string; accepted: boolean }>) => {
        setExtractedSuggestions(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    };

    const activeScopeDef = MEMORY_SCOPES.find(s => s.id === activeScope)!;
    const isArtifactScope = activeScope === 'artifact';
    const isChatHistoryScope = activeScope === 'chat-history';
    const isArtifactSelectionMissing = isArtifactScope && !currentArtifact;
    const isListMode = action.mode === 'list';
    const totalEntries = showFallback ? initialCaptureFallback.length : entryRecords.length;

    const viewedEntry: MemoryEntry | null = action.mode === 'view'
        ? (action.derivedIndex !== undefined
            ? { id: `derived-${action.derivedIndex}`, text: initialCaptureFallback[action.derivedIndex] ?? '', priority: DEFAULT_MEMORY_PRIORITY, createdAt: null }
            : entryRecords.find((entry) => entry.id === action.entryId) ?? null)
        : null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Centro de Memoria" description="Gestiona la memoria del Arquitecto Agente (base y proyecto), la memoria global, del proyecto y de cada artefacto en un único panel.">
            <div className="flex flex-col gap-5 md:flex-row md:gap-6 md:min-h-[60vh]">
                {/* Sidebar de scopes */}
                <aside className="md:w-64 md:flex-shrink-0">
                    <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        <CpuChipIcon className="h-4 w-4" />
                        Ámbitos
                    </div>
                    <nav className="grid gap-1.5" aria-label="Ámbitos de memoria">
                        {MEMORY_SCOPES.map(scope => {
                            const isActive = scope.id === activeScope;
                            const count = scope.id === 'global'
                                ? (settings.globalContext?.length ?? 0)
                                : scope.id === 'agent-base'
                                    ? (settings.agentMemory?.length ?? 0)
                                    : scope.id === 'project'
                                        ? (project.projectContext?.length ?? 0)
                                        : scope.id === 'agent'
                                            ? (project.agentMemory?.length ?? 0)
                                            : scope.id === 'initial-capture'
                                                ? ((project.initialCapture?.length ?? 0) || initialCaptureFallback.length)
                                                : scope.id === 'chat-history'
                                                    ? null
                                                    : (currentArtifact?.artifactMemory?.length ?? 0);
                            return (
                                <button
                                    key={scope.id}
                                    onClick={() => setActiveScope(scope.id)}
                                    className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                                        isActive
                                            ? 'border-primary-300 bg-primary-50 text-primary-900 shadow-sm dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-100'
                                            : 'border-transparent bg-slate-50 text-slate-700 hover:border-slate-200 hover:bg-slate-100 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]'
                                    }`}
                                    type="button"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="font-bold leading-tight">{scope.label}</span>
                                        {scope.id === 'chat-history' ? (
                                            <ChatBubbleBottomCenterTextIcon
                                                className={`h-3.5 w-3.5 flex-shrink-0 ${
                                                    isActive ? 'text-primary-700 dark:text-primary-200' : 'text-slate-500 dark:text-slate-300'
                                                }`}
                                                aria-hidden="true"
                                            />
                                        ) : (
                                            <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold leading-none ${
                                                isActive
                                                    ? 'bg-primary-200 text-primary-900 dark:bg-primary-500/30 dark:text-primary-100'
                                                    : 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200'
                                            }`}>
                                                {count}
                                            </span>
                                        )}
                                    </div>
                                    <span className="mt-1 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">{scope.description}</span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                {/* Panel principal */}
                <section className="flex flex-1 min-w-0 flex-col">
                    <header className="mb-3 flex flex-col gap-2 border-b border-slate-200 pb-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">{activeScopeDef.label}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{activeScopeDef.description}</p>
                        </div>
                        {isListMode && !isArtifactSelectionMissing && !isChatHistoryScope && (
                            <button
                                type="button"
                                onClick={handleCreate}
                                className="inline-flex items-center justify-center gap-1.5 self-start rounded-xl bg-primary-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400"
                            >
                                <PlusIcon className="h-4 w-4" />
                                Nuevo registro
                            </button>
                        )}
                    </header>

                    {/* Chat history scope renders its own self-contained UI.
                        We bail out early to skip the bullets list, suggestions
                        toolbar, and create/edit modes that don't apply here. */}
                    {isChatHistoryScope && <ChatHistoryPanel project={project} />}

                    {/* Bullets-based scopes (everything except chat-history)
                        share the standard list / view / edit / create / fallback
                        machinery below. We gate the whole block on
                        `!isChatHistoryScope` so the chat history panel renders
                        alone and we don't ship dead state with it. */}
                    {!isChatHistoryScope && <>
                    {/* Selector de artefacto cuando aplica */}
                    {isArtifactScope && (
                        <div className="mb-3">
                            <label htmlFor="memory-artifact-select" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Artefacto
                            </label>
                            <select
                                id="memory-artifact-select"
                                value={selectedArtifactId}
                                onChange={(event) => setSelectedArtifactId(event.target.value)}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-white/10 dark:bg-gray-800 dark:text-white"
                            >
                                {project.artifacts.length === 0 ? (
                                    <option value="">Sin artefactos en este proyecto</option>
                                ) : (
                                    project.artifacts.map(artifact => (
                                        <option key={artifact.id} value={artifact.id}>
                                            {artifact.name} (v{artifact.version})
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>
                    )}

                    {/* Banner si estamos viendo el fallback de captura inicial */}
                    {isListMode && showFallback && (
                        <div className="mb-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/20 dark:bg-amber-500/[0.06]">
                            <LightBulbIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-300" />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-amber-900 dark:text-amber-100">Captura inicial derivada</p>
                                <p className="mt-0.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                                    Este proyecto se creó antes de que existiera la captura inicial gestionable. Se está mostrando lo registrado al momento de creación (descripción y contexto inicial). Conviértela en captura editable para poder modificar, añadir o eliminar entradas.
                                </p>
                                <button
                                    type="button"
                                    onClick={handleMaterializeFallback}
                                    disabled={isSaving}
                                    className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-400"
                                >
                                    {isSaving ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <CheckCircleIcon className="h-3.5 w-3.5" />}
                                    Convertir en captura editable
                                </button>
                            </div>
                        </div>
                    )}

                    {isListMode ? (
                        <ListView
                            entries={renderableEntries}
                            totalCount={totalEntries}
                            search={search}
                            onSearchChange={setSearch}
                            onView={(item) => setAction({ mode: 'view', entryId: item.isDerived ? null : item.entry.id, derivedIndex: item.derivedIndex })}
                            onEdit={(item) => {
                                if (item.isDerived) {
                                    addToast('Convierte la captura inicial en editable para modificarla.', 'info');
                                    return;
                                }
                                startEdit(item.entry.id);
                            }}
                            onDelete={(item) => handleDelete(item.isDerived ? null : item.entry.id, item.isDerived)}
                            onChangePriority={(item, priority) => {
                                if (item.isDerived) {
                                    addToast('Convierte la captura inicial en editable para priorizar sus notas.', 'info');
                                    return;
                                }
                                handleChangePriority(item.entry.id, priority);
                            }}
                            scopeLabel={activeScopeDef.label}
                            isArtifactSelectionMissing={isArtifactSelectionMissing}
                        />
                    ) : action.mode === 'view' && viewedEntry ? (
                        <ViewEntry
                            entry={viewedEntry}
                            isDerived={action.derivedIndex !== undefined}
                            onEdit={() => {
                                if (action.derivedIndex !== undefined) {
                                    addToast('Convierte la captura inicial en editable para modificarla.', 'info');
                                    return;
                                }
                                if (action.entryId) startEdit(action.entryId);
                            }}
                            onDelete={() => handleDelete(action.entryId ?? null, action.derivedIndex !== undefined)}
                            onBack={() => setAction({ mode: 'list' })}
                        />
                    ) : action.mode === 'edit' ? (
                        <EditEntry
                            draft={draft}
                            onChange={setDraft}
                            priority={draftPriority}
                            onPriorityChange={setDraftPriority}
                            isSaving={isSaving}
                            onSave={() => handleSaveEdit(action.entryId)}
                            onCancel={() => setAction({ mode: 'list' })}
                        />
                    ) : (
                        <CreateEntry
                            draft={draft}
                            onChange={setDraft}
                            priority={draftPriority}
                            onPriorityChange={setDraftPriority}
                            isSaving={isSaving}
                            onSave={handleSaveNew}
                            onCancel={() => setAction({ mode: 'list' })}
                            onPickFile={() => fileInputRef.current?.click()}
                            isExtracting={isExtracting}
                            extractedSuggestions={extractedSuggestions}
                            extractionFileName={extractionFileName}
                            onUpdateSuggestion={updateSuggestion}
                            onClearSuggestions={() => { setExtractedSuggestions([]); setExtractionFileName(null); }}
                        />
                    )}

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_TYPES}
                        className="hidden"
                        onChange={onFileSelected}
                    />
                    </>}
                </section>
            </div>
            <ConfirmDialog
                isOpen={pendingDeleteId !== null}
                title="Eliminar entrada de memoria"
                message="Esta entrada se eliminará de la memoria del proyecto. La acción no se puede deshacer."
                confirmLabel="Eliminar"
                variant="danger"
                onConfirm={() => { void confirmDelete(); }}
                onCancel={() => setPendingDeleteId(null)}
            />
        </Modal>
    );
};
