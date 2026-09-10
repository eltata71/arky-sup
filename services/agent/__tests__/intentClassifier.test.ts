import { describe, it, expect } from 'vitest';
import { classifyAgentIntent } from '../intentClassifier';
import type { AgentContext } from '../agentTypes';
import type { Artifact } from '../../../types';

const FAKE_ARTIFACT: Artifact = {
  id: 'art-1',
  versionGroupId: 'grp-1',
  version: 1,
  createdAt: new Date().toISOString(),
  name: 'Diagrama de Contexto',
  type: 'mermaid-c4-context',
  phase: 'Análisis',
  architecturalView: 'Vista de Contexto y Negocio',
  content: 'graph TD\n  A --> B',
  objective: 'Test',
  keyConcepts: [],
  representation: 'diagram',
};

const ctx = (overrides: Partial<AgentContext> = {}): AgentContext => ({
  artifact: FAKE_ARTIFACT,
  viewMode: 'diagram',
  history: [],
  hasPendingSuggestions: false,
  ...overrides,
});

describe('classifyAgentIntent', () => {
  it('returns unknown when there is no active artifact', () => {
    const intent = classifyAgentIntent('Mejora este artefacto', ctx({ artifact: null }));
    expect(intent.type).toBe('unknown');
    expect(intent.confidence).toBe(0);
  });

  it('classifies regeneration commands', () => {
    const intent = classifyAgentIntent('Regenera este diagrama con lo que conversamos', ctx());
    expect(intent.type).toBe('artifact.regenerate');
    expect(intent.confidence).toBeGreaterThan(0.7);
    expect(intent.impact).toBe('high');
    expect(intent.requiresConfirmation).toBe(true);
  });

  it('classifies "vuelve a crear" as regeneration', () => {
    const intent = classifyAgentIntent('vuelve a crear este artefacto', ctx());
    expect(intent.type).toBe('artifact.regenerate');
  });

  it('classifies improvement commands', () => {
    const intent = classifyAgentIntent('Mejora este artefacto incorporando las mejores prácticas', ctx());
    expect(intent.type).toBe('artifact.improve');
    expect(intent.suggestedTarget).toBe('new_version');
  });

  it('classifies "Mejóralo" as improvement', () => {
    const intent = classifyAgentIntent('mejóralo por favor', ctx());
    expect(intent.type).toBe('artifact.improve');
  });

  it('classifies patch commands with specific change requests', () => {
    const intent = classifyAgentIntent(
      'Cambia el nombre del nodo plataforma-pbm-weecompany por Plataforma PBM WeeCompany',
      ctx(),
    );
    expect(intent.type).toBe('artifact.patch');
    expect(intent.suggestedTarget).toBe('new_version');
  });

  it('classifies suggestion application', () => {
    const intent = classifyAgentIntent('Aplica todas las recomendaciones al artefacto', ctx({ hasPendingSuggestions: true }));
    expect(intent.type).toBe('artifact.applySuggestion');
  });

  it('downgrades suggestion intent confidence when no suggestions are loaded', () => {
    const intent = classifyAgentIntent('Aplica estas sugerencias al artefacto', ctx({ hasPendingSuggestions: false }));
    expect(intent.type).toBe('artifact.applySuggestion');
    expect(intent.confidence).toBeLessThan(0.6);
  });

  it('detects explicit "sobrescribir actual" instructions', () => {
    const intent = classifyAgentIntent('Mejora este artefacto en el mismo sin crear nueva versión', ctx());
    expect(intent.suggestedTarget).toBe('current');
  });

  it('returns unknown for purely informational questions', () => {
    const intent = classifyAgentIntent('¿Qué representa este diagrama?', ctx());
    expect(['unknown', 'artifact.explainOnly']).toContain(intent.type);
  });

  it('classifies explicit version creation requests', () => {
    const intent = classifyAgentIntent('Crea una nueva versión con esto', ctx());
    expect(intent.type).toBe('artifact.createVersion');
    expect(intent.impact).toBe('low');
  });

  it('preserves the raw user instruction', () => {
    const message = 'Regenera el diagrama usando microservicios';
    const intent = classifyAgentIntent(message, ctx());
    expect(intent.userInstruction).toBe(message);
  });

  it('binds the intent to the active artifact', () => {
    const intent = classifyAgentIntent('Regenera esto', ctx());
    expect(intent.artifactId).toBe(FAKE_ARTIFACT.id);
    expect(intent.artifactVersionGroupId).toBe(FAKE_ARTIFACT.versionGroupId);
  });

  it('does not classify when input is empty or whitespace', () => {
    expect(classifyAgentIntent('', ctx()).type).toBe('unknown');
    expect(classifyAgentIntent('   ', ctx()).type).toBe('unknown');
  });

  describe('batch (multi-artifact) classification', () => {
    it('detects "aplica esta mejora en todos los diagramas C4"', () => {
      const intent = classifyAgentIntent('Aplica esta convención en todos los diagramas C4 del proyecto', ctx());
      expect(intent.type).toBe('artifacts.batch');
      expect(intent.batchScope?.matcher.kind).toBe('type');
      if (intent.batchScope?.matcher.kind === 'type') {
        expect(intent.batchScope.matcher.type).toContain('c4');
      }
    });

    it('routes "cambia/renombra/corrige" to a patch sub-action', () => {
      const intent = classifyAgentIntent('Cambia el nombre del módulo en todos los artefactos', ctx());
      expect(intent.type).toBe('artifacts.batch');
      expect(intent.batchScope?.subAction).toBe('artifact.patch');
    });

    it('routes generic "aplica/mejora" to an improve sub-action', () => {
      const intent = classifyAgentIntent('Aplica esta recomendación en todos los artefactos del proyecto', ctx());
      expect(intent.type).toBe('artifacts.batch');
      expect(intent.batchScope?.subAction).toBe('artifact.improve');
    });

    it('marks batch as high impact', () => {
      const intent = classifyAgentIntent('Propaga este cambio en todos los diagramas', ctx());
      expect(intent.type).toBe('artifacts.batch');
      expect(intent.impact).toBe('high');
    });
  });

  describe('artifact.create intent', () => {
    it('classifies "crea un diagrama..." as a creation intent even without active artifact', () => {
      const intent = classifyAgentIntent(
        'Crea un diagrama de integración entre WeeCompany PBM, SIMASEC y GMD',
        ctx({ artifact: null }),
      );
      expect(intent.type).toBe('artifact.create');
      expect(intent.confidence).toBeGreaterThan(0.6);
      expect(intent.requiresConfirmation).toBe(true);
      expect(intent.impact).toBe('high');
      // Catalog matcher should attach a hint when something maps
      expect(intent.createHint).toBeDefined();
      expect(intent.createHint?.objective).toContain('WeeCompany');
    });

    it('classifies "genera un resumen ejecutivo" as create', () => {
      const intent = classifyAgentIntent('Genera un resumen ejecutivo del proyecto', ctx({ artifact: null }));
      expect(intent.type).toBe('artifact.create');
    });

    it('classifies "haz un documento de visión" as create', () => {
      const intent = classifyAgentIntent('Haz un documento de visión de la arquitectura', ctx({ artifact: null }));
      expect(intent.type).toBe('artifact.create');
    });

    it('does not match arbitrary chat as create', () => {
      const intent = classifyAgentIntent('explícame qué hace este sistema', ctx({ artifact: null }));
      expect(intent.type).not.toBe('artifact.create');
    });
  });
});
