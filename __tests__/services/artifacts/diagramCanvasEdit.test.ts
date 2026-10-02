/**
 * Una edición en el lienzo cambia el modelo guardado, nunca lo que muestra la
 * pantalla (plan de diagramas, 8.1a).
 *
 * Cada caso parte de lo que el lienzo pinta de verdad —`resolveRenderableDiagram`
 * con la audiencia de la vista— y aplica lo que haría una persona: mover,
 * borrar, conectar, renombrar.
 */
import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramAudience } from '../../../lib/diagram';
import { planCanvasEdit, type CanvasEditFlow } from '../../../services/artifacts/application/diagramCanvasEdit';
import { extractIRFromArtifact, resolveRenderableDiagram } from '../../../services/diagram';

type EditableArtifact = Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'>;

const artifactOf = (type: Artifact['type'], content: string, representation: Artifact['representation'] = 'diagram'): EditableArtifact => {
    const base = { id: `a-${type}`, type, content, representation };
    return { ...base, ir: extractIRFromArtifact(base) ?? undefined };
};

const canvasOf = (artifact: EditableArtifact, audience: DiagramAudience = 'technical'): CanvasEditFlow => {
    const { reactFlow } = resolveRenderableDiagram(artifact, { audience });
    return { nodes: reactFlow.nodes.filter((n) => n.type !== 'groupZone'), edges: reactFlow.edges };
};

const moveFirst = (flow: CanvasEditFlow): CanvasEditFlow => ({
    ...flow,
    nodes: flow.nodes.map((n, i) => (i === 0 ? { ...n, position: { x: n.position.x + 40, y: n.position.y + 8 } } : n)),
});

const SEQUENCE = [
    'sequenceDiagram',
    '    autonumber',
    '    participant Prov as Proveedor',
    '    participant Motor as Motor de Autorizaciones',
    '    participant Clin as Revisor Clínico',
    '    Prov->>Motor: Envía solicitud',
    '    alt Requiere revisión',
    '        Motor->>Clin: Escala caso',
    '        Clin-->>Motor: Dictamina',
    '    end',
    '    Motor-->>Prov: Responde',
].join('\n');

const FLOW = [
    'flowchart LR',
    '    asegurado((Asegurado)) -->|Presenta reclamación| app[App del asegurado]',
    '    subgraph Recepcion[Recepción]',
    '        app -->|Envía documentos| captura[Captura de documentos]',
    '        captura -->|Extrae datos| validacion[Validación de cobertura]',
    '    end',
    '    subgraph Decision[Decisión]',
    '        validacion -->|Aplica reglas| adjudicacion[Adjudicación automática]',
    '        adjudicacion -->|Casos complejos| revision[Revisión manual]',
    '    end',
    '    adjudicacion -->|Ordena pago| tesoreria[(Tesorería)]',
].join('\n');

const C4 = [
    'C4Container',
    '    title Contenedores de Reclamaciones',
    '    Person(asegurado, "Asegurado", "Presenta reclamaciones")',
    '    Container(portal, "Portal", "React", "Captura reclamaciones")',
    '    Container(api, "API de Reclamaciones", "Spring Boot", "Adjudica")',
    '    ContainerDb(bd, "Base de Reclamaciones", "PostgreSQL", "Guarda reclamaciones")',
    '    Rel(asegurado, portal, "Presenta reclamación", "HTTPS")',
    '    Rel(portal, api, "Envía reclamación", "REST")',
    '    Rel(api, bd, "Persiste", "JDBC")',
].join('\n');

describe('planCanvasEdit — mover un nodo', () => {
    it('no toca el texto de una secuencia: sigue siendo una secuencia, con sus fragmentos', () => {
        const artifact = artifactOf('mermaid-sequence', SEQUENCE);
        const before = canvasOf(artifact);
        const plan = planCanvasEdit(artifact, { before, after: moveFirst(before) });
        expect(plan.patch?.content).toBeUndefined();
        expect(plan.notice).toBeNull();
        const moved = plan.patch?.ir?.nodes.find((n) => n.id === before.nodes[0].id);
        expect(moved?.position?.x).toBe(Math.round(before.nodes[0].position.x + 40));
        expect(plan.patch?.ir?.metadata?.layoutMode).toBe('manual');
    });

    it('en la vista ejecutiva no borra lo que esa vista agrupa ni guarda sus nodos sintéticos', () => {
        const artifact = artifactOf('mermaid-graph', FLOW);
        const before = canvasOf(artifact, 'executive');
        expect(before.nodes.some((n) => String(n.id).startsWith('group_'))).toBe(true);
        const plan = planCanvasEdit(artifact, { before, after: moveFirst(before) });
        const ids = (plan.patch?.ir ?? artifact.ir!).nodes.map((n) => n.id).sort();
        expect(ids).toEqual(artifact.ir!.nodes.map((n) => n.id).sort());
        expect(plan.patch?.content).toBeUndefined();
        // Una disposición hecha a medias con posiciones de una proyección desordenaría el resto.
        expect(plan.patch?.ir?.metadata?.layoutMode).not.toBe('manual');
    });

    it('sin ningún cambio no escribe nada', () => {
        const artifact = artifactOf('mermaid-graph', FLOW);
        const before = canvasOf(artifact);
        expect(planCanvasEdit(artifact, { before, after: before }).patch).toBeNull();
    });
});

