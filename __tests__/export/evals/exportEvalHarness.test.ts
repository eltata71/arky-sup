/**
 * Controles positivos del banco de exportación (9.0).
 *
 * El banco hoy mide sobre todo ceros. Un cero puede ser un defecto del
 * exportador o un defecto del lector, y sólo el primero es información. Estos
 * controles construyen a mano el fichero que 9.1–9.3 deberían producir y
 * comprueban que el lector lo mide al 100 %: así la tarea que corrija un
 * exportador ve subir su cifra en vez de pelearse con el banco.
 */
import { describe, expect, it } from 'vitest';
import { createStoredZip } from '../../../services/export/utils/zip';
import type { PresentationDeck } from '../../../services/presentation';
import { countSpecialCharacters, measureDocx, measurePdf, measurePptx, readSourceDocument } from './exportEvalHarness';

const SOURCE = [
    '# Título del documento',
    '',
    '| Campo | Valor |',
    '|---|---|',
    '| Uno | **Alta** |',
    '| Dos |',
    '| Tres | Valor | Sobrante |',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
].join('\n');

const tc = (text: string): string => `<w:tc><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
const tr = (cells: string[]): string => `<w:tr>${cells.map(tc).join('')}</w:tr>`;

const docx = (withStyles: boolean): Uint8Array => createStoredZip([
    {
        path: 'word/document.xml',
        content: `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Título del documento</w:t></w:r></w:p>`
            + `<w:tbl>${tr(['Campo', 'Valor'])}${tr(['Uno', 'Alta'])}${tr(['Dos', ''])}${tr(['Tres', 'Valor · Sobrante'])}</w:tbl>`
            + `<w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>`,
    },
    ...(withStyles ? [{ path: 'word/styles.xml', content: '<w:styles><w:style w:type="paragraph" w:styleId="Heading1"/></w:styles>' }] : []),
]);

describe('lectura del original', () => {
    it('cuenta toda fila, tenga las celdas que tenga, y no confunde el código con contenido', () => {
        const source = readSourceDocument(SOURCE);
        expect(source.tables).toHaveLength(1);
        expect(source.tables[0]?.rows).toHaveLength(3);
        expect(source.headings).toEqual(['Título del documento']);
        expect(source.diagrams).toBe(1);
    });

    it('no cuenta como pérdida una comilla tipográfica ni un selector de variación', () => {
        expect(Array.from(countSpecialCharacters('“hola” — ⚠️ → é').entries())).toEqual([['⚠', 1], ['→', 1]]);
    });
});

describe('controles del DOCX', () => {
    it('un DOCX con estilos definidos, filas completas y un dibujo mide 100 %', () => {
        const metrics = measureDocx(docx(true), readSourceDocument(SOURCE));
        for (const [metric, count] of Object.entries(metrics)) expect(count?.logrado, metric).toBe(count?.esperado);
    });

    it('un estilo citado que styles.xml no define no cuenta como título', () => {
        expect(measureDocx(docx(false), readSourceDocument(SOURCE)).encabezadosConEstilo).toEqual({ logrado: 0, esperado: 1 });
    });
});

describe('controles del PPTX', () => {
    const deck: PresentationDeck = {
        kind: 'presentation',
        version: '1.0.0',
        title: 'Control',
        audience: 'technical',
        slides: [{
            id: 's1',
            slideNumber: 1,
            title: 'Hitos',
            layout: 'timeline',
            speakerNotes: 'El piloto usa un solo ramo.',
            contentBlocks: [
                { type: 'table', content: { headers: ['Hito', 'Fecha'], rows: [['Diseño', 'Enero']] } },
                { type: 'diagram', content: { mermaid: 'flowchart LR\n  A --> B' } },
            ],
        }],
    };
    const cell = (text: string): string => `<a:tc><a:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody></a:tc>`;
    const pptx = createStoredZip([
        { path: 'ppt/slides/slide1.xml', content: `<p:sld><a:tbl><a:tr>${cell('Hito')}${cell('Fecha')}</a:tr><a:tr>${cell('Diseño')}${cell('Enero')}</a:tr></a:tbl><p:pic/></p:sld>` },
        {
            path: 'ppt/slides/_rels/slide1.xml.rels',
            content: '<Relationships><Relationship Id="rId1" Type="http://x/relationships/slideLayout" Target="../slideLayouts/slideLayout7.xml"/>'
                + '<Relationship Id="rId2" Type="http://x/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
        },
        { path: 'ppt/slideLayouts/slideLayout7.xml', content: '<p:sldLayout><p:cSld name="timeline"/></p:sldLayout>' },
        { path: 'ppt/notesSlides/notesSlide1.xml', content: '<p:notes><a:t>El piloto usa un solo ramo.</a:t></p:notes>' },
    ]);

    it('tabla nativa, notas enlazadas, imagen y el layout por su nombre miden 100 %', () => {
        const { metrics, layouts } = measurePptx(pptx, deck);
        for (const [metric, count] of Object.entries(metrics)) expect(count?.logrado, metric).toBe(count?.esperado);
        expect(layouts).toEqual(['timeline']);
    });
});

describe('controles del PDF', () => {
    const pdf = (title: string): Uint8Array => {
        const stream = `BT /F2 22 Tf 72 700 Td (${title}) Tj ET\nBT /F1 9 Tf 72 680 Td (Uno Alta) Tj ET\nBT /F1 9 Tf 72 670 Td (Dos) Tj ET\nBT /F1 9 Tf 72 660 Td (Tres Valor Sobrante) Tj ET`;
        const text = [
            '%PDF-1.4',
            '1 0 obj\n<< /Type /Page /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 2 0 R >>\nendobj',
            `2 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`,
            '3 0 obj\n<< /Type /Font /BaseFont /Helvetica >>\nendobj',
            '4 0 obj\n<< /Type /Font /BaseFont /Helvetica-Bold >>\nendobj',
            '5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>\nendobj',
        ].join('\n');
        return Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    };

    it('un título en negrita, las palabras de cada fila y una imagen miden 100 %, sin pérdidas', () => {
        const { metrics, perdidos } = measurePdf(pdf('Título del documento'), readSourceDocument(SOURCE), SOURCE);
        for (const [metric, count] of Object.entries(metrics)) expect(count?.logrado, metric).toBe(count?.esperado);
        expect(perdidos).toEqual({});
    });

    it('una flecha que llega como «?» es una pérdida y deja el título sin contar', () => {
        const source = '# Base → objetivo\n';
        const { metrics, perdidos } = measurePdf(pdf('Base ? objetivo'), readSourceDocument(source), source);
        expect(perdidos).toEqual({ '→': 1 });
        expect(metrics.caracteresPerdidosPdf?.logrado).toBe(1);
        expect(metrics.encabezadosConEstilo).toEqual({ logrado: 0, esperado: 1 });
    });
});
