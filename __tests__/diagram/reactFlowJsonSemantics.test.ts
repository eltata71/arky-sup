/**
 * Regression coverage for `reactFlowJsonToIR` — the import path used when an
 * artifact's `type === 'react-flow-graph'` and content is JSON. Older
 * persisted artifacts tagged every node with `kind: 'Component'` because
 * the renderer did not distinguish kinds at the time. This made personas /
 * databases / queues collapse to the generic service palette after import.
 *
 * The new pipeline repairs the IR using the canonical semantic resolver
 * and exposes the corrected role on `node.semanticRole`.
 */

import { describe, it, expect } from 'vitest';
import { extractIRFromArtifact } from '../../services/diagram';
import type { Artifact } from '../../lib/artifacts';

const buildArtifact = (content: string): Artifact => ({
  id: 'a',
  versionGroupId: 'a',
  version: 1,
  createdAt: new Date().toISOString(),
  name: 'graph',
  type: 'react-flow-graph',
  phase: '—',
  architecturalView: 'Vista de Datos',
  content,
  objective: 'test',
  keyConcepts: [],
  representation: 'diagram',
});

describe('reactFlowJsonToIR — semantic repair', () => {
  it('repairs a legacy node tagged kind:"Component" with label "Asegurado" to person', () => {
    const json = JSON.stringify({
      nodes: [
        { id: 'u', data: { label: 'Asegurado', type: 'Component', kind: 'Component' } },
        { id: 'db', data: { label: 'Base de Datos de Reclamos', kind: 'Component' } },
        { id: 'q', data: { label: 'Cola de Eventos', kind: 'Component' } },
      ],
      edges: [],
    });
    const ir = extractIRFromArtifact(buildArtifact(json));
    expect(ir).not.toBeNull();
    const u = ir!.nodes.find((n) => n.id === 'u');
    expect(u?.semanticRole).toBe('person');
    expect(u?.shape).toBe('person');
    const db = ir!.nodes.find((n) => n.id === 'db');
    expect(db?.semanticRole).toBe('data');
    const q = ir!.nodes.find((n) => n.id === 'q');
    expect(q?.semanticRole).toBe('messaging');
    // Repair was applied — history must be appended.
    expect(ir!.metadata?.repairHistory?.length).toBeGreaterThan(0);
    expect(ir!.metadata?.repairHistory?.[0].reason).toBe('semantic-role-repair');
  });

  it('preserves a semanticRole already persisted on the JSON payload', () => {
    const json = JSON.stringify({
      nodes: [
        { id: 'u', data: { label: 'Whatever', kind: 'Component', semanticRole: 'person' } },
      ],
      edges: [],
    });
    const ir = extractIRFromArtifact(buildArtifact(json));
    expect(ir).not.toBeNull();
    const u = ir!.nodes.find((n) => n.id === 'u');
    // The persisted role wins; the resolver only fills it in when absent.
    expect(u?.semanticRole).toBe('person');
  });

  it('imports a fully-tagged C4 ReactFlow JSON without modifying its roles', () => {
    const json = JSON.stringify({
      nodes: [
        { id: 'p', data: { label: 'Operador', kind: 'Person', shape: 'person' } },
        { id: 'api', data: { label: 'API Gateway', kind: 'Container', technology: 'Spring Cloud Gateway' } },
        { id: 'db', data: { label: 'Reclamos DB', kind: 'ContainerDb', technology: 'PostgreSQL' } },
      ],
      edges: [
        { id: 'e1', source: 'p', target: 'api', label: 'usa' },
        { id: 'e2', source: 'api', target: 'db', label: 'lee/escribe' },
      ],
    });
    const ir = extractIRFromArtifact(buildArtifact(json));
    expect(ir).not.toBeNull();
    expect(ir!.nodes.find((n) => n.id === 'p')?.semanticRole).toBe('person');
    expect(ir!.nodes.find((n) => n.id === 'api')?.semanticRole).toBe('gateway');
    expect(ir!.nodes.find((n) => n.id === 'db')?.semanticRole).toBe('data');
  });
});
