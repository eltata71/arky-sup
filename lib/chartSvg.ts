/**
 * Declarative chart rendering for document artifacts.
 *
 * Documents embed charts as fenced ```chart blocks containing a small JSON
 * spec; this module parses the spec and renders a presentation-grade SVG
 * using the app palette. Pure TypeScript + SVG strings — no charting
 * dependency, deterministic output, trivially unit-testable, and the SVG
 * survives the print/PDF path because it is inlined in the document HTML.
 *
 * Spec example:
 * ```chart
 * { "type": "bar", "title": "Esfuerzo por fase",
 *   "labels": ["Diseño", "Build", "QA"],
 *   "series": [{ "name": "Semanas", "values": [4, 9, 3] }] }
 * ```
 */

export type ChartType = 'bar' | 'line' | 'pie' | 'donut';

export interface ChartSeries {
    name?: string;
    values: number[];
}

export interface ChartSpec {
    type: ChartType;
    title?: string;
    labels: string[];
    series: ChartSeries[];
    /** Optional unit suffix appended to value labels (e.g. "%", " sem"). */
    unit?: string;
}

/** App accent palette (mirrors DIAGRAM_TOKENS accents — kept inline so the
 *  chart module stays dependency-free for the PDF/export paths). */
export const CHART_PALETTE = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#0ea5e9', '#f43f5e'];

const FONT = 'Inter, sans-serif';
const TEXT = '#334155';
const MUTED = '#94a3b8';
const GRID = '#e2e8f0';

const esc = (value: string): string => value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Parse a ```chart fence body. Returns `null` (never throws) for anything
 * that is not a well-formed spec, so callers can fall back to a code block.
 */
export function parseChartSpec(raw: string): ChartSpec | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const type = record.type;
    if (type !== 'bar' && type !== 'line' && type !== 'pie' && type !== 'donut') return null;
    const labels = Array.isArray(record.labels) ? record.labels.map((l) => String(l)) : [];
    if (labels.length === 0 || labels.length > 24) return null;
    const seriesRaw = Array.isArray(record.series) ? record.series : [];
    const series: ChartSeries[] = [];
    for (const entry of seriesRaw) {
        if (!entry || typeof entry !== 'object') continue;
        const values = (entry as { values?: unknown }).values;
        if (!Array.isArray(values)) continue;
        const nums = values.map((v) => Number(v));
        if (nums.some((n) => !Number.isFinite(n))) continue;
        series.push({ name: typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name : undefined, values: nums });
    }
    if (series.length === 0 || series.length > 6) return null;
    if (series.some((s) => s.values.length !== labels.length)) return null;
    return {
        type,
        title: typeof record.title === 'string' ? record.title : undefined,
        labels,
        series,
        unit: typeof record.unit === 'string' ? record.unit : undefined,
    };
}

const fmt = (value: number, unit?: string): string => {
    const text = Math.abs(value) >= 1000
        ? value.toLocaleString('es-ES', { maximumFractionDigits: 0 })
        : String(Math.round(value * 100) / 100);
    return unit ? `${text}${unit}` : text;
};

interface Frame { width: number; height: number; title: string; legend: string; plotY: number }

function frameFor(spec: ChartSpec, width: number, plotHeight: number): Frame {
    const titleH = spec.title ? 30 : 8;
    const showLegend = spec.series.length > 1 || (spec.type === 'pie' || spec.type === 'donut');
    const legendH = showLegend ? 24 : 0;
    const height = titleH + plotHeight + legendH + 16;
    const title = spec.title
        ? `<text x="${width / 2}" y="20" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="#1e293b">${esc(spec.title)}</text>`
        : '';
    let legend = '';
    if (showLegend) {
        const entries = (spec.type === 'pie' || spec.type === 'donut')
            ? spec.labels.map((label, i) => ({ label, color: CHART_PALETTE[i % CHART_PALETTE.length] }))
            : spec.series.map((s, i) => ({ label: s.name ?? `Serie ${i + 1}`, color: CHART_PALETTE[i % CHART_PALETTE.length] }));
        const itemW = Math.min(150, Math.max(70, Math.floor((width - 24) / entries.length)));
        const startX = Math.max(12, (width - itemW * entries.length) / 2);
        const y = height - 14;
        legend = entries.map((entry, i) => {
            const x = startX + i * itemW;
            const label = entry.label.length > 16 ? `${entry.label.slice(0, 15)}…` : entry.label;
            return `<rect x="${x}" y="${y - 8}" width="9" height="9" rx="2" fill="${entry.color}"/>` +
                `<text x="${x + 13}" y="${y}" font-family="${FONT}" font-size="10" fill="${TEXT}">${esc(label)}</text>`;
        }).join('');
    }
    return { width, height, title, legend, plotY: titleH };
}

function renderBar(spec: ChartSpec, width: number): string {
    const rowH = 26;
    const plotHeight = spec.labels.length * spec.series.length * rowH + spec.labels.length * 8;
    const frame = frameFor(spec, width, plotHeight);
    const labelW = 130;
    const valueW = 56;
    const barMaxW = width - labelW - valueW - 24;
    const max = Math.max(1e-9, ...spec.series.flatMap((s) => s.values.map((v) => Math.abs(v))));
    let body = '';
    let y = frame.plotY;
    spec.labels.forEach((label, li) => {
        const shortLabel = label.length > 20 ? `${label.slice(0, 19)}…` : label;
        body += `<text x="${labelW - 8}" y="${y + rowH * spec.series.length / 2 + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${TEXT}">${esc(shortLabel)}</text>`;
        spec.series.forEach((s, si) => {
            const value = s.values[li];
            const w = Math.max(2, Math.round((Math.abs(value) / max) * barMaxW));
            const barY = y + si * rowH + 4;
            const color = CHART_PALETTE[si % CHART_PALETTE.length];
            body += `<rect x="${labelW}" y="${barY}" width="${w}" height="${rowH - 9}" rx="4" fill="${color}" fill-opacity="0.88"/>`;
            body += `<text x="${labelW + w + 6}" y="${barY + (rowH - 9) / 2 + 4}" font-family="${FONT}" font-size="10.5" font-weight="600" fill="${TEXT}">${esc(fmt(value, spec.unit))}</text>`;
        });
        y += rowH * spec.series.length + 8;
    });
    body += `<line x1="${labelW}" y1="${frame.plotY - 2}" x2="${labelW}" y2="${y - 4}" stroke="${GRID}" stroke-width="1"/>`;
    return wrap(frame, body);
}

function renderLine(spec: ChartSpec, width: number): string {
    const plotHeight = 200;
    const frame = frameFor(spec, width, plotHeight + 26);
    const padL = 48;
    const padR = 16;
    const plotW = width - padL - padR;
    const top = frame.plotY + 8;
    const all = spec.series.flatMap((s) => s.values);
    const max = Math.max(...all, 0);
    const min = Math.min(...all, 0);
    const range = Math.max(1e-9, max - min);
    const xFor = (i: number) => padL + (spec.labels.length === 1 ? plotW / 2 : (i / (spec.labels.length - 1)) * plotW);
    const yFor = (v: number) => top + plotHeight - ((v - min) / range) * plotHeight;
    let body = '';
    // Grid + Y labels (4 ticks).
    for (let t = 0; t <= 3; t++) {
        const v = min + (range * t) / 3;
        const yy = yFor(v);
        body += `<line x1="${padL}" y1="${yy}" x2="${width - padR}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>`;
        body += `<text x="${padL - 6}" y="${yy + 3}" text-anchor="end" font-family="${FONT}" font-size="9.5" fill="${MUTED}">${esc(fmt(v, spec.unit))}</text>`;
    }
    spec.series.forEach((s, si) => {
        const color = CHART_PALETTE[si % CHART_PALETTE.length];
        const points = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
        body += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
        s.values.forEach((v, i) => {
            body += `<circle cx="${xFor(i)}" cy="${yFor(v)}" r="3.2" fill="#fff" stroke="${color}" stroke-width="2"/>`;
        });
    });
    spec.labels.forEach((label, i) => {
        const short = label.length > 10 ? `${label.slice(0, 9)}…` : label;
        body += `<text x="${xFor(i)}" y="${top + plotHeight + 18}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${TEXT}">${esc(short)}</text>`;
    });
    return wrap(frame, body);
}

