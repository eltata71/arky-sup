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
 * so a customisation survives a Firestore outage instead of vanishing.
 */

import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import {
  AGENT_PROFILES_COLLECTION,
  MirroredList,
  USERS_COLLECTION,
  executeRemoteWrite,
  requireDb,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from './officeAgentPersonas';
import {
  OFFICE_AGENT_PROFILE_SCHEMA_VERSION,
  type OfficeAgentProfileOverride,
} from './officeAgentProfile';

/**
 * `MirroredList` keys by `id`, and the override's identity *is* its agent id:
 * one card per agent per user. This adapter is what lets the shared primitive
 * carry it without inventing a second id.
 */
interface StoredOverride extends OfficeAgentProfileOverride {
  id: OfficeAgentId;
}

const mirror = new MirroredList<StoredOverride>((userId) => `${AGENT_PROFILES_COLLECTION}_${userId}`);

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
      const snapshot = await getDocs(
        collection(requireDb(db), USERS_COLLECTION, userId, AGENT_PROFILES_COLLECTION),
      );
      const overrides = snapshot.docs
        .map((entry) => {
          const override = normalizeAgentProfileOverride(entry.data(), userId);
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
    const result = await executeRemoteWrite<OfficeAgentProfileOverride>(
      { operationName: 'saveAgentProfile', userId: override.userId },
      async () => {
        await setDoc(
          doc(requireDb(db), USERS_COLLECTION, override.userId, AGENT_PROFILES_COLLECTION, override.agentId),
          sanitizeForFirestore(override),
        );
        return override;
      },
    );
    mirror.upsert(override.userId, withId(override), result);
    return result;
  },

  async reset(userId, agentId) {
    const result = await executeRemoteWrite<void>(
      { operationName: 'resetAgentProfile', userId },
      async () => {
        await deleteDoc(doc(requireDb(db), USERS_COLLECTION, userId, AGENT_PROFILES_COLLECTION, agentId));
      },
    );
    // Removed from the mirrors either way: a reset that only landed locally
    // must still show the defaults, and the next successful read re-syncs.
    mirror.remove(userId, agentId);
    return result;
  },

  clearCache(userId) {
    mirror.invalidate(userId);
  },
};
