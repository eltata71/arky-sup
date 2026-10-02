// @vitest-environment jsdom
/**
 * Plan de diagramas 8.3b: el IR guarda lo que una secuencia, un ERD o un
 * diagrama de estados dicen más allá del grafo, y el texto se puede escribir
 * de nuevo desde el IR sin perder nada.
 *
 * «Sin pérdida» se comprueba, no se supone: el texto escrito lo acepta la
 * gramática de Mermaid y, leído otra vez, dice lo mismo que el original.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiagramIR, ErdNotation, SequenceNotation, SequenceStep, StateNotation } from '../../lib/diagram';
import { applySemanticPatch, mermaidToIR, runDiagramQualityGate, serializeIRPreservingDialect } from '../../services/diagram';
import { checkMermaidSyntax } from '../../services/diagram/mermaidSyntax';
import { notationFingerprint, serializeNotation } from '../../services/diagram/notation';
import { attachNotationFromSource, migrateDiagramIR } from '../../services/diagram/irMigration';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'notation');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

const roundTrip = async (source: string): Promise<{ ir: DiagramIR; written: string; reread: DiagramIR }> => {
    const ir = mermaidToIR(source);
    const written = serializeNotation(ir);
    expect(written, 'el IR no pudo escribirse').not.toBeNull();
    const verdict = await checkMermaidSyntax(written!);
    expect(verdict, written!).toMatchObject({ status: 'valid' });
    return { ir, written: written!, reread: mermaidToIR(written!) };
};

describe('secuencia: orden, fragmentos, notas y activaciones (8.3b)', () => {
    const source = fixture('secuencia-fragmentos.mmd');

    it('lee cada fragmento con sus ramas, en orden', () => {
        const notation = mermaidToIR(source).notation as SequenceNotation;
        expect(notation.dialect).toBe('sequence');
        expect(notation.unsupported).toEqual([]);
        expect(notation.autonumber).toBe(true);
        expect(notation.actors).toEqual(['Af']);
        const fragments = notation.steps.filter((s): s is Extract<SequenceStep, { kind: 'fragment' }> => s.kind === 'fragment');
        expect(fragments.map((f) => f.fragment)).toEqual(['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect']);
        const alt = fragments[1];
        expect(alt.branches.map((b) => b.label)).toEqual(['Cumple criterios automáticos', 'Requiere revisión', 'Datos insuficientes']);
        expect(alt.branches[1].steps.map((s) => s.kind)).toEqual(['message', 'activate', 'message', 'deactivate']);
        expect(notation.steps.find((s) => s.kind === 'note')).toEqual({
            kind: 'note', placement: 'right of', participants: ['Af'], text: 'Recibe la respuesta en el portal',
        });
    });

    it('conserva las activaciones de los mensajes y las flechas tal como se escribieron', () => {
        const notation = mermaidToIR(source).notation as SequenceNotation;
        const messages = notation.steps.filter((s): s is Extract<SequenceStep, { kind: 'message' }> => s.kind === 'message');
        expect(messages[1]).toMatchObject({ arrow: '->>', activation: '+' });
        expect(messages.at(-2)).toMatchObject({ arrow: '-->>', activation: '-' });
        expect(messages.at(-1)).toMatchObject({ arrow: '->' });
    });

    it('ida y vuelta sin pérdida', async () => {
        const { ir, reread } = await roundTrip(source);
        expect(notationFingerprint(reread)).toBe(notationFingerprint(ir));
    });
});

describe('ERD: atributos, claves, comentarios y cardinalidades (8.3b)', () => {
    const source = fixture('erd-atributos.mmd');

    it('lee los atributos de cada entidad y la cardinalidad escrita', () => {
        const ir = mermaidToIR(source);
        const notation = ir.notation as ErdNotation;
        expect(notation.unsupported).toEqual([]);
        expect(notation.attributes.POLIZA).toEqual([
            { type: 'string', name: 'numero', keys: ['PK'] },
            { type: 'string', name: 'id_asegurado', keys: ['FK'] },
            { type: 'string', name: 'id_agente', keys: ['FK'], comment: 'Agente de venta' },
            { type: 'decimal', name: 'suma_asegurada' },
        ]);
        expect(notation.attributes.COBERTURA[2]).toEqual({ type: 'string', name: 'codigo_producto', keys: ['FK', 'UK'] });
        expect(notation.attributes.PRODUCTO).toEqual([]);
        const agent = ir.edges.find((e) => e.target === 'AGENTE')!;
        expect(notation.relations[agent.id]).toEqual({ left: '}o', right: 'o|', identifying: false, label: 'es vendida por' });
        // El lienzo sigue mostrando la cardinalidad en palabras.
        expect(agent.label).toBe('es vendida por (0..* → 0..1)');
    });

    it('ida y vuelta sin pérdida', async () => {
        const { ir, reread } = await roundTrip(source);
        expect(notationFingerprint(reread)).toBe(notationFingerprint(ir));
    });
});

describe('estados: compuestos, pseudoestados, descripciones y notas (8.3b)', () => {
    const source = fixture('estados-compuestos.mmd');

    it('cada compuesto es un ámbito con su propio inicio y fin', () => {
        const ir = mermaidToIR(source);
        const notation = ir.notation as StateNotation;
        expect(notation.unsupported).toEqual([]);
        expect(notation.direction).toBe('LR');
        expect(notation.composites).toEqual([
            { id: 'Revision', childIds: ['Revision::[*]', 'Clinica', 'Administrativa'] },
            { id: 'Administrativa', childIds: ['Administrativa::[*]', 'Documentos'] },
        ]);
        expect(ir.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['[*]', 'Revision::[*]', 'Administrativa::[*]']));
        expect(ir.groups.find((g) => g.id === 'state_Revision')?.nodeIds).toEqual(['Revision::[*]', 'Clinica', 'Administrativa']);
        expect(notation.pseudostates).toEqual({ Decision: 'choice', Bifurca: 'fork', Une: 'join' });
    });

    it('las descripciones son la etiqueta, y las notas se guardan', () => {
        const ir = mermaidToIR(source);
        const notation = ir.notation as StateNotation;
        expect(ir.nodes.find((n) => n.id === 'Recibida')?.label).toBe('Recibida en el portal');
        expect(ir.nodes.find((n) => n.id === 'Pago')?.label).toBe('Liquidación del siniestro');
        expect(notation.notes).toEqual([
            { placement: 'right of', stateId: 'Rechazada', text: 'El asegurado puede apelar' },
            { placement: 'left of', stateId: 'Aprobada', text: 'Se registra la decisión en el expediente' },
        ]);
        expect(notation.unlabeledEdges.length).toBeGreaterThan(0);
    });

    it('ida y vuelta sin pérdida, y una transición sin etiqueta no gana «Relaciona»', async () => {
        const { ir, written, reread } = await roundTrip(source);
        expect(notationFingerprint(reread)).toBe(notationFingerprint(ir));
        expect(written).not.toContain('Relaciona');
    });
});

describe('serializeIRPreservingDialect con notación (8.3b)', () => {
    it('un IR que sigue diciendo lo que dice el texto no lo reescribe', () => {
        const source = fixture('secuencia-fragmentos.mmd');
        expect(serializeIRPreservingDialect(mermaidToIR(source), 'mermaid-sequence', source)).toBeNull();
    });

    it('renombrar un participante reescribe la secuencia sin perder sus fragmentos', async () => {
        const source = fixture('secuencia-fragmentos.mmd');
        const ir = mermaidToIR(source);
        const renamed = { ...ir, nodes: ir.nodes.map((n) => (n.id === 'Clin' ? { ...n, label: 'Médico auditor' } : n)) };
        const written = serializeIRPreservingDialect(renamed, 'mermaid-sequence', source)!;
        expect(written).toContain('participant Clin as Médico auditor');
        expect(written).toContain('critical Conexión con el núcleo');
        expect(await checkMermaidSyntax(written)).toMatchObject({ status: 'valid' });
        expect((mermaidToIR(written).notation as SequenceNotation).steps).toEqual((ir.notation as SequenceNotation).steps);
    });

    it('quitar un participante quita sus mensajes y los fragmentos que quedan vacíos', async () => {
        const source = fixture('secuencia-fragmentos.mmd');
        const ir = mermaidToIR(source);
        const pruned: DiagramIR = {
            ...ir,
            nodes: ir.nodes.filter((n) => n.id !== 'Clin'),
            edges: ir.edges.filter((e) => e.source !== 'Clin' && e.target !== 'Clin'),
        };
        const written = serializeIRPreservingDialect(pruned, 'mermaid-sequence', source)!;
        expect(written).not.toContain('Clin');
        // La rama `else Requiere revisión` queda vacía y desaparece; la primera
        // rama de un fragmento se conserva aunque quede vacía, porque nombra al fragmento.
        expect(written).not.toContain('Requiere revisión');
        expect(written).toContain('critical Conexión con el núcleo\n    option Caída del núcleo');
        expect(written).toContain('Note over Motor: El dictamen queda auditado');
        expect(await checkMermaidSyntax(written)).toMatchObject({ status: 'valid' });
    });

    it('un ERD con una relación sin cardinalidad escrita no se reescribe: no se inventa una regla de negocio', () => {
        const source = fixture('erd-atributos.mmd');
        const ir = mermaidToIR(source);
        const added = { ...ir, edges: [...ir.edges, { id: 'nueva', source: 'AGENTE', target: 'PRODUCTO', label: 'vende' }] };
        expect(serializeIRPreservingDialect(added, 'mermaid-erd', source)).toBeNull();
    });

    it('un texto con algo que el lector no sabe guardar nunca se reescribe', () => {
        const source = 'sequenceDiagram\n  box Aseguradora\n  participant A\n  end\n  A->>B: Pide';
        const ir = mermaidToIR(source);
        expect(ir.notation?.unsupported).toContain('box Aseguradora');
        const renamed = { ...ir, nodes: ir.nodes.map((n) => ({ ...n, label: `${n.label}!` })) };
        expect(serializeIRPreservingDialect(renamed, 'mermaid-sequence', source)).toBeNull();
    });

    it('un IR guardado antes de la 8.3b recupera la notación de su texto', () => {
        const source = fixture('erd-atributos.mmd');
        const { notation: _drop, ...stored } = mermaidToIR(source);
        const renamed = { ...stored, nodes: stored.nodes.map((n) => (n.id === 'AGENTE' ? { ...n, label: 'Agente comercial' } : n)) };
        expect(attachNotationFromSource(renamed, mermaidToIR(source)).notation?.dialect).toBe('erd');
        const written = serializeIRPreservingDialect(renamed, 'mermaid-erd', source);
        // El id de la entidad manda en un ERD; cambiar su etiqueta no cambia el texto…
        expect(written).toBeNull();
    });

    it('…y si los ids ya no coinciden, el texto se conserva', () => {
        const stored = mermaidToIR('erDiagram\n  A ||--o{ B : tiene');
        const { notation: _drop, ...withoutNotation } = { ...stored, edges: stored.edges.map((e) => ({ ...e, source: 'B', target: 'A' })) };
        expect(attachNotationFromSource(withoutNotation, mermaidToIR('erDiagram\n  A ||--o{ B : tiene')).notation).toBeUndefined();
    });
});

describe('la notación viaja con el IR (8.3b)', () => {
    it('la puerta de calidad estructural la conserva', () => {
        for (const [name, type] of [['secuencia-fragmentos.mmd', 'mermaid-sequence'], ['erd-atributos.mmd', 'mermaid-erd'], ['estados-compuestos.mmd', 'mermaid-state']] as const) {
            const ir = mermaidToIR(fixture(name));
            const gated = runDiagramQualityGate(ir, { artifact: { type } }).ir;
            expect(gated.notation, name).toEqual(ir.notation);
        }
    });

    it('un parche semántico la conserva, y el texto se reescribe con el cambio', async () => {
        const source = fixture('estados-compuestos.mmd');
        const ir = mermaidToIR(source);
        const result = applySemanticPatch(ir, { id: 'p1', source: 'user', operations: [{ op: 'update-node', nodeId: 'Clinica', changes: { label: 'Revisión clínica' } }] });
        expect(result.ir.notation).toEqual(ir.notation);
        const written = serializeIRPreservingDialect(result.ir, 'mermaid-state', source)!;
        expect(written).toContain('state "Revisión clínica" as Clinica');
        expect(await checkMermaidSyntax(written)).toMatchObject({ status: 'valid' });
    });
});

describe('migración v4 (8.3b)', () => {
    it('es aditiva: conserva la notación y sube la versión', () => {
        const ir = mermaidToIR(fixture('estados-compuestos.mmd'));
        const migrated = migrateDiagramIR(ir).ir;
        expect(migrated.metadata?.schemaVersion).toBe(4);
        expect(migrated.notation).toEqual(ir.notation);
    });
});
