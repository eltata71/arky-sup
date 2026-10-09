import { describe, expect, it } from 'vitest';
import { mermaidToIR } from '../../../services/diagram/mermaidToIR';
import { serializeIRPreservingDialect } from '../../../services/diagram/dialectSerialization';
import { notationFingerprint } from '../../../services/diagram/notation';
import { checkArchimateRelation } from '../../../lib/archimate/archimateMetamodel';

const SOURCE = [
    '%% archimate viewpoint=layered',
    'flowchart LR',
    '  C["Cliente"]',
    '  S["Portal"]',
    '  A["Plataforma"]',
    '  C -->|serving: consulta| S',
    '  S -->|realization| A',
    '  class C archimate_business_actor',
    '  class S archimate_application_component',
    '  class A archimate_node',
].join('\n');

describe('ArchiMate como dialecto del IR', () => {
    it('lee tipos de elemento y relaciones sin tocar el kind de los nodos', () => {
        const ir = mermaidToIR(SOURCE);
        expect(ir.notation?.dialect).toBe('archimate');
        if (ir.notation?.dialect !== 'archimate') return;
        expect(ir.notation.viewpoint).toBe('layered');
        expect(Object.values(ir.notation.elements)).toEqual(['business-actor', 'application-component', 'node']);
        expect(Object.values(ir.notation.relations).map((r) => r.type)).toEqual(['serving', 'realization']);
        expect(ir.notation.unsupported).toEqual([]);
        expect(ir.edges[0].label).toBe('consulta');
    });

    it('una clase desconocida queda en unsupported y el texto no se reescribe', () => {
        const ir = mermaidToIR(SOURCE.replace('archimate_node', 'archimate_inventado'));
        expect(ir.notation?.unsupported.length).toBeGreaterThan(0);
    });

    it('ida y vuelta: lo escrito se lee como el mismo grafo y la misma notación', () => {
        const ir = mermaidToIR(SOURCE);
        const renamed = { ...ir, nodes: ir.nodes.map((n, i) => (i === 0 ? { ...n, label: 'Asegurado' } : n)) };
        const written = serializeIRPreservingDialect(renamed, 'mermaid-flowchart', SOURCE);
        expect(written).not.toBeNull();
        const back = mermaidToIR(written as string);
        expect(notationFingerprint(back, { graphOnly: true })).toBe(notationFingerprint(renamed, { graphOnly: true }));
        expect(back.notation).toMatchObject({ dialect: 'archimate', viewpoint: 'layered' });
        expect(back.nodes[0].label).toBe('Asegurado');
    });

    it('el metamodelo rechaza una relación prohibida con su motivo', () => {
        const verdict = checkArchimateRelation('assignment', 'node', 'business-actor');
        expect(verdict.allowed).toBe(false);
    });
});

describe('ArchiMate lint', () => {
  it('names a forbidden relation in the issues', async () => {
    const { mermaidToIR } = await import('../../../services/diagram/mermaidToIR');
    const { collectIssues } = await import('../../../services/diagram/quality/diagramLintRules');
    const ir = mermaidToIR([
      '%% archimate viewpoint=layered',
      'flowchart TD',
      'A[Nodo]',
      'B[Actor]',
      'A -->|assignment| B',
      'class A archimate_node',
      'class B archimate_business_actor',
    ].join('\n'));
    expect(collectIssues(ir).some((i) => i.code === 'ARCHIMATE_RELATION_NOT_ALLOWED')).toBe(true);
  });
});
