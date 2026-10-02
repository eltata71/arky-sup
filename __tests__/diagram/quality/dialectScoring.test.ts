/**
 * La rúbrica lee cada dialecto en su propia notación (plan de diagramas, 8.4b).
 *
 * Tres dimensiones medían estructura de grafo: *jerarquía visual* contaba
 * grupos, *atractivo visual* pagaba diez puntos por tener alguno y
 * *preparación técnica* contaba protocolos en las aristas. Una secuencia no
 * tiene grupos, un ERD no tiene protocolos y un diagrama de estados anida
 * estados en vez de dibujar límites. Juzgados como grafos, un ERD correcto
 * perdía puntos por no ser un diagrama de integración, y añadir un grupo sin
 * sentido a una secuencia subía su puntuación — el criterio de aceptación de
 * la 8.4b es que eso ya no pasa.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../../lib/diagram';
import { mermaidToIR } from '../../../services/diagram/mermaidToIR';
import { analyzeDiagramQuality } from '../../../services/diagram/quality/diagramQualityService';
import { buildBreakdown, weightedBreakdownScore } from '../../../services/diagram/quality/diagramScoring';
import { scoreGeometria, scoringDialectOf } from '../../../services/diagram/quality/dialectScoring';
import { detectDiagramArchetype } from '../../../services/diagram/diagramTypeQualityGates';
import type { LayoutQualityMetrics } from '../../../services/diagram/layoutQualityService';

const SEQUENCE = `sequenceDiagram
    autonumber
    participant H as Hospital
    participant P as Portal de proveedores
    participant M as Motor de elegibilidad
    H->>P: envía solicitud 270
    P->>M: consulta cobertura vigente
    alt póliza activa
        M-->>P: devuelve beneficios
    else póliza cancelada
        M-->>P: rechaza con motivo
    end
    P-->>H: responde 271
    Note over P,M: PHI cifrada en tránsito`;

const ERD = `erDiagram
    POLIZA ||--o{ COBERTURA : incluye
    POLIZA }o--|| ASEGURADO : pertenece
    POLIZA {
        string numero PK
        date vigencia
    }
    COBERTURA {
        string codigo PK
        decimal suma
    }
    ASEGURADO {
        string documento PK
        string nombre
    }`;

const STATE = `stateDiagram-v2
    [*] --> Recibida
    Recibida --> EnRevision : asignar auditor
    state EnRevision {
        [*] --> Documental
        Documental --> Medica : documentos completos
        Medica --> [*]
    }
    EnRevision --> Aprobada : dictamen favorable
    EnRevision --> Rechazada : dictamen adverso
    Aprobada --> [*]
    Rechazada --> [*]`;

const withGroup = (ir: DiagramIR): DiagramIR => ({
    ...ir,
    groups: [...ir.groups, { id: 'grupo-sin-sentido', label: 'Grupo', nodeIds: ir.nodes.slice(0, 2).map((n) => n.id) }],
} as DiagramIR);

const cases = { sequence: SEQUENCE, erd: ERD, state: STATE } as const;

describe('cada dialecto se puntúa en su notación', () => {
    it.each(Object.entries(cases))('%s se reconoce por su notación', (dialect, text) => {
        expect(scoringDialectOf(mermaidToIR(text))).toBe(dialect);
    });

    it.each(Object.entries(cases))('a %s no le sube la nota un grupo sin sentido', (_dialect, text) => {
        const ir = mermaidToIR(text);
        expect(analyzeDiagramQuality(withGroup(ir)).score).toBeLessThanOrEqual(analyzeDiagramQuality(ir).score);
        const before = buildBreakdown(ir);
        const after = buildBreakdown(withGroup(ir));
        expect(after.jerarquiaVisual).toBe(before.jerarquiaVisual);
        expect(after.atractivoVisual).toBe(before.atractivoVisual);
    });

    it('un flowchart sigue premiando los grupos — la regla nueva no toca los grafos', () => {
        const ir = mermaidToIR('flowchart LR\n  A[Portal] -->|consulta| B[API]\n  B -->|lee| C[(Base)]\n  C -->|responde| D[Auditoría]');
        expect(scoringDialectOf(ir)).toBe('graph');
        expect(buildBreakdown(withGroup(ir)).atractivoVisual).toBeGreaterThan(buildBreakdown(ir).atractivoVisual);
    });

    it('un ERD gana preparación técnica con atributos, claves y cardinalidades, no con protocolos', () => {
        const full = mermaidToIR(ERD);
        const bare = mermaidToIR('erDiagram\n    POLIZA ||--o{ COBERTURA : incluye\n    POLIZA }o--|| ASEGURADO : pertenece');
        expect(buildBreakdown(full).preparacionTecnica).toBeGreaterThan(buildBreakdown(bare).preparacionTecnica);
        expect(buildBreakdown(full).preparacionTecnica).toBeGreaterThanOrEqual(90);
    });

    it('una secuencia con fragmentos y notas puntúa su notación por encima de una plana', () => {
        const flat = mermaidToIR('sequenceDiagram\n    H->>P: envía solicitud\n    P-->>H: responde');
        const rich = mermaidToIR(SEQUENCE);
        expect(buildBreakdown(rich).atractivoVisual).toBeGreaterThan(buildBreakdown(flat).atractivoVisual);
        expect(buildBreakdown(rich).preparacionTecnica).toBeGreaterThan(buildBreakdown(flat).preparacionTecnica);
    });

    it('un diagrama de estados premia transiciones etiquetadas, inicio y fin, y compuestos', () => {
        const b = buildBreakdown(mermaidToIR(STATE));
        expect(b.preparacionTecnica).toBeGreaterThanOrEqual(80);
        expect(b.atractivoVisual).toBeGreaterThan(buildBreakdown(mermaidToIR('stateDiagram-v2\n    A --> B\n    B --> C')).atractivoVisual);
    });

    it('la notación decide el arquetipo: una secuencia no se juzga como proceso ni un ERD como linaje', () => {
        expect(detectDiagramArchetype(mermaidToIR(SEQUENCE))).toBe('sequence');
        expect(detectDiagramArchetype(mermaidToIR(ERD))).toBe('generic');
        expect(detectDiagramArchetype(mermaidToIR(STATE))).toBe('generic');
    });
});

const metrics = (overrides: Partial<LayoutQualityMetrics> = {}): LayoutQualityMetrics => ({
    hasLayout: true,
    overlappingNodePairs: [],
    overlappingGroupPairs: [],
    edgesCrossingNodes: [],
    edgeCrossings: 0,
    boundaryContainmentBreaches: [],
    ...overrides,
} as unknown as LayoutQualityMetrics);

describe('geometría, la undécima dimensión', () => {
    it('sólo existe cuando el lienzo midió las posiciones reales', () => {
        const ir = mermaidToIR(SEQUENCE);
        expect(buildBreakdown(ir).geometria).toBeUndefined();
        expect(buildBreakdown(ir, metrics({ hasLayout: false })).geometria).toBeUndefined();
        expect(buildBreakdown(ir, metrics()).geometria).toBe(100);
    });

    it('cobra solapes, aristas sobre nodos, cruces y nodos fuera de su límite', () => {
        expect(scoreGeometria(metrics())).toBe(100);
        const broken = metrics({
            overlappingNodePairs: [['a', 'b']] as never,
            edgesCrossingNodes: [{}, {}] as never,
            edgeCrossings: 3,
            boundaryContainmentBreaches: [{ groupId: 'g', nodeIds: ['a'] }] as never,
        });
        expect(scoreGeometria(broken)).toBe(100 - 20 - 12 - 6 - 5);
    });

    it('una geometría limpia no castiga ni premia: el total se renormaliza', () => {
        const breakdown = buildBreakdown(mermaidToIR(SEQUENCE));
        const base = weightedBreakdownScore(breakdown);
        const withPerfect = weightedBreakdownScore({ ...breakdown, geometria: base });
        expect(withPerfect).toBeCloseTo(base, 6);
        expect(weightedBreakdownScore({ ...breakdown, geometria: 0 })).toBeLessThan(base);
    });
});
