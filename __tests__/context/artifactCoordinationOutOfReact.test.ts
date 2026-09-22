/**
 * La coordinación de artefactos no vuelve a React (F4-05).
 *
 * `useArtifactsState` numeraba versiones, recompilaba, elegía el comando y
 * decidía qué revertir. Ahora eso es `services/artifacts/application/
 * artifactWorkflow`, puro y probado sin proveedor. El compilador no puede ver la
 * regresión —importar la fábrica desde el hook es un import válido—, así que se
 * lee el fichero.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'context', 'app', 'useArtifactsState.ts'), 'utf8');
const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

describe('useArtifactsState sólo adapta el flujo de artefactos a React', () => {
  it('no importa la fábrica, el compilador ni el tipo de revisión: decide el flujo', () => {
    expect(imports.filter((path) => /artifactFactory|artifactCompiler|SupabaseArtifactCommands|artifactPersistence/.test(path))).toEqual([]);
    expect(imports).toContain('../../services/artifacts/application/artifactWorkflow');
  });

  it('no numera versiones ni recompila por su cuenta', () => {
    expect(source).not.toMatch(/\.version\s*\+\s*1|version:\s*latest|recompileArtifactBeforePersist|reviseArtifact\(/);
  });
});
