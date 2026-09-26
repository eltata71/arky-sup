/**
 * Where an agent's configured card is stored.
 *
 * `users/{uid}/agentProfiles/{agentId}` — one document per agent, under the
 * person who configured it. Two decisions worth the sentence each:
 *
 *  - **Per user, not global.** The cast of thirteen personas ships with the
 *    product; what an organisation teaches one of them is theirs. A global
 *    document would also need an authority to decide who may edit it, and that
 *    authority does not exist in the role model.
 *  - **One document per agent.** Editing happens one card at a time, and two
 *    tabs open on the same array overwrite each other's agent silently.
 *
 * The contract is the one every repository in this codebase keeps: it never
 * throws, it returns a `PersistenceResult`, and it degrades to the local mirror
 * so a customisation survives a database outage instead of vanishing.
 *
 * `api.save_agent_profile` refuses `orchestrationRole`, `producesArtifactTypes`
 * and `reviewsArtifactTypes`. That half of the card is governance, and the
 * screen already withholds it — but a screen runs in a browser the caller
 * controls, so the same refusal is written where it can be enforced.
 */

import {
  MirroredList,
  createFailureResult,
  executeRemoteWrite,
} from '../../persistence';
import type { PersistenceResult } from '../../persistence';
import { callRpc } from '../../adapters';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from '../domain/officeAgentPersonas';
import {
  OFFICE_AGENT_PROFILE_SCHEMA_VERSION,
  type OfficeAgentProfileOverride,
} from '../domain/officeAgentProfile';

/**
 * `MirroredList` keys by `id`, and the override's identity *is* its agent id:
 * one card per agent per user. This adapter is what lets the shared primitive
 * carry it without inventing a second id.
 */
interface StoredOverride extends OfficeAgentProfileOverride {
  id: OfficeAgentId;
}

const mirror = new MirroredList<StoredOverride>((userId) => `agentProfiles_${userId}`);

const withId = (override: OfficeAgentProfileOverride): StoredOverride => ({
  ...override,
  id: override.agentId,
});

const stripId = (stored: StoredOverride): OfficeAgentProfileOverride => {
  const { id: _id, ...override } = stored;
  return override;
};

const MODEL_TIERS = new Set(['quick', 'default', 'deep']);

const asStringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return list.length > 0 ? list : undefined;
};

/**
 * Reads a stored document defensively.
 *
 * A hand-edited or older document must not be able to take the agents screen
 * down — the whole cast would disappear because one card was malformed. Unknown
 * agents and unknown values are dropped, and what is left resolves against the
 * persona's defaults exactly as an absent override would.
 */
export const normalizeAgentProfileOverride = (
  raw: unknown,
  userId: string,
): OfficeAgentProfileOverride | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const agentId = typeof value.agentId === 'string' ? value.agentId as OfficeAgentId : null;
  if (!agentId || !OFFICE_AGENT_PERSONAS[agentId]) return null;
  const tier = typeof value.modelTier === 'string' && MODEL_TIERS.has(value.modelTier)
    ? value.modelTier as OfficeAgentProfileOverride['modelTier']
    : undefined;
  const concurrency = typeof value.maxConcurrentTasks === 'number'
    && Number.isInteger(value.maxConcurrentTasks)
    && value.maxConcurrentTasks >= 1
    && value.maxConcurrentTasks <= 5
    ? value.maxConcurrentTasks
    : undefined;
  return {
    agentId,
    userId,
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : OFFICE_AGENT_PROFILE_SCHEMA_VERSION,
    alias: typeof value.alias === 'string' && value.alias.trim() ? value.alias.trim() : undefined,
    role: typeof value.role === 'string' && value.role.trim() ? value.role.trim() : undefined,
    avatar: typeof value.avatar === 'string' && value.avatar.trim() ? value.avatar.trim() : undefined,
    skills: asStringList(value.skills),
    knowledge: asStringList(value.knowledge),
    memory: asStringList(value.memory),
    instruction: typeof value.instruction === 'string' && value.instruction.trim() ? value.instruction.trim() : undefined,
    modelTier: tier,
    maxConcurrentTasks: concurrency,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
};

export interface OfficeAgentProfileRepository {
  list(userId: string): Promise<OfficeAgentProfileOverride[]>;
  save(override: OfficeAgentProfileOverride): Promise<PersistenceResult<OfficeAgentProfileOverride>>;
  /** Returns the agent to its shipped defaults. */
  reset(userId: string, agentId: OfficeAgentId): Promise<PersistenceResult<void>>;
  clearCache(userId: string): void;
}

export const officeAgentProfileRepository: OfficeAgentProfileRepository = {
  async list(userId) {
    if (!userId) return [];
    const cached = mirror.cached(userId);
    if (cached) return cached.map(stripId);
    try {
      const rows = await callRpc<unknown>('list_agent_profiles');
      const overrides = (Array.isArray(rows) ? rows : [])
        .map((entry) => {
          const override = normalizeAgentProfileOverride(entry, userId);
          return override ? withId(override) : null;
        })
        .filter((entry): entry is StoredOverride => entry !== null);
      return mirror.remember(userId, overrides).map(stripId);
    } catch {
      // The cards are configuration, not the record of work: falling back to
      // what this browser last saw is strictly better than an empty screen
      // that looks like the customisation was lost.
      return mirror.fallback(userId).map(stripId);
    }
  },

  async save(override) {
    let result: PersistenceResult<OfficeAgentProfileOverride>;
    try {
      result = await executeRemoteWrite<OfficeAgentProfileOverride>(
        { operationName: 'saveAgentProfile', userId: override.userId },
        async () => {
          await callRpc<void>('save_agent_profile', { p_profile: override });
          return override;
        },
      );
    } catch (error) {
      result = createFailureResult('saveAgentProfile', error);
    }
    mirror.upsert(override.userId, withId(override), result);
    return result;
  },

  async reset(userId, agentId) {
    let result: PersistenceResult<void>;
    try {
      result = await executeRemoteWrite<void>(
        { operationName: 'resetAgentProfile', userId },
        () => callRpc<void>('delete_agent_profile', { p_agent_id: agentId }),
      );
    } catch (error) {
      result = createFailureResult('resetAgentProfile', error);
    }
    // Removed from the mirrors either way: a reset that only landed locally
    // must still show the defaults, and the next successful read re-syncs.
    mirror.remove(userId, agentId);
    return result;
  },

  clearCache(userId) {
    mirror.invalidate(userId);
  },
};
