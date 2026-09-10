/**
 * Tests for the semantic group inference pass. Groups are emitted only when
 *  - the IR has no deliberate grouping yet, and
 *  - at least 2 nodes share the same archetype.
 */

import { describe, it, expect } from 'vitest';
import { inferSemanticGroups } from '../../services/diagram/inferSemanticGroups';
import type { DiagramIR } from '../../lib/diagram';

describe('inferSemanticGroups', () => {
    it('groups nodes by semantic archetype when no explicit groups exist', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'gmd', label: 'GMD', kind: 'System', semanticType: 'legacy-system' },
                { id: 'sim', label: 'Simasec', kind: 'System', semanticType: 'legacy-system' },
                { id: 'aws-s3', label: 'AWS S3', kind: 'Container', semanticType: 'cloud-service' },
                { id: 'aws-ses', label: 'Amazon SES', kind: 'Container', semanticType: 'notification-service' },
                { id: 'mule', label: 'MuleSoft', kind: 'Container', semanticType: 'integration-platform' },
                { id: 'kafka', label: 'Kafka EOB', kind: 'Container', semanticType: 'messaging' },
                { id: 'asegurado', label: 'Asegurado', kind: 'Person', semanticType: 'human-actor' },
                { id: 'medico', label: 'Médico', kind: 'Person', semanticType: 'human-actor' },
            ],
            edges: [],
            groups: [],
        };
        const { ir: out, addedGroups } = inferSemanticGroups(ir);
        // 4 zones expected: Legacy, Cloud + Notification each have one,
        // Integration platform + messaging are merged, Actors merged.
        expect(addedGroups).toContain('Sistemas Legacy');
        expect(addedGroups).toContain('Plataforma de Integración');
        expect(addedGroups).toContain('Usuarios y Actores');
        // Singletons (AWS S3 cloud-service, SES notification-service) do not
        // get a group of their own.
        expect(addedGroups).not.toContain('Servicios Cloud');
        expect(addedGroups).not.toContain('Servicios de Notificación');

        const groupLabels = new Set(out.groups.map((g) => g.label));
        expect(groupLabels.has('Sistemas Legacy')).toBe(true);
        expect(groupLabels.has('Plataforma de Integración')).toBe(true);
        expect(groupLabels.has('Usuarios y Actores')).toBe(true);
    });

    it('is a no-op when the IR already has explicit groups for most nodes', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'A', kind: 'System', semanticType: 'legacy-system', group: 'PALIC' },
                { id: 'b', label: 'B', kind: 'System', semanticType: 'legacy-system', group: 'PALIC' },
                { id: 'c', label: 'C', kind: 'Container', semanticType: 'cloud-service', group: 'PALIC' },
            ],
            edges: [],
            groups: [{ id: 'palic', label: 'PALIC', nodeIds: ['a', 'b', 'c'] }],
        };
        const { ir: out, addedGroups } = inferSemanticGroups(ir);
        expect(addedGroups).toEqual([]);
        expect(out).toBe(ir);
    });

    it('preserves nodes already assigned to a group', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'GMD', kind: 'System', semanticType: 'legacy-system' },
                { id: 'b', label: 'Simasec', kind: 'System', semanticType: 'legacy-system' },
                { id: 'c', label: 'Mule', kind: 'Container', semanticType: 'integration-platform', group: 'Custom Group' },
                { id: 'd', label: 'Kafka', kind: 'Container', semanticType: 'messaging' },
            ],
            edges: [],
            groups: [],
        };
        const { ir: out } = inferSemanticGroups(ir);
        const muleNode = out.nodes.find((n) => n.id === 'c');
        expect(muleNode?.group).toBe('Custom Group');
    });

    it('records the inference in repair history', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'A', kind: 'System', semanticType: 'legacy-system' },
                { id: 'b', label: 'B', kind: 'System', semanticType: 'legacy-system' },
            ],
            edges: [],
            groups: [],
        };
        const { ir: out } = inferSemanticGroups(ir);
        const history = out.metadata?.repairHistory ?? [];
        expect(history.length).toBe(1);
        expect(history[0].reason).toBe('semantic-group-inference');
        expect(history[0].changes[0]).toContain('Sistemas Legacy');
    });

    it('assigns a semantic boundary kind to each inferred group', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'l1', label: 'GMD',       kind: 'System',    semanticType: 'legacy-system' },
                { id: 'l2', label: 'Simasec',   kind: 'System',    semanticType: 'legacy-system' },
                { id: 'd1', label: 'PG Reclamos', kind: 'Database', semanticType: 'database' },
                { id: 'd2', label: 'Mongo Audit', kind: 'Database', semanticType: 'database' },
                { id: 'm1', label: 'MuleSoft', kind: 'Container', semanticType: 'integration-platform' },
                { id: 'm2', label: 'Kafka',    kind: 'Container', semanticType: 'messaging' },
            ],
            edges: [],
            groups: [],
        };
        const { ir: out } = inferSemanticGroups(ir);
        const groupKinds = new Map(out.groups.map((g) => [g.label, g.kind]));
        expect(groupKinds.get('Sistemas Legacy')).toBe('legacy');
        expect(groupKinds.get('Capa de Datos')).toBe('data');
        expect(groupKinds.get('Plataforma de Integración')).toBe('integration');
    });
});
