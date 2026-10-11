/**
 * 13.5 — four microinteractions, each earned by a domain event, none looping,
 * all off with reduced motion.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MICRO, MICRO_EVENTS } from '../../lib/designTokens';
import { Appear, CelebrateOnce, CompletionMark, hasCelebrated } from '../../components/ui/micro';

const setReducedMotion = (reduced: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('reduce'), media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }),
  });
};

beforeEach(() => { setReducedMotion(false); window.localStorage.clear(); });
afterEach(() => window.localStorage.clear());

describe('the vocabulary', () => {
  it('has the four shapes the plan declares', () => {
    expect(MICRO.appear.initial).toEqual({ opacity: 0, y: 8 });
    expect(MICRO.appear.transition.duration).toBe(0.18);
    expect(MICRO.complete.duration).toBe(0.4);
    expect(Object.keys(MICRO).sort()).toEqual(['appear', 'celebrate', 'complete', 'reorder']);
  });

  it('names the domain event behind each one, and the doc carries the same table', () => {
    const doc = readFileSync('docs/microinteracciones.md', 'utf8');
    for (const events of Object.values(MICRO_EVENTS)) {
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) expect(doc.toLowerCase()).toContain(event.toLowerCase());
    }
  });
});

describe('completar', () => {
  it('draws only when the thing becomes done while on screen', () => {
    const { rerender } = render(<CompletionMark done={false} label="Charter aprobado" />);
    expect(screen.queryByRole('img')).toBeNull();
    rerender(<CompletionMark done label="Charter aprobado" />);
    expect(screen.getByRole('img', { name: 'Charter aprobado' })).toHaveAttribute('data-animated', 'true');
  });

  it('is simply there when it was already done on arrival', () => {
    render(<CompletionMark done label="Charter aprobado" />);
    expect(screen.getByRole('img', { name: 'Charter aprobado' })).toHaveAttribute('data-animated', 'false');
  });

  it('does not draw with reduced motion', () => {
    setReducedMotion(true);
    const { rerender } = render(<CompletionMark done={false} label="Generación terminada" />);
    rerender(<CompletionMark done label="Generación terminada" />);
    expect(screen.getByRole('img', { name: 'Generación terminada' })).toHaveAttribute('data-animated', 'false');
  });
});

describe('celebrar una vez', () => {
  it('celebrates a package once, and never again for the same package', () => {
    const first = render(<CelebrateOnce id="pkg-1" active message="Paquete publicado" />);
    expect(screen.getByRole('status')).toHaveTextContent('Paquete publicado');
    expect(screen.getByTestId('celebrate-ring')).toBeInTheDocument();
    expect(hasCelebrated('pkg-1')).toBe(true);
    first.unmount();
    render(<CelebrateOnce id="pkg-1" active message="Paquete publicado" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says it without moving with reduced motion', () => {
    setReducedMotion(true);
    render(<CelebrateOnce id="pkg-2" active message="Paquete publicado" />);
    expect(screen.getByRole('status')).toHaveTextContent('Paquete publicado');
    expect(screen.queryByTestId('celebrate-ring')).toBeNull();
  });
});

describe('aparecer', () => {
  it('renders plainly with reduced motion', () => {
    setReducedMotion(true);
    const { container } = render(<Appear>contenido</Appear>);
    expect(container.firstElementChild?.getAttribute('style') ?? '').not.toMatch(/opacity|transform/);
  });
});

/** Progress indicators may loop; nothing else may. This list only shrinks. */
const LOOPING_PROGRESS_INDICATORS = [
  'components/ExcalidrawViewer.tsx',
  'components/architectureOffice/TeamCoordinationPanel.tsx',
  'components/artifacts/diagram/DiagramSkeleton.tsx',
  'components/ui/AIArchitectIdentity.tsx',
];

const tsx = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === '__tests__' ? [] : tsx(path);
  return /\.tsx$/.test(name) ? [path] : [];
});

describe('nothing loops except progress', () => {
  it('only the listed progress indicators repeat forever', () => {
    const looping = ['components', 'pages']
      .flatMap(tsx)
      .filter((file) => /repeat:\s*Infinity/.test(readFileSync(file, 'utf8')))
      .sort();
    expect(looping).toEqual([...LOOPING_PROGRESS_INDICATORS].sort());
  });
});
