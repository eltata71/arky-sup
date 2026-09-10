import { describe, it, expect } from 'vitest';
import { assessDocumentArtifact, assessPresentationDeck } from '../../services/quality/documentAcceptability';

describe('assessDocumentArtifact', () => {
    const completeDoc = `# Documento de Diseño

## Contexto
El sistema gestiona reclamaciones médicas del PBM con trazabilidad completa.

## Requisitos
- BR-001: Validar elegibilidad del afiliado.
- BR-002: Registrar auditoría de cada transacción.

## Conclusión
El diseño cumple los requisitos establecidos y queda listo para revisión.
${'Contenido adicional de relleno. '.repeat(20)}`;

    it('accepts a complete structured document', () => {
        const result = assessDocumentArtifact(completeDoc, { expectStructuredDocument: true });
        expect(result.ok).toBe(true);
        expect(result.truncated).toBe(false);
        expect(result.score).toBeGreaterThan(50);
    });

    it('rejects empty content', () => {
        const result = assessDocumentArtifact('   ');
        expect(result.ok).toBe(false);
        expect(result.issues[0].code).toBe('doc.empty');
    });

    it('flags an unclosed code fence as truncation', () => {
        const truncated = `${completeDoc}\n\n\`\`\`json\n{ "corte": "a mitad de bloque"`;
        const result = assessDocumentArtifact(truncated);
        expect(result.ok).toBe(false);
        expect(result.truncated).toBe(true);
        expect(result.issues.some((i) => i.code === 'doc.unclosed-fence')).toBe(true);
    });

    it('flags an abrupt mid-sentence ending', () => {
        const truncated = `${completeDoc}\n\nEl módulo de facturación se integra con`;
        const result = assessDocumentArtifact(truncated);
        expect(result.truncated).toBe(true);
        expect(result.issues.some((i) => i.code === 'doc.abrupt-ending')).toBe(true);
    });

    it('flags an incomplete trailing table row', () => {
        const truncated = `${completeDoc}\n\n| Req | Estado |\n|---|---|\n| BR-001 | Completo |\n| BR-002 | En progre`;
        const result = assessDocumentArtifact(truncated);
        expect(result.truncated).toBe(true);
    });

    describe('visual enrichment gate', () => {
        const longProse = `# Informe\n\n## Contexto\n${'Texto sustantivo del informe arquitectural. '.repeat(60)}\n\n## Cierre\nFin del informe.`;
        const table = '\n\n| ID | Riesgo | Impacto |\n|---|---|---|\n| R-01 | Latencia | Alto |\n';
        const mermaid = '\n\n```mermaid\nflowchart LR\n  A --> B\n```\n';

        it('marks a long document with neither diagram nor tables as critical', () => {
            const result = assessDocumentArtifact(longProse, { expectVisualEnrichment: true });
            expect(result.ok).toBe(false);
            expect(result.issues.some((i) => i.code === 'doc.no-visual-elements' && i.severity === 'critical')).toBe(true);
        });

        it('only warns when the diagram is missing but tables exist', () => {
            const result = assessDocumentArtifact(longProse + table, { expectVisualEnrichment: true });
            expect(result.ok).toBe(true);
            expect(result.issues.some((i) => i.code === 'doc.no-diagram' && i.severity === 'warning')).toBe(true);
        });

        it('only warns when tables are missing but a diagram exists', () => {
            const result = assessDocumentArtifact(longProse + mermaid, { expectVisualEnrichment: true });
            expect(result.ok).toBe(true);
            expect(result.issues.some((i) => i.code === 'doc.no-tables' && i.severity === 'warning')).toBe(true);
        });

        it('passes clean when both diagram and tables are present', () => {
            const result = assessDocumentArtifact(longProse + table + mermaid, { expectVisualEnrichment: true });
            expect(result.ok).toBe(true);
            expect(result.issues.some((i) => i.code.startsWith('doc.no-'))).toBe(false);
        });

        it('exempts short documents from the visual standard', () => {
            const short = `# Nota\n\n## Decisión\n${'Decisión breve documentada. '.repeat(18)}Fin.`;
            const result = assessDocumentArtifact(short, { expectVisualEnrichment: true });
            expect(result.issues.some((i) => i.code.startsWith('doc.no-'))).toBe(false);
        });

        it('does not apply the visual standard when the flag is off', () => {
            const result = assessDocumentArtifact(longProse, {});
            expect(result.ok).toBe(true);
        });
    });

    it('warns (not blocks) when a structured document lacks headings', () => {
        const flat = 'Texto plano sin encabezados. '.repeat(40);
        const result = assessDocumentArtifact(flat, { expectStructuredDocument: true });
        expect(result.ok).toBe(true);
        expect(result.issues.some((i) => i.code === 'doc.no-headings' && i.severity === 'warning')).toBe(true);
    });

    it('rejects too-short documents', () => {
        const result = assessDocumentArtifact('# Hola\n\nMuy corto.');
        expect(result.ok).toBe(false);
        expect(result.issues.some((i) => i.code === 'doc.too-short')).toBe(true);
    });
});

describe('assessPresentationDeck', () => {
    const deck = (slides: unknown[]) => JSON.stringify({ kind: 'presentation', slides });

    const fullSlide = (n: number) => ({
        id: `s${n}`,
        title: `Slide ${n}`,
        layout: 'executiveSummary',
        contentBlocks: [{ type: 'text', content: 'Mensaje clave de la diapositiva.' }],
    });

    it('accepts a healthy deck', () => {
        const result = assessPresentationDeck(deck([
            { id: 's1', title: 'Portada', layout: 'titleSlide', contentBlocks: [] },
            fullSlide(2), fullSlide(3), fullSlide(4),
        ]));
        expect(result.ok).toBe(true);
        expect(result.slideCount).toBe(4);
        expect(result.emptySlideCount).toBe(0);
    });

    it('rejects invalid JSON and empty decks', () => {
        expect(assessPresentationDeck('no es json').ok).toBe(false);
        expect(assessPresentationDeck(deck([])).issues[0].code).toBe('deck.no-slides');
    });

    it('marks mostly-empty content slides as critical', () => {
        const result = assessPresentationDeck(deck([
            { id: 's1', title: 'A', layout: 'executiveSummary', contentBlocks: [] },
            { id: 's2', title: 'B', layout: 'twoColumn', contentBlocks: [] },
            fullSlide(3),
        ]));
        expect(result.ok).toBe(false);
        expect(result.emptySlideCount).toBe(2);
    });

    it('does not penalise title/divider/closing slides without blocks', () => {
        const result = assessPresentationDeck(deck([
            { id: 's1', title: 'Portada', layout: 'titleSlide', contentBlocks: [] },
            fullSlide(2),
            { id: 's3', title: 'Cierre', layout: 'closingSlide', contentBlocks: [] },
        ]));
        expect(result.emptySlideCount).toBe(0);
        expect(result.ok).toBe(true);
    });
});
