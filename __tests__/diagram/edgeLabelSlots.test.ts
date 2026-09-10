import { describe, it, expect } from 'vitest';
import { computeEdgeLabelSlots, slotOffsetPx } from '../../services/diagram/edgeLabelSlots';

describe('edgeLabelSlots', () => {
    it('gives lone edges a single slot with zero offset', () => {
        const slots = computeEdgeLabelSlots([
            { id: 'e1', source: 'a', target: 'b' },
            { id: 'e2', source: 'b', target: 'c' },
        ]);
        expect(slots.get('e1')).toEqual({ index: 0, count: 1 });
        expect(slotOffsetPx(slots.get('e1'))).toBe(0);
    });

    it('fans out parallel edges sharing the same node pair', () => {
        const slots = computeEdgeLabelSlots([
            { id: 'e1', source: 'a', target: 'b' },
            { id: 'e2', source: 'a', target: 'b' },
            { id: 'e3', source: 'a', target: 'b' },
        ]);
        expect(slots.get('e1')).toEqual({ index: 0, count: 3 });
        expect(slots.get('e2')).toEqual({ index: 1, count: 3 });
        expect(slots.get('e3')).toEqual({ index: 2, count: 3 });
        // Centred ladder: -step, 0, +step.
        expect(slotOffsetPx(slots.get('e1'), 26)).toBe(-26);
        expect(slotOffsetPx(slots.get('e2'), 26)).toBe(0);
        expect(slotOffsetPx(slots.get('e3'), 26)).toBe(26);
    });

    it('treats A→B and B→A as the same bundle (request/response pairs)', () => {
        const slots = computeEdgeLabelSlots([
            { id: 'req', source: 'a', target: 'b' },
            { id: 'res', source: 'b', target: 'a' },
        ]);
        expect(slots.get('req')?.count).toBe(2);
        expect(slots.get('res')?.count).toBe(2);
        expect(slots.get('req')?.index).not.toBe(slots.get('res')?.index);
    });

    it('returns zero offset for undefined slots (legacy edges)', () => {
        expect(slotOffsetPx(undefined)).toBe(0);
    });
});
