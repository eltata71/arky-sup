/**
 * A Training Center write that does not land must reach the person who made it.
 *
 * This is the second half of the defect that `trainingPersistence.test.ts`
 * guards. Making the service tell the truth is necessary and not sufficient:
 * `LMSContext` had exposed `syncError` since it was written, every write was
 * fire-and-forget, and nothing rendered the field — so the report had nowhere
 * to land even once it existed. Three separate places had to be right at the
 * same time for a failed save to be visible, which is exactly the shape of
 * thing that quietly stops working.
 *
 * The test drives the provider the way a user drives it: add a course, and
 * check that a refused write surfaces and that a subsequent accepted one
 * clears the notice.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import type { PersistenceResult } from '../../services/persistence';

const { saveCourse } = vi.hoisted(() => ({ saveCourse: vi.fn() }));

vi.mock('../../services/learning/trainingService', () => ({
  trainingService: {
    saveCourse,
    getCourses: vi.fn(async () => []),
    getSmartNotes: vi.fn(async () => []),
    getProgress: vi.fn(async () => null),
    getContext: vi.fn(async () => null),
    updateCourse: vi.fn(async () => confirmed()),
    deleteCourse: vi.fn(async () => confirmed()),
    saveSmartNote: vi.fn(async () => confirmed()),
    deleteSmartNote: vi.fn(async () => confirmed()),
    saveProgress: vi.fn(async () => confirmed()),
    saveContext: vi.fn(async () => confirmed()),
  },
}));

/*
 * The identities have to be stable. `LMSContext` loads its data in an effect
 * keyed on `[authLoading, user, profile]`, so a mock that returns fresh object
 * literals on every render re-runs the load on every render, which sets state,
 * which renders again — the provider never settles and the test times out
 * without ever saying why.
 */
const AUTH_USER = { uid: 'user-1' };
const AUTH_PROFILE = { role: 'trainer' };
const AUTH = { user: AUTH_USER, profile: AUTH_PROFILE, isLoading: false };

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => AUTH,
}));

const confirmed = (): PersistenceResult<void> => ({
  status: 'success',
  success: true,
  operationId: 'op-ok',
  target: 'supabase',
});

const refused = (): PersistenceResult<void> => ({
  status: 'permission-denied',
  success: false,
  operationId: 'op-denied',
  target: 'local-draft',
  errorCode: 'permission-denied',
  message: 'El curso se guardó sólo en este navegador. No está publicado para el resto del equipo.',
});

const { LMSProvider, useLMS } = await import('../../context/LMSContext');

const Probe: React.FC = () => {
  const lms = useLMS();
  return (
    <div>
      <span data-testid="sync-error">{lms.syncError ?? 'sin-error'}</span>
      <button
        onClick={() =>
          lms.addCourse({
            id: 'course-1',
            title: 'Curso',
            description: '',
            category: 'Architecture',
            role: 'Arquitecto de Soluciones',
            level: 'Intermedio',
            icon: 'GraduationCap',
            modules: [],
          })
        }
      >
        guardar
      </button>
    </div>
  );
};

const renderProbe = () =>
  render(
    <LMSProvider>
      <Probe />
    </LMSProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LMSContext surfaces a write that did not reach Firestore', () => {
  it('stays quiet while writes are confirmed', async () => {
    saveCourse.mockResolvedValue(confirmed());
    renderProbe();

    await act(async () => {
      screen.getByText('guardar').click();
    });

    expect(screen.getByTestId('sync-error').textContent).toBe('sin-error');
  });

  it('shows the reason the write did not land', async () => {
    saveCourse.mockResolvedValue(refused());
    renderProbe();

    await act(async () => {
      screen.getByText('guardar').click();
    });

    expect(screen.getByTestId('sync-error').textContent).toContain('sólo en este navegador');
  });

  it('clears the notice once a write is confirmed again', async () => {
    saveCourse.mockResolvedValueOnce(refused()).mockResolvedValueOnce(confirmed());
    renderProbe();

    await act(async () => {
      screen.getByText('guardar').click();
    });
    expect(screen.getByTestId('sync-error').textContent).not.toBe('sin-error');

    await act(async () => {
      screen.getByText('guardar').click();
    });
    expect(screen.getByTestId('sync-error').textContent).toBe('sin-error');
  });

  it('reports a rejected promise too, not only a non-confirmed result', async () => {
    saveCourse.mockRejectedValue(new Error('network'));
    renderProbe();

    await act(async () => {
      screen.getByText('guardar').click();
    });

    expect(screen.getByTestId('sync-error').textContent).toContain('No se pudo sincronizar');
  });
});
