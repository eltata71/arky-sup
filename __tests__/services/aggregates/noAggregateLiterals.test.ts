/**
 * Un agregado se construye en su fábrica, y en ningún otro sitio.
 *
 * Este test existe por lo que pasó dos veces ya. `CLAUDE.md` decía —y sigue
 * diciendo— que una atención siempre pertenece a una iniciativa; la regla se
 * cumplía sólo porque los dos únicos llamadores pasaban por el mismo componente
 * de React. El tercero que alguien escribiera habría creado huérfanos en
 * silencio, y el sistema los habría *reportado* en vez de haberlos *rechazado*.
 * Lo mismo valía para el encargo y la iniciativa, construidos con literales
 * dentro de `OfficeContext` e `InitiativeContext`.
 *
 * Las fábricas ya existen. Lo que falta para que la regla se sostenga sola es
 * que nadie pueda volver a rodearlas, y eso no lo da el compilador: un literal
 * de objeto satisface el tipo. Lo da un escáner, igual que
 * `__tests__/authz/noRoleStrings.test.ts` impide comparar roles a mano.
 *
 * El escáner busca **anotaciones de construcción** —`: OfficeEngagement = {`,
 * `: BusinessInitiative = {`— que son la forma en que se escribe un agregado
 * nuevo. No busca `Partial<T>` ni propagaciones (`{ ...engagement, status }`):
 * modificar un agregado existente es legítimo y es lo que hacen las reglas de
 * transición.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Cada agregado, su fábrica, y quién más puede construirlo por una razón. */
const AGGREGATES = [
  {
    type: 'Project',
    factory: 'services/architectureProjects/domain/architectureProjectFactory.ts',
    /**
     * `runtimeValidation` reconstruye un proyecto a partir de lo que hay en la
     * base de datos: no está creando uno nuevo, está saneando uno que ya
     * existe. `portfolioResolver` hace lo mismo para dibujar el grafo.
     */
    alsoAllowed: [
      'services/architectureProjects/domain/projectRuntimeValidation.ts',
      'services/portfolioGraph/portfolioResolver.ts',
      'services/architectureProjects/domain/projectDocumentMapper.ts',
    ],
  },
  {
    type: 'OfficeEngagement',
    factory: 'services/architectureOffice/officeEngagementFactory.ts',
    /**
     * El runner y el servicio del ARB producen el *siguiente estado* de un
     * encargo que ya existe. Son transiciones, no construcción: el agregado ya
     * pasó por la fábrica y sus invariantes se comprobaron entonces.
     */
    alsoAllowed: [
      'services/architectureOffice/OfficeEngagementRunner.ts',
      'services/architectureOffice/OfficeArbService.ts',
    ],
  },
  {
    type: 'BusinessInitiative',
    factory: 'services/businessInitiatives/domain/businessInitiativeFactory.ts',
    /** `buildInitiative` es el ensamblador que la fábrica usa por dentro. */
    alsoAllowed: ['services/businessInitiatives/infrastructure/BusinessInitiativeRepository.ts'],
  },
] as const;

const sourceFiles = (): string[] =>
  execSync('git ls-files --cached --others --exclude-standard "components" "context" "hooks" "pages" "services" "lib" "utils"')
    .toString()
    .split('\n')
    .filter((file) => /\.tsx?$/.test(file) && !/\.d\.ts$/.test(file))
    .filter((file) => !file.includes('__tests__/'));

describe('un agregado se construye en su fábrica', () => {
  for (const { type, factory, alsoAllowed } of AGGREGATES) {
    it(`nadie declara un \`${type}\` nuevo fuera de ${factory.split('/').pop()}`, () => {
      const allowed = new Set<string>([factory, ...alsoAllowed]);
      // `: T = {` y `: T[] = [{` son las formas de escribir uno nuevo.
      // Una propagación (`{ ...previo, campo }`) es una modificación y no cuenta.
      const declaration = new RegExp(`:\\s*${type}\\s*=\\s*\\{(?![^}]*\\.\\.\\.)`);

      const offenders = sourceFiles().filter((file) => {
        if (allowed.has(file)) return false;
        return declaration.test(readFileSync(file, 'utf8'));
      });

      expect(
        offenders,
        `Construye un ${type} con su fábrica. Un literal salta las invariantes, `
        + 'y el compilador no lo ve porque un objeto satisface el tipo.',
      ).toEqual([]);
    });
  }

  it('cada fábrica declarada existe', () => {
    for (const { factory } of AGGREGATES) {
      expect(() => readFileSync(factory, 'utf8'), `${factory} no existe`).not.toThrow();
    }
  });
});
