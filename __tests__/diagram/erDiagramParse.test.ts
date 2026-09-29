/**
 * El parser de erDiagram lee las relaciones con cardinalidad (plan de diagramas, 6.5):
 * antes su expresión regular no cerraba una clase de caracteres y descartaba
 * toda relación `||--o{`, así que un ERD correcto llegaba al canvas sin aristas.
 */
import { describe, expect, it } from 'vitest';
import { mermaidToIR } from '../../services/diagram';

const ER = `erDiagram
    ASEGURADO ||--o{ POLIZA : contrata
    POLIZA ||--|{ BENEFICIARIO : "designa"
    POLIZA }o..o| AGENTE : "es atendida por"
    ASEGURADO {
        string id PK
    }`;

describe('erDiagram → IR', () => {
    it('conserva cada relación con su etiqueta y su cardinalidad', () => {
        const ir = mermaidToIR(ER);
        expect(ir.nodes.map((n) => n.id).sort()).toEqual(['AGENTE', 'ASEGURADO', 'BENEFICIARIO', 'POLIZA']);
        expect(ir.edges.map((e) => [e.source, e.target, e.label])).toEqual([
            ['ASEGURADO', 'POLIZA', 'contrata (1 → 0..*)'],
            ['POLIZA', 'BENEFICIARIO', 'designa (1 → 1..*)'],
            ['POLIZA', 'AGENTE', 'es atendida por (0..* → 0..1)'],
        ]);
    });
});
