import { describe, expect, it } from 'vitest';
import { REVIEW_CRITIQUE_SCHEMA } from '../../services/architectureOffice/application/orchestrationSchemas';
import { readReviewCritique, renderReviewCritique } from '../../services/architectureOffice/domain/reviewCritique';
import { buildReviewPrompt } from '../../services/architectureOffice/infrastructure/officeReviewPrompt';
import type { OfficeTask } from '../../services/architectureOffice/domain/OfficeTypes';
import type { Artifact } from '../../lib/artifacts';
import { loadCorpus, runReview } from '../agent/evals/agentEvalHarness';

const task: OfficeTask = {
  id: 'review', engagementId: 'eng', title: 'Revisar', objective: 'Revisar el entregable.',
  kind: 'review-artifact', assigneeId: 'elena', dependsOn: [],
  acceptanceCriteria: ['Incluye decisión.', 'Compara alternativas.'],
  status: 'ready', attempts: 0, maxAttempts: 2,
};
const finding = { severity: 'high', message: 'Falta comparar alternativas.', criterion: 2, evidence: '  Sección Alternativas: sólo enumera SQS.  ' };
const raw = (findings: unknown[]) => ({ verdict: 'changes-requested', summary: 'Falta algo', findings });
const read = (findings: unknown[], context = task) => readReviewCritique(raw(findings), context);
const without = (key: string): Record<string, unknown> => Object.fromEntries(Object.entries(finding).filter(([name]) => name !== key));

// El corpus aporta un artefacto válido; el puerto real, no un doble del lector,
// toma la decisión y deriva si una aprobación es limpia.
const cleanCase = loadCorpus().revision.find((item) => item.aprueba)!;

describe('hallazgos de aceptación con criterio real y evidencia (#264 M2)', () => {
  it('exige criterion y evidence en cada hallazgo del esquema', () => {
    const schema = REVIEW_CRITIQUE_SCHEMA.properties?.findings?.items;
    expect(schema?.required).toEqual(expect.arrayContaining(['severity', 'message', 'criterion', 'evidence']));
    expect(schema?.properties?.criterion?.type).toBe('integer');
    expect(schema?.properties?.evidence?.type).toBe('string');
  });

  it.each([
    ['ausente', without('criterion')], ['null', { ...finding, criterion: null }],
    ['texto', { ...finding, criterion: '2' }], ['cero', { ...finding, criterion: 0 }],
    ['negativo', { ...finding, criterion: -1 }], ['fracción', { ...finding, criterion: 1.5 }],
    ['inexistente', { ...finding, criterion: 999 }], ['NaN', { ...finding, criterion: NaN }],
    ['infinito', { ...finding, criterion: Infinity }],
  ])('descarta criterion %s sin perder el motivo', (_label, item) => {
    const reading = read([item]);
    expect(reading.value?.findings).toEqual([]);
    expect(reading.discarded.join(' ')).toContain('criterion');
  });

  it.each([
    ['ausente', without('evidence')], ['null', { ...finding, evidence: null }],
    ['no textual', { ...finding, evidence: 42 }], ['vacía', { ...finding, evidence: '' }],
    ['blancos', { ...finding, evidence: ' \n\t ' }],
  ])('descarta evidence %s sin una lectura limpia', (_label, item) => {
    const reading = read([item]);
    expect(reading.value?.findings).toEqual([]);
    expect(reading.discarded.join(' ')).toContain('evidence');
  });

  it('señala ambos campos ausentes en el ejemplo del defecto', () => {
    const reading = read([{ severity: 'high', message: 'Sin criterio ni evidencia' }]);
    expect(reading.value?.verdict).toBe('changes-requested');
    expect(reading.value?.findings).toEqual([]);
    expect(reading.discarded.join(' ')).toContain('criterion');
    expect(reading.discarded.join(' ')).toContain('evidence');
  });

  it('sin criterios reales no hay ninguna referencia válida', () => {
    const reading = read([finding], { ...task, acceptanceCriteria: [] });
    expect(reading.value?.findings).toEqual([]);
    expect(reading.discarded.join(' ')).toContain('criterion');
  });

  it('acepta los ordinales existentes y normaliza evidencia no vacía', () => {
    for (const criterion of [1, 2]) {
      const reading = read([{ ...finding, criterion }]);
      expect(reading.discarded).toEqual([]);
      expect(reading.value?.findings).toEqual([{ ...finding, criterion, evidence: finding.evidence.trim() }]);
      expect(renderReviewCritique(reading.value!)).toContain(`criterio ${criterion}`);
    }
  });

  it('conserva los hallazgos válidos al descartar uno inválido', () => {
    const reading = read([finding, { ...finding, criterion: 999 }]);
    expect(reading.value?.findings).toHaveLength(1);
    expect(reading.discarded).toHaveLength(1);
  });

  it('no admite una excepción general implícita ni en prompt ni lector', () => {
    const artifact: Artifact = {
      id: 'a', versionGroupId: 'a', version: 1, createdAt: '2026-10-23T00:00:00Z',
      name: 'ADR', type: 'markdown', phase: 'Fase 2', architecturalView: 'Vista de Gestión y Soporte',
      content: '# ADR', objective: 'Decidir.', keyConcepts: [], representation: 'document',
    };
    const prompt = buildReviewPrompt(task, artifact, { findings: [], blockingValidatorIds: [], blocking: false });
    expect(prompt).toContain('1. Incluye decisión.');
    expect(prompt).toContain('2. Compara alternativas.');
    expect(prompt).not.toContain('omite «criterion»');
    expect(prompt).toContain('«criterion» y «evidence» son obligatorios');
    expect(prompt).toContain('entero');
    expect(prompt).toContain('no vacía');
    expect(read([without('criterion')]).discarded.length).toBeGreaterThan(0);
  });
});

describe('puerto canónico de revisión fail-closed', () => {
  it.each([
    { severity: 'high', message: 'Sin criterio ni evidencia' },
    { ...finding, criterion: 999 },
    { ...finding, criterion: 1, evidence: '  ' },
  ])('no presenta una aprobación con hallazgo inválido como revisión limpia: %j', async (item) => {
    const result = await runReview({
      ...cleanCase, id: 'critica-invalida', aprueba: false,
      critica: { verdict: 'approved', summary: 'Bien.', findings: [item] },
    });
    expect(result.defectoDeterminista).toBe(false);
    expect(result.aprobacionLimpia).toBe(false);
  });

  it('pasa los criterios de la tarea al lector y conserva un hallazgo válido', async () => {
    const result = await runReview({
      ...cleanCase, id: 'critica-valida', aprueba: false,
      critica: { verdict: 'changes-requested', summary: 'Corregir.', findings: [{ ...finding, criterion: 1 }] },
    });
    expect(result.veredicto).toBe('changes-requested');
    expect(result.defectoDeterminista).toBe(false);
  });

  it('una aprobación sin hallazgos sigue siendo limpia', async () => {
    const result = await runReview(cleanCase);
    expect(result.aprobacionLimpia).toBe(true);
  });
});
