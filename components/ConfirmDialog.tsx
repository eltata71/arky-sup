import React, { useEffect, useId } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ExclamationTriangleIcon } from './Icons';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    variant = 'danger',
    onConfirm,
    onCancel,
}) => {
    const titleId = useId();
    const descId = useId();
    const containerRef = useFocusTrap<HTMLDivElement>(isOpen);

    // Escape closes the dialog as Cancel — destructive actions never auto-fire
    // on Escape (the user has to confirm explicitly).
    useEffect(() => {
        if (!isOpen) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    const variantStyles = {
        danger: {
            icon: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
            button: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500',
        },
        warning: {
            icon: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
            button: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500',
        },
        info: {
            icon: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
            button: 'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500',
        },
    };

    const styles = variantStyles[variant];

    return (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onCancel}>
            <div
                ref={containerRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descId}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl border border-gray-200 dark:border-gray-800 animate-slide-up"
            >
                <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full ${styles.icon} flex items-center justify-center`}>
                        <ExclamationTriangleIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
                        <p id={descId} className="mt-2 text-sm text-gray-500 dark:text-gray-400">{message}</p>
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors focus:outline-none focus-visible:ring-2 ${styles.button}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
