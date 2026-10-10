import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { C4LevelNavigator } from '../../components/artifacts/diagram/C4LevelNavigator';
import { describeC4Navigation } from '../../services/artifacts/application/diagramDetailLinks';

const mk = (id: string, type: string, name: string, nodes: Array<{ id: string; label: string; detailArtifactGroupId?: string }> = []) =>
  ({ id, versionGroupId: `g-${id}`, version: 1, name, type, ir: { nodes } }) as never;

const ctx = mk('a', 'mermaid-c4-context', 'Contexto', [{ id: 'n1', label: 'Sistema', detailArtifactGroupId: 'g-b' }]);
const cont = mk('b', 'mermaid-c4-container', 'Contenedores', [{ id: 'm1', label: 'API', detailArtifactGroupId: 'g-c' }]);
const comp = mk('c', 'mermaid-c4-component', 'Componentes');
const all = [ctx, cont, comp];

describe('describeC4Navigation', () => {
  it('deriva el camino de vuelta desde los enlaces', () => {
    const nav = describeC4Navigation(comp, all);
    expect(nav.trail.map((s) => s.artifactId)).toEqual(['a', 'b', 'c']);
    expect(nav.parentArtifactId).toBe('b');
    expect(nav.enterable).toEqual([]);
  });
  it('lista sólo detalles resueltos y no se cuelga con ciclos', () => {
    const loop = mk('x', 'mermaid-c4-container', 'X', [{ id: 'n', label: 'Y', detailArtifactGroupId: 'g-y' }]);
    const y = mk('y', 'mermaid-c4-container', 'Y', [{ id: 'n', label: 'X', detailArtifactGroupId: 'g-x' }]);
    expect(describeC4Navigation(loop, [loop, y]).trail.length).toBeLessThanOrEqual(2);
    expect(describeC4Navigation(cont, all).enterable.map((e) => e.artifactId)).toEqual(['c']);
  });
});

describe('C4LevelNavigator', () => {
  it('Entrar abre el hijo y Esc sube al padre', () => {
    const open = vi.fn();
    const { rerender } = render(<C4LevelNavigator artifact={cont} projectArtifacts={all} onOpenArtifact={open}><div>lienzo</div></C4LevelNavigator>);
    fireEvent.click(screen.getByRole('button', { name: /Entrar en «API»/ }));
    expect(open).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(open).toHaveBeenLastCalledWith('a');
    rerender(<C4LevelNavigator artifact={ctx} projectArtifacts={all} onOpenArtifact={open}><div>lienzo</div></C4LevelNavigator>);
    open.mockClear();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(open).not.toHaveBeenCalled();
  });
  it('no pinta barra sin niveles', () => {
    const lone = mk('z', 'mermaid-flowchart', 'Solo');
    render(<C4LevelNavigator artifact={lone} projectArtifacts={[lone]} onOpenArtifact={vi.fn()}><div>lienzo</div></C4LevelNavigator>);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
