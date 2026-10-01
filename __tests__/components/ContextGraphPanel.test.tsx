import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextGraphPanel } from '../../components/ContextGraphPanel';
import type { Artifact } from '../../lib/artifacts';

const base: Artifact = {
  id: 'a', revision: 1, versionGroupId: 'a', version: 1, createdAt: '2026-10-01T00:00:00Z', name: 'ADR',
  type: 'markdown', phase: 'Diseño', architecturalView: 'Vista Lógica y de Diseño',
  content: '# ADR', objective: 'Decidir', representation: 'document', keyConcepts: [],
};

const withManifest = (text: string): Artifact => ({
  ...base,
  generationTrace: {
    id: 't', source: 'catalog', status: 'clean', startedAt: '', completedAt: '',
    decisions: [], errors: [], warnings: [], contentLength: 5,
    contextManifest: {
      version: 1,
      capturedAt: '2026-10-01T00:00:00Z',
      records: [{
        label: 'Contexto de artefacto',
        profile: 'generate',
        sources: [{ id: 'p', label: 'Proyecto Salud', revision: 4 }, { id: 'settings', label: 'Estándares' }],
        sections: [{ scope: 'proyecto', items: [{ text, truncated: true }] }],
        omitted: [{ scope: 'hermanos', count: 2, reason: 'Sin relevancia' }],
      }],
    },
  } as unknown as Artifact['generationTrace'],
});

describe('ContextGraphPanel — «Contexto usado» lee lo registrado (7.5a)', () => {
  it('muestra el contexto de la generación, sus fuentes con revisión y lo excluido', () => {
    render(<ContextGraphPanel projectId="p" artifact={withManifest('Servicio de pólizas')} />);
    expect(screen.getByText('Contexto de artefacto')).toBeInTheDocument();
    expect(screen.getByText(/Proyecto Salud · p · revisión 4/)).toBeInTheDocument();
    expect(screen.getByText(/Estándares · settings · revisión no disponible/)).toBeInTheDocument();
    expect(screen.getByText('Servicio de pólizas')).toBeInTheDocument();
    expect(screen.getByText('Fuente recortada para esta operación')).toBeInTheDocument();
    expect(screen.getByText(/hermanos: 2 · Sin relevancia/)).toBeInTheDocument();
  });

  it('un artefacto sin registro lo dice, en vez de reconstruir el contexto del proyecto actual', () => {
    render(<ContextGraphPanel projectId="p" artifact={base} />);
    expect(screen.getByText('Sin registro histórico')).toBeInTheDocument();
  });
});
