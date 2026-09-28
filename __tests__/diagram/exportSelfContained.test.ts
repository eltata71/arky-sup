// @vitest-environment jsdom
/**
 * Un diagrama exportado se abre sin red (plan de diagramas, 2.2).
 *
 * Un SVG que referencia una fuente, una imagen o una hoja de estilos externa
 * se ve bien en la máquina de quien lo exportó y roto en la sala del comité:
 * sin red, detrás de un proxy o años después, cuando el recurso ya no existe.
 * Y abierto directamente en un navegador, lo que un SVG carga, lo carga.
 *
 * Esto recorre lo que el producto añade a la captura —el recorte y el marco
 * editorial— y falla si el resultado referencia algo fuera del propio fichero.
 * Una URL escrita como **texto** (un título que cita una web) no es una
 * referencia y no cuenta.
 */
import { describe, expect, it } from 'vitest';
import { applySvgExportFrame, defaultFrameMetadataFromIR } from '../../services/diagram/diagramExportFrame';
import { cropSvgToBoundingBox } from '../../services/diagram/exportBoundingBoxCrop';

/**
 * Todo lo que haría que un SVG cargue algo que no lleva dentro. Se lee como
 * documento, no con expresiones regulares: un título escapado que *contiene*
 * `href="…"` es texto, y sólo un atributo o un estilo es una referencia.
 */
const externalReferences = (svg: string): string[] => {
  const found: string[] = [];
  const local = (value: string) => /^(data:|#)/i.test(value.trim());
  const cssRefs = (css: string, where: string) => {
    for (const m of css.matchAll(/url\(\s*["']?([^"')]*)["']?\s*\)/gi)) if (!local(m[1])) found.push(`${where} url(${m[1]})`);
    for (const m of css.matchAll(/@import[^;]*/gi)) found.push(`${where} ${m[0]}`);
  };
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.localName === 'script') found.push('<script>');
    if (el.localName === 'style') cssRefs(el.textContent ?? '', '<style>');
    for (const attr of Array.from(el.attributes)) {
      if (['href', 'xlink:href', 'src'].includes(attr.name) && !local(attr.value)) found.push(`${attr.name}=${attr.value}`);
      if (attr.name === 'style') cssRefs(attr.value, 'style');
    }
  }
  return found;
};

const decode = (dataUrl: string): string =>
  Buffer.from(dataUrl.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf-8');

/** Lo que devuelve la captura: HTML dentro de un foreignObject, con la fuente ya incrustada. */
const CAPTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,AAAA)}</style><div style="font-family:Inter;background-image:url(data:image/png;base64,AAAA)">API Gateway</div></div></foreignObject><use href="#marker-1"/></svg>`;

describe('exportación autocontenida', () => {
  it('el detector encuentra cada forma de referencia externa, y no el texto', () => {
    expect(externalReferences('<svg><image href="https://cdn.example.com/a.png"/></svg>')).toHaveLength(1);
    expect(externalReferences('<svg><style>@import url("https://fonts.googleapis.com/css2?family=Inter");</style></svg>')).toHaveLength(2);
    expect(externalReferences('<svg><rect style="fill:url(https://x/y.svg#g)"/></svg>')).toHaveLength(1);
    expect(externalReferences('<svg><script>alert(1)</script></svg>')).toEqual(['<script>']);
    expect(externalReferences('<svg><text>Ver https://arky-sup.vercel.app</text></svg>')).toEqual([]);
    expect(externalReferences(CAPTURE)).toEqual([]);
  });

  it('el marco editorial no añade ninguna referencia externa', async () => {
    const framed = await applySvgExportFrame(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(CAPTURE)}`,
      {
        ...defaultFrameMetadataFromIR({ metadata: { title: 'Contexto', audience: 'executive' }, edges: [{ relation: 'sync' }, { relation: 'async' }] }),
        owner: 'Arquitectura',
        version: 'v3',
        confidentiality: 'Uso interno',
      },
    );
    const svg = decode(framed);
    expect(svg).toContain('API Gateway');
    expect(externalReferences(svg)).toEqual([]);
  });

  it('el texto del marco se escapa: un título no puede inyectar marcado', async () => {
    const framed = await applySvgExportFrame(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(CAPTURE)}`,
      { title: '<image href="https://evil.example/x.png"/><script>x()</script>', isDark: false },
    );
    expect(externalReferences(decode(framed))).toEqual([]);
  });

  it('el recorte sólo cambia la caja, nunca añade referencias', () => {
    const cropped = cropSvgToBoundingBox(CAPTURE, { x: 10, y: 10, width: 400, height: 200 });
    expect(cropped).toContain('viewBox="10 10 400 200"');
    expect(externalReferences(cropped)).toEqual([]);
  });
});
