/**
 * La vertical que pide al modelo un parche de documento, nunca el documento
 * (plan de calidad de artefactos, 7.4b).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../types';
import { UNTRUSTED_FENCE_OPEN } from '../../../lib/untrustedContent';

const gateway = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('../../../services/ai/generation/aiGateway', () => ({ aiGateway: gateway }));

import { documentEditService } from '../../../services/ai/generation/documentEdit/documentEditService';

const settings = { language: 'es', aiConfig: { model: 'gemini-2.5-flash' } } as unknown as Settings;
const DOC = '# Plan\n\n## Riesgos\n| Riesgo | Severidad |\n| --- | --- |\n| Caída | Alta |\n\n## Anexo\nTexto.';

beforeEach(() => gateway.generateContent.mockReset());

describe('documentEditService.proposeEdit', () => {
  it('pide operaciones sobre el índice, con el documento y la petición cercados', async () => {
    gateway.generateContent.mockResolvedValue({ text: JSON.stringify({ rationale: 'Añade un riesgo', operations: [{ op: 'append-table-row', heading: 'Riesgos', cells: ['Fraude', 'Media'] }, { op: 'reescribir' }] }) });
    const result = await documentEditService.proposeEdit({ content: DOC, outline: ['# Plan', '## Riesgos', '## Anexo'], instruction: 'Añade el riesgo de fraude' }, settings);
    expect(result.ok).toBe(true);
    expect(result.patch?.operations).toEqual([{ op: 'append-table-row', heading: 'Riesgos', cells: ['Fraude', 'Media'] }]);
    const prompt = gateway.generateContent.mock.calls[0][2] as string;
    expect(prompt).toContain('- ## Riesgos');
    expect(prompt).toContain(`${UNTRUSTED_FENCE_OPEN} documento`);
    expect(prompt).toContain(`${UNTRUSTED_FENCE_OPEN} petición`);
  });

  it('de un documento largo muestra sólo las secciones de las que habla la petición', async () => {
    gateway.generateContent.mockResolvedValue({ text: '{"operations":[]}' });
    const long = `# Plan\n\n## Riesgos regulatorios\nHIPAA y retención.\n\n## Anexo técnico\n${'relleno '.repeat(8000)}`;
    await documentEditService.proposeEdit({ content: long, outline: ['# Plan', '## Riesgos regulatorios', '## Anexo técnico'], instruction: 'Amplía los riesgos regulatorios' }, settings);
    const prompt = gateway.generateContent.mock.calls[0][2] as string;
    expect(prompt).toContain('SECCIONES RELEVANTES');
    expect(prompt).toContain('HIPAA y retención');
    expect(prompt.length).toBeLessThan(long.length);
  });

  it('sin operaciones devuelve el motivo del modelo, y un fallo no lanza', async () => {
    gateway.generateContent.mockResolvedValueOnce({ text: '{"rationale":"No hay tabla de costes","operations":[]}' });
    expect(await documentEditService.proposeEdit({ content: DOC, outline: [], instruction: 'x' }, settings))
      .toMatchObject({ ok: false, reason: 'No hay tabla de costes' });
    gateway.generateContent.mockRejectedValueOnce(new Error('503'));
    expect((await documentEditService.proposeEdit({ content: DOC, outline: [], instruction: 'x' }, settings)).ok).toBe(false);
  });
});
