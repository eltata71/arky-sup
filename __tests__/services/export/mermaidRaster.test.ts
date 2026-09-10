import { describe, it, expect } from 'vitest';
import { rasterizeMermaidToPng } from '../../../services/export/utils/mermaidRaster';

describe('rasterizeMermaidToPng', () => {
    it('resolves null for empty input without importing mermaid', async () => {
        await expect(rasterizeMermaidToPng('')).resolves.toBeNull();
        await expect(rasterizeMermaidToPng('   ')).resolves.toBeNull();
    });

    it('degrades to null (never throws) when the environment cannot rasterize', async () => {
        // jsdom lacks the SVG layout APIs mermaid needs and its canvas cannot
        // encode PNGs — the export contract is "null, keep the text fallback".
        const result = await rasterizeMermaidToPng('flowchart TD\n  A[Inicio] --> B[Fin]');
        expect(result).toBeNull();
    }, 30_000);
});
