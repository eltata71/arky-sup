/**
 * Line-based text diff (LCS) for artifact version comparison.
 *
 * Pure TypeScript, no dependencies. Designed for the version-history UI:
 * given two artifact contents it produces a readable, ordered list of
 * added / removed / unchanged lines plus a compact summary. For very large
 * inputs the quadratic LCS is capped and the tail is emitted as a coarse
 * replace block so the UI never freezes.
 */

export type DiffLineType = 'same' | 'added' | 'removed';

export interface DiffLine {
    type: DiffLineType;
    text: string;
    /** 1-based line number in the OLD text (absent for added lines). */
    oldLine?: number;
    /** 1-based line number in the NEW text (absent for removed lines). */
    newLine?: number;
}

export interface DiffSummary {
    added: number;
    removed: number;
    unchanged: number;
    /** True when both inputs are identical. */
    identical: boolean;
}

/** Beyond this many lines per side, fall back to the coarse block diff. */
const LCS_MAX_LINES = 3000;

function splitLines(text: string): string[] {
    if (text.length === 0) return [];
    return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Compute the line diff between `oldText` and `newText`.
 * Output preserves original order: unchanged lines interleaved with
 * removals (old) and additions (new), the standard unified-diff shape.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
    const a = splitLines(oldText);
    const b = splitLines(newText);

    if (oldText === newText) {
        return a.map((text, i) => ({ type: 'same', text, oldLine: i + 1, newLine: i + 1 }));
    }
    if (a.length > LCS_MAX_LINES || b.length > LCS_MAX_LINES) {
        return coarseBlockDiff(a, b);
    }

    // Trim the common prefix/suffix first — typical edits touch a small
    // region, and this keeps the DP table tiny for big documents.
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (
        suffix < a.length - prefix &&
        suffix < b.length - prefix &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    ) suffix++;

    const coreA = a.slice(prefix, a.length - suffix);
    const coreB = b.slice(prefix, b.length - suffix);

    // LCS DP over the core region.
    const n = coreA.length;
    const m = coreB.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = coreA[i] === coreB[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const lines: DiffLine[] = [];
    for (let k = 0; k < prefix; k++) {
        lines.push({ type: 'same', text: a[k], oldLine: k + 1, newLine: k + 1 });
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (coreA[i] === coreB[j]) {
            lines.push({ type: 'same', text: coreA[i], oldLine: prefix + i + 1, newLine: prefix + j + 1 });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            lines.push({ type: 'removed', text: coreA[i], oldLine: prefix + i + 1 });
            i++;
        } else {
            lines.push({ type: 'added', text: coreB[j], newLine: prefix + j + 1 });
            j++;
        }
    }
    while (i < n) {
        lines.push({ type: 'removed', text: coreA[i], oldLine: prefix + i + 1 });
        i++;
    }
    while (j < m) {
        lines.push({ type: 'added', text: coreB[j], newLine: prefix + j + 1 });
        j++;
    }
    for (let k = 0; k < suffix; k++) {
        lines.push({
            type: 'same',
            text: a[a.length - suffix + k],
            oldLine: a.length - suffix + k + 1,
            newLine: b.length - suffix + k + 1,
        });
    }
    return lines;
}

/** Coarse fallback for very large inputs: prefix/suffix + one replace block. */
function coarseBlockDiff(a: string[], b: string[]): DiffLine[] {
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (
        suffix < a.length - prefix &&
        suffix < b.length - prefix &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    ) suffix++;
    const lines: DiffLine[] = [];
    for (let k = 0; k < prefix; k++) lines.push({ type: 'same', text: a[k], oldLine: k + 1, newLine: k + 1 });
    for (let k = prefix; k < a.length - suffix; k++) lines.push({ type: 'removed', text: a[k], oldLine: k + 1 });
    for (let k = prefix; k < b.length - suffix; k++) lines.push({ type: 'added', text: b[k], newLine: k + 1 });
    for (let k = 0; k < suffix; k++) {
        lines.push({
            type: 'same',
            text: a[a.length - suffix + k],
            oldLine: a.length - suffix + k + 1,
            newLine: b.length - suffix + k + 1,
        });
    }
    return lines;
}

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (const line of lines) {
        if (line.type === 'added') added++;
        else if (line.type === 'removed') removed++;
        else unchanged++;
    }
    return { added, removed, unchanged, identical: added === 0 && removed === 0 };
}

export interface DiffHunk {
    lines: DiffLine[];
    /** Header label, e.g. "Líneas 12–18". */
    header: string;
}

/**
 * Collapse long unchanged stretches so the UI shows only changed regions
 * with `context` unchanged lines around each.
 */
export function buildDiffHunks(lines: DiffLine[], context = 2): DiffHunk[] {
    const keep = new Array<boolean>(lines.length).fill(false);
    lines.forEach((line, idx) => {
        if (line.type === 'same') return;
        for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
            keep[k] = true;
        }
    });
    const hunks: DiffHunk[] = [];
    let current: DiffLine[] = [];
    const flush = () => {
        if (current.length === 0) return;
        const first = current[0];
        const start = first.newLine ?? first.oldLine ?? 1;
        const last = current[current.length - 1];
        const end = last.newLine ?? last.oldLine ?? start;
        hunks.push({ lines: current, header: start === end ? `Línea ${start}` : `Líneas ${start}–${end}` });
        current = [];
    };
    lines.forEach((line, idx) => {
        if (keep[idx]) current.push(line);
        else flush();
    });
    flush();
    return hunks;
}
