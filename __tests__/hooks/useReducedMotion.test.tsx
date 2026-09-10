import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type Listener = (event: MediaQueryListEvent) => void;

interface MockMql {
    matches: boolean;
    media: string;
    onchange: ((event: MediaQueryListEvent) => void) | null;
    addEventListener: (type: string, cb: Listener) => void;
    removeEventListener: (type: string, cb: Listener) => void;
    addListener: (cb: Listener) => void;
    removeListener: (cb: Listener) => void;
    dispatchEvent: () => boolean;
    _setMatches: (next: boolean) => void;
}

function createMockMql(matches: boolean): MockMql {
    const listeners = new Set<Listener>();
    const mql: MockMql = {
        matches,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: (_: string, cb: Listener) => { listeners.add(cb); },
        removeEventListener: (_: string, cb: Listener) => { listeners.delete(cb); },
        addListener: (cb: Listener) => { listeners.add(cb); },
        removeListener: (cb: Listener) => { listeners.delete(cb); },
        dispatchEvent: () => true,
        _setMatches(next: boolean) {
            this.matches = next;
            for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent);
        },
    };
    return mql;
}

describe('useReducedMotion', () => {
    let originalMatchMedia: typeof window.matchMedia | undefined;

    beforeEach(() => {
        originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
        if (originalMatchMedia) {
            window.matchMedia = originalMatchMedia;
        }
    });

    it('returns false when the user has not opted into reduced motion', () => {
        const mql = createMockMql(false);
        window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
        const { result } = renderHook(() => useReducedMotion());
        expect(result.current).toBe(false);
    });

    it('returns true when the media query matches', () => {
        const mql = createMockMql(true);
        window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
        const { result } = renderHook(() => useReducedMotion());
        expect(result.current).toBe(true);
    });

    it('reacts to media-query changes', () => {
        const mql = createMockMql(false);
        window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
        const { result } = renderHook(() => useReducedMotion());
        expect(result.current).toBe(false);
        act(() => { mql._setMatches(true); });
        expect(result.current).toBe(true);
    });
});
