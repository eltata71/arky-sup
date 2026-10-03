/**
 * Banco de evaluación de exportación (plan de clase mundial, 9.0).
 *
 * Los bancos de diagramas y de artefactos miden lo que se guarda. Éste mide lo
 * que **sale**: cada caso es un artefacto real, se exporta con el adaptador de
 * producción y el fichero resultante se abre y se cuenta —el DOCX y el PPTX se
 * descomprimen y se lee su XML; el PDF se lee operador a operador—. Nada se
 * estima a partir del código del exportador: si la tabla no está en el
 * fichero, no está.
 *
 * Métricas, por formato:
 *
 * - `filasPreservadas`: filas de tabla del original cuyas celdas siguen en el
 *   fichero. DOCX y PPTX lo miran dentro de su tabla nativa; el PDF no tiene
 *   tablas como estructura, así que lo mide **léxicamente**: todas las palabras
 *   de la fila están en el texto del PDF.
 * - `tablasNativas`: tablas del original que llegan como tabla del formato
 *   (`w:tbl`, `a:tbl`) con su cabecera, no aplanadas a texto.
 * - `encabezadosConEstilo`: encabezados de nivel 1–3 que el formato reconoce
 *   como tales. En DOCX, un `w:pStyle` **cuyo estilo está definido** en
 *   `word/styles.xml` (citar un estilo que no existe es pintar `Normal`); en el
 *   PDF, texto en la fuente negrita a cuerpo de título.
 * - `diagramasIncrustados`: diagramas del original que llegan como imagen o
 *   dibujo, no como su código fuente.
 * - `notasOrador`: diapositivas con `speakerNotes` cuyas notas viajan en un
 *   `notesSlide` enlazado.
 * - `layoutsRespetados`: *layouts* distintos del corpus que llegan como el
 *   *layout* de su diapositiva (el `p:cSld name` del `slideLayout` enlazado es
 *   el identificador del modelo). El objetivo es 14 de 14.
 * - `caracteresPerdidosPdf`: caracteres fuera de Latin-1 del original que no
 *   aparecen en el texto del PDF. Se excluyen las sustituciones tipográficas
 *   que no cambian el significado (comillas, rayas, viñetas, puntos
 *   suspensivos): lo que se cuenta es una flecha, un comparador, una marca o
 *   una letra griega que se convierte en `?`.
 *
 * El modelo no interviene: los artefactos son redactados a mano y cada caso lo
 * declara. El rasterizador de Mermaid se sustituye en la prueba por una imagen
 * fija, porque jsdom no pinta: lo que se mide es si el exportador **incrusta**
 * la imagen que recibe, no cómo la dibuja Mermaid.
 *
 * El PDF se lee con `../pdfTextReader`: cadenas literales `( ) Tj` sobre
 * WinAnsi y, desde 9.3, cadenas hexadecimales sobre fuentes Identity-H,
 * traducidas con su `ToUnicode` —como las lee un visor al copiar o buscar—.
 * No descomprime: si un exportador comprime sus flujos, el lector se amplía
 * en el mismo cambio.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact } from '../../../lib/artifacts';
import type { ArtifactType } from '../../../types';
import { docxExporter } from '../../../services/export/adapters/docxExporter';
import { pptxExporter } from '../../../services/export/adapters/pptxExporter';
import { pdfExporter } from '../../../services/export/adapters/pdfExporter';
import type { ExportContext } from '../../../services/export/exportTypes';
import { parsePresentationDeck, type PresentationDeck, type PresentationTableContent } from '../../../services/presentation';
import { readPdf } from '../pdfTextReader';

export const CORPUS_DIR = join(process.cwd(), 'tests', 'fixtures', 'export-evals');

// ─── Vocabulario ────────────────────────────────────────────────────────────

export const FORMATS = ['docx', 'pptx', 'pdf'] as const;
export type EvalFormat = typeof FORMATS[number];

export const METRICS = [
    'filasPreservadas',
    'tablasNativas',
    'encabezadosConEstilo',
    'diagramasIncrustados',
    'notasOrador',
    'layoutsRespetados',
    'caracteresPerdidosPdf',
] as const;
export type EvalMetric = typeof METRICS[number];

/** Qué mide cada formato. Una métrica que un formato no tiene no se inventa. */
export const METRICS_BY_FORMAT: Record<EvalFormat, readonly EvalMetric[]> = {
    docx: ['filasPreservadas', 'tablasNativas', 'encabezadosConEstilo', 'diagramasIncrustados'],
    pptx: ['filasPreservadas', 'tablasNativas', 'diagramasIncrustados', 'notasOrador', 'layoutsRespetados'],
    pdf: ['filasPreservadas', 'encabezadosConEstilo', 'diagramasIncrustados', 'caracteresPerdidosPdf'],
};

