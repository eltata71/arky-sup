/**
 * Las reglas de identidad y versionado de un Artefacto, sin React.
 *
 * Estaban dentro de `useArtifactsState`, mezcladas con el `setState` optimista
 * y la escritura remota. Lo que se comprueba aquí es lo que ese hook decidía de
 * paso: que la primera versión abre su propio grupo, que el número sale de las
 * versiones que ya existen, y que revisar un artefacto recompila en vez de
 * heredar la puntuación del contenido viejo.
 */

import { describe, expect, it } from 'vitest';
import {
  createArtifact,
  createArtifactVersion,
  reviseArtifact,
} from '../../../services/artifacts/artifactFactory';
import type { Artifact } from '../../../types';

const draft = {
  name: 'Diagrama de contexto',
  type: 'Diagrama de Contexto (C4 Nivel 1)',
  content: 'graph TD; A-->B;',
  view: 'Vista Funcional',
} as unknown as Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>;

const at = (iso: string) => () => iso;

describe('createArtifact', () => {
  it('abre su propio grupo de versiones', () => {
    // `versionGroupId === id` en la v1 no es casualidad: es lo que permite
    // pedir «todas las versiones de esto» sin una tabla aparte.
    const artifact = createArtifact(draft, { id: 'art-1', now: at('2026-09-02T00:00:00.000Z') });
    expect(artifact.id).toBe('art-1');
    expect(artifact.versionGroupId).toBe('art-1');
    expect(artifact.version).toBe(1);
  });

  it('genera un id cuando no se le da uno', () => {
    const a = createArtifact(draft);
    const b = createArtifact(draft);
    expect(a.id).not.toBe(b.id);
  });
});

describe('createArtifactVersion', () => {
  const v1 = createArtifact(draft, { id: 'art-1', now: at('2026-09-01T00:00:00.000Z') });

  it('numera sobre el máximo del grupo, no sobre el total', () => {
    const other = createArtifact(draft, { id: 'otro', now: at('2026-09-01T00:00:00.000Z') });
    const v2 = createArtifactVersion('art-1', draft, [v1, other], { id: 'art-2' });
    expect(v2.version).toBe(2);
    expect(v2.versionGroupId).toBe('art-1');
  });

  it('empieza en 1 cuando el grupo todavía no tiene versiones', () => {
    const v = createArtifactVersion('grupo-vacio', draft, [], { id: 'art-9' });
    expect(v.version).toBe(1);
  });

  it('no reutiliza un número aunque le pasen las versiones desordenadas', () => {
    const v2 = createArtifactVersion('art-1', draft, [v1], { id: 'a2' });
    const v3 = createArtifactVersion('art-1', draft, [v2, v1], { id: 'a3' });
    expect(v3.version).toBe(3);
  });
});

describe('reviseArtifact', () => {
  it('crea la siguiente versión del mismo grupo con el contenido nuevo', () => {
    const v1 = createArtifact(draft, { id: 'art-1', now: at('2026-09-01T00:00:00.000Z') });
    const v2 = reviseArtifact(v1, v1.version, { content: 'graph TD; A-->C;' }, { id: 'art-2' });

    expect(v2.version).toBe(2);
    expect(v2.versionGroupId).toBe('art-1');
    expect(v2.content).toBe('graph TD; A-->C;');
    expect(v2.id).not.toBe(v1.id);
  });

  it('no arrastra la compilación del contenido anterior', () => {
    // Un artefacto que dice estar compilado y puntuado sobre un texto que ya no
    // tiene es peor que uno sin puntuar: parece verificado.
    const v1 = createArtifact(draft, { id: 'art-1', now: at('2026-09-01T00:00:00.000Z') });
    const stale = { ...v1, compilation: { marker: 'viejo' } } as unknown as Artifact;
    const v2 = reviseArtifact(stale, 1, { content: 'contenido completamente distinto' }, { id: 'art-2' });

    expect((v2.compilation as unknown as { marker?: string })?.marker).toBeUndefined();
  });
});
