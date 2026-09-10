import React from 'react';
import { motion } from 'motion/react';
import { cn } from './cn';

export type AIState = 'idle' | 'thinking' | 'streaming' | 'error';

export interface AIArchitectAvatarProps {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    state?: AIState;
    className?: string;
}

const sizeMap = {
    sm: 'h-8 w-8 text-sm',
    md: 'h-10 w-10 text-base',
    lg: 'h-12 w-12 text-lg',
    xl: 'h-16 w-16 text-2xl',
};

/**
 * Identity avatar for the "Arquitecto Agente" (AI Architect).  Uses the AI
 * gradient and a tiny status indicator that pulses while thinking/streaming.
 * The visual stays the same across the app so users learn to recognise the
 * persona instantly.
 */
export const AIArchitectAvatar: React.FC<AIArchitectAvatarProps> = ({ size = 'md', state = 'idle', className }) => {
    const isAnimating = state === 'thinking' || state === 'streaming';
    return (
        <span className={cn('relative inline-flex flex-shrink-0', className)}>
            <motion.span
                animate={isAnimating ? { scale: [1, 1.05, 1], opacity: [0.92, 1, 0.92] } : { scale: 1, opacity: 1 }}
                transition={isAnimating ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
                className={cn(
                    'inline-flex items-center justify-center rounded-2xl shadow-glow-ai',
                    'bg-ai-gradient bg-[length:200%_200%]',
                    isAnimating && 'animate-gradient-shift',
                    sizeMap[size],
                )}
                aria-hidden
            >
                {/* Stylised "A" — the architect monogram */}
                <svg viewBox="0 0 24 24" fill="none" className="h-1/2 w-1/2 text-white">
                    <path d="M12 3.5L4 20h3.2l1.6-3.7h6.4L16.8 20H20L12 3.5zm-2.1 10l2.1-4.9 2.1 4.9H9.9z" fill="currentColor" />
                </svg>
            </motion.span>
            {/* Status dot */}
            {state !== 'idle' && (
                <span
                    className={cn(
                        'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-gray-900',
                        state === 'error' && 'bg-red-500',
                        state === 'thinking' && 'bg-amber-400 animate-ai-pulse',
                        state === 'streaming' && 'bg-emerald-400 animate-ai-pulse',
                    )}
                    aria-hidden
                />
            )}
        </span>
    );
};

export interface AIArchitectChipProps {
    name?: string;
    state?: AIState;
    subtitle?: string;
    className?: string;
}

/** Inline chip — avatar + name + status, used in chat headers and CTAs. */
export const AIArchitectChip: React.FC<AIArchitectChipProps> = ({
    name = 'Arquitecto Agente',
    state = 'idle',
    subtitle,
    className,
}) => {
    const stateLabel: Record<AIState, string> = {
        idle: 'En línea',
        thinking: 'Razonando…',
        streaming: 'Respondiendo…',
        error: 'Reintentar',
    };
    return (
        <div className={cn('flex items-center gap-3', className)}>
            <AIArchitectAvatar size="sm" state={state} />
            <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {name}
                </div>
                <div className="text-2xs text-gray-500 dark:text-gray-400 truncate">
                    {subtitle ?? stateLabel[state]}
                </div>
            </div>
        </div>
    );
};

export default AIArchitectAvatar;
