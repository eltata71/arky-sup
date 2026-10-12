import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import { Dropdown, type DropdownItem } from '../ui/Dropdown';
import { ArrowUturnLeftIcon, ArrowPathIcon, ViewfinderCircleIcon, ChevronDownIcon, SparklesIcon, PresentationChartBarIcon } from '../Icons';
import type { LayoutPreset, NarrativeScene } from './index';

interface CanvasToolbarProps {
    layoutDirection: 'TB' | 'LR' | 'auto';
    layoutPreset: LayoutPreset;
    storyMode: boolean;
    storyStep: number;
    storyScenes: NarrativeScene[];
    smartViewportHint: { explore: boolean; viewAllSecondary: boolean; reason?: string };
    focusPrimaryActive: boolean;
    nodeCount: number;
    onLayout: (direction: 'TB' | 'LR') => void;
    onDensityChange: (preset: LayoutPreset) => void;
    addNewNode: () => void;
    onViewAll: () => void;
    toggleFocusPrimary: () => void;
    onToggleStory: () => void;
    onPreviousScene: () => void;
    onNextScene: () => void;
    handleUndo: () => void;
    handleRedo: () => void;
    onFit: () => void;
    onOpenA11y: () => void;
    onStartPresentation: () => void;
}

export function CanvasToolbar({ layoutDirection, layoutPreset, storyMode, storyStep, storyScenes, smartViewportHint, focusPrimaryActive, nodeCount, onLayout, onDensityChange, addNewNode, onViewAll, toggleFocusPrimary, onToggleStory, onPreviousScene, onNextScene, handleUndo, handleRedo, onFit, onOpenA11y, onStartPresentation }: CanvasToolbarProps) {
  const t = useUiTranslation();
    return (
                <div className="diagram-toolbar absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md p-1.5 rounded-xl shadow-lg border border-gray-200/80 dark:border-gray-700/80">
                   {(() => {
                       const layoutItems: DropdownItem[] = [
                           {
                               id: 'tb',
                               label: t("Vertical (de arriba a abajo)"),
                               description: t("TB · jerarquías y flujos descendentes"),
                               icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>,
                               active: layoutDirection === 'TB',
                               onClick: () => onLayout('TB'),
                           },
                           {
                               id: 'lr',
                               label: t("Horizontal (izquierda → derecha)"),
                               description: t("LR · procesos y secuencias"),
                               icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>,
                               active: layoutDirection === 'LR',
                               onClick: () => onLayout('LR'),
                           },
                       ];
                       const densityItems: DropdownItem[] = (['compact', 'normal', 'spacious'] as LayoutPreset[]).map(p => ({
                           id: p,
                           label: p === 'compact' ? 'Compacto' : p === 'normal' ? 'Normal' : 'Amplio',
                           description: p === 'compact' ? 'Densidad alta · ideal en monitores pequeños' : p === 'normal' ? 'Densidad equilibrada' : 'Más aire alrededor de cada nodo',
                           active: layoutPreset === p,
                           onClick: () => onDensityChange(p),
                       }));

                       const historyItems: DropdownItem[] = [
                           { id: 'undo', icon: <ArrowUturnLeftIcon className="w-4 h-4" />, label: t("Deshacer"), description: t("Ctrl/⌘+Z"), onClick: handleUndo },
                           { id: 'redo', icon: <ArrowUturnLeftIcon className="w-4 h-4" style={{ transform: 'scaleX(-1)' }} />, label: t("Rehacer"), description: t("Ctrl/⌘+Shift+Z"), onClick: handleRedo },
                           { id: 'fit',  icon: <ViewfinderCircleIcon className="w-4 h-4" />, label: t("Ajustar a pantalla"), description: t("Tecla F"), onClick: onFit },
                       ];

                       const densityLabel = layoutPreset === 'compact' ? 'Compacto' : layoutPreset === 'normal' ? 'Normal' : 'Amplio';
                       const dirLabel = layoutDirection === 'TB' ? '↓' : layoutDirection === 'LR' ? '→' : '⤵';

                       return (
                           <>
                               {/* Vista del diagrama: layout direction + density */}
                               <Dropdown
                                   align="center"
                                   direction="up"
                                   width="md"
                                   aria-label={t("ui.vista-del-diagrama.2eb7a8")}
                                   trigger={({ open, toggle }) => (
                                       <button
                                           type="button"
                                           onClick={toggle}
                                           aria-expanded={open}
                                           className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                           title={t("ui.layout-y-densidad.18d48a")}
                                       >
                                           <span className="text-base leading-none">{dirLabel}</span>
                                           <span>{densityLabel}</span>
                                           <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                                       </button>
                                   )}
                                   sections={[
                                       { label: t("Dirección"), items: layoutItems },
                                       { label: t("Densidad"), items: densityItems },
                                   ]}
                               />

                               {/* Añadir nodo — edición topológica directa en el lienzo */}
                               <button
                                   type="button"
                                   onClick={addNewNode}
                                   className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                   title={t("ui.anadir-un-nodo-nuevo-al-diag.0e372b")}
                               >
                                   <span className="text-sm leading-none">＋</span>
                                   <span>{t("ui.nodo.9aa3d6")}</span>
                               </button>

                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />
                               {smartViewportHint.explore && (
                                   <span
                                       className="px-2 py-1 rounded-lg text-[10px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700"
                                       title={smartViewportHint.reason ? t("uiTemplate.legibilidad-p0.466a70", { p0: String(smartViewportHint.reason) }) : undefined}
                                   >
                                       {t("ui.explora-hay-contenido-fuera.1018da")}
                                   </span>
                               )}
                               {smartViewportHint.viewAllSecondary && (
                                   <button
                                       type="button"
                                       onClick={onViewAll}
                                       className="px-2 py-1 rounded-lg text-[10px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600"
                                       title={t("ui.ver-todo-puede-comprometer-l.d3c783")}
                                   >
                                       {t("ui.ver-todo.486f7f")}
                                   </button>
                               )}
                               {(smartViewportHint.explore || smartViewportHint.viewAllSecondary || focusPrimaryActive) && nodeCount > 6 && (
                                   <button
                                       type="button"
                                       onClick={toggleFocusPrimary}
                                       aria-pressed={focusPrimaryActive}
                                       className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${focusPrimaryActive
                                           ? 'bg-primary-100 text-primary-700 border-primary-300 dark:bg-primary-900/50 dark:text-primary-200 dark:border-primary-700'
                                           : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-600'}`}
                                       title={focusPrimaryActive
                                           ? t("uiExpr.volver-a-la-vista-completa.685b5e")
                                           : t("uiExpr.resaltar-nodos-clave-y-atenu.99a73f")}
                                   >
                                       {focusPrimaryActive ? t("uiExpr.salir-del-foco.4832f6") : t("uiExpr.foco-principal.75933c")}
                                   </button>
                               )}
                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />

                               {/* Narrativa: Story mode + scenes */}
                               <Dropdown
                                   align="center"
                                   direction="up"
                                   width="md"
                                   aria-label={t("ui.narrativa-por-escenas.229474")}
                                   trigger={({ open, toggle }) => (
                                       <button
                                           type="button"
                                           onClick={toggle}
                                           aria-expanded={open}
                                           aria-pressed={storyMode}
                                           className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${storyMode ? 'bg-cyan-100 dark:bg-cyan-900/50 text-cyan-700 dark:text-cyan-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                           title={t("ui.modo-narrativo-por-escenas.7a0119")}
                                       >
                                           <SparklesIcon className="w-3.5 h-3.5" />
                                           <span>{storyMode && storyScenes.length > 0 ? (storyScenes[storyStep]?.title ?? t("uiTemplate.escena-p0.2b5597", { p0: String(storyStep + 1) })) : t("projectHub.narrative")}</span>
                                           <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                                       </button>
                                   )}
                                   sections={[
                                       {
                                           items: [
                                               {
                                                   id: 'toggle',
                                                   icon: <SparklesIcon className="w-4 h-4" />,
                                                   label: storyMode ? 'Salir del modo narrativo' : 'Activar modo narrativo',
                                                   description: t("Cuenta la historia escena por escena"),
                                                   active: storyMode,
                                                   onClick: onToggleStory,
                                               },
                                           ],
                                       },
                                       {
                                           label: t("Escenas"),
                                           items: [
                                               {
                                                   id: 'prev',
                                                   icon: <span className="text-sm leading-none">←</span>,
                                                   label: t("Escena anterior"),
                                                   description: storyScenes.length > 0 ? `Paso ${Math.max(storyStep, 0) + 1} de ${storyScenes.length}` : 'Sin escenas',
                                                   disabled: !storyMode || storyScenes.length === 0 || storyStep === 0,
                                                   onClick: onPreviousScene,
                                               },
                                               {
                                                   id: 'next',
                                                   icon: <span className="text-sm leading-none">→</span>,
                                                   label: t("Escena siguiente"),
                                                   description: storyScenes.length > 0 ? `Paso ${Math.max(storyStep, 0) + 1} de ${storyScenes.length}` : 'Sin escenas',
                                                   disabled: !storyMode || storyScenes.length === 0 || storyStep >= storyScenes.length - 1,
                                                   onClick: onNextScene,
                                               },
                                           ],
                                       },
                                   ]}
                               />

                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />

                               {/* Historial + Fit */}
                               <Dropdown
                                   align="center"
                                   direction="up"
                                   width="md"
                                   aria-label={t("ui.historial-y-vista.e32757")}
                                   trigger={({ open, toggle }) => (
                                       <button
                                           type="button"
                                           onClick={toggle}
                                           aria-expanded={open}
                                           aria-label={t("ui.historial-y-ajuste-de-vista.d05a73")}
                                           className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                                           title={t("ui.deshacer-rehacer-ajustar.fa35ca")}
                                       >
                                           <ArrowPathIcon className="w-4 h-4" />
                                       </button>
                                   )}
                                   items={historyItems}
                               />

                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />

                               {/* Descripción accesible / narrativa textual */}
                               <button
                                   type="button"
                                   onClick={onOpenA11y}
                                   aria-label={t("ui.abrir-descripcion-accesible.dc3d2c")}
                                   title={t("ui.descripcion-accesible-lector.c53780")}
                                   className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                               >
                                   <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                       <circle cx="12" cy="6" r="2.2" />
                                       <path d="M9 11h6" />
                                       <path d="M12 11v9" />
                                       <path d="M9 16l3-1 3 1" />
                                   </svg>
                               </button>

                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />

                               {/* Presentar — única acción primaria visible */}
                               <button
                                   onClick={onStartPresentation}
                                   className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 text-white hover:scale-[1.03] active:scale-95 transition shadow-md"
                                   title={t("ui.modo-presentacion-cinematico.8e692c")}
                               >
                                   <PresentationChartBarIcon className="w-3.5 h-3.5" />
                                   {t("deck.present")}
                               </button>
                           </>
                       );
                   })()}
                </div>
    );
}
