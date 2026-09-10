/**
 * Setup for the `node` test project.
 *
 * The node project runs the ~280 test files that exercise services, parsers,
 * validators and reducers — none of which render anything. It deliberately
 * loads no React and no Testing Library.
 *
 * A handful of those files still need a DOM (localStorage, DOMPurify, a
 * `Blob`) and say so with `// @vitest-environment jsdom` in their own header.
 * When one of them also asserts with a jest-dom matcher, the matcher has to
 * exist — so the matchers are loaded, and only loaded, when a document is
 * actually present. The check is what keeps the other ~280 files from paying
 * for it: in a real node environment this module resolves to nothing.
 *
 * `cleanup()` is not here on purpose. It belongs to Testing Library, and a
 * test that renders is a `.test.tsx` file in the `dom` project.
 */
if (typeof document !== 'undefined') {
    await import('@testing-library/jest-dom/vitest');
}

export {};
