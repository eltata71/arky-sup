/**
 * The registry is the single answer to "which agent?", and the definitions are
 * checkable rather than merely written down.
 *
 * The reason both matter is the same defect, twice: the agent's card offered a
 * model tier and a capacity, the engine read neither, and nothing in the type
 * system noticed — because there was no contract to check against and no single
 * place that owned the lookup. Three modules each filtered
 * `OFFICE_AGENT_PERSONAS` their own way, which is how the Office ended up with
 * two routing tables that disagreed about who handles "Health Cloud".
 */

import { describe, expect, it } from 'vitest';
import {
  agentRegistry,
  canDelegate,
  canTakeWorkstream,
  delegationTargets,
  findAgentsByCapability,
  findAgentsByDomain,
  findAgentsThatProduce,
  findAgentsThatReview,
  getAgent,
  listAgents,
  validateAgentDefinition,
  validateAgentRegistry,
  workstreamCapableAgents,
} from '../../services/architectureOffice/agentRegistry';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';
import type { OfficeAgentPersona } from '../../services/architectureOffice/agentDefinition';

const clone = (over: Partial<OfficeAgentPersona> = {}): OfficeAgentPersona => ({
  ...OFFICE_AGENT_PERSONAS.felipe,
  ...over,
});

describe('AgentRegistry · lookup', () => {
  it('returns a definition for every id in the union', () => {
    for (const agent of listAgents()) {
      expect(getAgent(agent.id).id).toBe(agent.id);
    }
    expect(listAgents()).toHaveLength(13);
  });

  it('finds agents by declared capability', () => {
    expect(findAgentsByCapability('orchestrate').map((a) => a.id)).toEqual(['lucia']);
    expect(findAgentsByCapability('consolidate').map((a) => a.id)).toEqual(['alejandro']);
    expect(findAgentsByCapability('consult').length).toBeGreaterThan(10);
  });

  /**
   * Domains answer "whose job is this"; the router's signals answer "does this
   * sentence smell like this". Conflating them is what let a regex decide who
   * was qualified.
   */
  it('finds agents by domain, not by routing signal', () => {
    expect(findAgentsByDomain('aws').map((a) => a.id)).toContain('felipe');
    expect(findAgentsByDomain('AWS').map((a) => a.id)).toContain('felipe');
    expect(findAgentsByDomain('')).toEqual([]);
    expect(findAgentsByDomain('inexistente')).toEqual([]);
  });

  it('finds producers and reviewers of an artifact type', () => {
    expect(findAgentsThatProduce('mermaid-erd').map((a) => a.id)).toContain('daniel');
    expect(findAgentsThatReview('sdd-nfr').map((a) => a.id)).toContain('carmen');
  });

  it('exposes the same functions through the namespace object', () => {
    // A namespace that re-implemented its members would be the second copy this
    // registry exists to remove.
    expect(agentRegistry.get).toBe(getAgent);
    expect(agentRegistry.findByCapability).toBe(findAgentsByCapability);
    expect(agentRegistry.canDelegate).toBe(canDelegate);
    expect(agentRegistry.validate).toBe(validateAgentRegistry);
  });
});

describe('AgentRegistry · delegation', () => {
  it('lets the coordinator hand work to a specialist', () => {
    expect(canDelegate('lucia', 'felipe')).toBe(true);
    expect(canDelegate('lucia', 'carmen')).toBe(true);
  });

  /** Separation of duties, expressed for delegation. */
  it('never lets an agent delegate to itself', () => {
    for (const agent of listAgents()) {
      expect(canDelegate(agent.id, agent.id), agent.id).toBe(false);
    }
  });

  it('does not let a specialist delegate at all — that is what bounds the depth', () => {
    expect(canDelegate('felipe', 'mauricio')).toBe(false);
    expect(canDelegate('carmen', 'felipe')).toBe(false);
    expect(delegationTargets('felipe')).toEqual([]);
  });

  it('does not let the consolidator or the generalist hand out work', () => {
    expect(canDelegate('alejandro', 'felipe')).toBe(false);
    expect(canDelegate('arky', 'felipe')).toBe(false);
  });

  it('refuses a target that cannot take a workstream', () => {
    expect(canDelegate('lucia', 'alejandro')).toBe(false);
    expect(canDelegate('lucia', 'arky')).toBe(false);
    expect(canDelegate('lucia', 'lucia')).toBe(false);
  });

  it('lists exactly the specialists as the coordinator’s targets', () => {
    expect(delegationTargets('lucia').map((a) => a.id))
      .toEqual(workstreamCapableAgents().map((a) => a.id));
  });
});

