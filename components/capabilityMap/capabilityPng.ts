/**
 * Draws the capability map as a PNG with the 2D canvas: one row per capability,
 * indented by level, tinted by the layer's intensity, with the value written in
 * words (colour never carries the reading alone). No library, no SVG round trip.
 */

import type { CapabilityExportRow } from '../../services/enterpriseRepository';

const ROW_H = 34;
const INDENT = 28;
const PAD = 24;
const WIDTH = 960;
const HEADER_H = 64;

const tint = (intensity: number | null): string =>
  intensity === null ? '#f3f4f6' : `rgba(37, 99, 235, ${(0.12 + 0.55 * Math.min(1, Math.max(0, intensity))).toFixed(2)})`;

export const drawCapabilityPng = (
  rows: readonly CapabilityExportRow[],
  title: string,
  subtitle: string,
): Promise<Blob | null> => {
  const canvas = document.createElement('canvas');
  const scale = 2;
  const height = HEADER_H + rows.length * ROW_H + PAD;
  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111827';
  ctx.font = '600 18px sans-serif';
  ctx.fillText(title, PAD, 26);
  ctx.fillStyle = '#4b5563';
  ctx.font = '12px sans-serif';
  ctx.fillText(subtitle, PAD, 48);
  rows.forEach((row, i) => {
    const y = HEADER_H + i * ROW_H;
    const x = PAD + (row.level - 1) * INDENT;
    ctx.fillStyle = tint(row.intensity);
    ctx.fillRect(x, y + 2, WIDTH - PAD - x, ROW_H - 4);
    ctx.fillStyle = '#111827';
    ctx.font = `${row.level === 1 ? '600 ' : ''}13px sans-serif`;
    ctx.fillText(`L${row.level} · ${row.name}`, x + 10, y + ROW_H / 2);
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(row.value, WIDTH - PAD - 10, y + ROW_H / 2);
    ctx.textAlign = 'left';
  });
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
};
