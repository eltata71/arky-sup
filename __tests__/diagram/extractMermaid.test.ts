import { describe, it, expect } from 'vitest';
import { detectMermaidKind, extractMermaidCode } from '../../utils/diagram/extractMermaid';

describe('extractMermaidCode', () => {
    it('returns null for empty input', () => {
        expect(extractMermaidCode(undefined, 'hybrid')).toBeNull();
        expect(extractMermaidCode('', 'hybrid')).toBeNull();
        expect(extractMermaidCode('   ', 'hybrid')).toBeNull();
    });

    it('returns raw content when representation is diagram and no fence present', () => {
        const raw = 'flowchart LR\n    A --> B';
        expect(extractMermaidCode(raw, 'diagram')).toBe(raw.trim());
    });

    it('recorta texto introductorio antes de un bloque Mermaid sin fence', () => {
        const code = extractMermaidCode('Aquí tienes el resultado:\n\nflowchart LR\n  Web --> API', 'diagram');
        expect(code).toBe('flowchart LR\n  Web --> API');
    });

    it('no trata prosa como Mermaid solo por representation diagram', () => {
        expect(extractMermaidCode('La IA devolvió una descripción sin sintaxis renderizable.', 'diagram')).toBeNull();
    });

    it('extracts fenced mermaid from hybrid content', () => {
        const content = `# Title\n\nIntro paragraph.\n\n\`\`\`mermaid\nflowchart TD\n  A-->B\n\`\`\`\n\nFooter text.`;
        const extracted = extractMermaidCode(content, 'hybrid');
        expect(extracted).toBe('flowchart TD\n  A-->B');
    });

    it('falls back to header detection when no fence exists', () => {
        const content = 'sequenceDiagram\n    actor User\n    User->>API: request';
        expect(extractMermaidCode(content, 'document')).toContain('sequenceDiagram');
    });
});

describe('extractMermaidCode — BPMN-style hybrid lanes regression', () => {
    // The pharmacy-claim regression that produced the empty canvas always
    // ships the Mermaid block inside the hybrid markdown using the standard
    // ```mermaid``` fence. This guards against any regex regression that
    // would silently strip subgraph lanes or the trailing fence.
    it('extracts a BPMN swimlane flowchart from a real on-demand hybrid artifact', () => {
        const content = [
            '# Modelo de Proceso de Negocio (BPMN)',
            '',
            '## Resumen',
            'Flujo end-to-end del pago de reclamos de farmacia.',
            '',
            '```mermaid',
            'flowchart LR',
            '    subgraph farmacia_lane ["Farmacia"]',
            '        dispensa["Dispensa medicamento"]',
            '        captura["Captura reclamo en POS"]',
            '    end',
            '    subgraph aseguradora_lane ["Aseguradora"]',
            '        adjudica["Adjudica monto"]',
            '    end',
            '    dispensa --> captura',
            '    captura --> adjudica',
            '```',
            '',
            '## Notas',
            'Documento listo para edición.',
        ].join('\n');

        const code = extractMermaidCode(content, 'hybrid');
        expect(code).toBeTruthy();
        expect(code).toContain('flowchart LR');
        expect(code).toContain('subgraph farmacia_lane');
        expect(code).toContain('subgraph aseguradora_lane');
        expect(code).toContain('captura --> adjudica');
    });
});

describe('detectMermaidKind', () => {
    it('identifies flowcharts', () => {
        expect(detectMermaidKind('flowchart TD\n  A-->B')).toBe('Flujo');
    });
    it('identifies C4 contexts', () => {
        expect(detectMermaidKind('C4Context\n  title Example')).toBe('C4 Contexto');
    });
    it('identifies sequence diagrams', () => {
        expect(detectMermaidKind('sequenceDiagram\n  actor User')).toBe('Secuencia');
    });
    it('falls back when nothing matches', () => {
        expect(detectMermaidKind('random text')).toBe('Diagrama');
    });
});
