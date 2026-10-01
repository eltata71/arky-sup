/**
 * El texto de un diagrama se reescribe desde su IR por una sola puerta
 * (plan de diagramas, 8.1a).
 *
 * `irToMermaid` sólo escribe diagramas de flujo. Llamarlo para guardar el
 * texto de un artefacto convierte una secuencia, un ERD o un diagrama de
 * estados en un flowchart, y deja desfasado el de un C4. La 6.1 lo corrigió en
 * la generación; la 8.0 midió que cuatro caminos de edición —mover en el
 * lienzo, «Guardar», «Modificar diagrama» y «Auto-mejora»— seguían haciéndolo.
 *
 * La puerta es `rewriteDiagramContent`, que reescribe sólo en una notación que
 * puede contener el IR. Esto mira el código: el compilador no puede ver la
 * diferencia, porque las dos funciones devuelven una cadena.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const LAYERS = ['services', 'hooks', 'components', 'pages', 'context', 'lib'];
/** El serializador, su puerta de dialecto y el banco que mide flowcharts viven aquí. */
const ALLOWED = new Set(['services/diagram/irToMermaid.ts', 'services/diagram/dialectSerialization.ts', 'services/diagram/index.ts']);

const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : filesUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
});

const code = (file: string): string => readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('el texto de un diagrama se reescribe por una sola puerta', () => {
    it('nadie fuera del módulo de diagramas llama a `irToMermaid` ni a `serializeIRToMermaid`', () => {
        const offenders = LAYERS
            .flatMap((layer) => filesUnder(join(ROOT, layer)))
            .map((file) => relative(ROOT, file).split('\\').join('/'))
            .filter((file) => !ALLOWED.has(file))
            .filter((file) => /\b(irToMermaid|serializeIRToMermaid)\s*\(/.test(code(join(ROOT, file))));
        expect(offenders).toEqual([]);
    });
});
