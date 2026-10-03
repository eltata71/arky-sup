/**
 * El ensamblado de un PDF: objetos numerados, flujos binarios y la tabla xref.
 *
 * Antes cada exportador escribía el fichero como una cadena y la pasaba a
 * Latin-1 al final, lo que sólo funcionaba mientras todo lo que contenía era
 * texto de un byte. Una fuente incrustada o una imagen JPEG son bytes, así que
 * los flujos se guardan como `Uint8Array` y nunca pasan por una cadena.
 */

/** Una cadena ASCII a bytes; los diccionarios y operadores de PDF son ASCII. */
export const ascii = (value: string): Uint8Array => {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
  return out;
};

export const escapePdfLiteral = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r/g, '\\r').replace(/\n/g, '\\n');

/**
 * Una cadena de texto de PDF (título, marcador, metadatos). ASCII imprimible
 * viaja como literal; cualquier otra cosa, en UTF-16BE con BOM, que es la
 * forma que el estándar da a un texto que no cabe en PDFDocEncoding.
 */
export const pdfTextString = (value: string): string => {
  if (/^[\x20-\x7e]*$/.test(value)) return `(${escapePdfLiteral(value)})`;
  let hex = 'FEFF';
  for (let i = 0; i < value.length; i += 1) hex += value.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
};

/** Una fecha de PDF (`D:AAAAMMDDHHmmSSZ`). */
export const pdfDate = (date: Date): string => `(D:${date.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z)`;

/** Un número con dos decimales como máximo y sin ceros sobrantes. */
export const num = (value: number): string => String(Math.round(value * 100) / 100);

type PdfObject = { kind: 'dict'; body: string } | { kind: 'stream'; dict: string; data: Uint8Array };

export class PdfWriter {
  private readonly objects: Array<PdfObject | undefined> = [];

  /** Reserva un número de objeto que se rellenará después. */
  reserve(): number {
    this.objects.push(undefined);
    return this.objects.length;
  }

  set(id: number, body: string): void {
    this.objects[id - 1] = { kind: 'dict', body };
  }

  setStream(id: number, dict: string, data: Uint8Array): void {
    this.objects[id - 1] = { kind: 'stream', dict, data };
  }

  add(body: string): number {
    const id = this.reserve();
    this.set(id, body);
    return id;
  }

  addStream(dict: string, data: Uint8Array): number {
    const id = this.reserve();
    this.setStream(id, dict, data);
    return id;
  }

  toBytes(root: number, info?: number): Uint8Array {
    const chunks: Uint8Array[] = [ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    const offsets: number[] = [];
    let cursor = chunks[0].length;
    const push = (chunk: Uint8Array) => { chunks.push(chunk); cursor += chunk.length; };
    this.objects.forEach((object, index) => {
      if (!object) throw new Error(`El objeto PDF ${index + 1} se reservó y nunca se escribió.`);
      offsets.push(cursor);
      if (object.kind === 'dict') {
        push(ascii(`${index + 1} 0 obj\n${object.body}\nendobj\n`));
      } else {
        const dict = object.dict.replace(/>>\s*$/, ` /Length ${object.data.length} >>`);
        push(ascii(`${index + 1} 0 obj\n${dict}\nstream\n`));
        push(object.data);
        push(ascii('\nendstream\nendobj\n'));
      }
    });
    const xrefOffset = cursor;
    let xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
    push(ascii(xref));
    push(ascii(`trailer\n<< /Size ${this.objects.length + 1} /Root ${root} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xrefOffset}\n%%EOF`));
    const out = new Uint8Array(cursor);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
    return out;
  }
}
