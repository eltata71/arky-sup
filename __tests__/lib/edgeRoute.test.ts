/**
 * La ruta de una arista, tal como la calculó el motor (plan de diagramas, 8.3d).
 */
import { describe, expect, it } from 'vitest';
import { isRouteCurrent, routePath, type EdgeRoute } from '../../lib/edgeRoute';

const route: EdgeRoute = {
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 200, y: 80 }],
    sourceAt: { x: -50, y: -20 },
    targetAt: { x: 200, y: 60 },
};

describe('isRouteCurrent', () => {
    it('vale mientras los dos nodos siguen donde el motor los puso', () => {
        expect(isRouteCurrent(route, { x: -50, y: -20 }, { x: 200, y: 60 })).toBe(true);
        expect(isRouteCurrent(route, { x: -49.5, y: -20 }, { x: 200, y: 60.5 })).toBe(true);
    });

    it('deja de valer cuando alguien arrastra un nodo', () => {
        expect(isRouteCurrent(route, { x: -50, y: -20 }, { x: 240, y: 60 })).toBe(false);
    });

    it('sin ruta, sin nodos o con un solo punto no hay ruta que dibujar', () => {
        expect(isRouteCurrent(undefined, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
        expect(isRouteCurrent(route, undefined, { x: 200, y: 60 })).toBe(false);
        expect(isRouteCurrent({ ...route, points: [{ x: 0, y: 0 }] }, route.sourceAt, route.targetAt)).toBe(false);
    });
});

describe('routePath', () => {
    it('recorre los puntos con esquinas redondeadas y acaba en el último', () => {
        const { path } = routePath(route.points, 10);
        expect(path.startsWith('M 0 0')).toBe(true);
        expect(path).toContain('L 90 0');
        expect(path).toContain('Q 100 0 100 10');
        expect(path.endsWith('L 200 80')).toBe(true);
    });

    it('el radio nunca supera la mitad de un tramo corto', () => {
        const { path } = routePath([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 100 }], 10);
        expect(path).toContain('L 4 0');
        expect(path).toContain('Q 8 0 8 4');
    });

    it('la etiqueta va en la mitad de la línea, medida por longitud', () => {
        // Longitud total 100 + 80 + 100 = 280; la mitad, 140, cae en el tramo vertical.
        const { labelX, labelY } = routePath(route.points);
        expect(labelX).toBe(100);
        expect(labelY).toBe(40);
    });

    it('ignora los puntos repetidos', () => {
        const { path } = routePath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }]);
        expect(path).toBe('M 0 0 L 50 0');
    });
});
