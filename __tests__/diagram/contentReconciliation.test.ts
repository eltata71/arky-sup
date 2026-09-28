/**
 * Un texto reescrito convertido en el patch mínimo sobre el IR existente
 * (plan de diagramas, 1.4): cambia lo que el texto dice, y conserva lo que el
 * texto no sabe decir.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { mermaidToIR, reconcileIRWithContent } from '../../services/diagram';

/** El IR como lo deja el lienzo: posiciones manuales y campos ricos. */
const current = (): DiagramIR => ({
  nodes: [
    { id: 'A', label: 'Web', kind: 'service', position: { x: 10, y: 20 }, technology: 'React' },
    { id: 'B', label: 'API', kind: 'service', position: { x: 300, y: 20 }, description: 'Expone los casos de uso', criticality: 'high' },
    { id: 'C', label: 'DB', kind: 'data', position: { x: 600, y: 20 } },
  ],
  edges: [
    { id: 'e1', source: 'A', target: 'B', label: 'HTTPS' },
    { id: 'e2', source: 'B', target: 'C', label: 'SQL' },
  ],
  groups: [],
  metadata: { layoutMode: 'manual' },
});

const node = (ir: DiagramIR, id: string) => ir.nodes.find((n) => n.id === id);

describe('reconcileIRWithContent', () => {
  it('el mismo diagrama escrito en otro orden no cambia nada', () => {
    const parsed = mermaidToIR('graph LR\n  B[API] -->|SQL| C[DB]\n  A[Web] -->|HTTPS| B');
    const result = reconcileIRWithContent(current(), parsed);
    expect(result.changed).toBe(false);
  });

  it('un renombrado cambia la etiqueta y conserva posición y campos que el texto no expresa', () => {
    const parsed = mermaidToIR('graph LR\n  A[Web] -->|HTTPS| B[API Gateway]\n  B -->|SQL| C[DB]');
    const result = reconcileIRWithContent(current(), parsed);

    expect(result.changed).toBe(true);
    const api = node(result.ir, 'B');
    expect(api?.label).toBe('API Gateway');
    expect(api?.position).toEqual({ x: 300, y: 20 });
    expect(api?.description).toBe('Expone los casos de uso');
    expect(api?.criticality).toBe('high');
    expect(node(result.ir, 'A')?.technology).toBe('React');
    expect(result.ir.metadata?.layoutMode).toBe('manual');
  });

  it('un elemento nuevo entra sin posición y los demás se quedan donde estaban', () => {
    const parsed = mermaidToIR('graph LR\n  A[Web] -->|HTTPS| B[API]\n  B -->|SQL| C[DB]\n  B -->|lee| D[Cache]');
    const result = reconcileIRWithContent(current(), parsed);

    const cache = result.ir.nodes.find((n) => n.label === 'Cache');
    expect(cache).toBeDefined();
    expect(cache?.position).toBeUndefined();
    expect(result.ir.edges.some((e) => e.source === 'B' && e.target === cache?.id && e.label === 'lee')).toBe(true);
    expect(node(result.ir, 'A')?.position).toEqual({ x: 10, y: 20 });
  });

  it('un elemento que desaparece del texto se va con sus conexiones', () => {
    const parsed = mermaidToIR('graph LR\n  A[Web] -->|HTTPS| B[API]');
    const result = reconcileIRWithContent(current(), parsed);

    expect(node(result.ir, 'C')).toBeUndefined();
    expect(result.ir.edges.map((e) => e.id)).toEqual(['e1']);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('ids regenerados con las mismas etiquetas son los mismos elementos', () => {
    const parsed = mermaidToIR('graph LR\n  x1[Web] -->|HTTPS| x2[API]\n  x2 -->|SQL| x3[DB]');
    const result = reconcileIRWithContent(current(), parsed);
    expect(result.changed).toBe(false);
  });

  it('una etiqueta de conexión cambiada se actualiza sin rehacer la conexión', () => {
    const parsed = mermaidToIR('graph LR\n  A[Web] -->|HTTPS/2| B[API]\n  B -->|SQL| C[DB]');
    const result = reconcileIRWithContent(current(), parsed);
    expect(result.ir.edges.find((e) => e.id === 'e1')?.label).toBe('HTTPS/2');
  });

  it('una agrupación nueva en el texto agrupa los elementos existentes', () => {
    const parsed = mermaidToIR('graph LR\n  subgraph Backend\n    B[API]\n    C[DB]\n  end\n  A[Web] -->|HTTPS| B\n  B -->|SQL| C');
    const result = reconcileIRWithContent(current(), parsed);
    const backend = result.ir.groups.find((g) => g.label === 'Backend');
    expect(backend?.nodeIds.sort()).toEqual(['B', 'C']);
  });
});
