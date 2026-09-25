import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * El pipeline como contrato comprobable.
 *
 * Tres cosas que este repositorio aprendió por el camino difícil y que no se
 * sostienen con una convención:
 *
 *  1. Hubo un workflow que reemplazaba el árbol de trabajo con `rsync --delete`
 *     desde otro repositorio y hacía `push` a `main`. Sobrevivió a ocho fases
 *     de trabajo en ese mismo `main` porque su disparador era estrecho, no
 *     porque fuera seguro. Se retiró; esta prueba impide que vuelva.
 *  2. Producción sirvió durante días un commit que no existía en el
 *     repositorio, publicado con `vercel --force` desde una estación de
 *     trabajo. El despliegue tiene que colgar de los gates, y el único sitio
 *     donde eso es verificable es el `needs` del trabajo que despliega.
 *  3. El runtime se declara una sola vez, en `.nvmrc`. Una versión repetida a
 *     mano en un job es la que se queda atrás cuando se actualiza.
 */

const WORKFLOW_DIR = new URL('../../.github/workflows/', import.meta.url);

const workflowNames = (): string[] =>
  readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

const readWorkflow = (name: string): string =>
  readFileSync(new URL(name, WORKFLOW_DIR), 'utf8');

describe('CI/CD pipeline structure', () => {
  it('ships the workflows the pipeline is documented to have', () => {
    const names = workflowNames().sort();
    expect(names).toEqual(['ci.yml', 'e2e.yml', 'security.yml', 'supabase.yml']);
  });

  it('has no workflow that replaces the tree from another repository and pushes', () => {
    for (const name of workflowNames()) {
      const body = readWorkflow(name);
      expect(body, `${name} no debe reemplazar el árbol con rsync --delete`).not.toMatch(
        /rsync[^\n]*--delete/,
      );
      expect(body, `${name} no debe empujar a main desde un job`).not.toMatch(
        /git push[^\n]*HEAD:main/,
      );
    }
  });

  it('never triggers on pull_request_target', () => {
    // La palabra aparece en un comentario de `supabase.yml` explicando por qué
    // no se usa, así que lo que se comprueba es el disparador, no el texto.
    for (const name of workflowNames()) {
      expect(readWorkflow(name), `${name}`).not.toMatch(/^\s*pull_request_target:/m);
    }
  });

  it('declares least-privilege permissions in every workflow', () => {
    for (const name of workflowNames()) {
      expect(readWorkflow(name), `${name} debe declarar permissions`).toMatch(
        /^permissions:\s*$/m,
      );
    }
  });

  it('resolves the Node runtime only from .nvmrc', () => {
    for (const name of workflowNames()) {
      const body = readWorkflow(name);
      if (!body.includes('actions/setup-node')) continue;
      expect(body, `${name} debe usar node-version-file`).toContain("node-version-file: '.nvmrc'");
      expect(body, `${name} no debe fijar node-version a mano`).not.toMatch(/^\s+node-version:\s/m);
    }
  });
});

