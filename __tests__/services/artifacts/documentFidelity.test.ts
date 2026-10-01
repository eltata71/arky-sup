/**
 * Un documento se comprueba contra la solicitud y se corrige una vez como
 * máximo (plan de calidad de artefactos, 7.4c).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactTemplate, Settings } from '../../../types';
import type { Project } from '../../../services/architectureProjects';

const ai = vi.hoisted(() => ({ proposeEdit: vi.fn() }));
vi.mock('../../../services/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  documentEditService: { proposeEdit: ai.proposeEdit },
}));

import { checkDocumentFidelity, describeFidelityGaps } from '../../../services/artifacts/application/documentFidelity';
import { reviewDocumentFidelity } from '../../../services/artifacts/application/documentFidelityReview';

const ADR = `# ADR-007: Mensajería para autorizaciones

## Estado
Propuesta.

## Contexto
Las autorizaciones se encadenan de forma síncrona y superan los 40 segundos.

## Decisión
Se adopta un bus de eventos gestionado.

## Alternativas consideradas
| Opción | Resultado |
| --- | --- |
| Síncrona | Descartada |
`;

const template = (overrides: Partial<ArtifactTemplate> = {}): ArtifactTemplate => ({
  name: 'Registro de Decisiones Arquitectónicas (ADR)',
  type: 'markdown',
  phase: 'Fase 3',
  architecturalView: 'Vista de Gestión y Soporte',
  objective: 'Documentar decisiones',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
} as ArtifactTemplate);

const project = { id: 'p1', name: 'P', description: '', projectContext: [], artifacts: [] } as unknown as Project;
const settings = { language: 'es', aiConfig: { model: 'm' } } as unknown as Settings;

beforeEach(() => ai.proposeEdit.mockReset());

describe('checkDocumentFidelity', () => {
  it('marca la sección que la disciplina exige y falta, los nombres pedidos y el resumen ejecutivo', () => {
    const report = checkDocumentFidelity({
      templateName: 'Registro de Decisiones Arquitectónicas (ADR)',
      content: ADR,
      request: { userRequest: 'Decide la mensajería para el «Motor de Coberturas»', audience: 'executive', acceptanceCriteria: ['Compara costos de licenciamiento'] },
    });
    const warnings = report.warnings.map((check) => `${check.kind}:${check.target}:${check.fixable}`);
    expect(warnings).toEqual([
      'section:Consecuencias:true',
      'entity:Motor de Coberturas:true',
      'audience:audiencia ejecutiva:true',
      'criterion:Compara costos de licenciamiento:false',
    ]);
    expect(report.score).toBeGreaterThan(0);
  });

  it('un criterio nunca se manda a corregir: perseguir palabras hace que el modelo escriba palabras', () => {
    const report = checkDocumentFidelity({
      templateName: 'Un documento libre', content: '# Nota\n\nTexto.', request: { acceptanceCriteria: ['Incluye la matriz de riesgos'] },
    });
    expect(report.warnings).toHaveLength(1);
    expect(describeFidelityGaps(report)).toBeNull();
  });
});

describe('reviewDocumentFidelity', () => {
  it('corrige una vez, y conserva la corrección porque cierra la brecha sin perder nada', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: true, patch: { operations: [{ op: 'insert-section', after: 'Alternativas consideradas', heading: 'Consecuencias', body: 'Escala en campaña; exige operar un bus nuevo.' }] } });
    const review = (await reviewDocumentFidelity({ template: template(), content: ADR, project, settings }))!;
    expect(ai.proposeEdit).toHaveBeenCalledTimes(1);
    expect(review.corrected).toBe(true);
    expect(review.content).toContain('## Consecuencias');
    expect(review.warning).toBeNull();
  });

  it('descarta una corrección que no cierra nada, conserva el original y lo dice a la persona', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: true, patch: { operations: [{ op: 'replace-section', heading: 'Contexto', body: 'Otro contexto distinto.' }] } });
    const review = (await reviewDocumentFidelity({ template: template(), content: ADR, project, settings }))!;
    expect(review.corrected).toBe(false);
    expect(review.content).toBe(ADR);
    expect(review.warning).toMatch(/Falta la sección «Consecuencias»/);
  });

  it('no llama al modelo cuando no hay nada que se pueda corregir', async () => {
    const complete = `${ADR}\n## Consecuencias\nEscala en campaña.\n`;
    const review = (await reviewDocumentFidelity({ template: template(), content: complete, project, settings }))!;
    expect(ai.proposeEdit).not.toHaveBeenCalled();
    expect(review.warning).toBeNull();
  });
});
