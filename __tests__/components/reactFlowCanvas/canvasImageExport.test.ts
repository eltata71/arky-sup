/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * Specs for the canvas image export.
 *
 * Untestable until it left `useImperativeHandle`: exercising it meant mounting
 * a canvas and reaching through a ref, so the branches that decide *what gets
 * captured* — which view, whether to crop, whether to frame — were reached by
 * accident if at all.
 *
 * The rule the whole pipeline exists to enforce is that an export never
 * contains chrome. A screenshot with the toolbar in it is not a diagram.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Node } from 'reactflow';

const mocks = vi.hoisted(() => ({
  // Typed with their real parameters so `mock.calls[0][1]` is the options
  // object rather than an empty tuple — the assertions below read it.
  toPng: vi.fn(async (_element: HTMLElement, _options: Record<string, unknown>) => 'data:image/png;base64,RAW'),
  toSvg: vi.fn(async (_element: HTMLElement, _options: Record<string, unknown>) => '<svg id="raw"/>'),
  computeNodeBoundingRect: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 80 })),
  cropPngToBoundingBox: vi.fn(async () => 'data:image/png;base64,CROPPED'),
  cropSvgToBoundingBox: vi.fn(() => '<svg id="cropped"/>'),
  applyExportFrame: vi.fn(async (_image: string, _metadata: { legend: unknown[] }, _options?: unknown) => 'data:image/png;base64,FRAMED'),
  applySvgExportFrame: vi.fn(async () => '<svg id="framed"/>'),
  defaultFrameMetadataFromIR: vi.fn(() => ({ title: 'Diagrama', legend: [{ label: 'x' }] })),
}));

vi.mock('html-to-image', () => ({ toPng: mocks.toPng, toSvg: mocks.toSvg }));
vi.mock('../../../services/diagram/exportBoundingBoxCrop', () => ({
  computeNodeBoundingRect: mocks.computeNodeBoundingRect,
  cropPngToBoundingBox: mocks.cropPngToBoundingBox,
  cropSvgToBoundingBox: mocks.cropSvgToBoundingBox,
}));
vi.mock('../../../services/diagram/diagramExportFrame', () => ({
  applyExportFrame: mocks.applyExportFrame,
  applySvgExportFrame: mocks.applySvgExportFrame,
  defaultFrameMetadataFromIR: mocks.defaultFrameMetadataFromIR,
}));

import { exportCanvasImage, type CanvasExportDeps } from '../../../components/reactFlowCanvas/canvasImageExport';

const node = (id: string, x: number, y: number): Node =>
  ({ id, position: { x, y }, width: 160, height: 80, data: {} }) as Node;

const fitBounds = vi.fn();
const fitView = vi.fn();

const deps = (overrides: Partial<CanvasExportDeps> = {}): CanvasExportDeps => ({
  nodes: [node('a', 0, 0), node('b', 300, 200)],
  reactFlowInstance: { fitBounds },
  fitView,
  canvasBg: { bg: '#ffffff' },
  presentation: null,
  isDark: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div class="react-flow"></div>';
});

describe('what reaches the capture', () => {
  it('captures the canvas element', async () => {
    await exportCanvasImage('png', undefined, deps());
    expect(mocks.toPng).toHaveBeenCalledTimes(1);
    expect((mocks.toPng.mock.calls[0][0] as HTMLElement).className).toBe('react-flow');
  });

  it('returns null rather than throwing when there is no canvas in the DOM', async () => {
    document.body.innerHTML = '';
    expect(await exportCanvasImage('png', undefined, deps())).toBeNull();
  });

  it('excludes every piece of chrome — a screenshot with a toolbar is not a diagram', async () => {
    await exportCanvasImage('png', undefined, deps());
    const { filter } = mocks.toPng.mock.calls[0][1] as unknown as { filter: (n: HTMLElement) => boolean };

    for (const cls of [
      'react-flow__controls', 'react-flow__minimap', 'react-flow__panel',
      'diagram-editor-panel', 'diagram-toolbar', 'diagram-overlay-diagnostic',
      'diagram-legend-floating',
    ]) {
      const el = document.createElement('div');
      el.className = cls;
      expect(filter(el), `${cls} must not be captured`).toBe(false);
    }

    const nodeEl = document.createElement('div');
    nodeEl.className = 'react-flow__node';
    expect(filter(nodeEl)).toBe(true);
  });

  it('honours an explicit opt-out, so new chrome needs no edit here', async () => {
    await exportCanvasImage('png', undefined, deps());
    const { filter } = mocks.toPng.mock.calls[0][1] as unknown as { filter: (n: HTMLElement) => boolean };
    const el = document.createElement('div');
    el.setAttribute('data-export-exclude', 'true');
    expect(filter(el)).toBe(false);
  });

  it('applies the requested pixel ratio', async () => {
    await exportCanvasImage('png', { scale: 3 }, deps());
    expect((mocks.toPng.mock.calls[0][1] as unknown as { pixelRatio: number }).pixelRatio).toBe(3);
  });
});

