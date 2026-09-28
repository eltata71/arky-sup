/**
 * El historial dice qué hizo cada versión cuando lo sabe (plan de diagramas,
 * 1.2), y no inventa nada cuando no.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Artifact } from '../../lib/artifacts';

const versions = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ getArtifactVersions: () => versions.list }),
}));

import { RealArtifactHistoryModal } from '../../components/ArtifactHistoryModal';

const version = (n: number, extra: Partial<Artifact> = {}): Artifact => ({
  id: `a-${n}`,
  versionGroupId: 'a-1',
  version: n,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Contexto',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: `graph TD; A-->B${n}`,
  objective: 'x',
  keyConcepts: [],
  representation: 'diagram',
  ...extra,
});

const open = (current: Artifact) => render(
  <RealArtifactHistoryModal isOpen onClose={vi.fn()} projectId="p1" artifact={current} onOpenVersion={vi.fn()} />,
);

describe('RealArtifactHistoryModal — notas de cambio', () => {
  it('muestra la instrucción y lo que hizo el motor', () => {
    const v2 = version(2, {
      changeNote: {
        kind: 'diagram-patch',
        basedOnVersion: 1,
        instruction: 'renombra la API',
        changes: ['Renombrado «API» → «API Gateway»'],
        at: '2026-09-28T00:00:00.000Z',
      },
    });
    versions.list = [v2, version(1)];
    open(v2);

    expect(screen.getByText(/Modificado con IA desde la v1/)).toBeInTheDocument();
    expect(screen.getByText(/«renombra la API»/)).toBeInTheDocument();
    expect(screen.getByText('Renombrado «API» → «API Gateway»')).toBeInTheDocument();
  });

  it('resume una lista larga en vez de desbordar la tarjeta', () => {
    const v2 = version(2, {
      changeNote: {
        kind: 'diagram-patch',
        basedOnVersion: 1,
        changes: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
        at: '2026-09-28T00:00:00.000Z',
      },
    });
    versions.list = [v2];
    open(v2);

    expect(screen.getByText('c5')).toBeInTheDocument();
    expect(screen.queryByText('c6')).not.toBeInTheDocument();
    expect(screen.getByText('y 2 cambios más')).toBeInTheDocument();
  });

  it('una versión sin nota no se inventa una', () => {
    const v1 = version(1);
    versions.list = [v1];
    open(v1);

    expect(screen.getByText('Versión 1')).toBeInTheDocument();
    expect(screen.queryByText(/Modificado con IA/)).not.toBeInTheDocument();
  });
});

describe('RealArtifactHistoryModal — comparar', () => {
  // El comparador es un chunk diferido que arrastra el pipeline de diagramas:
  // su primera transformación bajo jsdom tarda más que la espera de `findBy`.
  beforeAll(async () => { await import('../../components/ArtifactVersionComparison'); }, 60_000);

  it('un diagrama se compara como diagrama, y el texto queda a un clic', async () => {
    const v1 = version(1, { content: 'graph TD\n  A[Web] --> B[API]' });
    const v2 = version(2, { content: 'graph TD\n  A[Web] --> B[API Gateway]' });
    versions.list = [v2, v1];
    open(v2);

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(await screen.findByText(/Cambios en el diagrama · v1 → v2/)).toBeInTheDocument();
    expect(screen.getByText('nombre: API → API Gateway')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver cambios en el texto' }));
    expect(screen.getByText('v1 → v2')).toBeInTheDocument();
  });

  it('reordenar el Mermaid sin cambiar el diagrama no es un cambio', async () => {
    const v1 = version(1, { content: 'graph TD\n  A[Web] --> B[API]\n  B --> C[DB]' });
    const v2 = version(2, { content: 'graph TD\n  B[API] --> C[DB]\n  A[Web] --> B' });
    versions.list = [v2, v1];
    open(v2);

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(await screen.findByText(/Mismo diagrama/)).toBeInTheDocument();
  });

  it('un documento se sigue comparando como texto', async () => {
    const doc = (n: number, content: string) => version(n, { type: 'markdown', representation: 'document', content });
    const v1 = doc(1, '# Título\nuno');
    const v2 = doc(2, '# Título\ndos');
    versions.list = [v2, v1];
    open(v2);

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(await screen.findByText('v1 → v2')).toBeInTheDocument();
    expect(screen.queryByText(/Cambios en el diagrama/)).not.toBeInTheDocument();
  });
});
