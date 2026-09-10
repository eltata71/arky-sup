/**
 * ContextFreshnessEvaluator — decides whether a set of sources is fresh or
 * possibly outdated.
 *
 * A source's effective date is its `updatedAt` when known (e.g. an artifact's
 * `createdAt`), otherwise the extraction timestamp. An entity is flagged stale
 * when its newest contributing source is older than `staleAfterDays`.
 */

import type { ContextFreshness, ContextSource } from './contextGraphTypes';

export const DEFAULT_STALE_AFTER_DAYS = 120;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface FreshnessOptions {
  /** Days after which a source is considered stale. */
  staleAfterDays?: number;
  /** ISO override of "now". Defaults to the current time. */
  now?: string;
}

const effectiveDate = (source: ContextSource): string | undefined =>
  source.updatedAt ?? source.extractedAt;

export class ContextFreshnessEvaluator {
  evaluate(sources: ContextSource[], options: FreshnessOptions = {}): ContextFreshness {
    const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
    const nowMs = options.now ? Date.parse(options.now) : Date.now();

    let newest: number | undefined;
    let oldest: number | undefined;
    let newestIso: string | undefined;
    let oldestIso: string | undefined;

    for (const source of sources) {
      const iso = effectiveDate(source);
      if (!iso) continue;
      const ts = Date.parse(iso);
      if (!Number.isFinite(ts)) continue;
      if (newest === undefined || ts > newest) {
        newest = ts;
        newestIso = iso;
      }
      if (oldest === undefined || ts < oldest) {
        oldest = ts;
        oldestIso = iso;
      }
    }

    if (newest === undefined) {
      return { stale: false, staleAfterDays };
    }

    const ageDays = Math.max(0, Math.round((nowMs - newest) / MS_PER_DAY));
    return {
      lastSeenAt: newestIso,
      firstSeenAt: oldestIso,
      ageDays,
      stale: ageDays > staleAfterDays,
      staleAfterDays,
    };
  }
}

export const contextFreshnessEvaluator = new ContextFreshnessEvaluator();
