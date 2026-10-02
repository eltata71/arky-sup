/**
 * El contrato de notación de un C4 (plan de diagramas, 8.4c).
 *
 * Un C4 se lee por el tipo de cada elemento: «Contenedor: Node.js»,
 * «Sistema externo». Hasta la 8.4c el lienzo pintaba una cinta en inglés
 * desde el `kind` del nodo —que el modelo escribe como rol—, la mayoría de los
 * elementos no tenía ninguna y los componentes nunca; la leyenda de la
 * exportación sólo listaba estilos de relación, y el título caía en
 * «Diagrama de arquitectura» cuando el IR no traía uno. Criterio de
 * aceptación: un C4 exportado siempre lleva título, leyenda y estereotipos.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { resolveNodeRibbon } from '../../lib/diagramC4Levels';
import {
    GENERIC_DIAGRAM_TITLE,
    c4LevelOfIR,
    c4StereotypeOf,
    checkNotationContract,
    describeNotationPresentation,
} from '../../services/diagram/notationContract';
import { defaultFrameMetadataFromIR, FRAME_LEGEND_LIMIT } from '../../services/diagram/diagramExportFrame';
import { irToMermaidC4 } from '../../services/diagram/irToMermaidC4';
import { irToReactFlow } from '../../services/diagram/irToReactFlow';
import { buildLegendData } from '../../components/reactFlowCanvas/DiagramLegend';

const container = (diagramType: string, title?: string): DiagramIR => ({
    nodes: [
        { id: 'asegurado', label: 'Asegurado', kind: 'person' },
        { id: 'portal', label: 'Portal de autorizaciones', kind: 'service', technology: 'React' },
        { id: 'api', label: 'API de autorizaciones', kind: 'service', technology: 'Node.js' },
        { id: 'bd', label: 'Base de autorizaciones', kind: 'data', technology: 'PostgreSQL' },
        { id: 'pbm', label: 'PBM externo', kind: 'external' },
    ],
    edges: [
        { id: 'e1', source: 'asegurado', target: 'portal', label: 'solicita autorización', relation: 'sync' },
        { id: 'e2', source: 'portal', target: 'api', label: 'envía la solicitud', relation: 'sync' },
        { id: 'e3', source: 'api', target: 'bd', label: 'guarda el caso', relation: 'data-flow' },
        { id: 'e4', source: 'api', target: 'pbm', label: 'consulta formulario', relation: 'async' },
    ],
    groups: [{ id: 'sistema', label: 'Sistema de autorizaciones', nodeIds: ['portal', 'api', 'bd'] }],
    metadata: { diagramType, ...(title ? { title } : {}) },
} as DiagramIR);

describe('el estereotipo de cada elemento', () => {
    it('sale de la misma macro con la que se escribe el texto C4', () => {
        const ir = container('c4-container');
        const text = irToMermaidC4(ir, 'container');
        const stereotypes = describeNotationPresentation(ir).stereotypes;
        expect(stereotypes).toEqual({
            asegurado: 'Persona',
            portal: 'Contenedor: React',
            api: 'Contenedor: Node.js',
            bd: 'Contenedor de datos: PostgreSQL',
            pbm: 'Sistema externo',
        });
        expect(text).toMatch(/ContainerDb\(bd,/);
        expect(text).toMatch(/System_Ext\(pbm,/);
    });

    it('cambia con el nivel: un servicio es componente en un diagrama de componentes', () => {
        const node = container('c4-component').nodes[2];
        expect(c4StereotypeOf(node, 'component')).toBe('Componente: Node.js');
        expect(c4StereotypeOf(node, 'context')).toBe('Sistema de software');
    });

    it('no inventa la tecnología que falta', () => {
        expect(c4StereotypeOf({ id: 'x', label: 'Motor', kind: 'service' }, 'container')).toBe('Contenedor');
    });

    it('un diagrama que no es C4 no tiene estereotipos ni leyenda de elementos', () => {
        const flow = container('generic');
        expect(c4LevelOfIR(flow)).toBeNull();
        expect(describeNotationPresentation(flow)).toEqual({ title: null, elementLegend: [], stereotypes: {} });
    });
});

describe('el lienzo cumple el contrato', () => {
    it('cada nodo C4 lleva su estereotipo y su tipo de elemento en los datos', () => {
        const ir = container('c4-container', 'Contenedores de autorizaciones');
        const nodes = irToReactFlow(ir).nodes;
        const stereotypes = Object.fromEntries(nodes.map((n) => [n.id, (n.data as { stereotype?: string }).stereotype]));
        // The canvas paints each boundary as a zone node beside the elements.
        const legend = buildLegendData([...nodes, { type: 'groupZone', data: {} }], irToReactFlow(ir).edges);
        expect(checkNotationContract(ir, {
            title: ir.metadata?.title,
            legendLabels: legend.c4Elements?.map((e) => e.label) ?? [],
            stereotypes,
        })).toEqual([]);
    });

    it('la leyenda de un C4 explica sus tipos de elemento, no la taxonomía genérica', () => {
        const { nodes, edges } = irToReactFlow(container('c4-container'));
        const legend = buildLegendData(nodes, edges);
        expect(legend.c4Elements?.map((e) => e.label)).toEqual(['Persona', 'Contenedor', 'Contenedor de datos', 'Sistema externo']);
    });

    it('la cinta muestra el estereotipo en su caja y conserva la cinta por tipo fuera de C4', () => {
        expect(resolveNodeRibbon('service', 'Contenedor: Node.js')).toMatchObject({ label: 'Contenedor: Node.js', textCase: 'normal-case tracking-normal' });
        expect(resolveNodeRibbon('person')).toMatchObject({ label: 'PERSON', textCase: 'uppercase tracking-[0.14em]' });
        expect(resolveNodeRibbon('unknown')).toBeNull();
    });
});

describe('la exportación cumple el contrato', () => {
    it('el marco lleva el título, los tipos de elemento antes que las relaciones y cabe en lo que se dibuja', () => {
        const ir = container('c4-container', 'Contenedores de autorizaciones');
        const frame = defaultFrameMetadataFromIR(ir);
        const labels = (frame.legend ?? []).map((e) => e.label);
        expect(frame.title).toBe('Contenedores de autorizaciones');
        expect(labels.slice(0, 5)).toEqual(['Persona', 'Contenedor', 'Contenedor de datos', 'Sistema externo', 'Límite']);
        expect(labels.length).toBeLessThanOrEqual(FRAME_LEGEND_LIMIT);
    });

    it('sin título en el IR, el nombre del artefacto; nunca el título genérico si hay uno', () => {
        const ir = container('c4-container');
        expect(defaultFrameMetadataFromIR(ir, { fallbackTitle: 'Contenedores PBM' }).title).toBe('Contenedores PBM');
        expect(defaultFrameMetadataFromIR(ir).title).toBe(GENERIC_DIAGRAM_TITLE);
    });

    it('el veredicto señala lo que falta: título genérico, leyenda incompleta y nodos sin estereotipo', () => {
        const ir = container('c4-container');
        const codes = checkNotationContract(ir, {
            title: GENERIC_DIAGRAM_TITLE,
            legendLabels: ['Persona', 'Sincrónico (REST)'],
            stereotypes: { asegurado: 'Persona', portal: 'CONTAINER' },
        }).map((issue) => issue.code);
        expect(codes).toEqual(['NOTATION_TITLE_MISSING', 'NOTATION_LEGEND_INCOMPLETE', 'NOTATION_STEREOTYPE_MISSING']);
    });
});
