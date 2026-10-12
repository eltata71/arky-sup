import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import { XMarkIcon } from '../Icons';
import type { buildAccessibleSummary } from '../../services/diagram';
type AccessibleSummary = ReturnType<typeof buildAccessibleSummary>;

interface CanvasAccessibleDialogProps {
    summary: AccessibleSummary | null;
    onClose: () => void;
}

export function CanvasAccessibleDialog({ summary: accessibleSummary, onClose }: CanvasAccessibleDialogProps) {
  const t = useUiTranslation();
    return (

                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="a11y-dialog-title"
                    className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6 animate-fade-in"
                    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
                >
                    <div className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col">
                        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                            <div>
                                <h2 id="a11y-dialog-title" className="text-sm font-semibold text-gray-900 dark:text-white">{t("ui.descripcion-accesible-del-di.434726")}</h2>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t("ui.resumen-textual-usado-por-le.74b8cc")}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onClose()}
                                aria-label={t("ui.cerrar-descripcion-accesible.554cf3")}
                                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4 text-sm text-gray-700 dark:text-gray-200">
                            {accessibleSummary ? (
                                <>
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">{accessibleSummary.headline}</p>
                                    {accessibleSummary.boundaries.length > 0 && (
                                        <section>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">{t("ui.agrupaciones-limites.2becec")}</p>
                                            <ul className="list-disc pl-5 space-y-0.5 text-[12.5px]">
                                                {accessibleSummary.boundaries.map((b, i) => <li key={i}>{b}</li>)}
                                            </ul>
                                        </section>
                                    )}
                                    {accessibleSummary.keyNodes.length > 0 && (
                                        <section>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">{t("ui.elementos-clave.f47fdc")}</p>
                                            <ul className="list-disc pl-5 space-y-0.5 text-[12.5px]">
                                                {accessibleSummary.keyNodes.map((n, i) => <li key={i}>{n}</li>)}
                                            </ul>
                                        </section>
                                    )}
                                    {accessibleSummary.keyFlows.length > 0 && (
                                        <section>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">{t("ui.relaciones-clave.d2f70a")}</p>
                                            <ul className="list-disc pl-5 space-y-0.5 text-[12.5px]">
                                                {accessibleSummary.keyFlows.map((f, i) => <li key={i}>{f}</li>)}
                                            </ul>
                                        </section>
                                    )}
                                </>
                            ) : (
                                <p className="text-gray-500 dark:text-gray-400 italic">{t("ui.el-diagrama-todavia-no-tiene.488bbd")}</p>
                            )}
                        </div>
                        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (accessibleSummary?.fullText && typeof navigator !== 'undefined' && navigator.clipboard) {
                                        void navigator.clipboard.writeText(accessibleSummary.fullText);
                                    }
                                }}
                                disabled={!accessibleSummary?.fullText}
                                className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                                {t("ui.copiar-texto.afd73b")}
                            </button>
                            <button
                                type="button"
                                onClick={() => onClose()}
                                className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                            >
                                {t("sdd.close")}
                            </button>
                        </div>
                    </div>
                </div>

    );
}
