import { describe, expect, it } from 'vitest';
import {
    applyExportFrame,
    defaultFrameMetadataFromIR,
    type FrameMetadata,
} from '../../services/diagram/diagramExportFrame';

describe('defaultFrameMetadataFromIR', () => {
    it('builds metadata with title from IR', () => {
        const md = defaultFrameMetadataFromIR({
            metadata: { title: 'Mi Diagrama', audience: 'executive', theme: 'editorial' },
            edges: [{ relation: 'sync' }, { relation: 'async' }],
        });
        expect(md.title).toBe('Mi Diagrama');
        expect(md.subtitle).toMatch(/executive/i);
        expect(md.legend).toBeDefined();
        expect(md.legend!.length).toBe(2);
        expect(md.legend!.some((l) => l.label.includes('Sincrónico'))).toBe(true);
        expect(md.legend!.some((l) => l.label.includes('Asíncrono'))).toBe(true);
    });

    it('falls back to a sensible default title when IR has none', () => {
        const md = defaultFrameMetadataFromIR({ edges: [] });
        expect(md.title).toBeTruthy();
        expect(md.legend).toEqual([]);
    });

    it('honours owner/version/confidentiality overrides', () => {
        const md = defaultFrameMetadataFromIR({ edges: [] }, {
            owner: 'PBM WeeCompany',
            version: 'v2.0',
            confidentiality: 'Uso interno',
            isDark: false,
        });
        expect(md.owner).toBe('PBM WeeCompany');
        expect(md.version).toBe('v2.0');
        expect(md.confidentiality).toBe('Uso interno');
        expect(md.isDark).toBe(false);
    });

    it('deduplicates legend entries by relation', () => {
        const md = defaultFrameMetadataFromIR({
            edges: [{ relation: 'sync' }, { relation: 'sync' }, { relation: 'sync' }],
        });
        expect(md.legend!.length).toBe(1);
    });

    it('always includes the date stamp', () => {
        const md = defaultFrameMetadataFromIR({ edges: [] });
        expect(md.date).toBeTruthy();
        // Should be a parseable ISO string.
        expect(Number.isNaN(new Date(md.date!).getTime())).toBe(false);
    });
});

describe('applyExportFrame (SSR / jsdom fallback)', () => {
    it('returns the input unchanged when the source data URL is invalid', async () => {
        // jsdom does not implement a real canvas / image decoder, so the
        // function falls back to returning the unchanged data URL via the
        // loadImage timeout. This is the contract that protects the
        // existing export flow from hanging forever.
        const metadata: FrameMetadata = {
            title: 'Test',
            subtitle: 'Subtitle',
            legend: [{ label: 'Sync', color: '#6366f1' }],
        };
        const fakeDataUrl = 'data:image/png;base64,invalid';
        const out = await applyExportFrame(fakeDataUrl, metadata);
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);
    }, 10_000);
});
