/**
 * Tests for the canvas edge-label shortening rule.
 *
 * Motivation: the screenshots from the regression report showed every long
 * edge label truncated with a trailing ellipsis ("Sincroniza catálogo
 * medicamentos · …") because the canvas applied a CSS `line-clamp` over a
 * 260px-wide pill. We now run a deterministic shortening pass in the
 * renderer so the visible text is meaningful, the protocol annotation moves
 * to the badge, and the full string is reachable via the tooltip.
 */

import { describe, it, expect } from 'vitest';
import { shortenEdgeLabel } from '../../components/CustomEdge';

describe('shortenEdgeLabel', () => {
    it('keeps short labels untouched', () => {
        expect(shortenEdgeLabel('Lee póliza')).toBe('Lee póliza');
        expect(shortenEdgeLabel('REST/HTTPS')).toBe('REST/HTTPS');
    });

    it('strips a trailing "· protocol" annotation when the prefix already fits', () => {
        expect(shortenEdgeLabel('Sincroniza catálogo medicamentos · REST/HTTPS')).toBe('Sincroniza catálogo medicamentos');
        expect(shortenEdgeLabel('Publica eventos EOB · Kafka topic')).toBe('Publica eventos EOB');
    });

    it('truncates at a word boundary with an ellipsis when nothing else helps', () => {
        const long = 'Consulta elegibilidad asegurado contra PBM con autenticación OAuth2 y JWT';
        const shortened = shortenEdgeLabel(long);
        expect(shortened.length).toBeLessThanOrEqual(57);
        expect(shortened.endsWith('…')).toBe(true);
        expect(shortened.split(/\s+/).pop()).not.toBe('au'); // never cuts mid-word
    });

    it('respects the configurable limit', () => {
        const shortened = shortenEdgeLabel('Una descripción extensa para una relación crítica', 24);
        expect(shortened.length).toBeLessThanOrEqual(25);
    });

    it('keeps the first sentence when the label is a narrative', () => {
        const narrative = 'Valida elegibilidad del asegurado. Publica EOB en el bus de eventos y notifica al PBM.';
        expect(shortenEdgeLabel(narrative)).toBe('Valida elegibilidad del asegurado.');
    });
});
