/**
 * ContextDeduplicator — consolidates raw entity signals into canonical
 * `ContextEntity` records.
 *
 * Two signals describe the same entity when their type and normalized label
 * match. Merging:
 *  - unions the sources and signal ids,
 *  - merges divergent spellings as `aliases`,
 *  - keeps the strongest confidence and boosts it slightly when independent
 *    sources agree,
 *  - prefers `explicit` over `inferred` for the consolidated mode.
 */

import type { ContextEntity, ContextSignal, ContextSource } from './contextGraphTypes';
import { contextFreshnessEvaluator, type FreshnessOptions } from './contextFreshnessEvaluator';
import { normalizeLabel, slugify } from './contextSignalExtractor';

const MAX_ALIAS_LENGTH = 40;

const uniqueSources = (sources: ContextSource[]): ContextSource[] => {
  const seen = new Set<string>();
  const out: ContextSource[] = [];
  for (const source of sources) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    out.push(source);
  }
  return out;
};

export class ContextDeduplicator {
  dedupe(signals: ContextSignal[], options: FreshnessOptions = {}): ContextEntity[] {
    const groups = new Map<string, ContextSignal[]>();
    for (const signal of signals) {
      if (signal.kind !== 'entity' || !signal.entityType) continue;
      const key = `${signal.entityType}|${normalizeLabel(signal.label)}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(signal);
      else groups.set(key, [signal]);
    }

    const entities: ContextEntity[] = [];
    for (const bucket of groups.values()) {
      const first = bucket[0];
      const type = first.entityType!;
      const label = first.label.trim();
      const normalizedLabel = normalizeLabel(label);

      const aliases = new Set<string>();
      const tags = new Set<string>();
      let confidence = 0;
      let hasExplicit = false;
      const allSources: ContextSource[] = [];
      const signalIds: string[] = [];

      for (const signal of bucket) {
        signalIds.push(signal.id);
        allSources.push(signal.source);
        confidence = Math.max(confidence, signal.confidence);
        if (signal.mode === 'explicit') hasExplicit = true;
        for (const tag of signal.tags) tags.add(tag);
        const rawText = signal.text.trim();
        if (
          rawText.length > 0 &&
          rawText.length <= MAX_ALIAS_LENGTH &&
          normalizeLabel(rawText) !== normalizedLabel
        ) {
          aliases.add(rawText);
        }
      }

      const sources = uniqueSources(allSources);
      // Independent agreement is evidence: nudge confidence up per extra source.
      const boosted = Math.min(1, confidence + 0.04 * (sources.length - 1));

      entities.push({
        id: `${type}:${slugify(label)}`,
        type,
        label,
        aliases: Array.from(aliases),
        mode: hasExplicit ? 'explicit' : 'inferred',
        confidence: Number(boosted.toFixed(3)),
        sources,
        signalIds,
        freshness: contextFreshnessEvaluator.evaluate(sources, options),
        tags: Array.from(tags),
      });
    }

    // Stable order: explicit first, then by confidence, then alphabetically.
    entities.sort((a, b) => {
      if (a.mode !== b.mode) return a.mode === 'explicit' ? -1 : 1;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.label.localeCompare(b.label);
    });
    return entities;
  }
}

export const contextDeduplicator = new ContextDeduplicator();
