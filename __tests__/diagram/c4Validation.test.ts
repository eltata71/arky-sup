import { describe, it, expect } from 'vitest';
import { validateC4, inferC4Level } from '../../services/diagram/c4Validation';
import type { DiagramIR } from '../../lib/diagram';

const wrap = (ir: Partial<DiagramIR>): DiagramIR => ({
    nodes: ir.nodes ?? [],
    edges: ir.edges ?? [],
    groups: ir.groups ?? [],
    metadata: ir.metadata,
});

describe('validateC4 (Gap 9)', () => {
    it('returns no issues for non-C4 diagrams', () => {
        const issues = validateC4(wrap({ nodes: [{ id: 'a', label: 'A', kind: 'service' }] }));
        expect(issues).toEqual([]);
    });

    it('flags Context C4 missing system of interest', () => {
        const ir = wrap({
            metadata: { diagramType: 'c4-context' },
            nodes: [{ id: 'u', label: 'Usuario', kind: 'person' }],
        });
        const issues = validateC4(ir);
        expect(issues.some((i) => i.code === 'C4_CTX_MISSING_SOI')).toBe(true);
    });

    it('flags Context C4 that leaks components/classes/pods', () => {
        const ir = wrap({
            metadata: { diagramType: 'c4-context' },
            nodes: [
                { id: 's', label: 'PlatformX', kind: 'system' },
                { id: 'u', label: 'Cliente', kind: 'person' },
                { id: 'r', label: 'UserRepository', kind: 'repository', description: 'JPA repo' },
            ],
        });
        const issues = validateC4(ir);
        expect(issues.some((i) => i.code === 'C4_CTX_LEAKED_INTERNALS')).toBe(true);
    });

    it('flags Container C4 missing technology on technical containers', () => {
        const ir = wrap({
            metadata: { diagramType: 'c4-container' },
            nodes: [
                { id: 'api', label: 'API', kind: 'container', semanticType: 'api' },
                { id: 'db', label: 'DB', kind: 'containerdb', semanticType: 'database' },
            ],
            edges: [{ id: 'e', source: 'api', target: 'db', label: 'lee', protocol: 'JDBC' }],
        });
        const issues = validateC4(ir);
        expect(issues.some((i) => i.code === 'C4_CON_MISSING_TECHNOLOGY')).toBe(true);
    });

    it('flags Container C4 with relations missing protocol', () => {
        const ir = wrap({
            metadata: { diagramType: 'c4-container' },
            nodes: [
                { id: 'api', label: 'API', kind: 'container', technology: 'Spring' },
                { id: 'db', label: 'DB', kind: 'containerdb', technology: 'Postgres' },
            ],
            edges: [{ id: 'e', source: 'api', target: 'db', label: 'lee' }],
        });
        const issues = validateC4(ir);
        expect(issues.some((i) => i.code === 'C4_CON_MISSING_PROTOCOL')).toBe(true);
    });

    it('flags Component C4 mixing multiple containers', () => {
        const ir = wrap({
            metadata: { diagramType: 'c4-component' },
            nodes: [
                { id: 'c1', label: 'Auth', kind: 'component', group: 'Container A' },
                { id: 'c2', label: 'Order', kind: 'component', group: 'Container B' },
            ],
            edges: [{ id: 'e', source: 'c1', target: 'c2', label: 'rel' }],
            groups: [
                { id: 'A', label: 'Container A', nodeIds: ['c1'] },
                { id: 'B', label: 'Container B', nodeIds: ['c2'] },
            ],
        });
        const issues = validateC4(ir);
        expect(issues.some((i) => i.code === 'C4_COMP_MULTI_CONTAINER')).toBe(true);
    });

    it('flags Deployment C4 missing runtime / environment / network signals', () => {
        const ir = wrap({
            metadata: { diagramType: 'c4-deployment' },
            nodes: [
                // Generic service-style nodes — no runtime / env / network hints.
                { id: 'app', label: 'App', kind: 'application' },
            ],
        });
        const issues = validateC4(ir);
        const codes = issues.map((i) => i.code);
        expect(codes).toEqual(expect.arrayContaining([
            'C4_DEP_MISSING_RUNTIME_NODES',
            'C4_DEP_MISSING_ENVIRONMENT',
            'C4_DEP_MISSING_NETWORK_ZONE',
        ]));
    });

    it('inferC4Level honours the explicit metadata.diagramType', () => {
        expect(inferC4Level(wrap({ metadata: { diagramType: 'c4-component' } }))).toBe('component');
        expect(inferC4Level(wrap({}), 'mermaid-c4-container')).toBe('container');
        expect(inferC4Level(wrap({}))).toBeNull();
    });
});
