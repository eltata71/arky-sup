/**
 * Cambiar un documento sin reescribirlo (plan de calidad de artefactos, 7.4b):
 * comprobado antes de aplicar, sólo cambia lo nombrado, y un parche que no
 * cambia nada lo dice.
 */
import { describe, expect, it } from 'vitest';
import { applyDocumentPatch, outlineOfDocument } from '../../../services/artifacts/domain/documentPatchEngine';

const DOC = `# Plan de continuidad

## Resumen
El plan cubre la plataforma de reclamaciones.

## Riesgos
| Riesgo | Severidad | Mitigación |
| --- | --- | --- |
| Caída de región | Alta | Conmutación |
| Corrupción de datos | Media | Restauración |

### Riesgos regulatorios
Ninguno identificado.

## Próximos pasos
1. Ensayar la conmutación.

\`\`\`mermaid
flowchart LR
## esto no es una sección
\`\`\`
`;

const linesOutside = (before: string, after: string, keep: string) =>
  before.split('\n').filter((line) => !line.includes(keep)).every((line) => after.includes(line));

describe('applyDocumentPatch', () => {
  it('«añade un riesgo a la tabla» cambia sólo esa fila', () => {
    const result = applyDocumentPatch(DOC, { operations: [{ op: 'append-table-row', heading: 'Riesgos', cells: ['Fuga de PHI', 'Alta', 'Cifrado y DLP'] }] });
    expect(result.changed).toBe(true);
    expect(result.applied).toEqual(['Tabla de «Riesgos»: fila añadida.']);
    const added = result.content.split('\n').filter((line) => !DOC.split('\n').includes(line));
    expect(added).toEqual(['| Fuga de PHI | Alta | Cifrado y DLP |']);
    expect(result.content.indexOf('Fuga de PHI')).toBeGreaterThan(result.content.indexOf('Corrupción de datos'));
    expect(result.content.indexOf('Fuga de PHI')).toBeLessThan(result.content.indexOf('### Riesgos regulatorios'));
  });

  it('actualiza la fila cuya primera celda coincide', () => {
    const result = applyDocumentPatch(DOC, { operations: [{ op: 'update-table-row', heading: 'Riesgos', match: 'Caída de región', cells: ['Caída de región', 'Crítica', 'Conmutación automática'] }] });
    expect(result.content).toContain('| Caída de región | Crítica | Conmutación automática |');
    expect(result.content).not.toContain('| Caída de región | Alta | Conmutación |');
  });

  it('reemplaza, inserta y quita secciones sin tocar el resto', () => {
    const result = applyDocumentPatch(DOC, {
      operations: [
        { op: 'replace-section', heading: 'Resumen', body: 'El plan cubre reclamaciones y pagos.' },
        { op: 'insert-section', after: 'Resumen', heading: 'Alcance', body: 'Reclamaciones médicas y pagos a prestadores.' },
        { op: 'remove-section', heading: 'Próximos pasos' },
      ],
    });
    expect(result.applied).toHaveLength(3);
    expect(outlineOfDocument(result.content)).toEqual(['# Plan de continuidad', '## Resumen', '## Alcance', '## Riesgos', '### Riesgos regulatorios']);
    expect(result.content).toContain('| Corrupción de datos | Media | Restauración |');
    expect(result.content).not.toContain('Ensayar la conmutación');
  });

  it('rechaza lo que no encaja con un motivo, y aplica lo que sí', () => {
    const result = applyDocumentPatch(DOC, {
      operations: [
        { op: 'append-table-row', heading: 'Riesgos', cells: ['Sólo dos', 'celdas'] },
        { op: 'replace-section', heading: 'Glosario', body: 'x' },
        { op: 'append-table-row', heading: 'Resumen', cells: ['a'] },
        { op: 'insert-section', after: null, heading: 'Riesgos', body: 'duplicada' },
        { op: 'reescribir-todo' } as never,
        { op: 'update-table-row', heading: 'Riesgos', match: 'Inexistente', cells: ['a', 'b', 'c'] },
        { op: 'replace-section', heading: 'Resumen', body: 'Nuevo resumen.' },
      ],
    });
    expect(result.rejected.map((r) => r.code)).toEqual(['cell-count', 'unknown-section', 'no-table', 'duplicate-section', 'invalid-operation', 'row-not-found']);
    expect(result.applied).toEqual(['Sección «Resumen»: contenido reemplazado.']);
  });

  it('un encabezado dentro de un bloque de código no es una sección', () => {
    expect(outlineOfDocument(DOC)).not.toContain('## esto no es una sección');
  });

  it('un parche que no cambia nada lo dice y devuelve el original', () => {
    const result = applyDocumentPatch(DOC, { operations: [{ op: 'replace-section', heading: 'Resumen', body: 'El plan cubre la plataforma de reclamaciones.' }] });
    expect(result.changed).toBe(false);
    expect(result.content).toBe(DOC);
    expect(linesOutside(DOC, result.content, '')).toBe(true);
  });
});
