/**
 * Named operations on an inventory item. There is no `update(partial)`: each
 * change is an intention with its own rule, and a command that changes nothing
 * returns the same object so nothing is written (no new revision).
 */

import {
  MAX_CAPABILITY_LEVEL,
  capabilityAncestors,
  capabilityLevel,
  capabilitySubtreeHeight,
  type CapabilityAttributes,
  type CapabilityInvestment,
  type CapabilityMaturity,
  type CapabilityRisk,
  isCapabilityMaturity,
  CAPABILITY_INVESTMENTS,
  CAPABILITY_RISKS,
} from './capabilityAttributes';
import { isFitScore, type ApplicationAttributes, type FitScore } from './applicationAttributes';
import { isRadarRing, type RadarRing, type TechnologyAttributes } from './technologyAttributes';
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
  | { readonly type: 'unlink-project'; readonly projectId: string }
  | { readonly type: 'set-capability-parent'; readonly parentId: string | null }
  | { readonly type: 'set-capability-maturity'; readonly maturity: CapabilityMaturity | null }
  | { readonly type: 'set-capability-investment'; readonly investment: CapabilityInvestment | null }
  | { readonly type: 'set-capability-risk'; readonly risk: CapabilityRisk | null }
  | { readonly type: 'link-supporting-application'; readonly applicationId: string }
  | { readonly type: 'unlink-supporting-application'; readonly applicationId: string }
  | { readonly type: 'set-application-functional-fit'; readonly score: FitScore | null }
  | { readonly type: 'set-application-technical-fit'; readonly score: FitScore | null }
  | { readonly type: 'set-technology-ring'; readonly ring: RadarRing | null };

export type InventoryCommandRejection =
  | { readonly reason: 'missing-name' }
  | { readonly reason: 'missing-alias' }
  | { readonly reason: 'missing-project' }
  | { readonly reason: 'not-a-capability' }
  | { readonly reason: 'not-an-application' }
  | { readonly reason: 'not-a-technology' }
  | { readonly reason: 'invalid-value' }
  | { readonly reason: 'unknown-parent'; readonly parentId: string }
  | { readonly reason: 'capability-cycle' }
  | { readonly reason: 'capability-too-deep'; readonly level: number }
  | { readonly reason: 'unknown-application'; readonly applicationId: string }
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

const withCapability = (item: InventoryItem, patch: Partial<CapabilityAttributes>): Partial<InventoryItem> => {
  const merged: Record<string, unknown> = { ...item.capability, ...patch };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return { capability: Object.keys(merged).length ? (merged as CapabilityAttributes) : undefined };
};

const withApplication = (item: InventoryItem, patch: Partial<ApplicationAttributes>): Partial<InventoryItem> => {
  const merged: Record<string, unknown> = { ...item.application, ...patch };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return { application: Object.keys(merged).length ? (merged as ApplicationAttributes) : undefined };
};

const withTechnology = (ring: RadarRing | undefined): Partial<InventoryItem> => {
  const technology: TechnologyAttributes | undefined = ring ? { ring } : undefined;
  return { technology };
};

const applyCapabilityCommand = (
  item: InventoryItem,
  command: Extract<InventoryCommand, { type: `${'set-capability' | 'link-supporting' | 'unlink-supporting'}${string}` }>,
  { now, others }: InventoryCommandContext,
): InventoryCommandResult => {
  if (item.kind !== 'capability') return reject({ reason: 'not-a-capability' });
  const current = item.capability ?? {};
  switch (command.type) {
    case 'set-capability-parent': {
      const parentId = command.parentId?.trim() || undefined;
      if (parentId === current.parentId) return unchanged(item);
      if (parentId) {
        const universe = [item, ...others.filter((o) => o.id !== item.id)];
        const parent = universe.find((o) => o.id === parentId && o.kind === 'capability');
        if (!parent) return reject({ reason: 'unknown-parent', parentId });
        if (parent.id === item.id || capabilityAncestors(parent, universe).some((a) => a.id === item.id)) {
          return reject({ reason: 'capability-cycle' });
        }
        const level = capabilityLevel(parent, universe) + 1 + capabilitySubtreeHeight(item, universe);
        if (level > MAX_CAPABILITY_LEVEL) return reject({ reason: 'capability-too-deep', level });
      }
      return done(item, withCapability(item, { parentId }), now);
    }
    case 'set-capability-maturity': {
      if (command.maturity !== null && !isCapabilityMaturity(command.maturity)) return reject({ reason: 'invalid-value' });
      const maturity = command.maturity ?? undefined;
      return maturity === current.maturity ? unchanged(item) : done(item, withCapability(item, { maturity }), now);
    }
    case 'set-capability-investment': {
      if (command.investment !== null && !CAPABILITY_INVESTMENTS.includes(command.investment)) return reject({ reason: 'invalid-value' });
      const investment = command.investment ?? undefined;
      return investment === current.investment ? unchanged(item) : done(item, withCapability(item, { investment }), now);
    }
    case 'set-capability-risk': {
      if (command.risk !== null && !CAPABILITY_RISKS.includes(command.risk)) return reject({ reason: 'invalid-value' });
      const risk = command.risk ?? undefined;
      return risk === current.risk ? unchanged(item) : done(item, withCapability(item, { risk }), now);
    }
    case 'link-supporting-application': {
      const applicationId = command.applicationId?.trim();
      const app = others.find((o) => o.id === applicationId && o.kind === 'application');
      if (!app) return reject({ reason: 'unknown-application', applicationId: applicationId ?? '' });
      const supported = current.supportedByIds ?? [];
      if (supported.includes(applicationId)) return unchanged(item);
      return done(item, withCapability(item, { supportedByIds: uniqueIds([...supported, applicationId]) }), now);
    }
    case 'unlink-supporting-application': {
      const supported = current.supportedByIds ?? [];
      const next = supported.filter((id) => id !== command.applicationId);
      if (next.length === supported.length) return unchanged(item);
      return done(item, withCapability(item, { supportedByIds: next.length ? next : undefined }), now);
    }
  }
};

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
    case 'set-application-functional-fit':
    case 'set-application-technical-fit': {
      if (item.kind !== 'application') return reject({ reason: 'not-an-application' });
      if (command.score !== null && !isFitScore(command.score)) return reject({ reason: 'invalid-value' });
      const score = command.score ?? undefined;
      const field = command.type === 'set-application-functional-fit' ? 'functionalFit' : 'technicalFit';
      if (score === item.application?.[field]) return unchanged(item);
      return done(item, withApplication(item, { [field]: score }), now);
    }
    case 'set-technology-ring': {
      if (item.kind !== 'technology') return reject({ reason: 'not-a-technology' });
      if (command.ring !== null && !isRadarRing(command.ring)) return reject({ reason: 'invalid-value' });
      const ring = command.ring ?? undefined;
      if (ring === item.technology?.ring) return unchanged(item);
      return done(item, withTechnology(ring), now);
    }
    case 'set-capability-parent':
    case 'set-capability-maturity':
    case 'set-capability-investment':
    case 'set-capability-risk':
    case 'link-supporting-application':
    case 'unlink-supporting-application':
      return applyCapabilityCommand(item, command, context);
  }
};
