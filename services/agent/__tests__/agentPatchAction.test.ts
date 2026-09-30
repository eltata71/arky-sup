/**
 * El cambio puntual del agente sobre un documento es un parche, no una
 * reescritura (plan de calidad de artefactos, 7.4b).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import type { Settings } from '../../../types';

const ai = vi.hoisted(() => ({ proposeEdit: vi.fn(), runAgentTurn: vi.fn() }));
vi.mock('../../ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  documentEditService: { proposeEdit: ai.proposeEdit },
}));
vi.mock('../../ai/generation/assistant/agentTurn', () => ({
  runAgentTurn: (...args: unknown[]) => ai.runAgentTurn(...args),
  streamAgentTurn: vi.fn(),
}));

import { runArtifactPatch } from '../agentPatchAction';

const DOC = `# Registro de riesgos

## Riesgos
| Riesgo | Severidad |
| --- | --- |
| Caída de región | Alta |

## Próximos pasos
Ensayar la conmutación.
`;

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'a1', versionGroupId: 'g1', version: 1, createdAt: '2026-09-01T00:00:00.000Z',
  name: 'Registro de riesgos', type: 'markdown', phase: 'Fase 2', architecturalView: 'Vista de Gestión y Soporte',
  objective: '', keyConcepts: [], representation: 'document', content: DOC, ...overrides,
} as Artifact);
const project = { id: 'p1', name: 'P', description: '', projectContext: [], artifacts: [] } as unknown as Project;
const settings = { language: 'es', aiConfig: { model: 'm' } } as unknown as Settings;

beforeEach(() => {
  ai.proposeEdit.mockReset();
  ai.runAgentTurn.mockReset();
});

describe('runArtifactPatch', () => {
  it('«añade un riesgo» sobre un documento cambia sólo esa fila y nunca pide el documento entero', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: true, patch: { operations: [{ op: 'append-table-row', heading: 'Riesgos', cells: ['Fuga de PHI', 'Alta'] }] } });
    const outcome = await runArtifactPatch({ artifact: artifact(), project, settings, history: [], instruction: 'Añade el riesgo de fuga de PHI' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.content.split('\n').filter((line) => !DOC.split('\n').includes(line))).toEqual(['| Fuga de PHI | Alta |']);
    expect(outcome.changes).toEqual(['Tabla de «Riesgos»: fila añadida.']);
    expect(ai.runAgentTurn).not.toHaveBeenCalled();
    const [request] = ai.proposeEdit.mock.calls[0];
    expect(request.outline).toEqual(['# Registro de riesgos', '## Riesgos', '## Próximos pasos']);
  });

  it('una propuesta que no se puede aplicar se explica y no escribe nada', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: true, patch: { operations: [{ op: 'replace-section', heading: 'Glosario', body: 'x' }] } });
    const outcome = await runArtifactPatch({ artifact: artifact(), project, settings, history: [], instruction: 'Cambia el glosario' });
    expect(outcome).toEqual({ ok: false, message: expect.stringContaining('No existe una sección «Glosario»') });
  });

  it('un documento largo también se cambia por parche: ya no hay límite de reescritura', async () => {
    const long = `${DOC}\n## Anexo\n${'Texto del anexo. '.repeat(4000)}`;
    ai.proposeEdit.mockResolvedValue({ ok: true, patch: { operations: [{ op: 'append-table-row', heading: 'Riesgos', cells: ['Fraude', 'Media'] }] } });
    const outcome = await runArtifactPatch({ artifact: artifact({ content: long }), project, settings, history: [], instruction: 'Añade fraude' });
    expect(outcome.ok).toBe(true);
  });
});
