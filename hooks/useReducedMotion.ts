import { useEffect, useState } from 'react';

/**
 * Subscribes to the `prefers-reduced-motion: reduce` media query and returns
 * `true` when the user has opted out of non-essential motion.
 *
 * Use this to gate heavy enter/exit animations, parallax scenes, marquee
 * shimmer, etc. Toast, dialogs and other non-decorative motion already
 * respect the global CSS rule in index.html (which pauses keyframe-based
 * animations); this hook lets React components branch their JS-driven
 * motion (motion.div spring transitions, route transitions) the same way.
 *
 * SSR-safe: returns `false` until the first effect runs.
 */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState<boolean>(false);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(!!mql.matches);
        update();

        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', update);
            return () => mql.removeEventListener('change', update);
        }
        // Safari < 14 fallback.
        const legacy = mql as unknown as { addListener?: (cb: () => void) => void; removeListener?: (cb: () => void) => void };
        legacy.addListener?.(update);
        return () => legacy.removeListener?.(update);
    }, []);

    return reduced;
}

export default useReducedMotion;