describe('continuous deployment gates on the quality suite', () => {
  const ci = readWorkflow('ci.yml');

  it('defines a deploy job', () => {
    expect(ci).toMatch(/^ {2}deploy:$/m);
  });

  it('runs the deploy only on main, and only from a push or a manual re-run', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toContain("github.ref == 'refs/heads/main'");
    expect(deploy).toContain("github.event_name == 'push'");
    expect(deploy).toContain("github.event_name == 'workflow_dispatch'");
    // Una pull request nunca publica: el disparador se enumera, no se niega.
    expect(deploy).not.toContain("github.event_name == 'pull_request'");
  });

  it('never cancels a deploy that is already running', () => {
    // El `concurrency` del workflow cancela ejecuciones superadas, que es lo
    // correcto para unos gates y exactamente lo contrario para un despliegue:
    // interrumpir `vercel deploy` a mitad deja el estado publicado a merced del
    // momento en que llegó la señal. El trabajo lleva grupo propio, en serie.
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    const block = /concurrency:\s*\n\s*group:\s*deploy-production\s*\n\s*cancel-in-progress:\s*false/;
    expect(deploy).toMatch(block);
  });

  it('records the deployment in a GitHub environment', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toMatch(/environment:\s*\n\s*name:\s*production/);
  });

  it('makes the deploy depend on the static gates and the merged coverage', () => {
    // El trabajo `rules` desapareció con Firestore. Su equivalente vive en
    // `supabase.yml`, que sólo se dispara cuando cambia `supabase/**`:
    // encadenarlo aquí bloquearía cada despliegue esperando a un trabajo que
    // no llegó a ejecutarse.
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    const needs = /needs:\s*\[([^\]]+)\]/.exec(deploy);
    expect(needs, 'el job deploy debe declarar needs').not.toBeNull();
    const declared = needs![1].split(',').map((entry) => entry.trim()).sort();
    expect(declared).toEqual(['coverage', 'quality']);
  });

  it('keeps the database contracts in their own workflow, path-triggered', () => {
    const supabase = readFileSync('.github/workflows/supabase.yml', 'utf8');
    expect(supabase).toContain('scripts/supabase/local.sh test');
    expect(supabase).toMatch(/paths:[\s\S]*?supabase\/\*\*/);
  });

  it('fails loudly instead of reporting a deployment it did not make', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toContain('VERCEL_TOKEN');
    expect(deploy).toContain('VERCEL_ORG_ID');
    expect(deploy).toContain('VERCEL_PROJECT_ID');
    // La ausencia de credenciales termina el job con exit 1, no con un verde.
    expect(deploy).toMatch(/Faltan secretos de despliegue[\s\S]*?exit 1/);
  });

  it('verifies the Vercel project resolved from secrets before it builds or deploys', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    const pullAt = deploy.indexOf('vercel@latest pull');
    const targetCheckAt = deploy.indexOf('scripts/deploy/assertDeploymentTarget.mjs');
    const buildAt = deploy.indexOf('vercel@latest build');
    const deployAt = deploy.indexOf('vercel@latest deploy');

    expect(pullAt, 'deploy debe materializar el destino Vercel').toBeGreaterThan(-1);
    expect(buildAt, 'deploy debe construir el artefacto preconstruido').toBeGreaterThan(-1);
    expect(targetCheckAt, 'deploy debe comprobar el destino resuelto de Vercel').toBeGreaterThan(-1);
    expect(deployAt, 'deploy debe publicar el artefacto preconstruido').toBeGreaterThan(-1);
    expect(targetCheckAt, 'la comprobación sucede después de vercel pull').toBeGreaterThan(pullAt);
    expect(targetCheckAt, 'la comprobación sucede antes de vercel build').toBeLessThan(buildAt);
    expect(targetCheckAt, 'la comprobación sucede antes de vercel deploy').toBeLessThan(deployAt);
  });

  it('refuses to build a commit whose migrations production does not have (F6-10)', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    const pullAt = deploy.indexOf('vercel@latest pull');
    const migrationsAt = deploy.indexOf('scripts/deploy/assertProductionMigrations.mjs');
    const buildAt = deploy.indexOf('vercel@latest build');
    expect(migrationsAt, 'deploy debe comprobar el esquema de producción').toBeGreaterThan(-1);
    expect(migrationsAt, 'después de vercel pull, que trae la URL y la clave publicable').toBeGreaterThan(pullAt);
    expect(migrationsAt, 'antes de construir: un commit sin su esquema no se construye').toBeLessThan(buildAt);
  });

  it('re-scans the artefact it publishes, which the placeholder build cannot cover', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toContain('scripts/checkBundleSecrets.mjs .vercel/output/static');
  });

  it('smoke-tests the published deployment', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toContain('scripts/deploy/productionSmoke.mjs');
  });
});

/**
 * Un solo camino publica producción.
 *
 * El proyecto de Vercel `arky-sup` está enlazado a este repositorio, así que su
 * integración Git despliega **al recibir el push**, sin leer el resultado de
 * ningún gate. Eso convive mal con el trabajo `deploy` de `ci.yml`: dos caminos
 * sobre el mismo alias de producción, uno de ellos sin comprobar nada.
 *
 * No es hipotético. El primer despliegue del proyecto nuevo falló *en el build*,
 * en producción, sobre un commit ya fusionado a `main` —el gate de configuración
 * rechazando una clave de proveedor con prefijo `VITE_`—. Con los gates delante,
 * ese fallo se habría visto en la PR y nunca habría tocado producción.
 *
 * `git.deploymentEnabled` apaga el disparador automático **solo en `main`**: las
 * ramas que no se nombran siguen desplegando, así que las previews de PR —que
 * son el motivo por el que la integración Git vale la pena— no se pierden.
 *
 * Vive en `vercel.json` y no en el panel de Vercel a propósito: un interruptor
 * del dashboard no se revisa, no viaja con el repositorio y nadie se entera el
 * día que alguien lo vuelve a encender.
 */
describe('production has exactly one publisher', () => {
  const vercelConfig = JSON.parse(
    readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
  ) as { git?: { deploymentEnabled?: boolean | Record<string, boolean> } };

  it('disables the Vercel Git integration on main, so only the gated job publishes', () => {
    const enabled = vercelConfig.git?.deploymentEnabled;
    expect(enabled, 'vercel.json debe declarar git.deploymentEnabled').toBeDefined();
    expect(typeof enabled, 'debe ser el mapa por rama, no un booleano global').toBe('object');
    expect((enabled as Record<string, boolean>).main).toBe(false);
  });

  it('keeps preview deployments for every other branch', () => {
    // `deploymentEnabled: false` a secas apagaría también las previews de PR, que
    // es la mitad útil de la integración: revisar un cambio sobre algo servido.
    expect(vercelConfig.git?.deploymentEnabled).not.toBe(false);
  });
});
