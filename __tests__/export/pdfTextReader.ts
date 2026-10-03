/**
 * Un lector de PDF para pruebas: lo que el fichero **pinta**, con su fuente y
 * su cuerpo, y decodificado como lo decodifica un visor al copiar o buscar.
 *
 * Lee los dos modos de texto que han escrito los exportadores de Arky: cadenas
 * literales `( ) Tj` sobre fuentes WinAnsi (el PDF anterior a 9.3, y los
 * controles positivos del banco) y cadenas hexadecimales `< > Tj` sobre
 * fuentes Type0 Identity-H, que se traducen con el `ToUnicode` de la fuente.
 * Un glifo sin entrada en el `ToUnicode` se lee como U+FFFD: no se inventa.
 *
 * Sólo lee los flujos de contenido de las páginas —nunca los de fuentes o
 * imágenes, que son binarios— y no descomprime: el exportador no comprime.
 */

export interface PdfRun {
    /** El nombre del recurso de fuente (`F1`…). */
    font: string;
    size: number;
    text: string;
}

export interface PdfReading {
    /** El fichero como Latin-1, para buscar marcadores estructurales. */
    raw: string;
    runs: PdfRun[];
    /** Recurso de fuente → su `BaseFont`. */
    baseFonts: Map<string, string>;
    /** Todo el texto pintado, separado por espacios. */
    text: string;
}

const latin1 = (bytes: Uint8Array): string => {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
    return out;
};

const objectsOf = (raw: string): Map<number, string> => {
    const objects = new Map<number, string>();
    for (const m of raw.matchAll(/(?:^|\n)(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) objects.set(Number(m[1]), m[2] ?? '');
    return objects;
};

const streamOf = (object: string): string => /stream\n([\s\S]*?)\nendstream/.exec(object)?.[1] ?? '';

const hexToUtf16 = (hex: string): string => {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
};

/** `ToUnicode`: código de dos bytes → texto. */
const readToUnicode = (cmap: string): Map<number, string> => {
    const map = new Map<number, string>();
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const m of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1] ?? '0', 16), hexToUtf16(m[2] ?? ''));
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const m of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
            const first = parseInt(m[1] ?? '0', 16);
            const last = parseInt(m[2] ?? '0', 16);
            const start = parseInt(m[3] ?? '0', 16);
            for (let code = first; code <= last; code += 1) map.set(code, String.fromCharCode(start + code - first));
        }
    }
    return map;
};

const readLiteral = (source: string, start: number): { text: string; end: number } => {
    let depth = 0;
    let text = '';
    for (let i = start; i < source.length; i += 1) {
        const ch = source[i] ?? '';
        if (ch === '\\') {
            const next = source[i + 1] ?? '';
            const octal = /^[0-7]{1,3}/.exec(source.slice(i + 1, i + 4));
            if (octal) {
                text += String.fromCharCode(parseInt(octal[0], 8));
                i += octal[0].length;
            } else {
                text += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next;
                i += 1;
            }
            continue;
        }
        if (ch === '(') {
            depth += 1;
            if (depth === 1) continue;
        } else if (ch === ')') {
            depth -= 1;
            if (depth === 0) return { text, end: i };
        }
        text += ch;
    }
    return { text, end: source.length };
};

export const readPdf = (bytes: Uint8Array): PdfReading => {
    const raw = latin1(bytes);
    const objects = objectsOf(raw);
    const fontMaps = new Map<string, Map<number, string> | null>();
    const baseFonts = new Map<string, string>();
    const contents: string[] = [];
    for (const object of objects.values()) {
        if (!/\/Type\s*\/Page\b/.test(object)) continue;
        const fontDict = /\/Font\s*<<([^>]*)>>/.exec(object)?.[1] ?? '';
        for (const ref of fontDict.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
            const name = ref[1] ?? '';
            if (fontMaps.has(name)) continue;
            const font = objects.get(Number(ref[2])) ?? '';
            baseFonts.set(name, /\/BaseFont\s*\/([\w+-]+)/.exec(font)?.[1] ?? '');
            const toUnicode = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font);
            fontMaps.set(name, toUnicode ? readToUnicode(streamOf(objects.get(Number(toUnicode[1])) ?? '')) : null);
        }
        for (const ref of (/\/Contents\s+(\d+)\s+0\s+R/.exec(object) ?? []).slice(1)) contents.push(streamOf(objects.get(Number(ref)) ?? ''));
    }
    const runs: PdfRun[] = [];
    for (const body of contents) {
        let font = '';
        let size = 0;
        let i = 0;
        while (i < body.length) {
            const ch = body[i];
            if (ch === '(') {
                const literal = readLiteral(body, i);
                if (/^\s*Tj/.test(body.slice(literal.end + 1, literal.end + 6))) runs.push({ font, size, text: literal.text });
                i = literal.end + 1;
                continue;
            }
            if (ch === '<' && body[i + 1] !== '<') {
                const end = body.indexOf('>', i);
                const hex = body.slice(i + 1, end).replace(/\s+/g, '');
                if (/^\s*Tj/.test(body.slice(end + 1, end + 6))) {
                    const map = fontMaps.get(font);
                    let text = '';
                    if (map) for (let k = 0; k + 4 <= hex.length; k += 4) text += map.get(parseInt(hex.slice(k, k + 4), 16)) ?? '�';
                    else for (let k = 0; k + 2 <= hex.length; k += 2) text += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
                    runs.push({ font, size, text });
                }
                i = end + 1;
                continue;
            }
            if (ch === '/') {
                const tf = /^\/(\w+)\s+([\d.]+)\s+Tf/.exec(body.slice(i, i + 32));
                if (tf) {
                    font = tf[1] ?? '';
                    size = Number(tf[2]);
                    i += tf[0].length;
                    continue;
                }
            }
            i += 1;
        }
    }
    return { raw, runs, baseFonts, text: runs.map((run) => run.text).join(' ') };
};

export const readPdfBlob = async (blob: Blob): Promise<PdfReading> => readPdf(new Uint8Array(await blob.arrayBuffer()));
