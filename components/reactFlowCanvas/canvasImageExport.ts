/**
 * Capturing the canvas as an image.
 *
 * This was 123 lines inside `useImperativeHandle`, which is a strange place
 * for it: none of it is React. It reads the DOM, fits a viewport, rasterises,
 * crops and frames — a pipeline with four ordered stages and its own failure
 * modes, none of which could be exercised without mounting a canvas and
 * reaching through a ref.
 *
 * Its dependencies are named in `CanvasExportDeps` now instead of captured
 * from a closure. That is the real gain: what this needs from the component is
 * four values and two ReactFlow calls, and that was impossible to see while it
 * lived inside one.
 */

import { toPng, toSvg } from 'html-to-image';
import type { Node } from 'reactflow';
import { computeExportBounds, nodesToRects } from '../../services/diagram/layoutQualityService';
import { computeNodeBoundingRect, cropPngToBoundingBox, cropSvgToBoundingBox } from '../../services/diagram/exportBoundingBoxCrop';
import { applyExportFrame, applySvgExportFrame, defaultFrameMetadataFromIR } from '../../services/diagram/diagramExportFrame';
import type { DiagramIR } from '../../lib/diagram';

/**
 * Which part of the diagram the export should show.
 *
 * `useful` is the default because it is what someone means by "export the
 * diagram": the nodes, cropped tight, without the toolbar.
 */
export type ExportViewMode = 'useful' | 'current' | 'executive' | 'technical' | 'full';

export interface CanvasExportOptions {
    scale?: 1 | 2 | 3;
    view?: ExportViewMode;
    frame?: boolean;
    legend?: boolean;
}

/** What the export needs from the canvas, stated rather than closed over. */
export interface CanvasExportDeps {
    nodes: Node[];
    /** Only `fitBounds` is used, and only when the instance provides it. */
    reactFlowInstance: {
        fitBounds?: (
            bounds: { x: number; y: number; width: number; height: number },
            options?: { padding?: number; duration?: number },
        ) => void;
    };
    fitView: (options?: { padding?: number; duration?: number }) => unknown;
    canvasBg: { bg: string };
    presentation?: { ir?: DiagramIR } | null;
    isDark: boolean;
}

        export async function exportCanvasImage(
    format: 'png' | 'svg',
    exportOptions: CanvasExportOptions | undefined,
    deps: CanvasExportDeps,
): Promise<string | null> {
    const { nodes, reactFlowInstance, fitView, canvasBg, presentation, isDark } = deps;
            const scale: 1 | 2 | 3 = exportOptions?.scale ?? 2;
            const view: ExportViewMode = exportOptions?.view ?? 'useful';
            // Frame defaults: ON for any formal export (useful / executive /
            // technical / full), OFF by default for the operational
            // `current` snapshot unless the user explicitly opted in.
            const frameDefault = view !== 'current';
            const wantFrame = exportOptions?.frame ?? frameDefault;
            // Legend defaults to ON when the frame is on; the user can
            // override both independently from the export modal.
            const wantLegend = exportOptions?.legend ?? wantFrame;
            // Gap 2: bounding-box-aware export with view variants.
            //
            // Pipeline:
            //   1. Pre-fit: position the viewport so the relevant nodes
            //      occupy the captured area (useful / executive / technical
            //      use the content bbox; current uses the user's viewport;
            //      full uses an extra-padded bbox).
            //   2. Capture: toPng / toSvg with a filter that excludes the
            //      toolbar, minimap, controls, panels and inspector — the
            //      export must never include chrome.
            //   3. Post-crop: clip the captured raster / vector to the real
            //      DOM bounding rect of the nodes (+ professional padding)
            //      so the output has zero excessive empty space and zero
            //      risk of clipping labels / badges / boundaries.
            //   4. Frame: wrap the cropped image with the editorial frame
            //      (title / footer / legend / date) when an IR is present.
            const PADDING_PX = view === 'full' ? 96 : 64;
            const liveNodes = nodes.filter((n) => n.type !== 'groupZone');
            const rects = nodesToRects(liveNodes.map((n) => ({
                id: String(n.id),
                position: n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y) ? n.position : undefined,
                width: n.width ?? undefined,
                height: n.height ?? undefined,
            })));
            const bounds = rects.length > 0 ? computeExportBounds(rects, PADDING_PX) : null;
            const shouldFit = view !== 'current';
            try {
                if (shouldFit && bounds && bounds.width > 0 && bounds.height > 0 && typeof reactFlowInstance.fitBounds === 'function') {
                    const fitPadding = view === 'full' ? 0.10 : 0.05;
                    reactFlowInstance.fitBounds({
                        x: bounds.x,
                        y: bounds.y,
                        width: bounds.width,
                        height: bounds.height,
                    }, { padding: fitPadding, duration: 0 });
                } else if (shouldFit) {
                    await fitView({ padding: view === 'full' ? 0.25 : 0.2, duration: 0 });
                }
            } catch {
                if (shouldFit) {
                    try { fitView({ padding: 0.2, duration: 0 }); } catch { /* noop */ }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 120));
            const element = document.querySelector('.react-flow') as HTMLElement;
            if (!element) return null;

            const options = {
                backgroundColor: canvasBg.bg,
                filter: (node: HTMLElement) => {
                    const cl = node.classList;
                    if (!cl) return true;
                    if (
                        cl.contains('react-flow__controls') ||
                        cl.contains('react-flow__minimap') ||
                        cl.contains('react-flow__panel') ||
                        cl.contains('diagram-editor-panel') ||
                        cl.contains('diagram-toolbar') ||
                        cl.contains('diagram-overlay-diagnostic') ||
                        cl.contains('diagram-legend-floating')
                    ) return false;
                    // Honour explicit opt-out so callers can mark their own
                    // floating chrome without touching this list.
                    if (node.getAttribute && node.getAttribute('data-export-exclude') === 'true') return false;
                    return true;
                },
                quality: 1.0,
                pixelRatio: scale,
            };

            try {
                const raw = format === 'svg' ? await toSvg(element, options) : await toPng(element, options);
                if (!raw) return null;

                // Step 3: tight bounding-box crop. Skip for `current` view
                // (the user explicitly asked for "what is on screen") and
                // skip if we can't measure the nodes in the DOM (jsdom).
                let cropped = raw;
                if (view !== 'current') {
                    const cropPaddingPx = view === 'full' ? 56 : 32;
                    const cropRect = computeNodeBoundingRect({
                        container: element,
                        paddingPx: cropPaddingPx,
                    });
                    if (cropRect) {
                        if (format === 'png') {
                            cropped = await cropPngToBoundingBox(raw, { cropPx: cropRect, pixelRatio: scale, backgroundColor: canvasBg.bg });
                        } else {
                            cropped = cropSvgToBoundingBox(raw, cropRect);
                        }
                    }
                }

                // Step 4: editorial frame. Returns the cropped image
                // unchanged when no IR is present so the legacy export
                // contract is preserved. Skipped entirely when the caller
                // disabled the frame from the export modal.
                if (wantFrame && presentation?.ir) {
                    const metadata = defaultFrameMetadataFromIR(presentation.ir, { isDark });
                    // Honour the legend toggle: when the user disabled the
                    // legend we drop it from the frame metadata so the
                    // footer stays minimal (date + confidentiality only).
                    if (!wantLegend) metadata.legend = [];
                    if (format === 'png') return await applyExportFrame(cropped, metadata, { pixelRatio: scale });
                    if (format === 'svg') return await applySvgExportFrame(cropped, metadata);
                }
                return cropped;
            } catch (err) {
                console.error("Export capture failed", err);
                return null;
            }
        }
