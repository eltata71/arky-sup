import React, { createContext, useCallback, useContext, useId, useMemo, useRef } from 'react';
import { cn } from './cn';

export type TabsVariant = 'underline' | 'pill' | 'enclosed';
export type TabsSize = 'sm' | 'md';

interface TabsContextValue {
    value: string;
    onChange: (next: string) => void;
    variant: TabsVariant;
    size: TabsSize;
    baseId: string;
    registerTab: (value: string, el: HTMLButtonElement | null) => void;
    focusTab: (direction: 1 | -1 | 'first' | 'last', from: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
    const ctx = useContext(TabsContext);
    if (!ctx) {
        throw new Error(`<${component}> must be rendered inside <Tabs>.`);
    }
    return ctx;
}

export interface TabsProps {
    value: string;
    onChange: (next: string) => void;
    variant?: TabsVariant;
    size?: TabsSize;
    className?: string;
    'aria-label'?: string;
    children: React.ReactNode;
}

/**
 * Accessible tabs (WAI-ARIA Tabs Pattern): roving tabindex, ArrowLeft/Right
 * navigation, Home/End jumps, Enter/Space activates. Composed via
 * <Tabs><TabList><Tab/></TabList><TabPanel/></Tabs>.
 */
export const Tabs: React.FC<TabsProps> = ({
    value,
    onChange,
    variant = 'underline',
    size = 'md',
    className,
    children,
    ...rest
}) => {
    const baseId = useId();
    const tabsRef = useRef<Map<string, HTMLButtonElement>>(new Map());

    const registerTab = useCallback((tabValue: string, el: HTMLButtonElement | null) => {
        const map = tabsRef.current;
        if (el) map.set(tabValue, el);
        else map.delete(tabValue);
    }, []);

    const focusTab = useCallback((direction: 1 | -1 | 'first' | 'last', from: string) => {
        const map = tabsRef.current;
        const order = Array.from(map.keys());
        if (order.length === 0) return;
        let nextIndex: number;
        if (direction === 'first') nextIndex = 0;
        else if (direction === 'last') nextIndex = order.length - 1;
        else {
            const currentIndex = order.indexOf(from);
            nextIndex = (currentIndex + direction + order.length) % order.length;
        }
        const nextKey = order[nextIndex];
        const node = map.get(nextKey);
        if (node) node.focus();
    }, []);

    const ctx = useMemo<TabsContextValue>(
        () => ({ value, onChange, variant, size, baseId, registerTab, focusTab }),
        [value, onChange, variant, size, baseId, registerTab, focusTab],
    );

    return (
        <TabsContext.Provider value={ctx}>
            <div className={cn('flex flex-col', className)} {...rest}>
                {children}
            </div>
        </TabsContext.Provider>
    );
};

export interface TabListProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}

const listVariantStyles: Record<TabsVariant, string> = {
    underline: 'border-b border-gray-200 dark:border-gray-800 gap-1',
    pill: 'gap-1 p-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/60',
    enclosed: 'border-b border-gray-200 dark:border-gray-800 gap-1',
};

export const TabList: React.FC<TabListProps> = ({ children, className, ...rest }) => {
    const { variant } = useTabsContext('TabList');
    return (
        <div
            role="tablist"
            className={cn('inline-flex items-center flex-wrap', listVariantStyles[variant], className)}
            {...rest}
        >
            {children}
        </div>
    );
};

export interface TabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
    value: string;
    icon?: React.ReactNode;
    badge?: React.ReactNode;
    disabled?: boolean;
}

const tabBase = 'group relative inline-flex items-center justify-center gap-2 font-medium select-none transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950';

const tabSize: Record<TabsSize, string> = {
    sm: 'h-8 px-2.5 text-xs',
    md: 'h-10 px-3.5 text-sm',
};

const tabVariantStyles: Record<TabsVariant, { active: string; inactive: string; shape: string }> = {
    underline: {
        active: 'text-primary-700 dark:text-primary-300',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100',
        shape: 'border-b-2 -mb-px border-transparent aria-selected:border-primary-600 dark:aria-selected:border-primary-400',
    },
    pill: {
        active: 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100',
        shape: 'rounded-lg',
    },
    enclosed: {
        active: 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 border-b-white dark:border-b-gray-900',
        inactive: 'text-gray-600 dark:text-gray-400 border border-transparent hover:text-gray-900 dark:hover:text-gray-100',
        shape: 'rounded-t-lg -mb-px',
    },
};

export const Tab: React.FC<TabProps> = ({
    value,
    icon,
    badge,
    disabled,
    className,
    children,
    ...rest
}) => {
    const { value: active, onChange, variant, size, baseId, registerTab, focusTab } = useTabsContext('Tab');
    const isActive = active === value;
    const styles = tabVariantStyles[variant];

    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                event.preventDefault();
                focusTab(1, value);
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                event.preventDefault();
                focusTab(-1, value);
                break;
            case 'Home':
                event.preventDefault();
                focusTab('first', value);
                break;
            case 'End':
                event.preventDefault();
                focusTab('last', value);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                if (!disabled) onChange(value);
                break;
        }
    };

    return (
        <button
            ref={(el) => registerTab(value, el)}
            id={`${baseId}-tab-${value}`}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`${baseId}-panel-${value}`}
            tabIndex={isActive ? 0 : -1}
            disabled={disabled}
            onClick={() => !disabled && onChange(value)}
            onKeyDown={onKeyDown}
            className={cn(
                tabBase,
                tabSize[size],
                styles.shape,
                isActive ? styles.active : styles.inactive,
                disabled && 'opacity-50 cursor-not-allowed',
                className,
            )}
            {...rest}
        >
            {icon && <span className="flex-shrink-0">{icon}</span>}
            <span>{children}</span>
            {badge && <span className="ml-1 flex-shrink-0">{badge}</span>}
        </button>
    );
};

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
    value: string;
    /** Keep the panel mounted even when not active (preserves scroll/state). */
    keepMounted?: boolean;
}

export const TabPanel: React.FC<TabPanelProps> = ({
    value,
    keepMounted = false,
    className,
    children,
    ...rest
}) => {
    const { value: active, baseId } = useTabsContext('TabPanel');
    const isActive = active === value;
    if (!isActive && !keepMounted) return null;
    return (
        <div
            role="tabpanel"
            id={`${baseId}-panel-${value}`}
            aria-labelledby={`${baseId}-tab-${value}`}
            hidden={!isActive}
            tabIndex={0}
            className={cn('focus:outline-none', className)}
            {...rest}
        >
            {children}
        </div>
    );
};

export default Tabs;
