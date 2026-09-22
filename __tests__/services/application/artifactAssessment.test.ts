/**
 * Las decisiones que el lienzo tomaba entre dos ramas de JSX.
 *
 * `ArtifactCanvas` importaba de ocho módulos de servicio y encadenaba sus
 * resultados en el cuerpo del componente. Nada de esto se podía comprobar sin
 * montar un lienzo, unas medidas de ReactFlow y un artefacto renderizado — que
 * es la razón por la que no había una sola prueba de ello.
 */

import { describe, expect, it } from 'vitest';
import {
  assessDiagramQuality,
  assessPreflight,
  assessVisualGate,
  enrichSuggestions,
  resolveExportView,
} from '../../../services/artifacts/application/artifactAssessment';
import type { Artifact } from '../../../lib/artifacts';

const artifact = { id: 'a1', content: '', lastDiagramError: undefined } as unknown as Artifact;

describe('resolveExportView', () => {
  it('exporta como diagrama las tres formas de enseñar un diagrama', () => {
    // Excalidraw, Lucidchart y Fable son visores distintos del mismo IR.
    for (const view of ['excalidraw', 'lucidchart', 'fable']) {
      expect(resolveExportView(view)).toBe('diagram');
    }
  });

  it('exporta la vista de publicación como documento', () => {
    expect(resolveExportView('publication')).toBe('document');
  });

  it('deja pasar los modos que ya son vistas de exportación', () => {
    expect(resolveExportView('markdown')).toBe('markdown');
    expect(resolveExportView('document')).toBe('document');
  });
});

describe('assessDiagramQuality', () => {
  it('cae al informe sólo-IR mientras el lienzo no ha medido nada', () => {
    // El panel siempre tiene que tener *algo* que enseñar: uno vacío se lee
    // como «este diagrama no tiene problemas».
    const fallback = { score: 42 } as never;
    expect(assessDiagramQuality({
      artifact, ir: { nodes: [], edges: [] } as never, layout: null,
      fallback, lastPreflightReady: undefined,
    })).toBe(fallback);
  });

  it('cae al informe sólo-IR cuando no hay IR', () => {
    const fallback = { score: 7 } as never;
    expect(assessDiagramQuality({
      artifact, ir: null, layout: { nodeRects: [], groupRects: [] },
      fallback, lastPreflightReady: undefined,
    })).toBe(fallback);
  });

  it('devuelve null cuando no hay ni IR ni informe previo', () => {
    expect(assessDiagramQuality({
      artifact, ir: null, layout: null, fallback: null, lastPreflightReady: undefined,
    })).toBeNull();
  });
});

describe('assessPreflight', () => {
  it('no hay preflight sin IR', () => {
    expect(assessPreflight(null, { score: 1 } as never)).toBeNull();
  });

  it('no hay preflight sin informe de calidad', () => {
    expect(assessPreflight({ nodes: [], edges: [] } as never, null)).toBeNull();
  });
});

describe('assessVisualGate', () => {
  /** Un diagrama con nodos: nada que bloquear de forma dura. */
  const drawn = { contentNodeCount: 5 } as never;
  /** Un diagrama sin nodos renderizados. */
  const empty = { contentNodeCount: 0 } as never;

  it('un diagrama vacío bloquea duro aunque la puerta diga que está lista', () => {
    // Exportar cero nodos produce un fichero vacío que parece un entregable.
    // Es la razón por la que el bloqueo duro existe y manda sobre el estado.
    const result = assessVisualGate('ready' as never, 'export' as never, empty);
    expect(result.guard.hardBlock).toBe(true);
    expect(result.guard.hardBlockCode).toBe('EMPTY_DIAGRAM');
    expect(result.tone).toBe('block');
    expect(result.showBanner).toBe(true);
  });

  it('el bloqueo duro manda sobre el tono que dictaría el estado', () => {
    // Sin bloqueo el tono de `warnings` sería ámbar; con él, rojo.
    expect(assessVisualGate('warnings' as never, 'export' as never, drawn).tone).not.toBe('block');
    expect(assessVisualGate('warnings' as never, 'export' as never, empty).tone).toBe('block');
  });

  it('enseña el aviso cuando la puerta está bloqueada o con avisos', () => {
    expect(assessVisualGate('blocked' as never, 'export' as never, drawn).showBanner).toBe(true);
    expect(assessVisualGate('warnings' as never, 'export' as never, drawn).showBanner).toBe(true);
  });

  it('no enseña el aviso cuando la puerta está lista y el diagrama tiene nodos', () => {
    expect(assessVisualGate('ready' as never, 'export' as never, drawn).showBanner).toBe(false);
  });
});

describe('enrichSuggestions', () => {
  it('sin informe no hay nada que enriquecer', () => {
    expect(enrichSuggestions({ report: null, ir: null, quality: null, density: 'normal' })).toBeNull();
  });

  it('sin IR devuelve el informe tal cual, no uno vacío', () => {
    // Una sugerencia sin acción ejecutable sigue siendo una sugerencia útil;
    // vaciarla la haría desaparecer del panel.
    const report = { suggestions: [{ id: 's1' }] };
    expect(enrichSuggestions({ report, ir: null, quality: null, density: 'normal' })).toBe(report);
  });
});
