/**
 * The diagram editor: a model that proposes a patch, and a preview it does not
 * get to write.
 *
 * These specs pin the four properties that make an AI edit safe to offer next
 * to a diagram somebody has already worked on: it never applies anything, it
 * never invents geometry, its account of what it did is replaced by the
 * engine's, and a provider failure leaves the diagram exactly as it was.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { generateContentWithFallback } = vi.hoisted(() => ({
    generateContentWithFallback: vi.fn(),
}));

vi.mock('../../../services/geminiService', () => ({
    geminiService: { generateContentWithFallback },
}));

vi.mock('../../../lib/ai/modelCatalog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/ai/modelCatalog')>()),
    resolveEffectiveModel: (tier: string) => ({ id: `model-${tier}` }),
}));

import { diagramEditService, MAX_PATCH_OPERATIONS } from '../../../services/ai/generation/diagramEdit/diagramEditService';
import type { DiagramIR } from '../../../lib/diagram';
import type { Settings } from '../../../types';

const settings = {
    globalContext: [],
    language: 'es',
    theme: 'light',
    aiConfig: { model: 'gemini-2.5-flash', temperature: 0.4, provider: 'gemini' },
} as unknown as Settings;

const ir = (): DiagramIR => ({
    nodes: [
        { id: 'cliente', label: 'Cliente', kind: 'person' },
        { id: 'auth', label: 'Autorización', kind: 'service' },
        { id: 'core', label: 'Core', kind: 'service' },
    ],
    edges: [
        { id: 'e1', source: 'cliente', target: 'auth', label: 'autentica' },
        { id: 'e2', source: 'auth', target: 'core', label: 'consulta' },
    ],
    groups: [],
});

const respond = (payload: unknown) =>
    generateContentWithFallback.mockResolvedValue({ text: JSON.stringify(payload) });

beforeEach(() => {
    generateContentWithFallback.mockReset();
});

describe('it refuses before it spends a call', () => {
    it('does nothing for an empty diagram', async () => {
        const result = await diagramEditService.proposeEdit({ ir: { nodes: [], edges: [], groups: [] }, instruction: 'algo' }, settings);
        expect(result.ok).toBe(false);
        expect(generateContentWithFallback).not.toHaveBeenCalled();
    });

    it('does nothing without an instruction', async () => {
        const result = await diagramEditService.proposeEdit({ ir: ir(), instruction: '   ' }, settings);
        expect(result.ok).toBe(false);
        expect(generateContentWithFallback).not.toHaveBeenCalled();
    });
});

describe('the model works in ids, and is never shown geometry', () => {
    it('hands it the ids, labels and relations it needs', async () => {
        respond({ operations: [{ op: 'update-edge', edgeId: 'e1', changes: { criticality: 'critical' } }] });
        await diagramEditService.proposeEdit({ ir: ir(), instruction: 'resalta el flujo de autorización' }, settings);
        const prompt = String(generateContentWithFallback.mock.calls[0][2]);
        expect(prompt).toContain('cliente — Cliente');
        expect(prompt).toContain('e1: cliente → auth');
        expect(prompt).toContain('resalta el flujo de autorización');
    });

    it('never puts a position in the prompt, and says so is not its job', async () => {
        const withPositions = ir();
        withPositions.nodes[0].position = { x: 420, y: 96 };
        respond({ operations: [] });
        await diagramEditService.proposeEdit({ ir: withPositions, instruction: 'mueve algo' }, settings);
        const prompt = String(generateContentWithFallback.mock.calls[0][2]);
        expect(prompt).not.toContain('420');
        expect(prompt).toContain('No describas posiciones');
    });
});

describe('it proposes and never applies', () => {
    it('returns the patch and the preview, leaving the diagram untouched', async () => {
        respond({
            rationale: 'Sube la criticidad del camino de autenticación.',
            operations: [{ op: 'update-edge', edgeId: 'e1', changes: { criticality: 'critical' } }],
        });
        const source = ir();
        const before = JSON.stringify(source);
        const result = await diagramEditService.proposeEdit({ ir: source, instruction: 'resalta la autorización' }, settings);

        expect(result.ok).toBe(true);
        expect(result.patch).toMatchObject({ source: 'ai', rationale: 'Sube la criticidad del camino de autenticación.' });
        expect(result.preview?.changed).toBe(true);
        expect(result.preview?.ir.edges.find(edge => edge.id === 'e1')?.criticality).toBe('critical');
        expect(JSON.stringify(source)).toBe(before);
    });

    it('reports the operations the engine rejected instead of hiding them', async () => {
        respond({
            operations: [
                { op: 'update-edge', edgeId: 'e1', changes: { criticality: 'critical' } },
                { op: 'remove-node', nodeId: 'no-existe' },
            ],
        });
        const result = await diagramEditService.proposeEdit({ ir: ir(), instruction: 'limpia el diagrama' }, settings);
        expect(result.ok).toBe(true);
        expect(result.preview?.applied).toHaveLength(1);
        expect(result.preview?.rejected[0]).toMatchObject({ code: 'unknown-node' });
    });

    it('fails rather than pretending when nothing the model proposed applies', async () => {
        respond({ operations: [{ op: 'remove-node', nodeId: 'fantasma' }] });
        const result = await diagramEditService.proposeEdit({ ir: ir(), instruction: 'borra el fantasma' }, settings);
        expect(result.ok).toBe(false);
        expect(result.preview?.changed).toBe(false);
        expect(result.reason).toContain('aplicable');
    });

    it('caps the proposal so an edit cannot become a rewrite', async () => {
        respond({
            operations: Array.from({ length: 30 }, (_, index) => ({
                op: 'add-node',
                node: { id: `n${index}`, label: `Nodo ${index}`, kind: 'service' },
            })),
        });
        const result = await diagramEditService.proposeEdit({ ir: ir(), instruction: 'añade de todo' }, settings);
        expect(result.patch?.operations).toHaveLength(MAX_PATCH_OPERATIONS);
    });
});

describe('it degrades, never blocks', () => {
    it('reports an uninterpretable response without throwing', async () => {
        generateContentWithFallback.mockResolvedValue({ text: 'lo siento, no puedo' });
        const result = await diagramEditService.proposeEdit({ ir: ir(), instruction: 'algo' }, settings);
        expect(result.ok).toBe(false);
        expect(result.reason).toBeTruthy();
    });

    it('carries the model reason when it declines with no operations', async () => {
        respond({ rationale: 'Ese nodo no está en el diagrama.', operations: [] });
        const result = await diagramEditService.proposeEdit({ ir: ir(), instruction: 'borra el ERP' }, settings);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('Ese nodo no está en el diagrama.');
    });

    it('reports a provider failure as unavailability, not as a broken diagram', async () => {
        generateContentWithFallback.mockRejectedValue(new Error('503'));
        const result = await diagramEditService.proposeEdit({ ir: ir(), instruction: 'algo' }, settings);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('a mano');
    });

    it('stays silent when the user cancels', async () => {
        generateContentWithFallback.mockRejectedValue(new DOMException('aborted', 'AbortError'));
        const result = await diagramEditService.proposeEdit({ ir: ir(), instruction: 'algo' }, settings);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('');
    });
});
