/**
 * useFocusTrap — keep keyboard focus inside a container while it is open.
 *
 * Required for WCAG 2.1: dialogs, drawers, command palettes and the keyboard
 * shortcuts cheatsheet must not let `Tab` walk out into the page behind them.
 *
 * Behaviour:
 *  - On open, we move focus to the first focusable element inside the
 *    container (or the container itself if none is found).
 *  - `Tab` from the last focusable wraps to the first; `Shift+Tab` from the
 *    first wraps to the last.
 *  - On close, focus is restored to whatever element had focus *before* the
 *    trap engaged — so the architect's keyboard navigation is not disrupted.
 *
 * The query intentionally excludes elements with `aria-hidden`, `disabled`,
 * `tabindex="-1"` and offscreen items — same set you get from
 * `inert`-style traps in design systems like Radix.
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    'details summary',
    'audio[controls]',
    'video[controls]',
    '[contenteditable]:not([contenteditable="false"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
    const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    return nodes.filter((el) => {
        if (el.hasAttribute('disabled')) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        if (el.tabIndex === -1) return false;
        // Skip elements that are not visible (display:none / visibility:hidden / 0-size).
        const rects = el.getClientRects();
        return rects.length > 0;
    });
}

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
    const containerRef = useRef<T | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!active) return;
        const container = containerRef.current;
        if (!container) return;

        previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;

        // Focus the first focusable child on the next frame — many components
        // mount via AnimatePresence, so DOM nodes are not yet measurable on the
        // synchronous tick.
        const focusFrame = window.requestAnimationFrame(() => {
            const focusables = getFocusable(container);
            const target = focusables[0] ?? container;
            // `tabIndex` ensures the container itself can receive focus when
            // it has no focusable children yet.
            if (target === container && container.tabIndex < 0) container.tabIndex = -1;
            target.focus({ preventScroll: false });
        });

        const handleKey = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            const focusables = getFocusable(container);
            if (focusables.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement as HTMLElement | null;

            if (event.shiftKey) {
                if (active === first || !container.contains(active)) {
                    event.preventDefault();
                    last.focus();
                }
            } else {
                if (active === last || !container.contains(active)) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKey);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', handleKey);
            // Restore focus only if the previously-focused element is still
            // mounted — otherwise we'd throw a TypeError in some browsers.
            const previous = previouslyFocusedRef.current;
            if (previous && document.body.contains(previous)) {
                try { previous.focus({ preventScroll: true }); } catch { /* noop */ }
            }
            previouslyFocusedRef.current = null;
        };
    }, [active]);

    return containerRef;
}
