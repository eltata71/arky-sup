import { render, waitFor } from '@testing-library/react';
import { MotionConfig, motion } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

function simulateReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

function Box() {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div data-testid="box" initial={{ x: 100 }} animate={{ x: 0 }} transition={{ duration: 30 }} />
    </MotionConfig>
  );
}

describe('13.1 · movimiento reducido', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('con prefers-reduced-motion la transformación salta al destino', async () => {
    simulateReducedMotion(true);
    const { getByTestId } = render(<Box />);
    await waitFor(() => expect(getByTestId('box').style.transform).not.toContain('100px'), { timeout: 1500 });
  });
});
