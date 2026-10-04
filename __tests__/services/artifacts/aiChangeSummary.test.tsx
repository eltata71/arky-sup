import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { summarizeDiagramChange, summarizeDocumentChange, aiChangeStore } from '../../../services/artifacts/application/aiChangeSummary';
import { applySemanticPatch } from '../../../services/diagram';
import { AiChangeCard } from '../../../components/artifacts/AiChangeCard';
import { AriaAnnouncerProvider } from '../../../hooks/useAriaAnnouncer';
import { useAiChangeHighlight } from '../../../hooks/artifacts/useAiChangeHighlight';

const ir: any = {
  version: '1', type: 'flowchart', title: 'T',
  nodes: [{ id: 'a', label: 'A', kind: 'service' }, { id: 'b', label: 'B', kind: 'service' }],
  edges: [{ id: 'e1', source: 'a', target: 'b' }], groups: [],
};

afterEach(() => aiChangeStore.clear());

describe('aiChangeSummary', () => {
  it('resume un diagrama desde el mismo resultado que aplica el motor', () => {
    const patch: any = { operations: [{ op: 'add-node', node: { id: 'c', label: 'C', kind: 'service' } }] };
    const result = applySemanticPatch(ir, patch);
    const summary = summarizeDiagramChange({ artifactId: 'x', before: ir, result });
    expect(summary.touchedNodeIds).toEqual(['c']);
    expect(summary.lines).toEqual(result.applied.map(entry => entry.description));
    expect(summary.headline).toContain('1 nodo nuevo');
  });

  it('declara las cascadas de una eliminación', () => {
    const result = applySemanticPatch(ir, { operations: [{ op: 'remove-node', nodeId: 'a' }] } as any);
    const summary = summarizeDiagramChange({ artifactId: 'x', before: ir, result });
    expect(summary.headline).toContain('1 nodo eliminado');
    expect(summary.headline).toContain('1 arista eliminada');
    expect(summary.touchedNodeIds).toEqual([]);
  });

  it('resume secciones y filas de un documento', () => {
    const summary = summarizeDocumentChange({
      artifactId: 'd',
      before: '# A\ntexto\n| x | y |\n|---|---|\n| 1 | 2 |',
      after: '# A\ntexto nuevo\n| x | y |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n# B\nmás',
    });
    expect(summary.lines).toContain('Sección nueva: «B».');
    expect(summary.lines).toContain('Sección modificada: «A».');
    expect(summary.headline).toContain('1 fila añadida');
  });

  it('la tarjeta muestra el último cambio y se cierra', () => {
    render(<AriaAnnouncerProvider><AiChangeCard /></AriaAnnouncerProvider>);
    expect(screen.queryByLabelText('Qué cambió la IA')).toBeNull();
    act(() => aiChangeStore.set({ id: 'k', artifactId: 'x', headline: '1 cambio', lines: ['Hecho'], touchedNodeIds: [] }));
    expect(screen.getByText('Hecho')).toBeTruthy();
    act(() => screen.getByText('Cerrar').click());
    expect(screen.queryByText('Hecho')).toBeNull();
  });
});

function Probe({ ids }: { ids: string[] }) { useAiChangeHighlight(ids, 'c1'); return null; }

describe('resaltado', () => {
  const setup = (reduced: boolean) => {
    window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as any;
    document.body.innerHTML = '<div class="react-flow__node" data-id="n1"></div>';
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 1; }) as any;
    (globalThis as any).CSS = { escape: (v: string) => v };
  };
  it('resalta el nodo tocado', () => {
    setup(false);
    render(<Probe ids={['n1']} />);
    expect(document.querySelector('[data-id="n1"]')!.classList.contains('ai-change-flash')).toBe(true);
  });
  it('no resalta con movimiento reducido', () => {
    setup(true);
    render(<Probe ids={['n1']} />);
    expect(document.querySelector('[data-id="n1"]')!.classList.contains('ai-change-flash')).toBe(false);
  });
});
