import React, { useMemo, useState } from 'react';
import { ArtifactTemplate } from '../types';
import { ARTIFACT_TEMPLATES } from '../constants';
import { useAppContext } from '../context/AppContext';
import {
    CheckCircleIcon,
    SparklesIcon,
    PlusCircleIcon,
    MagnifyingGlassIcon,
} from './Icons';
import { Button, Badge, CardEyebrow } from './ui';

interface SuggestedArtifact {
    template: ArtifactTemplate;
    suggested: boolean;
}

interface ArtifactSelectionStepProps {
    projectName: string;
    projectDescription?: string;
    suggestedNames: string[];
    onConfirm: (selectedNames: string[]) => void;
    onSkip: () => void;
    onCancel: () => void;
}

const dedupe = (names: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of names) {
        const name = (raw ?? '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(name);
    }
    return result;
};

const ArtifactSelectionStep: React.FC<ArtifactSelectionStepProps> = ({
    projectName,
    projectDescription,
    suggestedNames,
    onConfirm,
    onSkip,
    onCancel,
}) => {
    const { t } = useAppContext();

    const cleanSuggested = useMemo(() => dedupe(suggestedNames), [suggestedNames]);

    // Resolve suggested names against the catalog. Unmatched suggestions are
    // dropped silently — the catalog is the single source of truth for what
    // can be generated.
    const suggestedItems = useMemo<SuggestedArtifact[]>(() => {
        return cleanSuggested
            .map(name => ARTIFACT_TEMPLATES.find(tpl => tpl.name === name))
            .filter((tpl): tpl is ArtifactTemplate => Boolean(tpl))
            .map(tpl => ({ template: tpl, suggested: true }));
    }, [cleanSuggested]);

    // Selection state: stores the artifact names that should be generated.
    const [selected, setSelected] = useState<Set<string>>(
        () => new Set(suggestedItems.map(item => item.template.name))
    );
    const [showCatalog, setShowCatalog] = useState(false);
    const [catalogSearch, setCatalogSearch] = useState('');

    const toggle = (name: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    };

    const selectAll = () => setSelected(new Set(suggestedItems.map(i => i.template.name)));
    const selectNone = () => {
        setSelected(prev => {
            // Keep extra catalog items that the user added beyond the suggestions.
            const suggestedSet = new Set(suggestedItems.map(i => i.template.name));
            const next = new Set<string>();
            prev.forEach(name => {
                if (!suggestedSet.has(name)) next.add(name);
            });
            return next;
        });
    };

    // Group suggested artifacts by phase for clearer hierarchy.
    const suggestedByPhase = useMemo(() => {
        const map = new Map<string, SuggestedArtifact[]>();
        for (const item of suggestedItems) {
            const list = map.get(item.template.phase) ?? [];
            list.push(item);
            map.set(item.template.phase, list);
        }
        return Array.from(map.entries());
    }, [suggestedItems]);

    // Catalog templates the user can pull in beyond the AI suggestions.
    const catalogItems = useMemo(() => {
        const suggestedSet = new Set(suggestedItems.map(i => i.template.name));
        const term = catalogSearch.trim().toLowerCase();
        return ARTIFACT_TEMPLATES
            .filter(tpl => !suggestedSet.has(tpl.name))
            .filter(tpl => {
                if (!term) return true;
                return (
                    tpl.name.toLowerCase().includes(term) ||
                    tpl.objective.toLowerCase().includes(term) ||
                    tpl.architecturalView.toLowerCase().includes(term) ||
                    tpl.phase.toLowerCase().includes(term)
                );
            });
    }, [suggestedItems, catalogSearch]);

    const selectedCount = selected.size;
    const estimatedSeconds = selectedCount * 12; // rough heuristic for UX feedback
    const estimateLabel = selectedCount === 0
        ? 'Sin generación inicial'
        : estimatedSeconds < 60
            ? `~${estimatedSeconds}s estimados`
            : `~${Math.ceil(estimatedSeconds / 60)} min estimados`;

    const handleConfirm = () => {
        const ordered = dedupe(Array.from(selected));
        onConfirm(ordered);
    };

    return (
        <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-950">
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto px-6 py-10 md:py-14">
                    {/* Header */}
                    <div className="space-y-3 mb-8 animate-fade-in">
                        <div className="flex items-center space-x-2 text-primary-600 dark:text-primary-400">
                            <SparklesIcon className="h-5 w-5" />
                            <CardEyebrow>Sugerencias del Arquitecto IA</CardEyebrow>
                        </div>
                        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight">
                            Elige los primeros artefactos para
                            {' '}
                            <span className="text-primary-600">{projectName}</span>
                        </h1>
                        <p className="text-base text-gray-600 dark:text-gray-300 max-w-3xl">
                            Marcamos por omisión los artefactos recomendados como punto de partida. Desmarca los que prefieras no generar todavía. Podrás añadir más en cualquier momento desde el Hub del Proyecto.
                        </p>
                        {projectDescription && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl line-clamp-2">
                                <span className="font-semibold text-gray-700 dark:text-gray-300">Contexto:</span> {projectDescription}
                            </p>
                        )}
                    </div>

                    {/* Toolbar */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                        <div className="flex items-center gap-3 text-sm">
                            <Badge tone="primary" size="sm">
                                {selectedCount} seleccionado{selectedCount === 1 ? '' : 's'}
                            </Badge>
                            <span className="text-gray-500 dark:text-gray-400">{estimateLabel}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={selectAll}
                                className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 hover:underline"
                            >
                                Marcar sugeridos
                            </button>
                            <span className="text-gray-300 dark:text-gray-600">·</span>
                            <button
                                type="button"
                                onClick={selectNone}
                                className="text-xs font-medium text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white hover:underline"
                            >
                                Desmarcar sugeridos
                            </button>
                        </div>
                    </div>

                    {/* Suggested artifacts */}
                    {suggestedItems.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center bg-white dark:bg-gray-900">
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                                No tenemos sugerencias automáticas para este proyecto. Explora el catálogo para elegir los primeros artefactos.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {suggestedByPhase.map(([phase, items]) => (
                                <section key={phase} className="space-y-3">
                                    <header className="flex items-center justify-between">
                                        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                            {phase}
                                        </h2>
                                        <span className="text-xs text-gray-400">
                                            {items.filter(i => selected.has(i.template.name)).length}/{items.length}
                                        </span>
                                    </header>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {items.map(({ template }) => {
                                            const isSelected = selected.has(template.name);
                                            return (
                                                <button
                                                    key={template.name}
                                                    type="button"
                                                    onClick={() => toggle(template.name)}
                                                    aria-pressed={isSelected}
                                                    className={`group relative text-left rounded-xl border p-4 transition-all duration-200 bg-white dark:bg-gray-900 ${
                                                        isSelected
                                                            ? 'border-primary-500 dark:border-primary-400 ring-2 ring-primary-500/20 shadow-sm'
                                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                    }`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <span
                                                            className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors ${
                                                                isSelected
                                                                    ? 'border-primary-500 bg-primary-500 text-white'
                                                                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                                                            }`}
                                                        >
                                                            {isSelected && <CheckCircleIcon className="h-4 w-4" />}
                                                        </span>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                                                                    {template.name}
                                                                </h3>
                                                                <Badge tone="primary" size="sm">Sugerido</Badge>
                                                            </div>
                                                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                                {template.architecturalView} · {template.representation === 'diagram' ? 'Diagrama' : template.representation === 'document' ? 'Documento' : 'Híbrido'}
                                                            </p>
                                                            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                                                                {template.objective}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>
                            ))}
                        </div>
                    )}

                    {/* Catalog expander */}
                    <div className="mt-10">
                        <button
                            type="button"
                            onClick={() => setShowCatalog(prev => !prev)}
                            className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 transition-colors"
                        >
                            <PlusCircleIcon className="h-5 w-5" />
                            {showCatalog ? 'Ocultar catálogo completo' : 'Añadir más desde el catálogo'}
                        </button>

                        {showCatalog && (
                            <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 animate-fade-in">
                                <div className="relative mb-4">
                                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="text"
                                        value={catalogSearch}
                                        onChange={e => setCatalogSearch(e.target.value)}
                                        placeholder="Buscar por nombre, objetivo o vista..."
                                        className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    />
                                </div>
                                <div className="max-h-80 overflow-y-auto pr-1 space-y-2">
                                    {catalogItems.length === 0 ? (
                                        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                                            No hay resultados.
                                        </p>
                                    ) : (
                                        catalogItems.map(tpl => {
                                            const isSelected = selected.has(tpl.name);
                                            return (
                                                <label
                                                    key={tpl.name}
                                                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                                        isSelected
                                                            ? 'border-primary-500/60 bg-primary-50 dark:bg-primary-900/20'
                                                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggle(tpl.name)}
                                                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                                {tpl.name}
                                                            </span>
                                                            <span className="text-[10px] uppercase tracking-wide text-gray-400">
                                                                {tpl.phase}
                                                            </span>
                                                        </div>
                                                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                                                            {tpl.objective}
                                                        </p>
                                                    </div>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Sticky footer */}
            <div className="sticky bottom-0 border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-gray-900/80">
                <div className="max-w-5xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                        {selectedCount === 0 ? (
                            <span>Continuarás sin generar artefactos iniciales.</span>
                        ) : (
                            <span>
                                Se generarán <strong className="text-gray-900 dark:text-white">{selectedCount}</strong> artefacto{selectedCount === 1 ? '' : 's'} con tu contexto.
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={onCancel}>
                            {t('back')}
                        </Button>
                        {selectedCount === 0 ? (
                            <Button variant="secondary" onClick={onSkip}>
                                Crear proyecto vacío
                            </Button>
                        ) : (
                            <Button variant="ai" leftIcon={<SparklesIcon className="h-4 w-4" />} onClick={handleConfirm}>
                                Generar {selectedCount} artefacto{selectedCount === 1 ? '' : 's'}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ArtifactSelectionStep;