describe('planCanvasEdit — cambios estructurales', () => {
    it('borrar un nodo de un flowchart lo quita con sus relaciones y reescribe el texto como flowchart', () => {
        const artifact = artifactOf('mermaid-graph', FLOW);
        const before = canvasOf(artifact);
        const after = { nodes: before.nodes.filter((n) => n.id !== 'revision'), edges: before.edges.filter((e) => e.target !== 'revision') };
        const plan = planCanvasEdit(artifact, { before, after });
        expect(plan.patch?.ir?.nodes.some((n) => n.id === 'revision')).toBe(false);
        expect(plan.patch?.ir?.edges.some((e) => e.target === 'revision' || e.source === 'revision')).toBe(false);
        expect(plan.patch?.content?.split('\n')[0]).toMatch(/^(flowchart|graph)/);
        expect(plan.patch?.content).not.toContain('Revisión manual');
    });

    it('renombrar en un C4 reescribe el texto en C4, no en flowchart', () => {
        const artifact = artifactOf('mermaid-c4-container', C4);
        const before = canvasOf(artifact);
        const after = {
            ...before,
            nodes: before.nodes.map((n) => (n.id === 'api' ? { ...n, data: { ...n.data, label: 'API de Siniestros' } } : n)),
        };
        const plan = planCanvasEdit(artifact, { before, after });
        expect(plan.patch?.ir?.nodes.find((n) => n.id === 'api')?.label).toBe('API de Siniestros');
        expect(plan.patch?.content?.trimStart()).toMatch(/^C4Container/);
        expect(plan.patch?.content).toContain('API de Siniestros');
    });

    it('borrar un participante de una secuencia la reescribe en su dialecto, sin él ni el fragmento que queda vacío (8.3b)', () => {
        const artifact = artifactOf('mermaid-sequence', SEQUENCE);
        const before = canvasOf(artifact);
        const victim = before.nodes.find((n) => String((n.data as { label?: string }).label).includes('Revisor'))!;
        const after = { nodes: before.nodes.filter((n) => n.id !== victim.id), edges: before.edges.filter((e) => e.source !== victim.id && e.target !== victim.id) };
        const plan = planCanvasEdit(artifact, { before, after });
        expect(plan.patch?.ir?.nodes.some((n) => n.id === victim.id)).toBe(false);
        expect(plan.patch?.content).toBe([
            'sequenceDiagram',
            '    autonumber',
            '    participant Prov as Proveedor',
            '    participant Motor as Motor de Autorizaciones',
            '    Prov->>Motor: Envía solicitud',
            '    Motor-->>Prov: Responde',
        ].join('\n'));
        expect(plan.notice).toBeNull();
    });

    it('borrar un participante de una secuencia que el modelo no sabe reescribir conserva el texto y lo dice', () => {
        const artifact = artifactOf('mermaid-sequence', SEQUENCE.replace('    autonumber', '    box Aseguradora\n    end'));
        const before = canvasOf(artifact);
        const victim = before.nodes.find((n) => String((n.data as { label?: string }).label).includes('Revisor'))!;
        const after = { nodes: before.nodes.filter((n) => n.id !== victim.id), edges: before.edges.filter((e) => e.source !== victim.id && e.target !== victim.id) };
        const plan = planCanvasEdit(artifact, { before, after });
        expect(plan.patch?.ir?.nodes.some((n) => n.id === victim.id)).toBe(false);
        expect(plan.patch?.content).toBeUndefined();
        expect(plan.notice).toMatch(/texto .* se conserva/);
    });

    it('una conexión a un nodo que sólo existe en la proyección se rechaza y no se guarda', () => {
        const artifact = artifactOf('mermaid-graph', FLOW);
        const before = canvasOf(artifact, 'executive');
        const synthetic = before.nodes.find((n) => String(n.id).startsWith('group_'))!;
        const after = {
            ...before,
            edges: [...before.edges, { id: 'nueva', source: 'asegurado', target: String(synthetic.id), label: 'Consulta' }],
        };
        const plan = planCanvasEdit(artifact, { before, after });
        expect(plan.rejected.length).toBe(1);
        expect(plan.patch).toBeNull();
    });

    it('añadir y conectar un nodo nuevo entra en el modelo', () => {
        const artifact = artifactOf('mermaid-graph', FLOW);
        const before = canvasOf(artifact);
        const added: Node = { id: 'antifraude', type: 'custom', position: { x: 10, y: 10 }, data: { label: 'Motor antifraude', kind: 'service' } };
        const after = {
            nodes: [...before.nodes, added],
            edges: [...before.edges, { id: 'e-fraude', source: 'validacion', target: 'antifraude', label: 'Evalúa riesgo de fraude' }],
        };
        const plan = planCanvasEdit(artifact, { before, after });
        expect(plan.rejected).toEqual([]);
        expect(plan.patch?.ir?.nodes.some((n) => n.label === 'Motor antifraude')).toBe(true);
        expect(plan.patch?.content).toContain('Motor antifraude');
    });
});
