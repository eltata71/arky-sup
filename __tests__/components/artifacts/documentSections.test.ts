import { describe, it, expect } from 'vitest';
import { activeSectionId, adjacentSectionId, sectionFromHash } from '../../../components/artifacts/document/documentSections';

const toc = [
  { id: 'doc-h-a', text: 'A', level: 1 },
  { id: 'doc-h-b', text: 'B', level: 2 },
  { id: 'doc-h-c', text: 'C', level: 2 },
];

describe('documentSections', () => {
  it('marca como activa la última sección que pasó la línea de lectura', () => {
    const tops = [{ id: 'a', top: -300 }, { id: 'b', top: 20 }, { id: 'c', top: 400 }];
    expect(activeSectionId(tops, 80)).toBe('b');
    expect(activeSectionId([{ id: 'a', top: 300 }], 80)).toBe('a');
    expect(activeSectionId([], 80)).toBeNull();
  });
  it('navega a la sección vecina sin salirse de los extremos', () => {
    expect(adjacentSectionId(toc, 'doc-h-a', 1)).toBe('doc-h-b');
    expect(adjacentSectionId(toc, 'doc-h-c', 1)).toBe('doc-h-c');
    expect(adjacentSectionId(toc, 'doc-h-a', -1)).toBe('doc-h-a');
    expect(adjacentSectionId(toc, null, 1)).toBe('doc-h-a');
    expect(adjacentSectionId([], null, 1)).toBeNull();
  });
  it('resuelve un hash compartido sólo si nombra una sección del documento', () => {
    expect(sectionFromHash('#doc-h-b', toc)).toBe('doc-h-b');
    expect(sectionFromHash('#otra', toc)).toBeNull();
    expect(sectionFromHash('', toc)).toBeNull();
  });
});
