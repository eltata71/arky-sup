/**
 * Spec for the security/offline classifier and the getAllProjects guard.
 *
 * The full Firestore SDK is mocked out — we only validate the *contract* the
 * service exposes, not the underlying transport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../firebase', () => ({
  db: {},
  auth: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
  query: vi.fn((c: unknown) => c),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

import {

  isOfflineError,
  isSecurityError,
} from '../../services/persistence';
import { clearProjectCache } from '../../services/architectureProjects/projectCache';
import { getAllProjects } from '../../services/architectureProjects/projectReads';

describe('persistence — error classification', () => {
  it('classifies permission-denied as a security error', () => {
    expect(isSecurityError({ code: 'permission-denied' })).toBe(true);
    expect(isSecurityError({ code: 'unauthenticated' })).toBe(true);
    expect(isSecurityError({ code: 'failed-precondition' })).toBe(true);
  });

  it('does not classify transient/network errors as security errors', () => {
    expect(isSecurityError({ code: 'unavailable' })).toBe(false);
    expect(isSecurityError({ code: 'deadline-exceeded' })).toBe(false);
    expect(isSecurityError(new Error('boom'))).toBe(false);
    expect(isSecurityError(null)).toBe(false);
  });

  it('classifies offline errors using the firestore code', () => {
    expect(isOfflineError({ code: 'unavailable' })).toBe(true);
    expect(isOfflineError({ code: 'deadline-exceeded' })).toBe(true);
  });
});

describe('architectureProjects — getAllProjects guard', () => {
  beforeEach(() => {
    clearProjectCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns [] without ever hitting Firestore when called without auth', async () => {
    const firestore = await import('firebase/firestore');
    const result = await getAllProjects(undefined, false);
    expect(result).toEqual([]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('queries Firestore when called with a userId', async () => {
    const firestore = await import('firebase/firestore');
    (firestore.getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ docs: [] });
    await getAllProjects('user-1', false);
    expect(firestore.getDocs).toHaveBeenCalledOnce();
  });

  it('queries the entire collection only when admin=true', async () => {
    const firestore = await import('firebase/firestore');
    (firestore.getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ docs: [] });
    await getAllProjects(undefined, true);
    expect(firestore.getDocs).toHaveBeenCalledOnce();
    expect(firestore.where).not.toHaveBeenCalled();
  });
});
