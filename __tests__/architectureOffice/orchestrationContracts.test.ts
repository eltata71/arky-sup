import { describe, expect, it } from 'vitest';
import {
  applyCoordinationBrief,
  evaluateRecommendationFields,
  readCoordinationBrief,
  readRecommendation,
  readSpecialistAnalysis,
  renderRecommendation,
} from '../../services/architectureOffice/domain/orchestrationContracts';
import {
  executeOfficeOrchestration,
  planOfficeWorkstreams,
} from '../../services/architectureOffice/application/officeOrchestration';

const analysis = JSON.stringify({
  summary: 'Resumen', findings: [{ text: 'Hallazgo', severity: 'high' }], assumptions: ['a'],
  risks: ['r'], decisions: ['d'], outOfScope: [], evidence: ['e'], confidence: 'medium',
});
const recommendation = (verdict: string, extra: object = {}) => JSON.stringify({
  verdict, rationale: 'Porque sí', contributions: [], contradictions: [], conditions: [], openQuestions: [], ...extra,
});

describe('contratos de orquestación (18.0)', () => {
  it('lee un análisis válido y descarta lo ilegible sin inventar', () => {
    expect(readSpecialistAnalysis(JSON.parse(analysis)).value?.findings[0].severity).toBe('high');
    expect(readSpecialistAnalysis('texto').value).toBeNull();
  });

  it('una recomendación sin veredicto válido no se lee', () => {
    expect(readRecommendation(JSON.parse(recommendation('maybe'))).value).toBeNull();
    const ok = readRecommendation(JSON.parse(recommendation('conditional'))).value;
    expect(ok?.verdict).toBe('conditional');
    expect(renderRecommendation(ok!)).toMatch(/Conditional/i);
  });

  it('el brief nunca deja el equipo vacío', () => {
    const plan = planOfficeWorkstreams('@Lucía coordina AWS y MuleSoft');
    const everyone = readCoordinationBrief({ summary: 's', order: [], dependencies: [], extraConstraints: [],
      dropWorkstreams: plan.workstreams.map((w) => w.id) }).value;
    expect(applyCoordinationBrief(everyone, plan.workstreams).keep).toHaveLength(plan.workstreams.length);
  });

  it('exige declarar la parcialidad si un especialista falló', () => {
    const plan = planOfficeWorkstreams('@Lucía coordina AWS y MuleSoft');
    const reading = readRecommendation(JSON.parse(recommendation('ready'))).value!;
    const results = plan.workstreams.map((w, i) => ({
      ...w, status: i === 0 ? 'failed' : 'completed', output: 'x',
    })) as never;
    expect(evaluateRecommendationFields(reading, results).join(' ')).toMatch(/no entregaron/);
  });
});

describe('executeOfficeOrchestration con contratos', () => {
  it('conserva el texto y explica la degradación cuando la respuesta no es JSON', async () => {
    const plan = planOfficeWorkstreams('@Lucía coordina AWS y MuleSoft');
    const result = await executeOfficeOrchestration(plan, async (id) => `texto-${id}`);
    expect(result.consolidation).toBe('texto-alejandro');
    expect(result.recommendation).toBeUndefined();
    expect(result.structuredDegraded?.length).toBeGreaterThan(0);
  });

  it('lee el JSON válido como datos y entrega el markdown renderizado', async () => {
    const plan = planOfficeWorkstreams('@Lucía coordina AWS y MuleSoft');
    const result = await executeOfficeOrchestration(plan, async (id) => {
      if (id === 'lucia') return JSON.stringify({ summary: 'Brief', order: [], dependencies: [], dropWorkstreams: [], extraConstraints: ['Sin nube pública'] });
      if (id === 'alejandro') return recommendation('blocked', { openQuestions: ['¿Falta algo?'] });
      return analysis;
    });
    expect(result.coordinationBrief?.summary).toBe('Brief');
    expect(result.recommendation?.verdict).toBe('blocked');
    expect(Object.keys(result.analyses ?? {})).toHaveLength(plan.workstreams.length);
    expect(result.workstreamResults[0].output).toContain('Resumen');
  });
});
