/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    computeNodeBoundingRect,
    cropSvgToBoundingBox,
} from '../../services/diagram/exportBoundingBoxCrop';

describe('computeNodeBoundingRect', () => {
    let container: HTMLElement;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        document.body.appendChild(container);
        // jsdom returns 0×0 rects unless we stub.
        // We mock getBoundingClientRect on a per-element basis below.
        container.getBoundingClientRect = () => ({
            x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 800,
            width: 1000, height: 800,
            toJSON: () => ({}),
        }) as DOMRect;
    });

    it('returns null when no nodes are present', () => {
        const rect = computeNodeBoundingRect({ container });
        expect(rect).toBeNull();
    });

    it('computes the bounding box of multiple nodes with padding clamped to the container', () => {
        const mkNode = (left: number, top: number, w: number, h: number): HTMLElement => {
            const el = document.createElement('div');
            el.className = 'react-flow__node';
            el.getBoundingClientRect = () => ({
                x: left, y: top, left, top,
                right: left + w, bottom: top + h,
                width: w, height: h, toJSON: () => ({}),
            }) as DOMRect;
            container.appendChild(el);
            return el;
        };
        mkNode(100, 120, 200, 100); // right=300 bottom=220
        mkNode(500, 300, 200, 100); // right=700 bottom=400
        const rect = computeNodeBoundingRect({ container, paddingPx: 24 });
        expect(rect).not.toBeNull();
        // X: 100 - 24 = 76 floored; Y: 120 - 24 = 96 floored
        expect(rect!.x).toBe(76);
        expect(rect!.y).toBe(96);
        // width: 700 - 100 + 48 = 648
        expect(rect!.width).toBe(648);
        // height: 400 - 120 + 48 = 328
        expect(rect!.height).toBe(328);
    });

    it('clamps the bbox to the container size when padding overflows', () => {
        const el = document.createElement('div');
        el.className = 'react-flow__node';
        el.getBoundingClientRect = () => ({
            x: 0, y: 0, left: 0, top: 0,
            right: 1000, bottom: 800,
            width: 1000, height: 800, toJSON: () => ({}),
        }) as DOMRect;
        container.appendChild(el);
        const rect = computeNodeBoundingRect({ container, paddingPx: 200 });
        expect(rect!.x).toBe(0);
        expect(rect!.y).toBe(0);
        expect(rect!.width).toBeLessThanOrEqual(1000);
        expect(rect!.height).toBeLessThanOrEqual(800);
    });
});

describe('cropSvgToBoundingBox', () => {
    it('sets viewBox + width + height on the root svg element', () => {
        const src = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect x="10" y="10" width="20" height="20" /></svg>';
        const out = cropSvgToBoundingBox(src, { x: 50, y: 60, width: 400, height: 200 });
        expect(out).toContain('viewBox="50 60 400 200"');
        expect(out).toContain('width="400"');
        expect(out).toContain('height="200"');
    });

    it('returns the input unchanged for invalid crop rects', () => {
        const src = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';
        expect(cropSvgToBoundingBox(src, { x: 0, y: 0, width: 0, height: 100 })).toBe(src);
        expect(cropSvgToBoundingBox(src, { x: 0, y: 0, width: 100, height: -1 })).toBe(src);
    });
});
