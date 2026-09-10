/**
 * `components/reactFlowCanvas/` — the canvas, in parts.
 *
 * `ReactFlowCanvas.tsx` is the component; everything here is what it used to
 * hold inline. The split follows the pattern the repository already uses
 * (`hooks/artifacts/`, `components/artifacts/<format>/`): pure logic and
 * presentational pieces move out, the component stays the composition root.
 */

export * from './canvasLayout';
export * from './canvasNarrative';
export * from './canvasGroupZones';
export * from './DiagramLegend';
export * from './canvasImageExport';
