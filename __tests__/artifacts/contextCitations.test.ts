import { describe, expect, it } from 'vitest';
import {
  decorateContextCitationsHtml,
  describeCitationReview,
  renderCitationsForExport,
  reviewContextCitations,
  stripContextCitations,
  type ContextManifest,
} from '../../lib/artifacts';

const manifest: ContextManifest = {
  version: 1,
  capturedAt: '2026-10-01T00:00:00Z',
  records: [{
    label: 'Grafo de contexto',
    sources: [{ id: 'p', label: 'Proyecto' }],
    sections: [],
    omitted: [],
    citations: [
      { tag: '[ctx:tech-1]', label: 'Kafka', entityType: 'technology', sources: ['Notas de arquitectura'] },
      { tag: '[ctx:sys-1]', label: 'Core de pólizas', entityType: 'system', sources: [] },
    ],
  }],
};

const doc = [
  '# Decisión',
  '',
  'Los eventos viajan por Kafka [ctx:tech-1] hasta el core [ctx:sys-1].',
  'Un dato inventado [ctx:risk-9].',
  'Dos a la vez [ctx:tech-1, ctx:sys-1].',
  '',
  '```text',
  'ejemplo literal [ctx:tech-1]',
  '```',
  '',
  '## Contexto utilizado',
  '',
  '- [ctx:tech-1] Kafka',
  '- [ctx:sys-1] Core',
].join('\n');

describe('citas [ctx:*] — verificación contra el contexto registrado (7.5b)', () => {
  it('resuelve lo que se envió, informa lo que no, y no cuenta el código', () => {
    const review = reviewContextCitations(doc, manifest);
    expect(review.verifiable).toBe(true);
    const byKey = Object.fromEntries(review.references.map((ref) => [ref.key, ref]));
    expect(byKey['tech-1']).toMatchObject({ status: 'resolved', occurrences: 3 });
    expect(byKey['tech-1'].citation?.label).toBe('Kafka');
    expect(byKey['risk-9'].status).toBe('unresolved');
    expect(describeCitationReview(review)).toBe('Una cita del documento no corresponde al contexto enviado al modelo: ctx:risk-9.');
  });

  it('sin manifiesto no se puede verificar, y no se inventa un fallo', () => {
    const review = reviewContextCitations(doc, undefined);
    expect(review.verifiable).toBe(false);
    expect(review.references.every((ref) => ref.status === 'unverifiable')).toBe(true);
    expect(describeCitationReview(review)).toBeNull();
  });

  it('una etiqueta numerada con dos entidades distintas es ambigua', () => {
    const twice: ContextManifest = { ...manifest, records: [...manifest.records, {
      ...manifest.records[0], citations: [{ tag: '[ctx:tech-1]', label: 'RabbitMQ', entityType: 'technology', sources: [] }],
    }] };
    const review = reviewContextCitations('Usa [ctx:tech-1].', twice);
    expect(review.references[0].status).toBe('ambiguous');
    expect(describeCitationReview(review)).toContain('ctx:tech-1 (ambigua)');
  });
});

describe('citas [ctx:*] — exportación (7.5b)', () => {
  it('no deja ninguna etiqueta opaca: notas numeradas, lo que no resuelve fuera y nombrado', () => {
    const out = renderCitationsForExport(doc, manifest);
    const prose = out.content.replace(/```[\s\S]*?```/g, '');
    expect(prose).not.toMatch(/\[ctx:/i);
    expect(out.content).toContain('Los eventos viajan por Kafka [1] hasta el core [2].');
    expect(out.content).toContain('Un dato inventado.');
    expect(out.content).toContain('Dos a la vez [1, 2].');
    expect(out.content).toContain('ejemplo literal [ctx:tech-1]');
    expect(out.content).toContain('## Fuentes de contexto\n\n1. Kafka — Notas de arquitectura\n2. Core de pólizas');
    expect(out.content).not.toContain('Contexto utilizado');
    expect(out.removed).toEqual(['risk-9']);
  });

  it('sin manifiesto retira todas las etiquetas y no añade notas', () => {
    const out = renderCitationsForExport('Kafka [ctx:tech-1] y nada más.', undefined);
    expect(out.content).toBe('Kafka y nada más.\n');
    expect(out.notes).toHaveLength(0);
    expect(out.removed).toEqual(['tech-1']);
  });

  it('la nota de cierre en forma de párrafo también se sustituye', () => {
    const out = renderCitationsForExport('Texto [ctx:tech-1].\n\n**Contexto utilizado:** [ctx:tech-1], [ctx:sys-1]', manifest);
    expect(out.content).toBe('Texto [1].\n\n## Fuentes de contexto\n\n1. Kafka — Notas de arquitectura\n');
  });

  it('una frase que empieza igual no es la nota de cierre', () => {
    const out = renderCitationsForExport('Contexto utilizado en la reunión del lunes.', manifest);
    expect(out.content).toBe('Contexto utilizado en la reunión del lunes.\n');
  });

  it('stripContextCitations retira etiquetas sin tocar el código', () => {
    expect(stripContextCitations('A [ctx:tech-1] y `[ctx:x-1]`')).toBe('A y `[ctx:x-1]`');
  });
});

describe('citas [ctx:*] — chips en el lienzo (7.5b)', () => {
  it('nombra la entidad, marca lo que no resuelve y deja el código intacto', () => {
    const html = decorateContextCitationsHtml('<p>Kafka [ctx:tech-1] y [ctx:risk-9]</p><pre><code>[ctx:tech-1]</code></pre>', manifest);
    expect(html).toContain('title="Fuente: Notas de arquitectura">Kafka</span>');
    expect(html).toContain('ctx:risk-9 · cita sin resolver');
    expect(html).toContain('<pre><code>[ctx:tech-1]</code></pre>');
  });

  it('sin registro lo dice en el chip', () => {
    expect(decorateContextCitationsHtml('<p>[ctx:tech-1]</p>', undefined)).toContain('ctx:tech-1 · sin registro');
  });

  it('escapa la etiqueta registrada', () => {
    const evil: ContextManifest = { ...manifest, records: [{ ...manifest.records[0], citations: [{ tag: '[ctx:tech-1]', label: '<img src=x>', entityType: 't', sources: [] }] }] };
    expect(decorateContextCitationsHtml('<p>[ctx:tech-1]</p>', evil)).toContain('&lt;img src=x&gt;');
  });
});
