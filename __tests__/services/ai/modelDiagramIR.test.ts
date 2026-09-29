/**
 * La respuesta del modelo se lee como salida no confiable (plan de diagramas,
 * 6.4): lo válido se conserva, lo inválido se quita y se nombra.
 */
import { describe, expect, it } from 'vitest';
import { readModelDiagramIR } from '../../../services/ai/generation/diagram/modelDiagramIR';

describe('readModelDiagramIR', () => {
    it('tolera bloques de código y descarta el review que nadie lee', () => {
        const read = readModelDiagramIR('```json\n{"nodes":[{"id":"a","label":"A","kind":"service"}],"edges":[],"review":{"score":99}}\n```');
        expect(read.ir?.nodes).toHaveLength(1);
        expect(read.ir).not.toHaveProperty('review');
        expect(read.dropped).toEqual([]);
    });

    it('distingue un rechazo del modelo de una respuesta rota', () => {
        expect(readModelDiagramIR('{"error":"faltan actores"}')).toMatchObject({ ir: null, declined: 'faltan actores' });
        expect(readModelDiagramIR('no es json')).toMatchObject({ ir: null, failure: expect.any(String) });
        expect(readModelDiagramIR('{"nodes":[]}')).toMatchObject({ ir: null, failure: expect.stringMatching(/ningún nodo/) });
    });

    it('quita y nombra nodos sin id, repetidos y conexiones a la nada', () => {
        const read = readModelDiagramIR(JSON.stringify({
            nodes: [
                { id: 'a', label: 'A', kind: 'service' },
                { id: 'a', label: 'Otra A', kind: 'service' },
                { label: 'Sin id' },
                { id: 'b', label: 'B' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: 'Llama' },
                { id: 'e2', source: 'a', target: 'fantasma', label: 'x' },
                { id: 'e1', source: 'b', target: 'a', label: 'Responde' },
            ],
            groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'zzz'] }, { id: 'vacio', label: 'V', nodeIds: ['nada'] }],
        }));
        expect(read.ir?.nodes.map((n) => [n.id, n.kind])).toEqual([['a', 'service'], ['b', 'generic']]);
        expect(read.ir?.edges.map((e) => e.id)).toEqual(['e1', 'e1-3']);
        expect(read.ir?.groups.map((g) => [g.id, g.nodeIds])).toEqual([['g', ['a']]]);
        expect(read.dropped).toEqual([
            'Nodo «a» repetido: se conserva el primero.',
            'Nodo 3: le falta el id.',
            'Conexión «e2»: apunta a un nodo que no existe (a → fantasma).',
            'Agrupación «g»: 1 miembro(s) que no existen.',
            'Agrupación «vacio»: 1 miembro(s) que no existen.',
        ]);
    });

    it('quita los valores fuera de vocabulario sin perder el elemento', () => {
        const read = readModelDiagramIR(JSON.stringify({
            nodes: [{ id: 'a', label: 'A', kind: 'Container', dataClassification: 'secreto', trust: 'inferred', criticality: 'high' }],
            edges: [],
            groups: [{ id: 'g', label: 'G', nodeIds: ['a'], kind: 'dominio' }],
        }));
        const node = read.ir!.nodes[0];
        expect(node.kind).toBe('Container');
        expect(node.criticality).toBe('high');
        expect(node).not.toHaveProperty('dataClassification');
        expect(node).not.toHaveProperty('trust');
        expect(read.ir!.groups[0]).not.toHaveProperty('kind');
        expect(read.dropped).toHaveLength(3);
    });
});
