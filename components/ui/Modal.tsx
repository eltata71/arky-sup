import React, { useEffect, useId } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { cn } from './cn';

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Accessible name of the dialog; the caller renders the visible heading with `titleId`. */
    titleId?: string;
    ariaLabel?: string;
    role?: 'dialog' | 'alertdialog';
    /** Tailwind max-width class for the panel. */
    widthClass?: string;
    panelClassName?: string;
    /** Default true; false lets the content own its padding (e.g. a banner strip). */
    padded?: boolean;
    children: React.ReactNode | ((ids: { titleId: string }) => React.ReactNode);
}

export const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    titleId,
    ariaLabel,
    role = 'dialog',
    widthClass = 'max-w-md',
    panelClassName,
    padded = true,
    children,
}) => {
    const generatedTitleId = useId();
    const labelledBy = titleId ?? generatedTitleId;
    const panelRef = useFocusTrap<HTMLDivElement>(isOpen);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                aria-hidden="true"
                className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <div
                ref={panelRef}
                role={role}
                aria-modal="true"
                aria-label={ariaLabel}
                aria-labelledby={ariaLabel ? undefined : labelledBy}
                className={cn(
                    'relative w-full bg-white dark:bg-gray-900 rounded-2xl shadow-2xl ring-1 ring-gray-900/5 dark:ring-white/10',
                    padded && 'p-6',
                    widthClass,
                    panelClassName,
                )}
            >
                {typeof children === 'function' ? children({ titleId: labelledBy }) : children}
            </div>
        </div>
    );
};
