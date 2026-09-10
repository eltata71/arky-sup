/**
 * Setup for the `dom` test project only.
 *
 * Wires up jest-dom matchers and guarantees every test unmounts the React tree
 * it rendered — without the `cleanup()`, multiple tests in one file accumulate
 * DOM nodes and `screen.getByRole` returns surprising matches from previous
 * renders.
 *
 * This used to be the *global* setup, which meant every one of the 371 test
 * files imported React and Testing Library, including the ~270 that render
 * nothing. That was 58 s of the suite's `setup` time spent loading a library
 * most files never call. It now loads only where something is rendered; the
 * `node` project has no setup file at all.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
    cleanup();
});
