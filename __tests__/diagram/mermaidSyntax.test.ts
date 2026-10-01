// @vitest-environment jsdom
/**
 * La gramática de Mermaid juzga el texto de un diagrama (plan de diagramas, 8.2a).
 */
import { describe, expect, it } from 'vitest';
import { mermaidToIR } from '../../services/diagram';
import { checkMermaidSyntax, isIRReadableDialect } from '../../services/diagram/mermaidSyntax';

describe('checkMermaidSyntax', () => {
    it('acepta cada dialecto que el producto genera', async () => {
        for (const code of [
            'flowchart LR\n  a[Portal] --> b[API]',
            'sequenceDiagram\n  A->>B: Pide',
            'erDiagram\n  POLIZA ||--o{ SINIESTRO : origina',
            'stateDiagram-v2\n  [*] --> Recibida',
            'C4Container\n  Container(api, "API", "Spring Boot", "Adjudica")',
            'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Fase\n  Tarea :t1, 2026-11-02, 10d',
        ]) {
            expect((await checkMermaidSyntax(code)).status, code.split('\n')[0]).toBe('valid');
        }
    });

    it('rechaza un texto fuera de la gramática y devuelve el mensaje de Mermaid', async () => {
        const verdict = await checkMermaidSyntax('flowchart LR\n  a -->');
        expect(verdict.status).toBe('invalid');
        if (verdict.status === 'invalid') expect(verdict.message).toMatch(/parse error/i);
    });

    it('un texto vacío es inválido sin preguntar a Mermaid', async () => {
        expect((await checkMermaidSyntax('  ')).status).toBe('invalid');
    });
});

describe('el IR sólo lee los dialectos que son grafos', () => {
    it('Gantt, journey y mindmap no tienen modelo: IR vacío, no cajas hechas de tareas', () => {
        expect(isIRReadableDialect('gantt')).toBe(false);
        expect(isIRReadableDialect('journey')).toBe(false);
        expect(isIRReadableDialect('flowchart')).toBe(true);
        expect(isIRReadableDialect('C4Container')).toBe(true);
        const ir = mermaidToIR('gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Fase\n  Tarea :t1, 2026-11-02, 10d');
        expect(ir.nodes).toEqual([]);
    });
});