describe('which part of the diagram is framed', () => {
  it('fits the content bounds for the default view', async () => {
    await exportCanvasImage('png', undefined, deps());
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('leaves the viewport alone for `current` — the user asked for what is on screen', async () => {
    await exportCanvasImage('png', { view: 'current' }, deps());
    expect(fitBounds).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();
  });

  it('falls back to fitView when there are no nodes to bound', async () => {
    await exportCanvasImage('png', undefined, deps({ nodes: [] }));
    expect(fitView).toHaveBeenCalledTimes(1);
  });

  it('still produces an image when fitting throws', async () => {
    fitBounds.mockImplementationOnce(() => { throw new Error('no instance'); });
    expect(await exportCanvasImage('png', undefined, deps())).toBeTruthy();
  });
});

describe('cropping and framing', () => {
  it('crops the raster to the nodes', async () => {
    const result = await exportCanvasImage('png', undefined, deps());
    expect(mocks.cropPngToBoundingBox).toHaveBeenCalledTimes(1);
    expect(result).toBe('data:image/png;base64,CROPPED');
  });

  it('crops the vector with the vector cropper, not the raster one', async () => {
    const result = await exportCanvasImage('svg', undefined, deps());
    expect(mocks.cropSvgToBoundingBox).toHaveBeenCalledTimes(1);
    expect(mocks.cropPngToBoundingBox).not.toHaveBeenCalled();
    expect(result).toBe('<svg id="cropped"/>');
  });

  it('does not crop the `current` view', async () => {
    const result = await exportCanvasImage('png', { view: 'current' }, deps());
    expect(mocks.cropPngToBoundingBox).not.toHaveBeenCalled();
    expect(result).toBe('data:image/png;base64,RAW');
  });

  it('returns the crop unchanged when the nodes cannot be measured', async () => {
    // jsdom and a detached container both land here.
    mocks.computeNodeBoundingRect.mockReturnValueOnce(null as never);
    expect(await exportCanvasImage('png', undefined, deps())).toBe('data:image/png;base64,RAW');
  });

  it('frames the export when a diagram IR is present', async () => {
    const result = await exportCanvasImage('png', undefined, deps({ presentation: { ir: { nodes: [], edges: [] } as never } }));
    expect(result).toBe('data:image/png;base64,FRAMED');
  });

  it('leaves the legacy contract intact when there is no IR to frame from', async () => {
    expect(await exportCanvasImage('png', undefined, deps())).toBe('data:image/png;base64,CROPPED');
    expect(mocks.applyExportFrame).not.toHaveBeenCalled();
  });

  it('drops the legend from the frame when the user turned it off', async () => {
    await exportCanvasImage('png', { legend: false }, deps({ presentation: { ir: { nodes: [], edges: [] } as never } }));
    const [, metadata] = mocks.applyExportFrame.mock.calls[0];
    expect(metadata.legend).toEqual([]);
  });

  it('skips the frame entirely when the caller disabled it', async () => {
    await exportCanvasImage('png', { frame: false }, deps({ presentation: { ir: { nodes: [], edges: [] } as never } }));
    expect(mocks.applyExportFrame).not.toHaveBeenCalled();
  });
});

describe('failure', () => {
  it('returns null rather than propagating a capture error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.toPng.mockRejectedValueOnce(new Error('canvas tainted'));
    expect(await exportCanvasImage('png', undefined, deps())).toBeNull();
  });
});
