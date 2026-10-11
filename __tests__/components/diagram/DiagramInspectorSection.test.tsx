import { render, screen } from '@testing-library/react';
import type { Edge, Node } from 'reactflow';
import { describe, expect, it } from 'vitest';
import { en } from '../../../lib/i18n/locales/en';
import { NodeInspector, EdgeInspector } from '../../../components/diagram/DiagramInspectorSection';

const source: Node = { id: 'source', position: { x: 0, y: 0 }, data: { label: 'Source node' } };
const target: Node = { id: 'target', position: { x: 0, y: 0 }, data: { label: 'Target node' } };
const edge: Edge = { id: 'edge', source: source.id, target: target.id };

describe('diagram inspectors', () => {
  it('renders by itself in Spanish without an application provider', () => {
    render(<NodeInspector node={source} nodes={[source, target]} edges={[edge]} />);

    expect(screen.getByText('Inspeccionar')).toBeInTheDocument();
    expect(screen.getByText('Categoría')).toBeInTheDocument();
  });

  it('uses the translator supplied by its parent', () => {
    const t = (key: string) => en[key] ?? key;
    render(<EdgeInspector edge={edge} nodes={[source, target]} t={t} />);

    expect(screen.getByText('Inspect')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Target')).toBeInTheDocument();
  });
});
