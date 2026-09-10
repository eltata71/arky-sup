import { describe, it, expect } from 'vitest';
import { prioritizeProjectContext } from '../../services/ai/prompts/diagramPrompts';

describe('prioritizeProjectContext', () => {
    it('returns all items unchanged when below the limit', () => {
        const items = ['A', 'B', 'C'];
        expect(prioritizeProjectContext(items, { limit: 12 })).toEqual(items);
    });

    it('drops short noise lines first', () => {
        const items = [
            'ok',
            'sí',
            'gracias',
            'Tecnología principal: Kafka 3.6 y PostgreSQL 15',
            'Cumplimiento HIPAA y PCI-DSS obligatorios',
            'Despliegue on-prem con Kubernetes 1.29',
        ];
        const top = prioritizeProjectContext(items, { limit: 3 });
        expect(top).toContain('Tecnología principal: Kafka 3.6 y PostgreSQL 15');
        expect(top).toContain('Cumplimiento HIPAA y PCI-DSS obligatorios');
        expect(top.some((l) => l === 'ok' || l === 'sí')).toBe(false);
    });

    it('preserves narrative ordering after selection', () => {
        const items = [
            'Línea 1 con kafka',
            'Línea 2 sin keywords',
            'Línea 3 con postgres',
            'Línea 4 sin nada relevante',
        ];
        const top = prioritizeProjectContext(items, { limit: 2 });
        // Either picks 1 then 3 (ordered by index), but never 3 then 1.
        const idx1 = top.indexOf('Línea 1 con kafka');
        const idx3 = top.indexOf('Línea 3 con postgres');
        if (idx1 >= 0 && idx3 >= 0) {
            expect(idx1).toBeLessThan(idx3);
        }
    });

    it('prefers recent items when tied on keyword score', () => {
        const items = ['Bullet temprano sin keywords', 'Bullet medio sin keywords', 'Bullet tardío sin keywords'];
        const top = prioritizeProjectContext(items, { limit: 1 });
        expect(top).toEqual(['Bullet tardío sin keywords']);
    });
});
