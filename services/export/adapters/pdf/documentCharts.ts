/**
 * Gráficos ```chart del documento, dibujados en vectores en el PDF.
 *
 * Barras, tarta y anillo se dibujan como barras horizontales (la tarta en
 * porcentajes); una serie de líneas se presenta como tabla de datos. El
 * gráfico es una figura de la estructura etiquetada, y su texto alternativo
 * enumera cada valor: quien no ve las barras lee los mismos datos.
 */
import { CHART_PALETTE, type ChartSpec } from '../../../../lib/chartSvg';
import type { DocumentRenderer } from './documentRenderer';
import { CONTENT_W, MARGIN_X } from './pageGeometry';
import { num } from './pdfWriter';
import { structElem } from './pdfStructure';

const hexToRgb = (hex: string): string => {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((at) => (parseInt(n.slice(at, at + 2), 16) / 255).toFixed(3)).join(' ');
};

export function drawChart(renderer: DocumentRenderer, spec: ChartSpec, heading: (text: string, level: 3) => void): void {
  if (spec.title) heading(spec.title, 3);
  if (spec.type === 'line') {
    renderer.table(
      ['Serie', ...spec.labels],
      spec.series.map((s, i) => [s.name ?? `Serie ${i + 1}`, ...s.values.map((v) => `${v}${spec.unit ?? ''}`)]),
      true,
    );
    return;
  }
  const isPie = spec.type === 'pie' || spec.type === 'donut';
  const series = isPie ? [spec.series[0]] : spec.series;
  const total = series[0].values.reduce((a, b) => a + Math.max(0, b), 0);
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values.map((v) => Math.abs(v))));
  const valueText = (value: number) => (isPie
    ? `${Math.round((total > 0 ? Math.max(0, value) / total : 0) * 100)}%`
    : `${Math.round(value * 100) / 100}${spec.unit ?? ''}`);
  const alt = `Gráfico${spec.title ? ` «${spec.title}»` : ''}: ${spec.labels.map((label, li) =>
    `${label} ${series.map((s) => valueText(s.values[li])).join(' / ')}`).join('; ')}.`;
  const figure = structElem('Figure', renderer.root, alt);
  const labelW = 150;
  const valueW = 64;
  const barMaxW = CONTENT_W - labelW - valueW - 12;
  const rowH = 17;
  renderer.cursorY -= 4;
  spec.labels.forEach((label, li) => {
    series.forEach((s, si) => {
      renderer.ensureSpace(rowH + 2);
      renderer.cursorY -= rowH;
      const y = renderer.cursorY;
      const value = s.values[li];
      const ratio = isPie ? (total > 0 ? Math.max(0, value) / total : 0) : Math.abs(value) / max;
      const color = hexToRgb(CHART_PALETTE[(isPie ? li : si) % CHART_PALETTE.length]);
      renderer.mark(
        figure,
        '0.95 0.96 0.98 rg', `${MARGIN_X + labelW} ${num(y)} ${num(barMaxW)} ${rowH - 6} re f`,
        `${color} rg`, `${MARGIN_X + labelW} ${num(y)} ${num(Math.max(2, ratio * barMaxW))} ${rowH - 6} re f`,
      );
      if (si === 0) {
        let text = label;
        while (renderer.measure(text, 9, 'reg') > labelW - 10 && text.length > 4) text = `${text.slice(0, -2)}…`;
        renderer.line([{ text, font: 'reg' }], 9, MARGIN_X, y + 1, '0.2 0.25 0.35 rg', figure);
      }
      renderer.line([{ text: valueText(value), font: 'bold' }], 9, MARGIN_X + labelW + barMaxW + 6, y + 1, '0.13 0.16 0.24 rg', figure);
    });
    renderer.cursorY -= 3;
  });
  if (!isPie && spec.series.length > 1) {
    renderer.ensureSpace(14);
    renderer.cursorY -= 12;
    let x = MARGIN_X + labelW;
    spec.series.forEach((s, si) => {
      renderer.mark(figure, `${hexToRgb(CHART_PALETTE[si % CHART_PALETTE.length])} rg`, `${num(x)} ${num(renderer.cursorY)} 8 8 re f`);
      const name = s.name ?? `Serie ${si + 1}`;
      renderer.line([{ text: name, font: 'reg' }], 8.5, x + 12, renderer.cursorY + 1, '0.27 0.31 0.41 rg', figure);
      x += 12 + renderer.measure(name, 8.5, 'reg') + 18;
    });
  }
  renderer.cursorY -= 8;
}
