/**
 * Definition, Profile and Runtime are three different things, and the seams
 * between them are the governance.
 *
 *  - **Definition** is what the agent *is*: shipped, frozen, validated.
 *  - **Profile** is what this organisation *adds*: sparse, additive, persisted
 *    per user, and unable to touch anything that would switch off a control.
 *  - **Runtime** is one task or one workstream, which names an agent and never
 *    redefines it.
 *
 * These tests pin the seams. The one that matters most is the second group: a
 * form that could make one agent produce *and* review the same artifact would
 * turn off the separation of duties with a dropdown, which is the reason an
 * architecture office exists rather than a generator.
 */

import { describe, expect, it } from 'vitest';
import {
  createAgentProfileOverride,
  resolveAgentProfile,
} from '../../services/architectureOffice/officeAgentProfile';
import { listAgents, getAgent } from '../../services/architectureOffice/agentRegistry';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';

describe('the definition is frozen', () => {
  it('cannot be mutated in place', () => {
    const agent = getAgent('felipe');
    expect(Object.isFrozen(agent)).toBe(true);
    expect(Object.isFrozen(agent.scope)).toBe(true);
    expect(Object.isFrozen(agent.capabilities)).toBe(true);
  });

  it('declares a scope with an edge, for every agent', () => {
    for (const agent of listAgents()) {
      expect(agent.scope.goals.length, agent.id).toBeGreaterThan(0);
      expect(agent.scope.nonGoals.length, agent.id).toBeGreaterThan(0);
    }
  });
});

describe('the profile adds, and never governs', () => {
  const override = (input: Record<string, unknown>) =>
    createAgentProfileOverride({ agentId: 'elena', userId: 'u1', ...input } as never);

  it('cannot change what an agent produces or reviews', () => {
    const created = override({
      alias: 'Elena Custodia',
      producesArtifactTypes: ['markdown'],
      reviewsArtifactTypes: [],
      orchestrationRole: 'coordinator',
    });
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') return;

    const resolved = resolveAgentProfile('elena', created.override);
    expect(resolved.producesArtifactTypes).toEqual(OFFICE_AGENT_PERSONAS.elena.producesArtifactTypes);
    expect(resolved.reviewsArtifactTypes).toEqual(OFFICE_AGENT_PERSONAS.elena.reviewsArtifactTypes);
    expect(resolved.orchestrationRole).toBe(OFFICE_AGENT_PERSONAS.elena.orchestrationRole);
    // What it *may* change did change.
    expect(resolved.alias).toBe('Elena Custodia');
  });

  it('cannot change an agent’s capabilities or the standards it upholds', () => {
    const created = override({ capabilities: ['orchestrate'], standardIds: ['INVENTADO'] });
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') return;
    const resolved = resolveAgentProfile('elena', created.override);
    expect(resolved.capabilities).toEqual(OFFICE_AGENT_PERSONAS.elena.capabilities);
    expect(resolved.standardIds).toEqual(OFFICE_AGENT_PERSONAS.elena.standardIds);
  });
});

describe('the profile inherits from the definition, not from a literal', () => {
  /**
   * Every agent resolved to `'default'` regardless of what it does — a
   * regulatory review and a status report asked the same model the same way,
   * and the card's tier control was the only thing that could change it.
   */
  it('takes its default model tier from the agent’s own definition', () => {
    expect(resolveAgentProfile('carmen').modelTier).toBe(OFFICE_AGENT_PERSONAS.carmen.modelTier);
    expect(resolveAgentProfile('tomas').modelTier).toBe(OFFICE_AGENT_PERSONAS.tomas.modelTier);
    expect(resolveAgentProfile('carmen').modelTier).not.toBe(resolveAgentProfile('tomas').modelTier);
  });

  it('still lets the card override the tier', () => {
    const created = createAgentProfileOverride({ agentId: 'tomas', userId: 'u1', modelTier: 'deep' });
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') return;
    expect(resolveAgentProfile('tomas', created.override).modelTier).toBe('deep');
  });

  it('stamps the contract version the card was resolved against', () => {
    for (const agent of listAgents()) {
      expect(resolveAgentProfile(agent.id).definitionVersion, agent.id).toBe(agent.version);
    }
  });
});
