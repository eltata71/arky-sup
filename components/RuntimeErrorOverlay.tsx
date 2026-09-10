import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { observabilityService, type ObservabilityEvent } from '../services/observability';

const isRuntimeOrLoadFailure = (event: ObservabilityEvent): boolean => (
    event.source === 'runtime' ||
    event.source === 'react-boundary' ||
    (event.source === 'resource' && /script|module|chunk|recurso/i.test(`${event.title} ${event.message}`))
);

/**
 * What earns a modal that covers the application.
 *
 * This overlay exists for one failure: the view that cannot continue — a render
 * that threw, a chunk that never arrived, a boot that died — where the
 * alternative is a blank screen and its offer to reload is the actual remedy.
 *
 * It used to block on *any* non-recoverable error, and a `network` failure
 * qualified. So a deployment without `VITE_AI_PROXY_URL` answered "¿cómo pido
 * un entregable?" by covering the whole product with «Recargar aplicación» —
 * over a help panel that had already degraded to the written guide and was
 * showing the answer underneath. Reloading cannot fix a missing environment
 * variable, and the screen was never in danger of going blank.
 *
 * So the rule is the overlay's own purpose: a blank-screen class failure
 * (runtime, error boundary, chunk), or a `critical` one. What is dropped is the
 * clause that blocked on *any* non-recoverable error whatever its source.
 * Everything else stays where it belongs: recorded in the observability centre,
 * and reported by the surface that made the call — the only one that knows what
 * it did instead.
 */
const shouldBlockWithRecoveryOverlay = (event: ObservabilityEvent): boolean => (
    event.userVisible && (
        event.severity === 'critical' ||
        (event.severity === 'error' && isRuntimeOrLoadFailure(event))
    )
);

/**
 * Global runtime safety panel backed by the centralized observability service.
 * React ErrorBoundary handles render failures; this overlay handles critical
 * global failures so the user never remains on an empty, silent screen.
 */
export const RuntimeErrorOverlay: React.FC = () => {
    const [error, setError] = useState<ObservabilityEvent | null>(null);

    useEffect(() => observabilityService.subscribe((events) => {
        const blockingEvent = events.find(shouldBlockWithRecoveryOverlay) ?? null;
        setError(blockingEvent);
    }), []);

    const technicalReport = useMemo(() => {
        if (!error) return '';
        return [
            `id=${error.id}`,
            `source=${error.source}`,
            `status=${error.status}`,
            `at=${error.at}`,
            `message=${error.message}`,
            error.detail ? `detail=${error.detail}` : null,
            error.route ? `route=${error.route}` : null,
            `url=${window.location.href}`,
            `userAgent=${navigator.userAgent}`,
        ].filter((line): line is string => Boolean(line)).join('\n');
    }, [error]);

    const copyReport = useCallback(async () => {
        if (!technicalReport) return;
        try {
            await navigator.clipboard.writeText(technicalReport);
        } catch (copyError) {
            console.warn('[RuntimeErrorOverlay] clipboard copy failed', copyError);
        }
    }, [technicalReport]);

    if (!error) return null;

    const reload = () => window.location.reload();
    const goHome = () => { window.location.href = '/'; };
    const dismiss = () => {
        observabilityService.acknowledge(error.id);
        setError(null);
    };

    return (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" role="alertdialog" aria-modal="true" aria-labelledby="runtime-error-title">
            <div className="w-full max-w-xl rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl dark:border-rose-900/60 dark:bg-gray-950">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
                    <AlertTriangle className="h-6 w-6" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-300">Fallo observable</p>
                <h2 id="runtime-error-title" className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{error.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                    La vista no continuará en blanco. Puedes recargar la aplicación o volver al inicio; el detalle técnico queda disponible para soporte.
                </p>
                <details className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/70">
                    <summary className="cursor-pointer text-xs font-semibold text-gray-600 dark:text-gray-300">Detalle técnico observable</summary>
                    <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] text-gray-700 dark:text-gray-300">{technicalReport}</pre>
                </details>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        onClick={dismiss}
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
                    >
                        Mantener sesión
                    </button>
                    <button
                        type="button"
                        onClick={copyReport}
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
                    >
                        Copiar diagnóstico
                    </button>
                    <button
                        type="button"
                        onClick={goHome}
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
                    >
                        Volver al inicio
                    </button>
                    <button
                        type="button"
                        onClick={reload}
                        className="inline-flex h-10 items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
                    >
                        Recargar aplicación
                    </button>
                </div>
            </div>
        </div>
    );
};