/** Las métricas que cuentan pérdidas: el objetivo es 0, no 100 %. */
export const LOSS_METRICS: readonly EvalMetric[] = ['caracteresPerdidosPdf'];

export const ALL_LAYOUTS = [
    'titleSlide', 'executiveSummary', 'sectionDivider', 'twoColumn', 'problemSolution',
    'architectureOverview', 'roadmap', 'riskMatrix', 'decisionSlide', 'diagramFocused',
    'comparisonTable', 'timeline', 'metricsKpi', 'closingSlide',
] as const;

export interface ExportEvalCase {
    id: string;
    dominio: 'salud' | 'vida';
    origen: string;
    /** Los hallazgos del plan (H1–H5) que el caso ejercita a propósito. */
    ejercita: string[];
    artefacto: { nombre: string; tipo: ArtifactType; objetivo?: string; contenido: string };
    formatos: EvalFormat[];
    /** Lo que el original contiene, declarado a mano; el arnés lo comprueba contra su propia lectura. */
    esperado: {
        tablas: number;
        filas: number;
        encabezados: number;
        diagramas: number;
        caracteresEspeciales?: number;
        notas?: number;
        layouts?: string[];
    };
}

export interface MetricCount {
    logrado: number;
    esperado: number;
}

export interface ExportEvalCaseResult {
    id: string;
    /** Lo que el arnés lee en el original, para comprobar `esperado`. */
    original: { tablas: number; filas: number; encabezados: number; diagramas: number; caracteresEspeciales: number; notas: number; layouts: string[] };
    porFormato: Partial<Record<EvalFormat, Partial<Record<EvalMetric, MetricCount>>>>;
    /** Layouts honrados en este caso (para el agregado de distintos). */
    layoutsHonrados: string[];
    /** Caracteres perdidos, con su recuento, para el informe. */
    perdidos: Record<string, number>;
}

/** Porcentaje por formato y métrica; `caracteresPerdidosPdf` es un recuento absoluto. */
export type ExportEvalSummary = {
    [F in EvalFormat]: Partial<Record<EvalMetric, number>>;
};

// ─── Corpus ─────────────────────────────────────────────────────────────────

