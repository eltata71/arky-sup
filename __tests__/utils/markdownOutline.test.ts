import { describe, it, expect } from 'vitest';
import { extractOutline } from '../../utils/markdownOutline';

describe('extractOutline', () => {
    it('returns no sections for an empty document', () => {
        const out = extractOutline('');
        expect(out.sections).toEqual([]);
        expect(out.completion).toBe(1);
    });

    it('extracts headings with their level', () => {
        const out = extractOutline('# Título\n\ntexto\n\n## Sub\n\nmás texto');
        expect(out.sections).toHaveLength(2);
        expect(out.sections[0]).toMatchObject({ title: 'Título', level: 1 });
        expect(out.sections[1]).toMatchObject({ title: 'Sub', level: 2 });
    });

    it('marks sections without body content as empty', () => {
        const out = extractOutline('# Llena\n\ncontenido\n\n# Vacía\n');
        const llena = out.sections.find((s) => s.title === 'Llena');
        const vacia = out.sections.find((s) => s.title === 'Vacía');
        expect(llena?.isEmpty).toBe(false);
        expect(vacia?.isEmpty).toBe(true);
    });

    it('computes completion as the fraction of non-empty sections', () => {
        const out = extractOutline('# A\n\nx\n\n# B\n\n# C\n\ny');
        // 2 of 3 sections have content.
        expect(out.completion).toBeCloseTo(2 / 3, 5);
    });

    it('does not treat # inside fenced code blocks as a heading', () => {
        const md = '# Real\n\n```\n# not a heading\n```\n\ntexto';
        const out = extractOutline(md);
        expect(out.sections).toHaveLength(1);
        expect(out.sections[0].title).toBe('Real');
    });

    it('produces unique slugs for duplicate heading text', () => {
        const out = extractOutline('# Sección\n\na\n\n# Sección\n\nb');
        expect(out.sections[0].id).not.toBe(out.sections[1].id);
    });

    it('slugifies accented headings', () => {
        const out = extractOutline('# Diseño Técnico\n\ncontenido');
        expect(out.sections[0].id).toBe('diseno-tecnico');
    });

    it('records the source line of each heading', () => {
        const out = extractOutline('intro\n# Uno\n\ntexto\n## Dos\n');
        expect(out.sections[0].line).toBe(1);
        expect(out.sections[1].line).toBe(4);
    });
});
