import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, LightBulbIcon, XMarkIcon } from '../components/Icons';

type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

interface Toast {
    id: string;
    message: string;
    type: ToastType;
    /** Optional action button (e.g. "Deshacer"). */
    action?: ToastAction;
    /** Auto-dismiss time in ms — 0 disables auto-dismiss. */
    durationMs: number;
}

interface ToastContextType {
    toasts: Toast[];
    addToast: (message: string, type?: ToastType, options?: { action?: ToastAction; durationMs?: number }) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const DEFAULT_DURATION_MS = 4500;

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const addToast = useCallback<ToastContextType['addToast']>((message, type, options) => {
        const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
        const resolvedType: ToastType = type ?? 'info';
        const toast: Toast = { id, message, type: resolvedType, action: options?.action, durationMs };
        setToasts(prev => [...prev, toast]);
        if (durationMs > 0) {
            window.setTimeout(() => removeToast(id), durationMs);
        }
    }, [removeToast]);

    // Memoised: `addToast` and `removeToast` are already stable, so the identity
    // now changes only when a toast is actually added or removed. Seventeen
    // modules consume this context; an inline literal re-rendered all of them
    // whenever anything above this provider rendered.
    const value = useMemo<ToastContextType>(
        () => ({ toasts, addToast, removeToast }),
        [toasts, addToast, removeToast],
    );

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (context === undefined) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

const TONE_STYLES: Record<ToastType, {
    border: string;
    bg: string;
    text: string;
    iconBg: string;
    iconText: string;
    Icon: React.FC<{ className?: string }>;
    accent: string;
}> = {
    success: {
        border: 'border-green-200 dark:border-green-800/60',
        bg: 'bg-white dark:bg-gray-900',
        text: 'text-green-900 dark:text-green-100',
        iconBg: 'bg-green-100 dark:bg-green-900/40',
        iconText: 'text-green-600 dark:text-green-300',
        Icon: CheckCircleIcon,
        accent: 'bg-green-500',
    },
    error: {
        border: 'border-red-200 dark:border-red-800/60',
        bg: 'bg-white dark:bg-gray-900',
        text: 'text-red-900 dark:text-red-100',
        iconBg: 'bg-red-100 dark:bg-red-900/40',
        iconText: 'text-red-600 dark:text-red-300',
        Icon: XCircleIcon,
        accent: 'bg-red-500',
    },
    warning: {
        border: 'border-amber-200 dark:border-amber-800/60',
        bg: 'bg-white dark:bg-gray-900',
        text: 'text-amber-900 dark:text-amber-100',
        iconBg: 'bg-amber-100 dark:bg-amber-900/40',
        iconText: 'text-amber-600 dark:text-amber-300',
        Icon: ExclamationTriangleIcon,
        accent: 'bg-amber-500',
    },
    info: {
        border: 'border-blue-200 dark:border-blue-800/60',
        bg: 'bg-white dark:bg-gray-900',
        text: 'text-blue-900 dark:text-blue-100',
        iconBg: 'bg-blue-100 dark:bg-blue-900/40',
        iconText: 'text-blue-600 dark:text-blue-300',
        Icon: LightBulbIcon,
        accent: 'bg-blue-500',
    },
};

const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => {
    return (
        <div
            className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-[calc(100vw-3rem)] sm:w-96 pointer-events-none"
            role="status"
            aria-live="polite"
        >
            <AnimatePresence initial={false}>
                {toasts.map(toast => {
                    const style = TONE_STYLES[toast.type];
                    const Icon = style.Icon;
                    return (
                        <motion.div
                            key={toast.id}
                            layout
                            initial={{ opacity: 0, y: 16, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
                            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
                            className={`pointer-events-auto relative overflow-hidden rounded-xl border ${style.border} ${style.bg} shadow-pop flex items-start gap-3 p-3.5`}
                        >
                            {/* Accent stripe */}
                            <span className={`absolute left-0 top-0 bottom-0 w-1 ${style.accent}`} aria-hidden />
                            <span className={`flex-shrink-0 h-8 w-8 rounded-lg ${style.iconBg} ${style.iconText} flex items-center justify-center ml-1`}>
                                <Icon className="h-4 w-4" />
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium leading-snug ${style.text} break-words`}>{toast.message}</p>
                                {toast.action && (
                                    <button
                                        type="button"
                                        onClick={() => { toast.action?.onClick(); onRemove(toast.id); }}
                                        className="mt-1.5 text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-300 hover:underline"
                                    >
                                        {toast.action.label}
                                    </button>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => onRemove(toast.id)}
                                aria-label="Cerrar notificación"
                                className="flex-shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            >
                                <XMarkIcon className="h-3.5 w-3.5" />
                            </button>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
};
