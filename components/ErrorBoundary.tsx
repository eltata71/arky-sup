import React, { Component, ReactNode } from 'react';
import { observabilityService } from '../services/observability';

interface ErrorBoundaryProps {
    key?: React.Key;
    children: ReactNode;
    fallbackTitle?: string;
    /** Optional custom render — receives error + reset and returns the fallback UI. */
    fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * Real React error boundary. Catches render-time errors in child components
 * and renders a friendly fallback panel with a "try again" affordance.
 *
 * This class used to extend a hand-rolled `BaseComponent` cast through
 * `unknown`, with a comment explaining that "this codebase ships without
 * @types/react". That was true and it was the actual defect: a React 18 app
 * was typechecking with no React type definitions at all, so every JSX
 * element, hook and prop in the repository was silently `any`. The types are
 * installed now, so the workaround is gone and this extends `Component` like
 * any other boundary — which is also what makes `props` and `state` genuinely
 * checked here rather than nominally.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: { componentStack?: string }) {
        console.error('[ErrorBoundary] caught', { error, componentStack: info?.componentStack });
        observabilityService.reportError(error, {
            source: 'react-boundary',
            title: this.props.fallbackTitle ?? 'Error de render capturado',
            detail: info?.componentStack,
            severity: 'critical',
            recoverable: true,
            userVisible: true,
        });
    }

    private reset = () => {
        this.setState({ error: null });
    };

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        if (this.props.fallback) {
            return this.props.fallback(error, this.reset);
        }

        return (
            <div className="flex items-center justify-center w-full h-full p-6">
                <div
                    role="alert"
                    className="max-w-md w-full bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900/50 rounded-2xl shadow-pop p-6 text-center animate-slide-up"
                >
                    <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                        {this.props.fallbackTitle ?? 'Algo salió mal'}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Encontramos un problema al renderizar esta vista. Puedes intentar recargar la sección o volver atrás.
                    </p>
                    <details className="text-left mb-4 bg-gray-50 dark:bg-gray-950/50 rounded-lg p-3 border border-gray-200 dark:border-gray-800">
                        <summary className="cursor-pointer text-xs font-medium text-gray-500 dark:text-gray-400">Detalles técnicos</summary>
                        <pre className="mt-2 text-2xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words max-h-32 overflow-auto custom-scrollbar">{error.message}</pre>
                    </details>
                    <div className="flex items-center justify-center gap-2">
                        <button
                            type="button"
                            onClick={this.reset}
                            className="inline-flex items-center justify-center h-10 px-4 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
                        >
                            Intentar de nuevo
                        </button>
                        <button
                            type="button"
                            onClick={() => { window.location.href = '/'; }}
                            className="inline-flex items-center justify-center h-10 px-4 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                            Volver al inicio
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
