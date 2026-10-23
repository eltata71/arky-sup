import { describe, expect, it } from 'vitest';
import {
  createListOfficeStandardsTool,
  createReadArtifactTool,
  createSearchArtifactsTool,
  createToolRegistry,
  extractMarkdownSection,
  type ReadableArtifact,
} from '../../../services/ai/tools';

const artifacts: ReadableArtifact[] = [
  { id: 'a1', name: 'ADR-014 Mensajería', type: 'adr', version: 2, objective: 'Decidir el bus de eventos.', content: '# ADR\n## Contexto\nColas y eventos.\n## Decisión\nUsar Kafka.\n' },
  { id: 'a2', name: 'Runbook elegibilidad', type: 'runbook', version: 1, objective: '', content: '# Runbook\nPasos de recuperación.' },
];
const registry = createToolRegistry([
  createReadArtifactTool({ list: () => artifacts }),
  createSearchArtifactsTool({ list: () => artifacts }),
  createListOfficeStandardsTool({ list: () => [{ id: 's1', title: 'Cifrado', summary: 'Todo dato en reposo se cifra.' }] }),
]);

describe('herramientas de lectura del Despacho', () => {
  it('declara las tres con descripción de cuándo usarlas y cuándo no', () => {
    for (const tool of registry.list()) {
      expect(tool.definition.description).toContain('Úsala cuando');
      expect(tool.definition.description).toContain('No la uses cuando');
      expect(tool.effect).toBe('read-only');
    }
  });

  it('search_artifacts devuelve ids citables ordenados por coincidencia', async () => {
    const result = await registry.execute('search_artifacts', { query: 'eventos kafka' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('[ctx:artifact/a1]');
    expect(result.text).not.toContain('a2');
  });

  it('search_artifacts filtra por tipo y avisa cuando no hay resultados', async () => {
    const result = await registry.execute('search_artifacts', { query: 'eventos', type: 'runbook' });
    expect(result.text).toContain('Ningún artefacto coincide');
  });

  it('read_artifact da resumen, sección y errores accionables', async () => {
    expect((await registry.execute('read_artifact', { artifactId: 'a1' })).text).toContain('Secciones: ADR | Contexto | Decisión');
    expect((await registry.execute('read_artifact', { artifactId: 'a1', section: 'decisión' })).text).toContain('Usar Kafka');
    const missing = await registry.execute('read_artifact', { artifactId: 'zz' });
    expect(missing.ok).toBe(false);
    expect(missing.text).toContain('search_artifacts');
    const noSection = await registry.execute('read_artifact', { artifactId: 'a1', section: 'Riesgos' });
    expect(noSection.text).toContain('Secciones: ');
  });

  it('read_artifact respeta el tope de respuesta', async () => {
    const big = createToolRegistry([createReadArtifactTool({ list: () => [{ ...artifacts[0], content: `## Contexto\n${'x'.repeat(9_000)}` }] })]);
    const result = await big.execute('read_artifact', { artifactId: 'a1', section: 'Contexto' });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(3_000);
  });

  it('list_office_standards filtra por texto', async () => {
    expect((await registry.execute('list_office_standards', { query: 'cifr' })).text).toContain('[ctx:standard/s1]');
    expect((await registry.execute('list_office_standards', { query: 'nada' })).text).toContain('Ningún estándar');
  });

  it('extractMarkdownSection se detiene en el siguiente encabezado del mismo nivel', () => {
    expect(extractMarkdownSection(artifacts[0].content, 'Contexto')).toBe('## Contexto\nColas y eventos.');
  });
});
