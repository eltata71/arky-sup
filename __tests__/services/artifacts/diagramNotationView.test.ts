import { describe, expect, it } from 'vitest';
import {
    getArtifactViewCapabilities,
    nativeNotationDialect,
    resolveSafeArtifactView,
} from '../../../services/artifacts/application/artifactGenerationPipeline';
import type { Artifact } from '../../../lib/artifacts';

/**
 * Plan de diagramas 8.3a: la vista preferida depende del dialecto. Una
 * secuencia, un Gantt o un diagrama de estados abren en su notación nativa;
 * flujo, C4 y ERD, en el lienzo.
 */
const diagram = (type: Artifact['type'], content: string, representation: Artifact['representation'] = 'diagram'): Artifact => ({
    id: `a-${type}`,
    versionGroupId: 'vg',
    version: 1,
    createdAt: '2026-10-02T00:00:00.000Z',
    name: 'Diagrama',
    type,
    phase: 'Diseño',
    architecturalView: 'Vista Lógica y de Diseño',
    content,
    objective: 'Modelar',
    keyConcepts: [],
    representation,
});

const SEQUENCE = 'sequenceDiagram\n  participant A as Portal\n  participant B as Motor\n  A->>B: Solicita\n  alt aprobada\n    B-->>A: OK\n  else rechazada\n    B-->>A: Rechazo\n  end';
const GANTT = 'gantt\n  title Implantación\n  dateFormat YYYY-MM-DD\n  section Fase 1\n  Diseño :a1, 2026-10-01, 10d';
const STATE = 'stateDiagram-v2\n  [*] --> Recibida\n  Recibida --> Adjudicada\n  Adjudicada --> [*]';
const FLOW = 'flowchart LR\n  A[Portal] --> B[Motor]';
const ERD = 'erDiagram\n  POLIZA ||--o{ COBERTURA : incluye';
const C4 = 'C4Container\n  title Reclamaciones\n  Person(a, "Asegurado")\n  System(b, "Core")\n  Rel(a, b, "Usa")';

describe('nativeNotationDialect', () => {
    it('reconoce secuencia, Gantt, estados, journey y mindmap', () => {
        expect(nativeNotationDialect(SEQUENCE)).toBe('sequence');
        expect(nativeNotationDialect(GANTT)).toBe('gantt');
        expect(nativeNotationDialect(STATE)).toBe('state');
        expect(nativeNotationDialect('stateDiagram\n  [*] --> A')).toBe('state');
        expect(nativeNotationDialect('journey\n  title X')).toBe('journey');
        expect(nativeNotationDialect('mindmap\n  root')).toBe('mindmap');
    });

    it('devuelve null para lo que es un grafo', () => {
        expect(nativeNotationDialect(FLOW)).toBeNull();
        expect(nativeNotationDialect(ERD)).toBeNull();
        expect(nativeNotationDialect(C4)).toBeNull();
        expect(nativeNotationDialect('')).toBeNull();
        expect(nativeNotationDialect(null)).toBeNull();
    });

    it('salta el bloque de configuración y las directivas', () => {
        expect(nativeNotationDialect(`---\ntitle: Autorización\n---\n%%{init: {"theme":"base"}}%%\n${SEQUENCE}`)).toBe('sequence');
    });
});

describe('getArtifactViewCapabilities (8.3a)', () => {
    it('una secuencia abre en su notación, y el lienzo sigue disponible', () => {
        const caps = getArtifactViewCapabilities(diagram('mermaid-sequence', SEQUENCE));
        expect(caps.preferredView).toBe('notation');
        expect(caps.availableViews).toContain('notation');
    });

    it('un Gantt abre en su notación aunque el lienzo no pueda leerlo', () => {
        const caps = getArtifactViewCapabilities(diagram('mermaid-gantt', GANTT));
        expect(caps.preferredView).toBe('notation');
        expect(caps.availableViews).toContain('notation');
    });

    it('un diagrama de estados abre en su notación', () => {
        expect(getArtifactViewCapabilities(diagram('mermaid-state', STATE)).preferredView).toBe('notation');
    });

    it('flujo, ERD y C4 siguen abriendo en el lienzo, con la notación como alternativa', () => {
        for (const [type, content] of [['mermaid-graph', FLOW], ['mermaid-erd', ERD], ['mermaid-c4-container', C4]] as const) {
            const caps = getArtifactViewCapabilities(diagram(type as Artifact['type'], content));
            expect(caps.preferredView, type).toBe('diagram');
            expect(caps.availableViews, type).toContain('notation');
        }
    });

    it('un híbrido con secuencia ofrece su notación', () => {
        const caps = getArtifactViewCapabilities(diagram('hybrid-text-diagram', `# Flujo\n\nTexto.\n\n\`\`\`mermaid\n${SEQUENCE}\n\`\`\``, 'hybrid'));
        expect(caps.preferredView).toBe('notation');
    });

    it('un documento y un React Flow no ofrecen notación', () => {
        expect(getArtifactViewCapabilities(diagram('markdown', `# SRS\n\n\`\`\`mermaid\n${SEQUENCE}\n\`\`\``, 'document')).availableViews).not.toContain('notation');
        expect(getArtifactViewCapabilities(diagram('react-flow-graph', '{"nodes":[],"edges":[]}')).availableViews).not.toContain('notation');
    });

    it('pedir la notación de un documento cae a una vista que sí existe', () => {
        expect(resolveSafeArtifactView(diagram('markdown', '# SRS', 'document'), 'notation')).not.toBe('notation');
    });
});
