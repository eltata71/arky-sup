/**
 * Plan de diagramas 8.3c: los límites son nodos compuestos de ELK.
 *
 * Antes, un diagrama con grupos se desviaba a un dagre en dos niveles y uno
 * con un solo grupo pasaba por un ELK plano que no sabía que el grupo existía:
 * la zona se pintaba después, alrededor de miembros dispersos, y podía tapar
 * nodos que no eran suyos. Ahora ELK reserva el rectángulo de cada zona —con
 * el mismo relleno que dibuja el lienzo— y ninguna zona pisa a otra ni a un
 * nodo ajeno.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import type { DiagramIR } from '../../lib/diagram';
import { layoutIRWithELK } from '../../lib/elkLayoutEngine';
import { mermaidToIR } from '../../services/diagram';
import { irToReactFlowSmart } from '../../services/diagram/irToReactFlow';
import { resolveGroupSemanticStyle } from '../../services/diagram/groupSemantics';

interface Rect { x: number; y: number; width: number; height: number }

const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The zone exactly as the canvas draws it: the members' box plus the group's padding. */
const zonesOf = (ir: DiagramIR, nodes: Node[]): Map<string, Rect & { members: string[] }> => {
    const zones = new Map<string, Rect & { members: string[] }>();
    const byGroup = new Map<string, Node[]>();
    for (const n of nodes) {
        const group = (n.data as { group?: string }).group;
        if (group) byGroup.set(group, [...(byGroup.get(group) ?? []), n]);
    }
    for (const [label, members] of byGroup) {
        const style = resolveGroupSemanticStyle(ir.groups.find((g) => g.label === label)?.kind);
        const w = (n: Node) => (n.data as { width: number }).width;
        const h = (n: Node) => (n.data as { height: number }).height;
        const x = Math.min(...members.map((n) => n.position.x)) - style.padX;
        const y = Math.min(...members.map((n) => n.position.y)) - style.padTop;
        const maxX = Math.max(...members.map((n) => n.position.x + w(n))) + style.padX;
        const maxY = Math.max(...members.map((n) => n.position.y + h(n))) + style.padBottom;
        zones.set(label, { x, y, width: maxX - x, height: maxY - y, members: members.map((n) => String(n.id)) });
    }
    return zones;
};

const rectOf = (n: Node): Rect => ({ x: n.position.x, y: n.position.y, width: (n.data as { width: number }).width, height: (n.data as { height: number }).height });

const C4_THREE_BOUNDARIES = `C4Container
title Reclamaciones de salud
Person(afiliado, "Afiliado", "Presenta reclamaciones")
System_Boundary(canales, "Canales digitales") {
  Container(portal, "Portal del afiliado", "React", "Autoservicio")
  Container(app, "App móvil", "Flutter", "Autoservicio móvil")
  Container(bff, "BFF de canales", "Node.js", "Agrega servicios")
}
System_Boundary(core, "Core de reclamaciones") {
  Container(api, "API de reclamaciones", "Java", "Recibe reclamaciones")
  Container(adjudicacion, "Motor de adjudicación", "Java", "Adjudica")
  Container(reglas, "Motor de reglas", "Drools", "Reglas de cobertura")
  ContainerDb(bd, "Base de reclamaciones", "PostgreSQL", "Persistencia")
}
System_Boundary(integracion, "Integración") {
  Container(esb, "ESB", "MuleSoft", "Mediación")
  Container(edi, "Pasarela EDI", "X12", "837/835")
}
System_Ext(pagos, "Sistema de pagos", "Liquida")
Rel(afiliado, portal, "Usa", "HTTPS")
Rel(afiliado, app, "Usa", "HTTPS")
Rel(portal, bff, "Invoca", "REST")
Rel(app, bff, "Invoca", "REST")
Rel(bff, api, "Envía reclamación", "REST")
Rel(api, adjudicacion, "Solicita adjudicación", "gRPC")
Rel(adjudicacion, reglas, "Evalúa", "API")
Rel(adjudicacion, bd, "Persiste", "JDBC")
Rel(api, esb, "Publica", "AMQP")
Rel(esb, edi, "Transforma", "SOAP")
Rel(esb, pagos, "Ordena pago", "SOAP")`;

