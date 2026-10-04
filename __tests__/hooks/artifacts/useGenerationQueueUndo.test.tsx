/**
 * 10.4b: la cola de generación ofrece «Deshacer» cuando cambia un artefacto
 * existente, y no lo ofrece cuando crea uno nuevo (no hay «antes»).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Artifact } from '../../../lib/artifacts';

const mocks = vi.hoisted(() => ({
  offerUndo: vi.fn(),
  addToast: vi.fn(),
  updateArtifact: vi.fn(),
  createArtifactVersion: vi.fn(() => ({ id: 'a1-v2' })),
  createArtifact: vi.fn(() => ({ id: 'new-1' })),
  run: vi.fn(),
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, isLoading: false }) }));
vi.mock('../../../context/AppContext', () => ({
  useAppContext: () => ({ createArtifact: mocks.createArtifact, createArtifactVersion: mocks.createArtifactVersion, updateArtifact: mocks.updateArtifact }),
}));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../../../hooks/artifacts/useAiUndo', () => ({ useAiUndo: () => ({ offerUndo: mocks.offerUndo }) }));
vi.mock('../../../services/ai/callControl/aiCallControlService', () => ({ getAiBlockingCooldownRemainingMs: () => 0 }));
vi.mock('../../../services/artifacts/application/artifactGenerationRun', () => ({ runArtifactGeneration: mocks.run }));

import { GenerationQueueProvider, useGenerationQueue } from '../../../hooks/artifacts/useGenerationQueue';

const existing = { id: 'a1', versionGroupId: 'a1', version: 1, name: 'Doc', type: 'markdown' } as unknown as Artifact;
const project = { id: 'p1', name: 'P', artifacts: [existing] } as never;
const template = { name: 'Doc', type: 'markdown' } as never;

let enqueue: ReturnType<typeof useGenerationQueue>['enqueue'];
const Probe = () => { enqueue = useGenerationQueue().enqueue; return null; };

const start = async (action: string, existingArtifact?: Artifact) => {
  render(<MemoryRouter><GenerationQueueProvider><Probe /></GenerationQueueProvider></MemoryRouter>);
  act(() => {
    enqueue({
      project, template, settings: {} as never, action: action as never, existingArtifact,
      composePersonaInstruction: (() => '') as never, loadContextPorts: async () => ({}) as never,
    });
  });
};

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear());
  mocks.run.mockResolvedValue({ content: 'x', type: 'markdown', name: 'Doc' });
});

describe('cola de generación y deshacer', () => {
  it('ofrece deshacer al reemplazar un artefacto existente', async () => {
    await start('replace', existing);
    await waitFor(() => expect(mocks.offerUndo).toHaveBeenCalledTimes(1));
    expect(mocks.offerUndo.mock.calls[0][0].steps[0]).toMatchObject({ before: existing, producedId: 'a1' });
  });

  it('ofrece deshacer al crear una versión nueva', async () => {
    await start('new_version', existing);
    await waitFor(() => expect(mocks.offerUndo).toHaveBeenCalledTimes(1));
    expect(mocks.offerUndo.mock.calls[0][0].steps[0]).toMatchObject({ before: existing, producedId: 'a1-v2' });
  });

  it('no ofrece deshacer al crear un artefacto nuevo', async () => {
    await start('create');
    await waitFor(() => expect(mocks.createArtifact).toHaveBeenCalled());
    expect(mocks.offerUndo).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledWith(expect.stringContaining('está listo'), 'success', expect.anything());
  });
});
