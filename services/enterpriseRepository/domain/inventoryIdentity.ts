import { newPrefixedId } from '../../../lib/ids';

/** Minting an id is a rule of the model — which prefix means what — not of persistence. */
export const newInventoryItemId = (): string => newPrefixedId('inv');

export const isInventoryItemId = (value: unknown): value is string =>
  typeof value === 'string' && /^inv[_-][A-Za-z0-9_-]+$/.test(value);

/** Revision sent for an item that is not yet in the database. */
export const UNSTORED_REVISION = 0;

export const toInventoryRevision = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

export const expectedRevisionOf = (item: { readonly revision?: number }): number =>
  toInventoryRevision(item.revision) ?? UNSTORED_REVISION;
