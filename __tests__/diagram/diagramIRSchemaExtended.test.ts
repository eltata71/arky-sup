import { describe, it, expect } from 'vitest';
import { buildDiagramIRSchema, buildIRDirectGenerationPrompt } from '../../services/ai/prompts/diagramPrompts';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

describe('buildDiagramIRSchema — extended types.ts alignment (Gap 6)', () => {
    const schema = buildDiagramIRSchema() as {
        properties: {
            nodes: { items: { properties: Record<string, { type: string; enum?: string[] }> } };
            edges: { items: { properties: Record<string, { type: string; enum?: string[] }> } };
            groups: { items: { properties: Record<string, { type: string; enum?: string[] }> } };
            metadata: { properties: Record<string, { type: string; enum?: string[] }> };
        };
    };

    it('node schema declares every governance / domain field from types.ts', () => {
        const nodeProps = schema.properties.nodes.items.properties;
        for (const field of [
            'owner', 'domain', 'dataClassification', 'securityLevel',
            'compliance', 'criticality', 'trust',
            'businessMeaning', 'technicalMeaning',
        ]) {
            expect(nodeProps[field], `node.${field}`).toBeDefined();
        }
    });

    it('node.dataClassification accepts PHI/PII/PCI as required by healthcare/insurance flows', () => {
        const enumValues = schema.properties.nodes.items.properties.dataClassification.enum ?? [];
        expect(enumValues).toEqual(expect.arrayContaining(['pii', 'phi', 'pci', 'restricted']));
    });

    it('node.securityLevel matches the actual types.ts vocabulary', () => {
        const enumValues = schema.properties.nodes.items.properties.securityLevel.enum ?? [];
        expect(enumValues).toEqual(expect.arrayContaining(['none', 'standard', 'elevated', 'critical']));
    });

    it('edge schema declares every Phase 2 metadata field', () => {
        const edgeProps = schema.properties.edges.items.properties;
        for (const field of [
            'frequency', 'synchrony', 'security', 'payload', 'trust',
            'businessMeaning', 'technicalMeaning', 'observability', 'sla',
            'errorHandling',
        ]) {
            expect(edgeProps[field], `edge.${field}`).toBeDefined();
        }
    });

    it('edge.dataSensitivity carries the regulated taxonomy', () => {
        const enumValues = schema.properties.edges.items.properties.dataSensitivity.enum ?? [];
        expect(enumValues).toEqual(expect.arrayContaining(['public', 'internal', 'confidential', 'restricted', 'pii', 'phi', 'pci']));
    });

    it('edge.synchrony matches the types.ts vocabulary (fire-and-forget, request-reply)', () => {
        const enumValues = schema.properties.edges.items.properties.synchrony.enum ?? [];
        expect(enumValues).toEqual(expect.arrayContaining(['sync', 'async', 'fire-and-forget', 'request-reply']));
    });

    it('group schema declares kind, purpose, boundaryType, owner and trust', () => {
        const groupProps = schema.properties.groups.items.properties;
        for (const field of ['kind', 'purpose', 'boundaryType', 'owner', 'trust']) {
            expect(groupProps[field], `group.${field}`).toBeDefined();
        }
    });

    it('group.kind uses the swimlane / system-boundary taxonomy from types.ts', () => {
        const enumValues = schema.properties.groups.items.properties.kind.enum ?? [];
        expect(enumValues).toEqual(expect.arrayContaining(['swimlane', 'system-boundary', 'enterprise', 'security']));
    });

    it('metadata exposes diagramType as a narrow archetype enum', () => {
        const enumValues = schema.properties.metadata.properties.diagramType.enum ?? [];
        expect(enumValues).toEqual(expect.arrayContaining([
            'c4-context', 'c4-container', 'c4-component', 'c4-deployment',
            'integration', 'bpmn-process', 'value-stream', 'data-flow',
            'deployment', 'sequence', 'erd', 'generic',
        ]));
    });
});

describe('buildIRDirectGenerationPrompt — extended metadata directive (Gap 6)', () => {
    it('explicitly asks for the extended metadata fields when evidence exists', () => {
        const prompt = buildIRDirectGenerationPrompt({
            artifact: { name: 'Test', type: 'mermaid-c4-container', objective: 'demo' } as Artifact,
            project: { description: 'Healthcare integration platform' } as Project,
            audience: 'technical',
            settings: {} as Settings,
        });
        expect(prompt).toMatch(/EXTENDED METADATA/);
        expect(prompt).toMatch(/PHI/);
        expect(prompt).toMatch(/diagramType/);
        expect(prompt).toMatch(/swimlane/);
        expect(prompt).toMatch(/never fabricate/i);
    });
});
