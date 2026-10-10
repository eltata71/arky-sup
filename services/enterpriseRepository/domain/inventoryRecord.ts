/**
 * Reading a stored inventory item. Generous in what it accepts, strict in what
 * it returns: a malformed document yields `null` (and is reported by the
 * caller), never a plausible-looking item.
 */

import { readApplicationAttributes } from './applicationAttributes';
import { readTechnologyAttributes } from './technologyAttributes';
import { readCapabilityAttributes } from './capabilityAttributes';
import { toInventoryRevision } from './inventoryIdentity';
import { cleanAliases, cleanInventoryText, normalizeInventoryName } from './inventoryNames';
import { uniqueIds } from './inventoryFactory';
import { INVENTORY_KINDS, INVENTORY_LIFECYCLES, type InventoryItem, type InventoryKind, type InventoryLifecycle } from './InventoryTypes';

export const normalizeInventoryItem = (raw: unknown, fallbackUserId: string): InventoryItem | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = cleanInventoryText(r.name);
  const kind = r.kind as InventoryKind;
  if (!id || !normalizeInventoryName(name) || !INVENTORY_KINDS.includes(kind)) return null;
  const now = new Date(0).toISOString();
  const lifecycle = INVENTORY_LIFECYCLES.includes(r.lifecycle as InventoryLifecycle)
    ? (r.lifecycle as InventoryLifecycle)
    : 'candidate';
  const revision = toInventoryRevision(r.revision);
  const capability = kind === 'capability' ? readCapabilityAttributes(r.capability) : undefined;
  const application = kind === 'application' ? readApplicationAttributes(r.application) : undefined;
  const technology = kind === 'technology' ? readTechnologyAttributes(r.technology) : undefined;
  return {
    id,
    schemaVersion: 1,
    userId: typeof r.userId === 'string' && r.userId ? r.userId : fallbackUserId,
    kind,
    name,
    normalizedName: normalizeInventoryName(name),
    aliases: cleanAliases(name, Array.isArray(r.aliases) ? r.aliases : []),
    description: cleanInventoryText(r.description),
    lifecycle,
    projectIds: uniqueIds(Array.isArray(r.projectIds) ? r.projectIds : []),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
    ...(capability ? { capability } : {}),
    ...(application ? { application } : {}),
    ...(technology ? { technology } : {}),
    ...(revision ? { revision } : {}),
  };
};
