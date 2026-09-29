/**
 * El porqué de un proyecto llega a todo camino que genera (plan de diagramas,
 * 6.5): la regla de qué iniciativas atiende es la del portafolio, y el agente
 * la recibe como dato porque no puede buscarla.
 */
import { describe, expect, it } from 'vitest';
import { describeAttentionMotivation, initiativesServedBy } from '../../services/portfolioGraph';
import { buildInitiative } from '../../services/businessInitiatives';
import { agentGenerationOptions } from '../../services/agent/agentPersonaComposer';
import type { Project } from '../../services/architectureProjects';

const NOW = '2026-09-29T12:00:00.000Z';
const need = buildInitiative({ title: 'Autoservicio de siniestros', need: 'Reducir el tiempo de pago', code: 'NEG-2026-007' }, 'u1', [], NOW);
const other = buildInitiative({ title: 'Otra', need: 'Otra necesidad', code: 'NEG-2026-008' }, 'u1', [], NOW);
const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Portal', description: '', projectContext: [], artifacts: [], createdAt: NOW, updatedAt: NOW,
  initiativeIds: [need.id], ...over,
} as Project);

describe('describeAttentionMotivation', () => {
  it('lee sólo las iniciativas que el proyecto atiende, por id', () => {
    expect(initiativesServedBy(project(), [need, other]).map((i) => i.id)).toEqual([need.id]);
    const [motivation] = describeAttentionMotivation(project(), [need, other]);
    expect(motivation.title).toBe('Autoservicio de siniestros');
    expect(motivation.need).toBe('Reducir el tiempo de pago');
  });

  it('un proyecto sin iniciativa no inventa motivación', () => {
    expect(describeAttentionMotivation(project({ initiativeIds: [] }), [need])).toEqual([]);
  });
});

describe('agentGenerationOptions', () => {
  it('lleva la motivación cuando la hay y no añade la clave cuando no', () => {
    const motivation = describeAttentionMotivation(project(), [need]);
    expect(agentGenerationOptions(undefined, motivation).businessMotivation).toEqual(motivation);
    expect(agentGenerationOptions(undefined, [])).not.toHaveProperty('businessMotivation');
    expect(agentGenerationOptions()).not.toHaveProperty('businessMotivation');
  });
});