export const loadCorpus = (): ExportEvalCase[] =>
    readdirSync(CORPUS_DIR)
        .filter((file) => file.endsWith('.json') && file !== 'linea-base.json')
        .sort()
        .map((file) => JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8')) as ExportEvalCase);

const toArtifact = (testCase: ExportEvalCase): Artifact => ({
    id: `eval-${testCase.id}`,
    versionGroupId: `vg-${testCase.id}`,
    version: 1,
    createdAt: '2026-10-03T00:00:00.000Z',
    name: testCase.artefacto.nombre,
    type: testCase.artefacto.tipo,
    phase: 'Diseño',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: testCase.artefacto.objetivo ?? '',
    keyConcepts: [],
    representation: testCase.artefacto.tipo.startsWith('presentation-') ? 'presentation' : 'document',
    content: testCase.artefacto.contenido,
} as Artifact);

// ─── Lectura del original ───────────────────────────────────────────────────

interface SourceTable { headers: string[]; rows: string[][] }
interface SourceDocument { tables: SourceTable[]; headings: string[]; diagrams: number }

const splitCells = (line: string): string[] =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

const isSeparatorLine = (line: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

/**
 * Una lectura tolerante, a propósito distinta de la del producto: cuenta cada
 * fila con el número de celdas que tenga. Si usara el parser del producto,
 * heredaría su defecto —descartar la fila irregular— y lo mediría como cero.
 */
export const readSourceDocument = (content: string): SourceDocument => {
    const lines = content.split(/\r?\n/);
    const tables: SourceTable[] = [];
    const headings: string[] = [];
    let diagrams = 0;
    let fence: string | null = null;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        const fenceMatch = /^\s*```\s*([\w-]*)/.exec(line);
        if (fenceMatch) {
            if (fence === null) {
                fence = fenceMatch[1] ?? '';
                if (fence.toLowerCase() === 'mermaid') diagrams += 1;
            } else {
                fence = null;
            }
            continue;
        }
        if (fence !== null) continue;
        const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
        if (heading) {
            headings.push(heading[2] ?? '');
            continue;
        }
        if (line.trim().startsWith('|') && isSeparatorLine(lines[i + 1] ?? '')) {
            const headers = splitCells(line);
            const rows: string[][] = [];
            let cursor = i + 2;
            while (cursor < lines.length && (lines[cursor] ?? '').trim().startsWith('|')) {
                rows.push(splitCells(lines[cursor] ?? ''));
                cursor += 1;
            }
            tables.push({ headers, rows });
            i = cursor - 1;
        }
    }
    return { tables, headings, diagrams };
};

/** Comillas, rayas, viñetas y puntos suspensivos: sustituirlos no cambia el significado. */
const TYPOGRAPHIC = new Set(['‘', '’', '‚', '‛', '“', '”', '„', '‟', '–', '—', '•', '◦', '…']);
/** Selectores de variación y unión de ancho cero: modifican al anterior, no son un carácter visible. */
const isModifier = (ch: string): boolean => /^[\uFE00-\uFE0F\u200D]$/.test(ch);

export const countSpecialCharacters = (text: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const ch of text) {
        if ((ch.codePointAt(0) ?? 0) <= 0xff || TYPOGRAPHIC.has(ch) || isModifier(ch)) continue;
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    return counts;
};

const deckTables = (deck: PresentationDeck): SourceTable[] =>
    deck.slides.flatMap((slide) => slide.contentBlocks
        .filter((block) => block.type === 'table')
        .map((block) => block.content as PresentationTableContent)
        .map((table) => ({ headers: table.headers, rows: table.rows })));

const deckDiagrams = (deck: PresentationDeck): number =>
    deck.slides.filter((slide) => slide.contentBlocks.some((block) =>
        block.type === 'diagram' && Boolean((block.content as { mermaid?: string }).mermaid?.trim()))).length;

// ─── Lectura del fichero ────────────────────────────────────────────────────

/** Lee un ZIP sin compresión (método 0), que es lo que escribe `createStoredZip`. */
export const readStoredZip = (bytes: Uint8Array): Map<string, Uint8Array> => {
    const entries = new Map<string, Uint8Array>();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;
    while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
        const method = view.getUint16(offset + 8, true);
        const size = view.getUint32(offset + 18, true);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
        const start = offset + 30 + nameLength + extraLength;
        if (method !== 0) throw new Error(`El banco lee ZIP sin compresión; «${name}» usa el método ${method}. Amplía el lector.`);
        entries.set(name, bytes.subarray(start, start + size));
        offset = start + size;
    }
    return entries;
};

const utf8 = (bytes: Uint8Array | undefined): string => (bytes ? new TextDecoder().decode(bytes) : '');

const decodeXml = (value: string): string => value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');

/** El texto de un fragmento OOXML: todo lo que hay dentro de `<w:t>` o `<a:t>`. */
const xmlText = (fragment: string): string =>
    Array.from(fragment.matchAll(/<(?:w|a):t(?:\s[^>]*)?>([^<]*)<\/(?:w|a):t>/g), (m) => decodeXml(m[1] ?? '')).join('');

/** Comparar sin el marcado en línea de Markdown ni espacios: lo que se mide es el contenido. */
export const normalizeText = (value: string): string => value.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

const elements = (xml: string, tag: string): string[] =>
    Array.from(xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g')), (m) => m[0]);

interface FileTable { headers: string[]; rows: string[][] }

const readOoxmlTables = (xml: string, prefix: 'w' | 'a'): FileTable[] =>
    elements(xml, `${prefix}:tbl`).map((tbl) => {
        const rows = elements(tbl, `${prefix}:tr`).map((tr) => elements(tr, `${prefix}:tc`).map((tc) => normalizeText(xmlText(tc))));
        return { headers: rows[0] ?? [], rows: rows.slice(1) };
    });

/** Una fila se conserva si cada celda no vacía del original está, en orden, en una fila de la tabla. */
const rowPreserved = (source: string[], candidates: string[][]): boolean => {
    const wanted = source.map(normalizeText).filter(Boolean);
    return candidates.some((row) => {
        const joined = row.join(' \u0001 ');
        let from = 0;
        for (const cell of wanted) {
            const at = joined.indexOf(cell, from);
            if (at < 0) return false;
            from = at + cell.length;
        }
        return true;
    });
};

const sameHeaders = (a: string[], b: string[]): boolean =>
    a.length > 0 && a.map(normalizeText).join('\u0001') === b.map(normalizeText).join('\u0001');

const measureTables = (source: SourceTable[], file: FileTable[]): { tablas: MetricCount; filas: MetricCount } => {
    let tablas = 0;
    let filas = 0;
    let filasEsperadas = 0;
    for (const table of source) {
        const matches = file.filter((candidate) => sameHeaders(candidate.headers, table.headers));
        if (matches.length > 0) tablas += 1;
        const candidates = matches.flatMap((match) => match.rows);
        for (const row of table.rows) {
            filasEsperadas += 1;
            if (rowPreserved(row, candidates)) filas += 1;
        }
    }
    return { tablas: { logrado: tablas, esperado: source.length }, filas: { logrado: filas, esperado: filasEsperadas } };
};

export const measureDocx = (bytes: Uint8Array, source: SourceDocument): Partial<Record<EvalMetric, MetricCount>> => {
    const zip = readStoredZip(bytes);
    const documentXml = utf8(zip.get('word/document.xml'));
    const stylesXml = utf8(zip.get('word/styles.xml'));
    const definedStyles = new Set(Array.from(stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"/g), (m) => m[1] ?? ''));
    const styledHeadings = elements(documentXml, 'w:p')
        .map((p) => ({ style: /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '', text: normalizeText(xmlText(p)) }))
        .filter((p) => /^Heading[1-3]$/.test(p.style) && definedStyles.has(p.style))
        .map((p) => p.text);
    const { tablas, filas } = measureTables(source.tables, readOoxmlTables(documentXml, 'w'));
    const drawings = (documentXml.match(/<w:drawing\b/g) ?? []).length;
    return {
        filasPreservadas: filas,
        tablasNativas: tablas,
        encabezadosConEstilo: { logrado: countMatches(source.headings, styledHeadings), esperado: source.headings.length },
        diagramasIncrustados: { logrado: Math.min(drawings, source.diagrams), esperado: source.diagrams },
    };
};

/** Cuántos de `wanted` aparecen en `found`, consumiendo cada aparición una vez. */
const countMatches = (wanted: string[], found: string[]): number => {
    const pool = [...found];
    let hits = 0;
    for (const item of wanted.map(normalizeText)) {
        const at = pool.indexOf(item);
        if (at >= 0) {
            hits += 1;
            pool.splice(at, 1);
        }
    }
    return hits;
};

/**
 * Cuántos de `wanted` están contenidos en `lines`. Dos títulos seguidos sin
 * texto entre ellos caen en la misma línea leída, así que cada hallazgo se
 * tacha del texto en vez de gastar la línea entera.
 */
const countContained = (wanted: string[], lines: string[]): number => {
    let haystack = lines.join(' \u0001 ');
    let hits = 0;
    for (const item of wanted.map(normalizeText)) {
        const at = haystack.indexOf(item);
        if (at >= 0) {
            hits += 1;
            haystack = `${haystack.slice(0, at)}\u0002${haystack.slice(at + item.length)}`;
        }
    }
    return hits;
};

const relTargets = (relsXml: string, typeSuffix: string): string[] =>
    Array.from(relsXml.matchAll(/<Relationship\b[^>]*>/g), (m) => m[0])
        .filter((rel) => new RegExp(`Type="[^"]*/${typeSuffix}"`).test(rel))
        .map((rel) => /Target="([^"]+)"/.exec(rel)?.[1] ?? '');

const resolvePart = (fromDir: string, target: string): string => {
    const parts = `${fromDir}/${target}`.split('/');
    const out: string[] = [];
    for (const part of parts) {
        if (part === '..') out.pop();
        else if (part && part !== '.') out.push(part);
    }
    return out.join('/');
};

export const measurePptx = (bytes: Uint8Array, deck: PresentationDeck): { metrics: Partial<Record<EvalMetric, MetricCount>>; layouts: string[] } => {
    const zip = readStoredZip(bytes);
    const slides = deck.slides.map((_, idx) => ({
        xml: utf8(zip.get(`ppt/slides/slide${idx + 1}.xml`)),
        rels: utf8(zip.get(`ppt/slides/_rels/slide${idx + 1}.xml.rels`)),
    }));
    const fileTables = slides.flatMap((slide) => readOoxmlTables(slide.xml, 'a'));
    const { tablas, filas } = measureTables(deckTables(deck), fileTables);
    let notes = 0;
    let notesExpected = 0;
    let pictures = 0;
    const honoured = new Set<string>();
    deck.slides.forEach((slide, idx) => {
        const { xml, rels } = slides[idx] ?? { xml: '', rels: '' };
        if (slide.speakerNotes?.trim()) {
            notesExpected += 1;
            const notesXml = relTargets(rels, 'notesSlide').map((target) => utf8(zip.get(resolvePart('ppt/slides', target)))).join('');
            if (notesXml && normalizeText(xmlText(notesXml)).includes(normalizeText(slide.speakerNotes))) notes += 1;
        }
        const hasDiagram = slide.contentBlocks.some((block) => block.type === 'diagram' && Boolean((block.content as { mermaid?: string }).mermaid?.trim()));
        if (hasDiagram && /<p:pic\b/.test(xml)) pictures += 1;
        const layoutXml = relTargets(rels, 'slideLayout').map((target) => utf8(zip.get(resolvePart('ppt/slides', target)))).join('');
        const layoutName = /<p:cSld\b[^>]*\bname="([^"]*)"/.exec(layoutXml)?.[1];
        if (layoutName === slide.layout) honoured.add(slide.layout);
    });
    const distinct = new Set(deck.slides.map((slide) => slide.layout));
    return {
        metrics: {
            filasPreservadas: filas,
            tablasNativas: tablas,
            diagramasIncrustados: { logrado: pictures, esperado: deckDiagrams(deck) },
            notasOrador: { logrado: notes, esperado: notesExpected },
            layoutsRespetados: { logrado: honoured.size, esperado: distinct.size },
        },
        layouts: Array.from(honoured),
    };
};

