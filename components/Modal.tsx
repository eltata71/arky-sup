import React, { ReactNode, useEffect, useId, useState } from 'react';
import { XMarkIcon } from './Icons';
import { motion, AnimatePresence } from 'motion/react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { observabilityService } from '../services/observability';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * Subtitle under the title. Rendered as ordinary visible text and *not*
   * wired to `aria-describedby`: referencing visible content as a description
   * makes VoiceOver read it once on entering the dialog and again on reaching
   * it. See rule 6 in `lib/a11y.ts`.
   */
  description?: string;
}

/**
 * Generic modal with motion-driven enter/exit, drag-to-dismiss on mobile,
 * focus trap, Escape-to-close and ARIA-correct dialog semantics.
 *
 * Keyboard contract:
 *  - Tab / Shift+Tab cycle within the modal (focus trap).
 *  - Escape closes the modal.
 *  - Focus returns to the element that opened the dialog.
 */
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, description }) => {
  const titleId = useId();
  const containerRef = useFocusTrap<HTMLDivElement>(isOpen);
  const [resilienceMode, setResilienceMode] = useState(() => observabilityService.getResilienceProfile().shouldUseResilienceMode);

  useEffect(() => {
    if (!isOpen) return;
    setResilienceMode(observabilityService.getResilienceProfile().shouldUseResilienceMode || document.documentElement.classList.contains('arky-resilience-mode'));
  }, [isOpen]);

  // Escape-to-close.  We register only when open so we don't leak listeners.
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

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-6">
            {/* Backdrop with blur */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={resilienceMode ? 'fixed inset-0 bg-gray-950/80' : 'fixed inset-0 bg-gray-900/60 backdrop-blur-sm'}
                onClick={onClose}
                aria-hidden
            />

            {/* Modal Content */}
            <motion.div
                ref={containerRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                initial={resilienceMode ? false : { y: '100%', opacity: 0 }}
                animate={resilienceMode ? undefined : { y: 0, opacity: 1 }}
                exit={resilienceMode ? undefined : { y: '100%', opacity: 0 }}
                transition={resilienceMode ? undefined : { type: 'spring', damping: 25, stiffness: 300 }}
                drag={resilienceMode ? false : 'y'}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={resilienceMode ? 0 : 0.2}
                onDragEnd={(_, { offset, velocity }) => {
                    if (offset.y > 100 || velocity.y > 500) {
                        onClose();
                    }
                }}
                className="relative bg-white dark:bg-gray-900 w-full max-h-[90vh] sm:max-w-2xl rounded-xl shadow-2xl flex flex-col ring-1 ring-gray-900/5 dark:ring-white/10"
                onClick={e => e.stopPropagation()}
            >
                {/* Drag Handle for Mobile */}
                <div className="w-full flex justify-center pt-3 pb-1 sm:hidden cursor-grab active:cursor-grabbing" aria-hidden>
                    <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full" />
                </div>

                <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white leading-6 truncate">{title}</h2>
                        {description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{description}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Cerrar"
                        className="p-2.5 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {children}
                </div>
            </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
