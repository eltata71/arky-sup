/**
 * Named operations on an inventory item. There is no `update(partial)`: each
 * change is an intention with its own rule, and a command that changes nothing
 * returns the same object so nothing is written (no new revision).
 */

import { uniqueIds } from './inventoryFactory';
import { cleanAliases, cleanInventoryText, findInventoryMatch, normalizeInventoryName } from './inventoryNames';
import type { InventoryItem, InventoryLifecycle } from './InventoryTypes';

export type InventoryCommand =
  | { readonly type: 'rename'; readonly name: string }
  | { readonly type: 'describe'; readonly description: string }
  | { readonly type: 'add-alias'; readonly alias: string }
  | { readonly type: 'remove-alias'; readonly alias: string }
  | { readonly type: 'set-lifecycle'; readonly lifecycle: InventoryLifecycle }
  | { readonly type: 'link-project'; readonly projectId: string }
  | { readonly type: 'unlink-project'; readonly projectId: string };

export type InventoryCommandRejection =
  | { readonly reason: 'missing-name' }
  | { readonly reason: 'missing-alias' }
  | { readonly reason: 'missing-project' }
  | { readonly reason: 'duplicate'; readonly existingId: string; readonly existingName: string }
  | { readonly reason: 'illegal-transition'; readonly from: InventoryLifecycle; readonly to: InventoryLifecycle };

export type InventoryCommandResult =
  | { readonly ok: true; readonly item: InventoryItem; readonly changed: boolean }
  | { readonly ok: false; readonly rejection: InventoryCommandRejection };

export interface InventoryCommandContext {
  readonly now: string;
  /** The rest of the user's inventory, to refuse a name another item answers to. */
  readonly others: readonly InventoryItem[];
}

/** A lifecycle moves forward; a deprecated item may be reinstated. Nothing leaves `retired`. */
const TRANSITIONS: Readonly<Record<InventoryLifecycle, readonly InventoryLifecycle[]>> = {
  candidate: ['active', 'retired'],
  active: ['deprecated', 'retired'],
  deprecated: ['active', 'retired'],
  retired: [],
};

export const canTransitionLifecycle = (from: InventoryLifecycle, to: InventoryLifecycle): boolean =>
  from === to || TRANSITIONS[from].includes(to);

const done = (item: InventoryItem, next: Partial<InventoryItem>, now: string): InventoryCommandResult => ({
  ok: true,
  changed: true,
  item: { ...item, ...next, updatedAt: now },
});
const unchanged = (item: InventoryItem): InventoryCommandResult => ({ ok: true, changed: false, item });
const reject = (rejection: InventoryCommandRejection): InventoryCommandResult => ({ ok: false, rejection });

export const applyInventoryCommand = (
  item: InventoryItem,
  command: InventoryCommand,
  context: InventoryCommandContext,
): InventoryCommandResult => {
  const { now, others } = context;
  switch (command.type) {
    case 'rename': {
      const name = cleanInventoryText(command.name);
      const normalizedName = normalizeInventoryName(name);
      if (!normalizedName) return reject({ reason: 'missing-name' });
      if (name === item.name) return unchanged(item);
      const clash = findInventoryMatch(others, item.kind, [name], item.id);
      if (clash) return reject({ reason: 'duplicate', existingId: clash.id, existingName: clash.name });
      // The old name stays as an alias: whoever searches for it must still find the item.
      const aliases = cleanAliases(name, [item.name, ...item.aliases]);
      return done(item, { name, normalizedName, aliases }, now);
    }
    case 'describe': {
      const description = cleanInventoryText(command.description);
      return description === item.description ? unchanged(item) : done(item, { description }, now);
    }
    case 'add-alias': {
      const alias = cleanInventoryText(command.alias);
      if (!normalizeInventoryName(alias)) return reject({ reason: 'missing-alias' });
      const aliases = cleanAliases(item.name, [...item.aliases, alias]);
      if (aliases.length === item.aliases.length) return unchanged(item);
      const clash = findInventoryMatch(others, item.kind, [alias], item.id);
      if (clash) return reject({ reason: 'duplicate', existingId: clash.id, existingName: clash.name });
      return done(item, { aliases }, now);
    }
    case 'remove-alias': {
      const key = normalizeInventoryName(command.alias);
      const aliases = item.aliases.filter((a) => normalizeInventoryName(a) !== key);
      return aliases.length === item.aliases.length ? unchanged(item) : done(item, { aliases }, now);
    }
    case 'set-lifecycle': {
      if (command.lifecycle === item.lifecycle) return unchanged(item);
      if (!canTransitionLifecycle(item.lifecycle, command.lifecycle)) {
        return reject({ reason: 'illegal-transition', from: item.lifecycle, to: command.lifecycle });
      }
      return done(item, { lifecycle: command.lifecycle }, now);
    }
    case 'link-project': {
      const projectId = command.projectId?.trim();
      if (!projectId) return reject({ reason: 'missing-project' });
      if (item.projectIds.includes(projectId)) return unchanged(item);
      return done(item, { projectIds: uniqueIds([...item.projectIds, projectId]) }, now);
    }
    case 'unlink-project': {
      const projectIds = item.projectIds.filter((id) => id !== command.projectId);
      return projectIds.length === item.projectIds.length ? unchanged(item) : done(item, { projectIds }, now);
    }
  }
};