/** Los cuerpos de título del PDF empiezan en 13 pt; el texto del cuerpo es 11. */
const PDF_HEADING_MIN_PT = 13;

export const measurePdf = (
    bytes: Uint8Array,
    source: SourceDocument,
    content: string,
): { metrics: Partial<Record<EvalMetric, MetricCount>>; perdidos: Record<string, number> } => {
    const { raw, runs, baseFonts } = readPdf(bytes);
    const bold = new Set([...baseFonts].filter(([, name]) => /Bold/.test(name)).map(([id]) => id));
    // Un título largo se parte en varias líneas: se leen seguidas las cadenas
    // consecutivas en negrita a cuerpo de título, y el título se busca dentro.
    const headingLines: string[] = [];
    let streak: string[] = [];
    for (const run of runs) {
        if (bold.has(run.font) && run.size >= PDF_HEADING_MIN_PT) streak.push(run.text);
        else if (streak.length > 0) {
            headingLines.push(normalizeText(streak.join(' ')));
            streak = [];
        }
    }
    if (streak.length > 0) headingLines.push(normalizeText(streak.join(' ')));
    const allText = runs.map((run) => run.text).join(' ');
    const words = new Set(normalizeText(allText).split(' ').filter(Boolean));
    let filas = 0;
    let filasEsperadas = 0;
    for (const table of source.tables) {
        for (const row of table.rows) {
            filasEsperadas += 1;
            const rowWords = row.flatMap((cell) => normalizeText(cell).split(/\s+/)).filter(Boolean);
            if (rowWords.every((word) => words.has(word))) filas += 1;
        }
    }
    const expected = countSpecialCharacters(content);
    const found = countSpecialCharacters(allText);
    const perdidos: Record<string, number> = {};
    let lost = 0;
    for (const [ch, count] of expected) {
        const missing = Math.max(0, count - (found.get(ch) ?? 0));
        if (missing > 0) perdidos[ch] = missing;
        lost += missing;
    }
    const images = (raw.match(/\/Subtype\s*\/Image\b/g) ?? []).length;
    return {
        metrics: {
            filasPreservadas: { logrado: filas, esperado: filasEsperadas },
            encabezadosConEstilo: { logrado: countContained(source.headings, headingLines), esperado: source.headings.length },
            diagramasIncrustados: { logrado: Math.min(images, source.diagrams), esperado: source.diagrams },
            caracteresPerdidosPdf: { logrado: lost, esperado: 0 },
        },
        perdidos,
    };
};

