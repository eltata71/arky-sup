// @vitest-environment jsdom
/**
 * Un texto de diagrama se juzga con la gramática de Mermaid y, si es un grafo,
 * se cuenta (plan de diagramas, 8.2a).
 */
import { describe, expect, it } from 'vitest';
import { assessDiagramText, isRenderableDiagramText } from '../../../../../services/ai/generation/diagram/diagramTextAssessment';

const GANTT = 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Fase\n  Tarea :t1, 2026-11-02, 10d';

describe('assessDiagramText', () => {
    it('un Gantt válido se acepta aunque no tenga nodos que contar', async () => {
        const verdict = await assessDiagramText(GANTT, 'mermaid-gantt');
        expect(verdict.ok).toBe(true);
        expect(verdict.unverified).toBeUndefined();
    });

    it('un texto que Mermaid rechaza falla con el mensaje de Mermaid, que llega al reintento', async () => {
        const verdict = await assessDiagramText('flowchart LR\n  a[Portal] --> b[API]\n  b -->', 'mermaid-graph');
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/^Mermaid rejected the syntax: .*parse error/is);
    });

    it('un C4 válido sin relaciones sigue sin bastar', async () => {
        const verdict = await assessDiagramText('C4Context\n  Person(a, "Asegurado")\n  System(b, "Portal")', 'mermaid-c4-context');
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/edge/);
    });

    it('un híbrido sin bloque mermaid falla antes de preguntar', async () => {
        expect((await assessDiagramText('# Sólo prosa', 'hybrid-text-diagram')).ok).toBe(false);
    });
});

describe('isRenderableDiagramText', () => {
    it('un Gantt válido es renderizable: lo dibuja Mermaid, no el lienzo', async () => {
        expect((await isRenderableDiagramText(GANTT)).ok).toBe(true);
    });

    it('un grafo con menos de dos nodos no lo es', async () => {
        expect((await isRenderableDiagramText('flowchart LR\n  a[Solo]')).ok).toBe(false);
    });
});
