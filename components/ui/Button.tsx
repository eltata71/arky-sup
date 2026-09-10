import React, { forwardRef } from 'react';
import { cn } from './cn';

export type ButtonVariant =
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'danger'
    | 'success'
    | 'ai'
    | 'outline';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Optional left icon (renders to the left of the label). */
    leftIcon?: React.ReactNode;
    /** Optional right icon (renders to the right of the label). */
    rightIcon?: React.ReactNode;
    /** Show a loading spinner and disable the button. */
    loading?: boolean;
    /** Fill the parent width. */
    fullWidth?: boolean;
    /** Render as an icon-only square button — applies square padding & a11y label. */
    iconOnly?: boolean;
}

const sizeStyles: Record<ButtonSize, string> = {
    xs: 'h-7 px-2 text-xs gap-1.5 rounded-md',
    sm: 'h-8 px-3 text-sm gap-1.5 rounded-md',
    md: 'h-10 px-4 text-sm gap-2 rounded-lg',
    lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
};

const iconOnlyStyles: Record<ButtonSize, string> = {
    xs: 'h-7 w-7 p-0',
    sm: 'h-9 w-9 p-0',
    md: 'h-10 w-10 p-0',
    lg: 'h-12 w-12 p-0',
};

const variantStyles: Record<ButtonVariant, string> = {
    primary: [
        'bg-primary-600 text-white shadow-sm',
        'hover:bg-primary-700 active:bg-primary-800',
        'disabled:bg-primary-400 dark:disabled:bg-primary-900',
    ].join(' '),
    secondary: [
        'bg-white text-gray-900 border border-gray-200 shadow-sm',
        'hover:bg-gray-50 active:bg-gray-100',
        'dark:bg-gray-900 dark:text-gray-100 dark:border-gray-800',
        'dark:hover:bg-gray-800 dark:active:bg-gray-700',
    ].join(' '),
    outline: [
        'bg-transparent text-gray-700 border border-gray-300',
        'hover:bg-gray-50 hover:border-gray-400',
        'dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800',
    ].join(' '),
    ghost: [
        'bg-transparent text-gray-700',
        'hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
    ].join(' '),
    danger: [
        'bg-red-600 text-white shadow-sm',
        'hover:bg-red-700 active:bg-red-800',
    ].join(' '),
    success: [
        'bg-green-600 text-white shadow-sm',
        'hover:bg-green-700 active:bg-green-800',
    ].join(' '),
    ai: [
        'bg-ai-gradient text-white shadow-glow-ai bg-[length:200%_200%]',
        'hover:bg-[position:100%_50%] hover:shadow-glow-primary',
        'transition-[background-position,box-shadow]',
    ].join(' '),
};

const Spinner: React.FC<{ size: ButtonSize }> = ({ size }) => {
    const dim = size === 'xs' ? 'h-3 w-3' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
    return (
        <svg className={cn(dim, 'animate-spin')} fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
    );
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = 'primary',
        size = 'md',
        leftIcon,
        rightIcon,
        loading = false,
        fullWidth = false,
        iconOnly = false,
        disabled,
        className,
        children,
        type = 'button',
        ...rest
    },
    ref,
) {
    const isDisabled = disabled || loading;
    return (
        <button
            ref={ref}
            type={type}
            disabled={isDisabled}
            aria-busy={loading || undefined}
            className={cn(
                'inline-flex items-center justify-center font-medium select-none',
                'transition-all duration-150 ease-out',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                'active:scale-[0.98]',
                iconOnly ? iconOnlyStyles[size] : sizeStyles[size],
                variantStyles[variant],
                fullWidth && 'w-full',
                className,
            )}
            {...rest}
        >
            {loading ? <Spinner size={size} /> : leftIcon}
            {!iconOnly && children}
            {!loading && rightIcon}
        </button>
    );
});

Button.displayName = 'Button';

export default Button;
