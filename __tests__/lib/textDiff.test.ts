import { describe, it, expect } from 'vitest';
import { computeLineDiff, summarizeDiff, buildDiffHunks } from '../../lib/textDiff';

describe('computeLineDiff', () => {
    it('marks identical content as unchanged', () => {
        const text = 'a\nb\nc';
        const lines = computeLineDiff(text, text);
        expect(lines).toHaveLength(3);
        expect(lines.every((l) => l.type === 'same')).toBe(true);
        expect(summarizeDiff(lines).identical).toBe(true);
    });

    it('detects an inserted line with correct line numbers', () => {
        const lines = computeLineDiff('a\nc', 'a\nb\nc');
        expect(lines).toEqual([
            { type: 'same', text: 'a', oldLine: 1, newLine: 1 },
            { type: 'added', text: 'b', newLine: 2 },
            { type: 'same', text: 'c', oldLine: 2, newLine: 3 },
        ]);
    });

    it('detects removals and replacements', () => {
        const lines = computeLineDiff('uno\ndos\ntres', 'uno\nDOS\ntres');
        const summary = summarizeDiff(lines);
        expect(summary.added).toBe(1);
        expect(summary.removed).toBe(1);
        expect(summary.unchanged).toBe(2);
        expect(lines.find((l) => l.type === 'removed')?.text).toBe('dos');
        expect(lines.find((l) => l.type === 'added')?.text).toBe('DOS');
    });

    it('handles empty inputs on either side', () => {
        expect(summarizeDiff(computeLineDiff('', 'a\nb')).added).toBe(2);
        expect(summarizeDiff(computeLineDiff('a\nb', '')).removed).toBe(2);
    });

    it('normalises CRLF so Windows content does not produce phantom diffs', () => {
        const lines = computeLineDiff('a\r\nb', 'a\nb');
        expect(summarizeDiff(lines).added).toBe(0);
        expect(summarizeDiff(lines).removed).toBe(0);
    });

    it('stays fast and coherent on large documents (prefix/suffix trim)', () => {
        const big = Array.from({ length: 2000 }, (_, i) => `línea ${i}`).join('\n');
        const edited = big.replace('línea 1000', 'línea 1000 EDITADA');
        const start = Date.now();
        const lines = computeLineDiff(big, edited);
        expect(Date.now() - start).toBeLessThan(1500);
        const summary = summarizeDiff(lines);
        expect(summary.added).toBe(1);
        expect(summary.removed).toBe(1);
    });
});

describe('buildDiffHunks', () => {
    it('collapses long unchanged stretches keeping context lines', () => {
        const oldText = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
        const newText = oldText.replace('l15', 'l15-cambiada');
        const hunks = buildDiffHunks(computeLineDiff(oldText, newText), 2);
        expect(hunks).toHaveLength(1);
        // 2 context + removed + added + 2 context
        expect(hunks[0].lines).toHaveLength(6);
        expect(hunks[0].header).toMatch(/Líneas \d+–\d+/);
    });
});
