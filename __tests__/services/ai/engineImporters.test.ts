/**
 * Quién dentro de `services/ai` sigue importando el motor, y que la lista sólo
 * encoge (F5-01).
 *
 * La arista `services/ai -> services (raíz)` es la que cierra el componente de
 * nueve contextos de dominio (ADR-104): cada fachada de esta capa que importa
 * `services/geminiService` es una razón para que exista. El primer corte de
 * F5-01 sacó el transporte —proxy, reintentos, tope de tiempo, cambio de
 * modelo— a `generation/legacyTransport.ts`, y con él cinco importadores que
 * sólo querían enviar un prompt propio.
 *
 * Los que quedan son verticales de prompts de dominio que todavía viven en el
 * motor. Cada uno sale como salió el LMS (`learningVertical.test.ts`): se corta
 * primero su dependencia ascendente, y entonces se borra de esta lista. El
 * segundo corte sacó `learningService`: su último método, `evaluateChallenge`. El
 * octavo sacó `assistantService`, después de que el séptimo moviera sus turnos
 * sin persona: los tres con persona dejaron de buscarla y la reciben. Añadir
 * uno falla; quitar uno sin borrarlo de aquí también, para que el avance quede
 * escrito.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const AI = join(ROOT, 'services', 'ai');

const sourceFiles = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const path = join(directory, entry);
  if (statSync(path).isDirectory()) return sourceFiles(path);
  return /\.ts$/.test(entry) ? [path] : [];
});

/** Código sin comentarios: un docblock que cuenta la migración no es una dependencia. */
const readCode = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const importsEngine = (file: string): boolean =>
  /(?:from|import\()\s*['"](?:\.\.\/)+geminiService['"]/.test(readCode(file));

/** Los importadores que quedan. Sólo puede encoger. */
const REMAINING_ENGINE_IMPORTERS = [
  'services/ai/generation/artifactGenerationService.ts',
];

describe('importadores del motor dentro de services/ai', () => {
  const actual = sourceFiles(AI).filter(importsEngine).map((file) => relative(ROOT, file)).sort();

  it('son exactamente los registrados: ni uno nuevo, ni uno retirado sin anotarlo', () => {
    expect(actual).toEqual([...REMAINING_ENGINE_IMPORTERS].sort());
  });

  it('el transporte y la puerta genérica no vuelven a pasar por el motor', () => {
    for (const file of ['generation/legacyTransport.ts', 'generation/aiGateway.ts']) {
      expect(importsEngine(join(AI, file)), file).toBe(false);
    }
  });
});
