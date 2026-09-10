/**
 * What this organisation configured its agents to be, for one run.
 *
 * Two things the agent cards have always offered and the engine never read:
 * how many tasks an agent may take at once, and which model tier answers for
 * it. Raising Elena's capacity or moving Carmen to a deeper tier changed a
 * number on a screen and nothing else — the runner read
 * `OFFICE_AGENT_PERSONAS[id].maxConcurrentTasks` (the shipped default) and the
 * coordination invoker asked for no tier at all.
 *
 * It lives here rather than in `OfficeContext` for the reason every other
 * `application/` module does: deciding what a run is configured with is a
 * domain question, and a file under `context/` whose job is rendering should
 * not be the one answering it. It also keeps the profile repository off the
 * provider tree's static import graph — the context reaches this through the
 * same dynamic import that already defers the runner.
 */

import type { ModelTier } from '../../../lib/ai/modelCatalog';
import type { OfficeAgentId } from '../officeAgentPersonas';
import {
  resolveAgentProfiles,
  type OfficeAgentProfileOverride,
} from '../officeAgentProfile';
import { officeAgentProfileRepository } from '../OfficeAgentProfileRepository';

export interface OfficeAgentConfiguration {
  /** Capacity per agent, keyed by id. Empty means "use the shipped defaults". */
  concurrency: ReadonlyMap<string, number>;
  /** Model tier per agent. A missing entry lets the engine pick its own. */
  tiers: Partial<Record<OfficeAgentId, ModelTier>>;
}

/** Nothing configured — every agent runs as the product ships it. */
export const DEFAULT_AGENT_CONFIGURATION: OfficeAgentConfiguration = {
  concurrency: new Map(),
  tiers: {},
};

export interface AgentConfigurationDeps {
  list: (userId: string) => Promise<OfficeAgentProfileOverride[]>;
  resolve: typeof resolveAgentProfiles;
}

/**
 * Read the configured cards for a user.
 *
 * A failure falls back to the shipped defaults rather than propagating: an
 * engagement must not refuse to run because a preferences document is
 * unreachable. The cards are a customisation, and losing a customisation is a
 * smaller harm than losing the run.
 */
export const loadAgentConfiguration = async (
  userId: string,
  deps: AgentConfigurationDeps = {
    list: (id) => officeAgentProfileRepository.list(id),
    resolve: resolveAgentProfiles,
  },
): Promise<OfficeAgentConfiguration> => {
  if (!userId) return DEFAULT_AGENT_CONFIGURATION;
  try {
    const profiles = deps.resolve(await deps.list(userId));
    const tiers: Partial<Record<OfficeAgentId, ModelTier>> = {};
    for (const profile of profiles) tiers[profile.agentId] = profile.modelTier;
    return {
      concurrency: new Map(profiles.map((agent) => [agent.agentId, agent.maxConcurrentTasks])),
      tiers,
    };
  } catch {
    return DEFAULT_AGENT_CONFIGURATION;
  }
};
