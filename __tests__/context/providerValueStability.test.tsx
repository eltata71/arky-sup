/**
 * Every context provider must hand down a memoised value.
 *
 * The defect this guards was not ignorance of the pattern: four of the eight
 * providers already memoised correctly. It was that the pattern was applied to
 * each context as it was written and never backfilled into the four oldest —
 * which happened to be the four with the widest reach. `AppContext` alone sits
 * above every route with forty consumers, and passed a fresh object literal on
 * every render, so all forty re-rendered whenever anything in it changed, for
 * any reason, including changes none of them read.
 *
 * There are two checks here because they fail for different reasons:
 *
 *   - the **source scan** catches a provider written without a memo at all,
 *     including one added tomorrow that no rendering test covers yet;
 *   - the **identity tests** catch a memo that exists but does nothing, because
 *     something inside it is rebuilt on every render. A `useMemo` whose
 *     dependencies churn is decoration, and only a render can tell.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import React, { useState } from 'react';
import { act, render, screen } from '@testing-library/react';

/* ------------------------------------------------------------ source scan */

const CONTEXT_DIR = 'context';

const providerFiles = (): string[] =>
  readdirSync(CONTEXT_DIR)
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => join(CONTEXT_DIR, entry));

describe('every provider memoises the value it publishes', () => {
  const files = providerFiles();

  it('finds the provider files to scan', () => {
    // A scan that silently matches nothing always passes.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)('%s builds its value with useMemo', (file) => {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('.Provider')) return;
    expect(source).toMatch(/const value = useMemo/);
  });

  it.each(files)('%s does not pass an inline object literal to .Provider', (file) => {
    const source = readFileSync(file, 'utf8');
    // `value={{ ... }}` is a new object on every render by construction — no
    // dependency list can save it, because there is nowhere to put one.
    expect(source).not.toMatch(/\.Provider\s+value=\{\{/);
  });

  it.each(files)('%s passes the memoised binding, not a fresh expression', (file) => {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('.Provider')) return;
    const providerTags = source.match(/\.Provider\s+value=\{([^}]*)\}/g) ?? [];
    for (const tag of providerTags) {
      expect(tag).toMatch(/value=\{value\}/);
    }
  });
});

/* -------------------------------------------------------- identity in fact */

/**
 * Render a provider, force a re-render that changes nothing it publishes, and
 * report whether the context value kept its identity.
 *
 * The value is read through the module's public hook rather than its context
 * object, which most of these modules keep private — and which is the right
 * surface anyway: what consumers actually receive is what matters here.
 *
 * The re-render is driven from a parent, which is the case that matters: a
 * provider high in the tree re-renders because *something above it* did, and
 * that is precisely when an unmemoised value used to invalidate every consumer
 * below.
 *
 * Identity is measured from a baseline taken *after* mount settles. A provider
 * may legitimately publish once more on mount — `ObservabilityContext` records
 * an event from its own effect, which really is new data — and counting that as
 * churn would make this test fail for the one reason it should not.
 */
function measureIdentity(
  Provider: React.ComponentType<{ children: React.ReactNode }>,
  useValue: () => unknown,
): { rerender: () => void; identities: () => unknown[]; baseline: () => unknown } {
  const seen: unknown[] = [];
  let bump: (() => void) | undefined;

  const Probe: React.FC = () => {
    seen.push(useValue());
    return <span data-testid="probe">{seen.length}</span>;
  };

  const Host: React.FC = () => {
    const [tick, setTick] = useState(0);
    bump = () => setTick((n) => n + 1);
    return (
      <Provider>
        <span data-testid="tick">{tick}</span>
        <Probe />
      </Provider>
    );
  };

  render(<Host />);
  const settled = seen.length;
  return {
    rerender: () => act(() => bump?.()),
    identities: () => seen.slice(settled - 1),
    baseline: () => seen[settled - 1],
  };
}

describe('the memo holds across an unrelated re-render', () => {
  it('ToastContext keeps one identity when a parent re-renders', async () => {
    const { ToastProvider, useToast } = await import('../../context/ToastContext');

    const probe = measureIdentity(
      ToastProvider as React.ComponentType<{ children: React.ReactNode }>,
      useToast,
    );

    const baseline = probe.baseline();
    probe.rerender();
    probe.rerender();

    expect(screen.getByTestId('tick').textContent).toBe('2');
    const identities = probe.identities();
    expect(identities.length).toBeGreaterThanOrEqual(3);
    // Every observation is the same object the consumer already had: the parent
    // re-rendered twice and consumers saw no reason to.
    expect(new Set(identities).size).toBe(1);
    expect(identities[identities.length - 1]).toBe(baseline);
  });

  it('ObservabilityContext keeps one identity when a parent re-renders', async () => {
    const { ObservabilityProvider, useObservability } = await import(
      '../../context/ObservabilityContext'
    );

    const probe = measureIdentity(
      ObservabilityProvider as React.ComponentType<{ children: React.ReactNode }>,
      useObservability,
    );
    const baseline = probe.baseline();
    probe.rerender();
    probe.rerender();

    expect(new Set(probe.identities()).size).toBe(1);
    expect(probe.baseline()).toBe(baseline);
  });
});

describe('the memo still lets real changes through', () => {
  /**
   * The failure mode opposite to the one above: a value so aggressively frozen
   * that consumers stop seeing updates. A memo with a missing dependency is a
   * stale closure, which is worse than the re-renders it was meant to avoid.
   */
  it('ToastContext publishes a new identity when a toast is added', async () => {
    const { ToastProvider, useToast } = await import('../../context/ToastContext');

    const seen: unknown[] = [];
    let add: (() => void) | undefined;

    const Probe: React.FC = () => {
      const value = useToast();
      seen.push(value);
      add = () => value.addToast('mensaje de prueba', 'info');
      return null;
    };

    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );

    const before = seen.length;
    act(() => add?.());

    expect(seen.length).toBeGreaterThan(before);
    expect(seen[seen.length - 1]).not.toBe(seen[0]);
    expect((seen[seen.length - 1] as { toasts: unknown[] }).toasts).toHaveLength(1);
  });
});
