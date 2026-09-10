/**
 * Markdown outline extraction — turns a markdown document into a flat list of
 * sections (one per ATX heading) so the workspace can render a table of
 * contents, navigate by section and detect empty/incomplete sections.
 *
 * Deliberately dependency-free: it does not parse the full markdown AST, only
 * the heading structure plus the body that belongs to each heading. Fenced
 * code blocks are skipped so a `# comment` inside a code sample is not
 * mistaken for a heading.
 */

export interface OutlineSection {
    /** Stable slug derived from the heading text (unique within the document). */
    id: string;
    /** Heading text without the leading `#` markers. */
    title: string;
    /** Heading depth, 1-6. */
    level: number;
    /** 0-based line index of the heading in the source. */
    line: number;
    /** Non-empty, non-heading body lines that belong to this section. */
    contentLineCount: number;
    /** True when the section has no real body content (a stub to complete). */
    isEmpty: boolean;
}

export interface DocumentOutline {
    sections: OutlineSection[];
    /** Fraction 0..1 of sections that have body content. */
    completion: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 64) || 'section';
}

/**
 * Extract the heading-based outline of a markdown document.
 */
export function extractOutline(markdown: string): DocumentOutline {
    if (!markdown || typeof markdown !== 'string') {
        return { sections: [], completion: 1 };
    }

    const lines = markdown.split(/\r?\n/);
    const sections: OutlineSection[] = [];
    const usedSlugs = new Set<string>();
    let inFence = false;

    type Pending = { section: OutlineSection; bodyLines: number };
    let pending: Pending | null = null;

    const flush = () => {
        if (!pending) return;
        pending.section.contentLineCount = pending.bodyLines;
        pending.section.isEmpty = pending.bodyLines === 0;
        sections.push(pending.section);
        pending = null;
    };

    lines.forEach((rawLine, index) => {
        const line = rawLine.trimEnd();
        const fenceMatch = /^\s*(```|~~~)/.test(line);
        if (fenceMatch) {
            inFence = !inFence;
            if (pending) pending.bodyLines += 1;
            return;
        }
        if (inFence) {
            if (pending) pending.bodyLines += 1;
            return;
        }

        const headingMatch = HEADING_RE.exec(line);
        if (headingMatch) {
            flush();
            const level = headingMatch[1].length;
            const title = headingMatch[2].trim();
            let slug = slugify(title);
            let unique = slug;
            let counter = 2;
            while (usedSlugs.has(unique)) {
                unique = `${slug}-${counter}`;
                counter += 1;
            }
            usedSlugs.add(unique);
            slug = unique;
            pending = {
                section: {
                    id: slug,
                    title,
                    level,
                    line: index,
                    contentLineCount: 0,
                    isEmpty: true,
                },
                bodyLines: 0,
            };
            return;
        }

        if (pending && line.trim().length > 0) {
            pending.bodyLines += 1;
        }
    });
    flush();

    const completion = sections.length === 0
        ? 1
        : sections.filter((s) => !s.isEmpty).length / sections.length;

    return { sections, completion };
}
