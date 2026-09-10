import { describe, it, expect } from 'vitest';
import {
    renderDocumentMarkdown,
    encodeMermaidSource,
    decodeMermaidSource,
} from '../../hooks/artifacts/useDocumentRendering';

describe('renderDocumentMarkdown — rich document blocks', () => {
    it('renders ```chart fences as inline SVG figures', async () => {
        const md = '## Datos\n\n```chart\n{ "type": "bar", "labels": ["A", "B"], "series": [{ "values": [1, 2] }] }\n```';
        const { html } = await renderDocumentMarkdown(md);
        expect(html).toContain('doc-chart-figure');
        expect(html).toContain('<svg');
        expect(html).not.toContain('code-block">');
    });

    it('keeps invalid chart specs visible as a code block', async () => {
        const { html } = await renderDocumentMarkdown('```chart\nesto no es json\n```');
        expect(html).not.toContain('<svg');
        expect(html).toContain('code-block');
    });

    it('emits hydration placeholders for ```mermaid fences with source + fallback', async () => {
        const { html } = await renderDocumentMarkdown('```mermaid\nflowchart TD\n  A --> B\n```');
        expect(html).toContain('mermaid-embed');
        expect(html).toContain('data-mermaid-source=');
        // Highlighted source fallback stays inside the placeholder.
        expect(html).toContain('code-block');
        const encoded = /data-mermaid-source="([^"]+)"/.exec(html)?.[1];
        expect(decodeMermaidSource(encoded ?? '')).toContain('flowchart TD');
    });

    it('transforms GitHub-style admonitions into callout cards', async () => {
        const { html } = await renderDocumentMarkdown('> [!WARNING] El servicio legado no soporta TLS 1.3.');
        expect(html).toContain('callout-warning');
        expect(html).toContain('Atención');
        expect(html).toContain('TLS 1.3');
        expect(html).not.toContain('[!WARNING]');
    });

    it('keeps plain blockquotes untouched', async () => {
        const { html } = await renderDocumentMarkdown('> Una cita normal.');
        expect(html).toContain('<blockquote>');
        expect(html).not.toContain('callout');
    });
});

describe('mermaid source encoding', () => {
    it('round-trips UTF-8 content (accents, arrows)', () => {
        const source = 'flowchart TD\n  A[Petición] --> B[Validación]';
        expect(decodeMermaidSource(encodeMermaidSource(source))).toBe(source);
    });

    it('decodes garbage to empty string instead of throwing', () => {
        expect(decodeMermaidSource('%%%not-base64%%%')).toBe('');
    });
});