function renderPie(spec: ChartSpec, width: number, donut: boolean): string {
    const plotHeight = 210;
    const frame = frameFor(spec, width, plotHeight);
    const values = spec.series[0].values.map((v) => Math.max(0, v));
    const total = values.reduce((a, b) => a + b, 0);
    const cx = width / 2;
    const cy = frame.plotY + plotHeight / 2;
    const r = 88;
    let body = '';
    if (total <= 0) {
        body = `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${MUTED}">Sin datos</text>`;
        return wrap(frame, body);
    }
    let angle = -Math.PI / 2;
    values.forEach((value, i) => {
        const slice = (value / total) * Math.PI * 2;
        const end = angle + slice;
        const large = slice > Math.PI ? 1 : 0;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const color = CHART_PALETTE[i % CHART_PALETTE.length];
        if (slice >= Math.PI * 2 - 1e-6) {
            body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="0.92"/>`;
        } else {
            body += `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}" fill-opacity="0.92" stroke="#fff" stroke-width="1.5"/>`;
        }
        // Percentage label outside the slice midpoint.
        const mid = angle + slice / 2;
        const pct = Math.round((value / total) * 100);
        if (pct >= 4) {
            const lx = cx + (r + 16) * Math.cos(mid);
            const ly = cy + (r + 16) * Math.sin(mid);
            body += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="600" fill="${TEXT}">${pct}%</text>`;
        }
        angle = end;
    });
    if (donut) {
        body += `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/>`;
        body += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="700" fill="#1e293b">${esc(fmt(total, spec.unit))}</text>`;
    }
    return wrap(frame, body);
}

function wrap(frame: Frame, body: string): string {
    return `<svg class="doc-chart" role="img" viewBox="0 0 ${frame.width} ${frame.height}" width="100%" style="max-width:${frame.width}px" xmlns="http://www.w3.org/2000/svg">`
        + `<rect x="0.5" y="0.5" width="${frame.width - 1}" height="${frame.height - 1}" rx="10" fill="#ffffff" stroke="${GRID}"/>`
        + frame.title + body + frame.legend
        + '</svg>';
}

/**
 * Render a chart spec to an inline SVG string. Returns `null` when the spec
 * cannot be rendered so the caller keeps the code-block fallback.
 */
export function renderChartSvg(spec: ChartSpec, opts: { width?: number } = {}): string | null {
    const width = Math.min(900, Math.max(360, opts.width ?? 640));
    try {
        if (spec.type === 'bar') return renderBar(spec, width);
        if (spec.type === 'line') return renderLine(spec, width);
        return renderPie(spec, width, spec.type === 'donut');
    } catch {
        return null;
    }
}

/** Parse + render in one step (fence body → SVG or null). */
export function renderChartFence(raw: string, opts: { width?: number } = {}): string | null {
    const spec = parseChartSpec(raw);
    if (!spec) return null;
    return renderChartSvg(spec, opts);
}
