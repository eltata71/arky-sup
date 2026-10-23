import { describe, expect, it } from 'vitest';
import {
  applyContextPolicy,
  compactAnalysisForConsolidator,
  describeContextManifest,
  estimateTokens,
} from '../../services/architectureOffice/domain/agentContextPolicy';
import { executeOfficeOrchestration, planOfficeWorkstreams } from '../../services/architectureOffice/application/officeOrchestration';

const ref = (kind: 'record' | 'workstream-result' | 'coordination-brief', label: string, content: string) => ({ kind, label, content });

describe('política de contexto por rol (19.1)', () => {
  it('descarta lo que el rol no lee y lo dice', () => {
    const { references, manifest } = applyContextPolicy('consolidator', [ref('coordination-brief', 'Brief', 'x'), ref('record', 'Solicitud', 'hola')]);
    expect(references.map((r) => r.label)).toEqual(['Solicitud']);
    expect(manifest.dropped[0]).toMatch(/no lee coordination-brief/);
  });

  it('recorta una referencia que excede el tope por referencia', () => {
    const { references, manifest } = applyContextPolicy('consolidator', [ref('workstream-result', 'W1', 'a'.repeat(5000))]);
    expect(estimateTokens(references[0].content)).toBeLessThan(600);
    expect(manifest.entries[0].truncated).toBe(true);
  });

  it('respeta el presupuesto total', () => {
    const many = Array.from({ length: 20 }, (_, i) => ref('workstream-result', `W${i}`, 'b'.repeat(1900)));
    const { manifest } = applyContextPolicy('consolidator', many);
    expect(manifest.totalTokens).toBeLessThanOrEqual(4000);
    expect(manifest.dropped.length).toBeGreaterThan(0);
    expect(describeContextManifest(manifest)).toMatch(/^\[ctx:consolidator/);
  });

  it('compacta un análisis a lo que pesa en el veredicto', () => {
    const text = compactAnalysisForConsolidator({
      summary: 'Resumen', confidence: 'high',
      findings: [{ text: 'bajo', severity: 'low' }, { text: 'alto', severity: 'high' }, { text: 'm1', severity: 'medium' }, { text: 'm2', severity: 'medium' }],
      assumptions: ['supuesto'], risks: ['r1', 'r2', 'r3'], decisions: [], outOfScope: [{ text: 'x', belongsTo: 'sofia' }], evidence: ['evidencia larga'],
    });
    expect(text).toContain('[high] alto');
    expect(text).not.toContain('bajo');
    expect(text).toContain('(+1 más)');
    expect(text).not.toContain('supuesto');
    expect(text).not.toContain('evidencia larga');
  });

  it('el consolidador no recibe el output completo del especialista', async () => {
    const marker = 'EVIDENCIA-COMPLETA-NO-DEBE-LLEGAR';
    const analysis = JSON.stringify({
      summary: 'Resumen corto', findings: [{ text: 'hallazgo', severity: 'high' }], assumptions: [], risks: [], decisions: [], outOfScope: [],
      evidence: [marker], confidence: 'medium',
    });
    const plan = planOfficeWorkstreams('Lucía coordina una revisión de arquitectura.');
    plan.workstreams = [{ id: 'ws-1', personaId: 'carmen', objective: 'Revisar', acceptanceCriteria: ['Evidencia'] }];
    let consolidatorPrompt = '';
    const result = await executeOfficeOrchestration(plan, async (personaId, prompt) => {
      if (personaId === 'alejandro') { consolidatorPrompt = prompt; return '## Recomendación\n\nVeredicto: **Ready**. Se integra el análisis de Carmen en una recomendación completa y suficiente para el comité.'; }
      if (personaId === 'lucia') return 'Brief';
      return analysis;
    }, { maxConsolidationRefinements: 0 });
    expect(consolidatorPrompt).toContain('Resumen corto');
    expect(consolidatorPrompt).not.toContain(marker);
    expect(result.invocations?.some((i) => i.contextManifest)).toBe(true);
  });
});
