import { describe, it, expect } from 'vitest';
import { extractMermaid } from '../../utils/diagram/extractMermaid';

describe('extractMermaid (diagnostic union)', () => {
    it('reports empty when input is null/blank', () => {
        expect(extractMermaid(undefined, 'hybrid')).toEqual({ ok: false, reason: 'empty' });
        expect(extractMermaid('', 'hybrid')).toEqual({ ok: false, reason: 'empty' });
        expect(extractMermaid('   ', 'hybrid')).toEqual({ ok: false, reason: 'empty' });
    });

    it('returns ok with raw mermaid when representation is diagram', () => {
        const result = extractMermaid('flowchart LR\n    A --> B', 'diagram') as { ok: true; code: string };
        expect(result).toEqual({ ok: true, code: 'flowchart LR\n    A --> B' });
    });

    it('returns ok for fenced mermaid in hybrid content', () => {
        const result = extractMermaid('# title\n\n```mermaid\nflowchart TD\n  A-->B\n```\n', 'hybrid');
        expect(result.ok).toBe(true);
        const success = result as { ok: true; code: string };
        expect(success.code).toContain('flowchart TD');
    });

    it('reports fence-empty when ```mermaid block is empty', () => {
        const result = extractMermaid('intro\n```mermaid\n\n```\nend', 'hybrid');
        expect(result.ok).toBe(false);
        const failure = result as { ok: false; reason: string; sample?: string };
        expect(failure.reason).toBe('fence-empty');
        expect(failure.sample).toBeDefined();
    });

    it('reports fence-without-mermaid when generic fence carries non-mermaid content', () => {
        const result = extractMermaid('intro\n```yaml\nname: foo\n```\nend', 'hybrid');
        expect(result.ok).toBe(false);
        const failure = result as { ok: false; reason: string };
        expect(failure.reason).toBe('fence-without-mermaid');
    });

    it('reports no-fence when content has prose but no fence and no mermaid header', () => {
        const result = extractMermaid('Esto es solo prosa sin diagrama.', 'hybrid');
        expect(result.ok).toBe(false);
        const failure = result as { ok: false; reason: string };
        expect(failure.reason).toBe('no-fence');
    });

    it('falls back to header detection when no fence is present', () => {
        const result = extractMermaid('sequenceDiagram\n  actor U\n  U->>API: ping', 'document');
        expect(result.ok).toBe(true);
        const success = result as { ok: true; code: string };
        expect(success.code).toContain('sequenceDiagram');
    });
});
