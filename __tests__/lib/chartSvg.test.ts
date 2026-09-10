import { describe, it, expect } from 'vitest';
import { parseChartSpec, renderChartSvg, renderChartFence } from '../../lib/chartSvg';

const barSpec = JSON.stringify({
    type: 'bar',
    title: 'Esfuerzo por fase',
    labels: ['Diseño', 'Construcción', 'QA'],
    series: [{ name: 'Semanas', values: [4, 9, 3] }],
    unit: ' sem',
});

describe('parseChartSpec', () => {
    it('accepts a well-formed spec', () => {
        const spec = parseChartSpec(barSpec);
        expect(spec).not.toBeNull();
        expect(spec!.type).toBe('bar');
        expect(spec!.labels).toHaveLength(3);
    });

    it('rejects invalid JSON, unknown types and mismatched series lengths', () => {
        expect(parseChartSpec('no json')).toBeNull();
        expect(parseChartSpec(JSON.stringify({ type: 'radar', labels: ['a'], series: [{ values: [1] }] }))).toBeNull();
        expect(parseChartSpec(JSON.stringify({ type: 'bar', labels: ['a', 'b'], series: [{ values: [1] }] }))).toBeNull();
        expect(parseChartSpec(JSON.stringify({ type: 'bar', labels: [], series: [] }))).toBeNull();
        expect(parseChartSpec(JSON.stringify({ type: 'bar', labels: ['a'], series: [{ values: ['x'] }] }))).toBeNull();
    });
});

describe('renderChartSvg', () => {
    it('renders a bar chart with title, bars and value labels', () => {
        const svg = renderChartSvg(parseChartSpec(barSpec)!);
        expect(svg).not.toBeNull();
        expect(svg).toContain('<svg');
        expect(svg).toContain('Esfuerzo por fase');
        expect(svg).toContain('Construcción');
        expect(svg).toContain('9 sem');
        expect((svg!.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(4);
    });

    it('renders a line chart with polyline, grid and axis labels', () => {
        const svg = renderChartSvg({
            type: 'line',
            labels: ['Q1', 'Q2', 'Q3', 'Q4'],
            series: [{ name: 'Reclamos', values: [120, 180, 150, 210] }],
        });
        expect(svg).toContain('<polyline');
        expect(svg).toContain('Q4');
        expect((svg!.match(/<circle/g) ?? []).length).toBe(4);
    });

    it('renders pie slices with percentage labels and donut total', () => {
        const pie = renderChartSvg({
            type: 'pie',
            labels: ['Crítico', 'Alto', 'Medio'],
            series: [{ values: [2, 3, 5] }],
        });
        expect(pie).toContain('<path');
        expect(pie).toContain('%');
        const donut = renderChartSvg({
            type: 'donut',
            labels: ['A', 'B'],
            series: [{ values: [60, 40] }],
        });
        expect(donut).toContain('100');
    });

    it('escapes HTML in titles and labels', () => {
        const svg = renderChartSvg({
            type: 'bar',
            title: '<script>x</script>',
            labels: ['<b>'],
            series: [{ values: [1] }],
        });
        expect(svg).not.toContain('<script>');
        expect(svg).toContain('&lt;script&gt;');
    });
});

describe('renderChartFence', () => {
    it('returns null for unparseable fences (caller keeps code fallback)', () => {
        expect(renderChartFence('not a chart')).toBeNull();
    });
});
