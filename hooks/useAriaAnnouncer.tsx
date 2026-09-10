import React, { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect, ReactNode } from 'react';

export type Politeness = 'polite' | 'assertive';

interface AriaAnnouncerContextValue {
    /**
     * Announce a string to screen readers. `polite` waits for an opening in
     * the user's listening; `assertive` interrupts. Use assertive only for
     * critical errors (lost data, failed save).
     */
    announce: (message: string, politeness?: Politeness) => void;
}

const AriaAnnouncerContext = createContext<AriaAnnouncerContextValue | null>(null);

const ANNOUNCEMENT_TIMEOUT_MS = 6_000;

/**
 * Global aria-live announcer. Wrap the app once near the root; consumers
 * call `useAriaAnnouncer().announce(...)` after an action whose outcome is
 * not visually obvious (auto-saved, version restored, AI finished writing).
 *
 * Two live regions are rendered (polite + assertive) and the announcement
 * text is cleared a few seconds later so the same message can be announced
 * again later.
 */
export const AriaAnnouncerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [politeMessage, setPoliteMessage] = useState('');
    const [assertiveMessage, setAssertiveMessage] = useState('');
    const politeTimer = useRef<number | null>(null);
    const assertiveTimer = useRef<number | null>(null);

    const announce = useCallback((message: string, politeness: Politeness = 'polite') => {
        if (!message) return;
        if (politeness === 'assertive') {
            if (assertiveTimer.current) window.clearTimeout(assertiveTimer.current);
            // Forcing a state change by clearing first lets repeat announcements re-fire.
            setAssertiveMessage('');
            window.requestAnimationFrame(() => setAssertiveMessage(message));
            assertiveTimer.current = window.setTimeout(() => setAssertiveMessage(''), ANNOUNCEMENT_TIMEOUT_MS);
        } else {
            if (politeTimer.current) window.clearTimeout(politeTimer.current);
            setPoliteMessage('');
            window.requestAnimationFrame(() => setPoliteMessage(message));
            politeTimer.current = window.setTimeout(() => setPoliteMessage(''), ANNOUNCEMENT_TIMEOUT_MS);
        }
    }, []);

    useEffect(() => () => {
        if (politeTimer.current) window.clearTimeout(politeTimer.current);
        if (assertiveTimer.current) window.clearTimeout(assertiveTimer.current);
    }, []);

    const value = useMemo<AriaAnnouncerContextValue>(() => ({ announce }), [announce]);

    return (
        <AriaAnnouncerContext.Provider value={value}>
            {children}
            <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="aria-announcer-polite">
                {politeMessage}
            </div>
            <div className="sr-only" aria-live="assertive" aria-atomic="true" role="alert" data-testid="aria-announcer-assertive">
                {assertiveMessage}
            </div>
        </AriaAnnouncerContext.Provider>
    );
};

/**
 * Returns the announcer. Outside the provider, returns a no-op announcer so
 * tests and isolated components can call `announce()` without crashing.
 */
export function useAriaAnnouncer(): AriaAnnouncerContextValue {
    const ctx = useContext(AriaAnnouncerContext);
    if (!ctx) {
        return { announce: () => undefined };
    }
    return ctx;
}

export default useAriaAnnouncer;
