import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { rpc } from './backend';
import { uniqueSuffix } from './journeys';

export interface SeedSpec {
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly representation: 'diagram' | 'document';
  readonly content: string;
}

const fixture = (...parts: string[]): string => readFileSync(join(process.cwd(), 'tests', 'fixtures', ...parts), 'utf8');
const exportCase = (id: string): { artefacto: { nombre: string; contenido: string } } =>
  JSON.parse(fixture('export-evals', `${id}.json`));

const diagram = (key: string, name: string, type: string, ...path: string[]): SeedSpec =>
  ({ key, name, type, representation: 'diagram', content: fixture(...path) });

/** Seis diagramas canónicos: cuatro niveles de C4, una secuencia y un diagrama de estados. */
export const CANONICAL_DIAGRAMS: readonly SeedSpec[] = [
  diagram('c4-contexto', 'C4 Contexto', 'mermaid-c4-context', 'c4-context-basic.mmd'),
  diagram('c4-contenedores', 'C4 Contenedores', 'mermaid-c4-container', 'c4-container-boundary.mmd'),
  diagram('c4-componentes', 'C4 Componentes', 'mermaid-c4-component', 'c4-component.mmd'),
  diagram('c4-despliegue', 'C4 Despliegue', 'mermaid-c4-deployment', 'c4-deployment.mmd'),
  diagram('secuencia', 'Secuencia', 'mermaid-sequence', 'notation', 'secuencia-fragmentos.mmd'),
  diagram('estados', 'Estados', 'mermaid-state', 'notation', 'estados-compuestos.mmd'),
];

const documentSpec = (key: string, id: string): SeedSpec => {
  const { artefacto } = exportCase(id);
  return { key, name: artefacto.nombre, type: 'markdown', representation: 'document', content: artefacto.contenido };
};

/** Tres documentos: un ADR, una matriz de riesgos y un runbook. */
export const CANONICAL_DOCUMENTS: readonly SeedSpec[] = [
  documentSpec('doc-adr', 'salud-adr-mensajeria-autorizacion'),
  documentSpec('doc-riesgos', 'vida-matriz-riesgos-suscripcion'),
  documentSpec('doc-runbook', 'salud-runbook-elegibilidad'),
];

/** Escribe un artefacto por su comando, como lo haría otro dispositivo, y devuelve su id. */
export async function seedArtifact(request: APIRequestContext, token: string, projectId: string, spec: SeedSpec): Promise<string> {
  const id = `e2e-${spec.key}-${uniqueSuffix()}`;
  await rpc(request, token, 'create_artifact', {
    p_project_id: projectId,
    p_artifact: {
      id,
      name: spec.name,
      type: spec.type,
      versionGroupId: id,
      version: 1,
      createdAt: new Date().toISOString(),
      phase: 'Fase 1: Estratégica y de Visión de Negocio',
      architecturalView: 'Vista de Contexto y Negocio',
      content: spec.content,
      objective: spec.name,
      representation: spec.representation,
      keyConcepts: [],
    },
  });
  return id;
}
