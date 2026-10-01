/**
 * Lo que el lienzo dibuja es lo que el artefacto guarda (plan de diagramas, 8.1c).
 *
 * La puerta de calidad corría en cada render: el lienzo podía mostrar
 * relaciones, grupos o etiquetas que el artefacto no tenía, y hasta la 8.1a
 * una edición en el lienzo los guardaba. Sólo la proyección por audiencia,
 * que es declarada, puede cambiar lo que se ve.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { resolveRenderableDiagram } from '../../services/diagram';

const stored = (): DiagramIR => ({
    nodes: [
        { id: 'auditor', label: 'Auditor médico', kind: 'person', description: 'Revisa reclamaciones' },
        { id: 'historial', label: 'Historial clínico', kind: 'data', description: 'Antecedentes del asegurado' },
        { id: 'pagos', label: 'Liquidación', kind: 'service', description: 'Paga reclamaciones' },
        { id: 'regulador', label: 'Superintendencia', kind: 'external', description: 'Recibe reportes' },
    ],
    edges: [
        { id: 'e1', source: 'auditor', target: 'historial', label: 'Consulta antecedentes', protocol: 'ESB/SOAP' },
        { id: 'e2', source: 'auditor', target: 'pagos', label: 'Libera pago' },
    ],
    groups: [],
    metadata: { sourceFormat: 'mermaid' },
});

describe('el render muestra lo guardado', () => {
    it('no añade nodos, relaciones ni grupos, ni cambia etiquetas o protocolos', () => {
        const ir = stored();
        const { ir: rendered } = resolveRenderableDiagram(
            { id: 'a', type: 'mermaid-graph', content: '', representation: 'diagram', ir },
            { audience: 'technical' },
        );
        expect(rendered!.nodes.map((n) => [n.id, n.label, n.description])).toEqual(ir.nodes.map((n) => [n.id, n.label, n.description]));
        expect(rendered!.edges.map((e) => [e.id, e.source, e.target, e.label, e.protocol]))
            .toEqual(ir.edges.map((e) => [e.id, e.source, e.target, e.label, e.protocol]));
        expect(rendered!.groups).toEqual([]);
    });

    it('no informa cambios de una puerta que ya no corre', () => {
        const resolution = resolveRenderableDiagram(
            { id: 'a', type: 'mermaid-graph', content: '', representation: 'diagram', ir: stored() },
            { audience: 'technical' },
        );
        expect(resolution.qualityGateChanges).toEqual([]);
    });
});
