import { describe, it, expect } from 'vitest';
import { applySvgExportFrame, defaultFrameMetadataFromIR } from '../../services/diagram/diagramExportFrame';

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#fff"/></svg>`;

function encodeDataUrl(svg: string, base64 = false): string {
    if (base64) return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

describe('applySvgExportFrame (Gap 12)', () => {
    it('returns the input unchanged when the data URL is not an SVG', async () => {
        const out = await applySvgExportFrame('data:image/png;base64,abcd', { title: 'X' });
        expect(out).toBe('data:image/png;base64,abcd');
    });

    it('wraps a base64-encoded SVG with the frame metadata', async () => {
        const inUrl = encodeDataUrl(SAMPLE_SVG, true);
        const out = await applySvgExportFrame(inUrl, {
            title: 'Diagrama de Integración',
            subtitle: 'Audiencia técnica',
            owner: 'Plataforma',
            version: 'v1.0',
            confidentiality: 'Uso interno',
            legend: [{ label: 'Sync', color: '#6366f1' }, { label: 'Async', color: '#f59e0b', dash: '6 4' }],
            isDark: false,
        });
        expect(out.startsWith('data:image/svg+xml;base64,')).toBe(true);
        // Decode and assert the wrapper contains the title and the inner SVG.
        const decoded = Buffer.from(out.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf-8');
        expect(decoded).toContain('Diagrama de Integración');
        expect(decoded).toContain('Audiencia técnica');
        expect(decoded).toContain('Sync');
        expect(decoded).toContain('Uso interno');
        // The wrapper offsets the inner SVG by the header height (translate).
        expect(decoded).toMatch(/<g transform="translate\(0, 72\)">/);
    });

    it('survives URL-encoded SVG payloads as well', async () => {
        const inUrl = encodeDataUrl(SAMPLE_SVG, false);
        const out = await applySvgExportFrame(inUrl, { title: 'Hola' });
        expect(out.startsWith('data:image/svg+xml;base64,')).toBe(true);
        const decoded = Buffer.from(out.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf-8');
        expect(decoded).toContain('Hola');
    });

    it('defaultFrameMetadataFromIR populates a sensible default', () => {
        const meta = defaultFrameMetadataFromIR({
            metadata: { title: 'Test', audience: 'executive', theme: 'editorial' },
            edges: [{ relation: 'sync' }, { relation: 'async' }],
        });
        expect(meta.title).toBe('Test');
        expect(meta.legend?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
});
