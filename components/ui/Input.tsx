import React, { forwardRef } from 'react';
import { cn } from './cn';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
    leftIcon?: React.ReactNode;
    rightSlot?: React.ReactNode;
    invalid?: boolean;
    inputSize?: 'sm' | 'md' | 'lg';
}

const sizeStyles = {
    sm: 'h-8 text-sm rounded-md',
    md: 'h-10 text-sm rounded-lg',
    lg: 'h-12 text-base rounded-xl',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
    { leftIcon, rightSlot, invalid, inputSize = 'md', className, ...rest },
    ref,
) {
    return (
        <div className={cn('relative flex items-center', className)}>
            {leftIcon && (
                <span className="absolute left-3 flex items-center justify-center text-gray-400 dark:text-gray-500 pointer-events-none">
                    {leftIcon}
                </span>
            )}
            <input
                ref={ref}
                aria-invalid={invalid || undefined}
                className={cn(
                    'w-full bg-white dark:bg-gray-900 border text-gray-900 dark:text-gray-100',
                    'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                    'shadow-sm focus:outline-none transition-colors duration-150',
                    'focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20',
                    'disabled:opacity-60 disabled:cursor-not-allowed',
                    invalid
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                        : 'border-gray-200 dark:border-gray-800',
                    sizeStyles[inputSize],
                    leftIcon ? 'pl-9' : 'pl-3',
                    rightSlot ? 'pr-10' : 'pr-3',
                )}
                {...rest}
            />
            {rightSlot && (
                <span className="absolute right-2 flex items-center justify-center">
                    {rightSlot}
                </span>
            )}
        </div>
    );
});

Input.displayName = 'Input';

export default Input;
