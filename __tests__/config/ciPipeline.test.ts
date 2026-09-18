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

  it('runs the deploy only for a push to main', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
  });

  it('makes the deploy depend on the static gates, the merged coverage and the rules', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    const needs = /needs:\s*\[([^\]]+)\]/.exec(deploy);
    expect(needs, 'el job deploy debe declarar needs').not.toBeNull();
    const declared = needs![1].split(',').map((entry) => entry.trim()).sort();
    expect(declared).toEqual(['coverage', 'quality', 'rules']);
  });

  it('fails loudly instead of reporting a deployment it did not make', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toContain('VERCEL_TOKEN');
    expect(deploy).toContain('VERCEL_ORG_ID');
    expect(deploy).toContain('VERCEL_PROJECT_ID');
    // La ausencia de credenciales termina el job con exit 1, no con un verde.
    expect(deploy).toMatch(/Faltan secretos de despliegue[\s\S]*?exit 1/);
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