describe('validateAgentDefinition', () => {
  /** The gate that matters: the shipped roster is coherent. */
  it('accepts every agent the product ships', () => {
    for (const agent of listAgents()) {
      expect(validateAgentDefinition(agent), agent.id).toEqual([]);
    }
  });

  it('rejects a definition with no identity', () => {
    const codes = validateAgentDefinition(clone({ alias: '  ' })).map((i) => i.code);
    expect(codes).toContain('missing-identity');
  });

  it('rejects an agent with no declared goals', () => {
    const codes = validateAgentDefinition(clone({ scope: { goals: [], nonGoals: [] } }))
      .map((i) => i.code);
    expect(codes).toContain('empty-scope');
  });

  /**
   * The pair that would otherwise fail at runtime: a persona ranked by the
   * router and then found unable to author anything, and a persona doing work
   * its own contract says it may not.
   */
  it('rejects `generate` with nothing to produce, and producing with no authoring verb', () => {
    expect(validateAgentDefinition(clone({ producesArtifactTypes: [] })).map((i) => i.code))
      .toContain('capability-without-output');
    expect(
      validateAgentDefinition(clone({ capabilities: ['consult', 'validate'] })).map((i) => i.code),
    ).toContain('output-without-capability');
  });

  /**
   * `generate` is not the only way to author something, and assuming it was is
   * what this validation caught on its first run: Alejandro consolidates into
   * an executive presentation and Tomás reports into a status document. Both
   * were flagged, and the rule was what needed fixing, not the roster.
   */
  it('accepts consolidating and reporting as authoring, not only generating', () => {
    for (const capability of ['consolidate', 'report'] as const) {
      const codes = validateAgentDefinition(
        clone({ capabilities: ['consult', 'validate', capability] }),
      ).map((i) => i.code);
      expect(codes, capability).not.toContain('output-without-capability');
    }
  });

  it('rejects a reviewer that never declared `validate`', () => {
    const codes = validateAgentDefinition(
      clone({ capabilities: ['consult', 'generate'], reviewsArtifactTypes: ['markdown'] }),
    ).map((i) => i.code);
    expect(codes).toContain('reviewer-without-capability');
  });

  it('rejects a specialist that cannot consult', () => {
    const codes = validateAgentDefinition(
      clone({ capabilities: ['generate', 'validate'] }),
    ).map((i) => i.code);
    expect(codes).toContain('participant-cannot-consult');
  });

  it('rejects a coordinator that authors deliverables', () => {
    const codes = validateAgentDefinition(
      clone({ ...OFFICE_AGENT_PERSONAS.lucia, producesArtifactTypes: ['markdown'] }),
    ).map((i) => i.code);
    expect(codes).toContain('coordinator-authors');
  });

  it('rejects a nonsensical capacity or version', () => {
    expect(validateAgentDefinition(clone({ maxConcurrentTasks: 0 })).map((i) => i.code))
      .toContain('invalid-concurrency');
    expect(validateAgentDefinition(clone({ version: 0 })).map((i) => i.code))
      .toContain('invalid-version');
  });
});

describe('validateAgentRegistry', () => {
  /**
   * The whole-roster gate. It covers what a per-agent check cannot see: an
   * artifact type somebody can author and nobody independent can review would
   * produce a charter whose review task has no eligible assignee.
   */
  it('reports nothing wrong with the shipped roster', () => {
    expect(validateAgentRegistry()).toEqual([]);
  });

  it('keeps exactly one coordinator and one consolidator', () => {
    const roles = listAgents().map((agent) => agent.orchestrationRole);
    expect(roles.filter((role) => role === 'coordinator')).toHaveLength(1);
    expect(roles.filter((role) => role === 'consolidator')).toHaveLength(1);
  });

  it('has an independent reviewer for every producible artifact type', () => {
    for (const type of new Set(listAgents().flatMap((a) => a.producesArtifactTypes))) {
      const producers = findAgentsThatProduce(type);
      const independent = findAgentsThatReview(type).filter(
        (reviewer) => producers.length > 1 || producers[0]?.id !== reviewer.id,
      );
      expect(independent.length, `nadie independiente revisa ${type}`).toBeGreaterThan(0);
    }
  });
});

describe('the agent contract reaches the engine', () => {
  it('gives each agent its own default model tier, not one literal for all', () => {
    const tiers = new Set(listAgents().map((agent) => agent.modelTier));
    expect(tiers.size).toBeGreaterThan(1);
    expect(getAgent('carmen').modelTier).toBe('deep');
    expect(getAgent('tomas').modelTier).toBe('quick');
  });

  it('agrees with the router about who may take a workstream', () => {
    for (const agent of listAgents()) {
      expect(canTakeWorkstream(agent), agent.id).toBe(
        agent.orchestrationRole === 'participant' && agent.capabilities.includes('consult'),
      );
    }
  });
});