const SINGLE_GROUP_FLOW = `flowchart LR
  cliente[Asegurado] --> portal[Portal]
  subgraph Nucleo[Núcleo de pólizas]
    emision[Emisión]
    cobro[Cobro]
    renovacion[Renovación]
  end
  portal --> emision
  emision --> cobro
  cobro --> renovacion
  portal --> notificaciones[Notificaciones]
  renovacion --> notificaciones`;

const cases: Array<[string, string, Parameters<typeof irToReactFlowSmart>[1]]> = [
    ['C4 con tres límites', C4_THREE_BOUNDARIES, 'mermaid-c4-container'],
    ['flujo con un solo subgrafo', SINGLE_GROUP_FLOW, 'mermaid-graph'],
    ['C4 con límite del repositorio', readFileSync(join(process.cwd(), 'tests', 'fixtures', 'c4-container-boundary.mmd'), 'utf8'), 'mermaid-c4-container'],
];

describe('ELK jerárquico: los límites son nodos compuestos (8.3c)', () => {
    it.each(cases)('%s: ELK, ninguna zona pisa a otra ni a un nodo ajeno, y ningún nodo pisa a otro', async (_name, source, type) => {
        const ir = mermaidToIR(source);
        expect(ir.nodes.some((n) => n.group)).toBe(true);
        const result = await irToReactFlowSmart(ir, type);
        expect(result.plan.backend).toBe('elk');
        const zones = [...zonesOf(ir, result.nodes).entries()];
        for (let i = 0; i < zones.length; i++) {
            for (let j = i + 1; j < zones.length; j++) {
                expect(overlaps(zones[i][1], zones[j][1]), `${zones[i][0]} × ${zones[j][0]}`).toBe(false);
            }
        }
        for (const [label, zone] of zones) {
            for (const n of result.nodes) {
                if (zone.members.includes(String(n.id))) continue;
                expect(overlaps(zone, rectOf(n)), `${String(n.id)} dentro de «${label}»`).toBe(false);
            }
        }
        for (let i = 0; i < result.nodes.length; i++) {
            for (let j = i + 1; j < result.nodes.length; j++) {
                expect(overlaps(rectOf(result.nodes[i]), rectOf(result.nodes[j]))).toBe(false);
            }
        }
    });

    it('la zona que dibuja el lienzo es el rectángulo que ELK reservó', async () => {
        const ir = mermaidToIR(C4_THREE_BOUNDARIES);
        const layout = await layoutIRWithELK(ir, {
            preset: 'flow',
            groupOf: (n) => n.group,
            groupPadding: (label) => {
                const style = resolveGroupSemanticStyle(ir.groups.find((g) => g.label === label)?.kind);
                return { top: style.padTop, left: style.padX, bottom: style.padBottom, right: style.padX };
            },
        });
        expect(layout.groupBoxes?.size).toBe(3);
        for (const group of ir.groups) {
            const box = layout.groupBoxes!.get(group.label)!;
            const members = group.nodeIds.map((id) => layout.positions.get(id)!);
            for (const m of members) {
                expect(m.x).toBeGreaterThanOrEqual(box.x);
                expect(m.y).toBeGreaterThanOrEqual(box.y);
                expect(m.x + m.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
                expect(m.y + m.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
            }
        }
    });

    it('sin grupos, el ELK de siempre: el algoritmo del plan y sin cajas de grupo', async () => {
        const ir = mermaidToIR('flowchart LR\n  a[A] --> b[B]\n  b --> c[C]');
        const layout = await layoutIRWithELK(ir, { preset: 'flow', algorithm: 'layered', groupOf: (n) => n.group });
        expect(layout.groupBoxes).toBeUndefined();
        expect(layout.positions.size).toBe(3);
    });
});