// ─── Ejecución ──────────────────────────────────────────────────────────────

const blobBytes = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

export const runEvalCase = async (testCase: ExportEvalCase): Promise<ExportEvalCaseResult> => {
    const artifact = toArtifact(testCase);
    const context: ExportContext = { artifact, activeView: 'document', generatedAt: new Date('2026-10-03T00:00:00.000Z') };
    const isDeck = artifact.type.startsWith('presentation-');
    const deck = isDeck ? parsePresentationDeck(artifact.content, { artifactType: artifact.type, artifactName: artifact.name }).deck : null;
    const document = readSourceDocument(isDeck ? '' : artifact.content);
    const tables = deck ? deckTables(deck) : document.tables;
    const result: ExportEvalCaseResult = {
        id: testCase.id,
        original: {
            tablas: tables.length,
            filas: tables.reduce((sum, table) => sum + table.rows.length, 0),
            encabezados: document.headings.length,
            diagramas: deck ? deckDiagrams(deck) : document.diagrams,
            caracteresEspeciales: Array.from(countSpecialCharacters(isDeck ? '' : artifact.content).values()).reduce((a, b) => a + b, 0),
            notas: deck ? deck.slides.filter((slide) => slide.speakerNotes?.trim()).length : 0,
            layouts: deck ? Array.from(new Set(deck.slides.map((slide) => slide.layout))) : [],
        },
        porFormato: {},
        layoutsHonrados: [],
        perdidos: {},
    };
    for (const format of testCase.formatos) {
        if (format === 'docx') {
            result.porFormato.docx = measureDocx(await blobBytes((await docxExporter.export(context)).blob), document);
        } else if (format === 'pptx' && deck) {
            const measured = measurePptx(await blobBytes((await pptxExporter.export(context)).blob), deck);
            result.porFormato.pptx = measured.metrics;
            result.layoutsHonrados = measured.layouts;
        } else if (format === 'pdf') {
            const measured = measurePdf(await blobBytes((await pdfExporter.export(context)).blob), document, artifact.content);
            result.porFormato.pdf = measured.metrics;
            result.perdidos = measured.perdidos;
        }
    }
    return result;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

export const summarize = (results: ExportEvalCaseResult[]): ExportEvalSummary => {
    const summary: ExportEvalSummary = { docx: {}, pptx: {}, pdf: {} };
    for (const format of FORMATS) {
        for (const metric of METRICS_BY_FORMAT[format]) {
            const counts = results.map((r) => r.porFormato[format]?.[metric]).filter((c): c is MetricCount => Boolean(c));
            if (counts.length === 0) continue;
            if (LOSS_METRICS.includes(metric)) {
                summary[format][metric] = counts.reduce((sum, c) => sum + c.logrado, 0);
            } else if (metric === 'layoutsRespetados') {
                // Distintos en todo el corpus: dos decks con `timeline` cuentan uno.
                summary[format][metric] = new Set(results.flatMap((r) => r.layoutsHonrados)).size;
            } else {
                const expected = counts.reduce((sum, c) => sum + c.esperado, 0);
                if (expected > 0) summary[format][metric] = round1((100 * counts.reduce((sum, c) => sum + c.logrado, 0)) / expected);
            }
        }
    }
    return summary;
};

/** El objetivo de cada métrica: 100 %, 0 pérdidas, o los catorce layouts. */
export const targetOf = (metric: EvalMetric): number =>
    LOSS_METRICS.includes(metric) ? 0 : metric === 'layoutsRespetados' ? ALL_LAYOUTS.length : 100;

export const meetsTarget = (metric: EvalMetric, value: number): boolean =>
    LOSS_METRICS.includes(metric) ? value <= targetOf(metric) : value >= targetOf(metric);

const cell = (count: MetricCount | undefined, metric: EvalMetric): string => {
    if (!count) return '—';
    if (LOSS_METRICS.includes(metric)) return String(count.logrado);
    return count.esperado === 0 ? 'n/a' : `${count.logrado}/${count.esperado}`;
};

export const renderReport = (results: ExportEvalCaseResult[], summary: ExportEvalSummary): string => {
    const lines: string[] = ['# Banco de exportación', ''];
    for (const format of FORMATS) {
        const metrics = METRICS_BY_FORMAT[format];
        const rows = results.filter((r) => r.porFormato[format]);
        if (rows.length === 0) continue;
        lines.push(`## ${format.toUpperCase()}`, '', `| Caso | ${metrics.join(' | ')} |`, `|---|${metrics.map(() => '---').join('|')}|`);
        for (const r of rows) lines.push(`| ${r.id} | ${metrics.map((m) => cell(r.porFormato[format]?.[m], m)).join(' | ')} |`);
        const total = metrics.map((m) => {
            const value = summary[format][m];
            if (value === undefined) return '—';
            if (LOSS_METRICS.includes(m)) return `**${value}**`;
            if (m === 'layoutsRespetados') return `**${value}/${ALL_LAYOUTS.length}**`;
            return `**${value} %**`;
        });
        lines.push(`| **Total** | ${total.join(' | ')} |`, '');
    }
    const lost = results.filter((r) => Object.keys(r.perdidos).length > 0);
    if (lost.length > 0) {
        lines.push('## Caracteres perdidos en el PDF', '');
        for (const r of lost) lines.push(`- ${r.id}: ${Object.entries(r.perdidos).map(([ch, n]) => `${ch} ×${n}`).join(', ')}`);
    }
    return lines.join('\n');
};
