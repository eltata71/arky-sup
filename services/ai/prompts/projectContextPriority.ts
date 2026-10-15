import { ARCHITECTURE_SIGNAL_PATTERN } from './artifactContext';

interface ScoredItem {
    item: string;
    index: number;
    score: number;
}

/** Picks the architectural notes while preserving their original order. */
export function prioritizeProjectContext(rawItems: readonly string[], opts: { limit: number }): string[] {
    const cleaned: ScoredItem[] = [];
    rawItems.forEach((raw, idx) => {
        const item = (raw ?? '').trim();
        if (!item) return;
        const recencyWeight = idx / Math.max(1, rawItems.length - 1);
        const keywordBoost = ARCHITECTURE_SIGNAL_PATTERN.test(item) ? 2 : 0;
        const lengthSanity = item.length < 12 ? -1 : 0;
        cleaned.push({ item, index: idx, score: recencyWeight + keywordBoost + lengthSanity });
    });

    if (cleaned.length <= opts.limit) {
        return cleaned.sort((a, b) => a.index - b.index).map((c) => c.item);
    }

    const top = [...cleaned]
        .sort((a, b) => b.score - a.score || b.index - a.index)
        .slice(0, opts.limit)
        .sort((a, b) => a.index - b.index);
    return top.map((c) => c.item);
}
