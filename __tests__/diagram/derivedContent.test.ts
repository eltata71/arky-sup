/**
 * Lo derivado no puntúa (plan de diagramas, 8.4a).
 *
 * La rúbrica pagaba lo que la reparación rellenaba por su cuenta —un tema,
 * una audiencia, una descripción sintética, un verbo en una arista desnuda,
 * un grupo por rol—: reparar subía la nota sin que nadie mejorara el
 * diagrama. Cada reparación anota ahora qué escribió y qué había, y la
 * rúbrica puntúa el diagrama sin ello.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { autoRepairDiagramIR } from '../../services/diagram/qualityRepair';
import { runDiagramQualityGate } from '../../services/diagram/qualityGate';
import { analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';
import { withoutDerived } from '../../services/diagram/quality/derivedContent';

const bare = (): DiagramIR => ({
    nodes: [
        { id: 'portal', label: 'Portal', kind: 'service' },
        { id: 'motor', label: 'Motor de reglas', kind: 'service' },
        { id: 'bd', label: 'Base de pólizas', kind: 'data' },
        { id: 'bus', label: 'Bus de eventos', kind: 'messaging' },
        { id: 'pagos', label: 'Pagos', kind: 'service' },
        { id: 'auditoria', label: 'Auditoría', kind: 'data' },
    ],
    edges: [
        { id: 'e1', source: 'portal', target: 'motor', label: '' },
        { id: 'e2', source: 'motor', target: 'bd', label: 'data' },
        { id: 'e3', source: 'motor', target: 'bus', label: 'Publica decisión' },
        { id: 'e4', source: 'bus', target: 'pagos', label: '' },
    ],
    groups: [],
});

describe('reparar no sube la puntuación (8.4a)', () => {
    it('ni la reparación estructural ni la completa suman puntos', () => {
        const before = analyzeDiagramQuality(bare()).score;
        const artifact = { type: 'mermaid-graph' as const, name: 'Pólizas' };
        expect(runDiagramQualityGate(bare(), { artifact }).quality.score).toBe(before);
        expect(runDiagramQualityGate(bare(), { artifact, scope: 'full', aggressive: true, targetScore: 90, maxPasses: 4 }).quality.score).toBe(before);
    });

    it('la reparación sigue haciendo su trabajo, y lo anota', () => {
        const repaired = autoRepairDiagramIR(bare(), { artifact: { type: 'mermaid-graph', name: 'Pólizas' }, synthesizeDescriptions: true });
        const derived = repaired.ir.metadata?.derived;
        expect(repaired.ir.nodes.every((n) => (n.description ?? '').length > 0)).toBe(true);
        expect(Object.keys(derived?.nodeDescriptions ?? {}).sort()).toEqual(['auditoria', 'bd', 'bus', 'motor', 'pagos', 'portal']);
        expect(derived?.edgeLabels?.e1).toMatchObject({ before: '' });
        expect(derived?.edgeProtocols?.e3).toBeDefined();
        expect(derived?.fields?.theme).toEqual({ before: null, after: 'editorial' });
        expect(derived?.addedEdges?.length).toBeGreaterThan(0);
        expect(derived?.groups?.before).toEqual([]);
    });

    it('reparar dos veces no inventa un «antes»: el primero se conserva', () => {
        const once = autoRepairDiagramIR(bare(), { artifact: { type: 'mermaid-graph' } }).ir;
        const twice = autoRepairDiagramIR({ ...once, edges: once.edges.map((e) => (e.id === 'e1' ? { ...e, label: 'x' } : e)) }, { artifact: { type: 'mermaid-graph' } }).ir;
        expect(twice.metadata?.derived?.edgeLabels?.e1?.before).toBe('');
    });
});

describe('withoutDerived (8.4a)', () => {
    it('devuelve el diagrama del autor: sin lo rellenado, sin lo añadido, con sus grupos', () => {
        const repaired = autoRepairDiagramIR(bare(), { artifact: { type: 'mermaid-graph', name: 'Pólizas' }, synthesizeDescriptions: true }).ir;
        const authored = withoutDerived(repaired);
        expect(authored.nodes.map((n) => n.description ?? '')).toEqual(['', '', '', '', '', '']);
        expect(authored.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
        expect(authored.edges.find((e) => e.id === 'e1')?.label).toBe('');
        expect(authored.edges.find((e) => e.id === 'e2')?.label).toBe('data');
        expect(authored.edges.every((e) => e.protocol === undefined)).toBe(true);
        expect(authored.groups).toEqual([]);
        expect(authored.metadata?.theme).toBeUndefined();
        expect(authored.metadata?.narrative).toBeUndefined();
    });

    it('lo que una persona editó después de la reparación ya es suyo, y cuenta', () => {
        const repaired = autoRepairDiagramIR(bare(), { artifact: { type: 'mermaid-graph' }, synthesizeDescriptions: true }).ir;
        const edited: DiagramIR = {
            ...repaired,
            nodes: repaired.nodes.map((n) => (n.id === 'motor' ? { ...n, description: 'Evalúa coberturas y exclusiones.' } : n)),
            edges: repaired.edges.map((e) => (e.id === 'e1' ? { ...e, label: 'Solicita evaluación' } : e)),
            metadata: { ...repaired.metadata, theme: 'monochrome' },
        };
        const authored = withoutDerived(edited);
        expect(authored.nodes.find((n) => n.id === 'motor')?.description).toBe('Evalúa coberturas y exclusiones.');
        expect(authored.nodes.find((n) => n.id === 'portal')?.description).toBe('');
        expect(authored.edges.find((e) => e.id === 'e1')?.label).toBe('Solicita evaluación');
        expect(authored.metadata?.theme).toBe('monochrome');
        expect(analyzeDiagramQuality(edited).score).toBeGreaterThanOrEqual(analyzeDiagramQuality(bare()).score);
    });

    it('sin nada derivado, devuelve el mismo objeto', () => {
        const ir = bare();
        expect(withoutDerived(ir)).toBe(ir);
    });

    it('un nodo que los guardarraíles insertaron se va con sus aristas, y la arista desviada vuelve a su destino', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'aseguradora', label: 'Aseguradora externa', kind: 'external' },
                { id: 'bd', label: 'Base de siniestros', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'aseguradora', target: 'bd', label: 'Consulta siniestros' }],
            groups: [],
        };
        const gated = runDiagramQualityGate(ir, { artifact: { type: 'mermaid-c4-container' }, scope: 'full' }).ir;
        const inserted = gated.metadata?.derived?.addedNodes ?? [];
        expect(inserted.length).toBe(1);
        const authored = withoutDerived(gated);
        expect(authored.nodes.map((n) => n.id).sort()).toEqual(['aseguradora', 'bd']);
        expect(authored.edges.find((e) => e.id === 'e1')?.target).toBe('bd');
    });
});
