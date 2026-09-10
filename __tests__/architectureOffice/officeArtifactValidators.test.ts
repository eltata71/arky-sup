import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../types';
import {
  OFFICE_VALIDATORS,
  validateOfficeArtifact,
} from '../../services/architectureOffice/officeArtifactValidators';

const artifact = (overrides: Partial<Artifact>): Artifact => ({
  id: 'artifact-1',
  versionGroupId: 'group-1',
  version: 1,
  createdAt: '2026-08-23T00:00:00.000Z',
  name: 'Documento',
  type: 'markdown',
  phase: 'General',
  architecturalView: 'Vista de Calidad y Validación',
  content: '# Documento',
  objective: 'Validar',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

describe('officeArtifactValidators', () => {
  it('registers the eleven validators from the Architecture Office', () => {
    expect(OFFICE_VALIDATORS).toHaveLength(11);
    expect(new Set(OFFICE_VALIDATORS.map((validator) => validator.id)).size).toBe(11);
  });

  it('accepts a complete MADR and rejects an incomplete ADR', () => {
    const complete = validateOfficeArtifact(artifact({
      name: 'ADR-001 Decisión de integración',
      content: '# ADR-001\n\n## Status\nAccepted\n\n## Context\nContexto.\n\n## Decision\nDecisión.\n\n## Consequences\nConsecuencias.',
    }));
    expect(complete.blocking).toBe(false);
    expect(complete.results.find((result) => result.validatorId === 'adr')?.passed).toBe(true);

    const incomplete = validateOfficeArtifact(artifact({
      name: 'ADR-002 Incompleto',
      content: '# ADR-002\n\n## Context\nSin decisión.',
    }));
    expect(incomplete.blocking).toBe(true);
    expect(incomplete.results.find((result) => result.validatorId === 'adr')?.issues)
      .toContainEqual(expect.objectContaining({ code: 'ADR_MISSING_DECISION', severity: 'error' }));
  });

  it('checks OpenAPI security and STRIDE threat coverage deterministically', () => {
    const openapi = validateOfficeArtifact(artifact({
      name: 'Contrato de API (OpenAPI)',
      type: 'yaml',
      content: 'openapi: 3.1.0\ninfo:\n  title: Claims API\n  version: 1.0.0\npaths:\n  /claims:\n    get:\n      summary: Lista siniestros\ncomponents:\n  securitySchemes:\n    bearerAuth:\n      type: http\n      scheme: bearer',
    }));
    expect(openapi.results.find((result) => result.validatorId === 'openapi')?.passed).toBe(true);

    const threat = validateOfficeArtifact(artifact({
      name: 'Threat Model STRIDE',
      content: '# Amenazas\n\n- Spoofing\n- Tampering\n- Repudiation\n',
    }));
    expect(threat.results.find((result) => result.validatorId === 'threat-model')?.passed).toBe(false);
  });

  it('requires an accessible textual description for diagrams', () => {
    const report = validateOfficeArtifact(artifact({
      name: 'Diagrama de Contexto (C4-N1)',
      type: 'mermaid-c4-context',
      representation: 'diagram',
      content: 'C4Context\nPerson(user, "Usuario")\nSystem(app, "ArkyPro")\nRel(user, app, "Usa")',
    }));
    expect(report.results.find((result) => result.validatorId === 'diagram-accessibility')?.passed).toBe(false);
  });

  it('accepts DiagramIR as deterministic evidence for an accessible summary', () => {
    const report = validateOfficeArtifact(artifact({
      name: 'Diagrama de Contexto (C4-N1)',
      type: 'mermaid-c4-context',
      representation: 'diagram',
      content: 'C4Context\nPerson(user, "Usuario")\nSystem(app, "ArkyPro")\nRel(user, app, "Usa")',
      ir: {
        nodes: [
          { id: 'user', label: 'Usuario', kind: 'person' },
          { id: 'app', label: 'ArkyPro', kind: 'system' },
        ],
        edges: [{ id: 'uses', source: 'user', target: 'app', label: 'Usa' }],
        groups: [],
      },
    }));
    expect(report.results.find((result) => result.validatorId === 'diagram-accessibility')?.passed).toBe(true);
  });
});

/**
 * Regressions for the substring-matching defect recorded in
 * `docs/technical-debt-audit.md`: the validators judged documents on prose
 * rather than on structure.
 */
describe('officeArtifactValidators — estructura real, no subcadenas', () => {
  const artifact = (overrides: Partial<Artifact>): Artifact => ({
    id: 'a1',
    versionGroupId: 'g1',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    name: 'Artefacto',
    type: 'markdown',
    phase: 'General',
    architecturalView: 'Vista Lógica y de Diseño',
    content: '',
    objective: '',
    keyConcepts: [],
    representation: 'document',
    ...overrides,
  });

  const reportFor = (input: Artifact, validatorId: string) =>
    validateOfficeArtifact(input).results.find((result) => result.validatorId === validatorId);

  it('no trata como contrato OpenAPI un documento que solo menciona la palabra', () => {
    const prose = artifact({
      type: 'yaml',
      name: 'Notas sobre openapi',
      content: 'notas: |\n  Queremos publicar un openapi con paths y securitySchemes algún día.\n',
    });
    // `applies` ya no dispara: el documento no declara la clave raíz.
    expect(reportFor(prose, 'openapi')).toBeUndefined();
  });

  it('acepta un OpenAPI 3.1 bien formado', () => {
    const spec = artifact({
      type: 'yaml',
      name: 'API de Siniestros',
      content: [
        'openapi: 3.1.0',
        'info:',
        '  title: API de Siniestros',
        '  version: 1.0.0',
        'paths:',
        '  /claims:',
        '    get:',
        '      summary: Lista',
        'components:',
        '  securitySchemes:',
        '    oauth2:',
        '      type: oauth2',
      ].join('\n'),
    });
    expect(reportFor(spec, 'openapi')?.passed).toBe(true);
  });

  it('rechaza paths declarado pero vacío, que antes pasaba', () => {
    const spec = artifact({
      type: 'yaml',
      content: [
        'openapi: 3.1.0',
        'info:',
        '  title: X',
        '  version: 1.0.0',
        'paths:',
        'components:',
        '  securitySchemes:',
        '    oauth2:',
        '      type: oauth2',
      ].join('\n'),
    });
    const result = reportFor(spec, 'openapi');
    expect(result?.passed).toBe(false);
    expect(result?.issues.map((i) => i.code)).toContain('OPENAPI_STRUCTURE');
  });

  it('nombra la versión declarada cuando no es 3.1', () => {
    const spec = artifact({
      type: 'yaml',
      content: 'openapi: 3.0.3\ninfo:\n  title: X\n  version: 1\npaths:\n  /a:\n    get: {}\n',
    });
    const issues = reportFor(spec, 'openapi')?.issues ?? [];
    expect(issues.some((i) => i.code === 'OPENAPI_VERSION' && i.message.includes('3.0.3'))).toBe(true);
  });

  it('valida AsyncAPI por estructura igual que OpenAPI', () => {
    const spec = artifact({
      type: 'yaml',
      content: [
        'asyncapi: 3.0.0',
        'info:',
        '  title: Eventos de Siniestros',
        '  version: 1.0.0',
        'channels:',
        '  claimOpened:',
        '    address: claims/opened',
      ].join('\n'),
    });
    expect(reportFor(spec, 'asyncapi')?.passed).toBe(true);
  });

  it('acepta encabezados ADR en español y en cualquier nivel', () => {
    const adr = artifact({
      name: 'ADR-001 Motor de siniestros',
      content: [
        '# ADR-001',
        '### Estado',
        'Aceptada',
        '### Contexto',
        'El AS/400 limita la evolución.',
        '## Decisión',
        'Strangler Fig.',
        '## Consecuencias',
        'Coexistencia temporal.',
      ].join('\n'),
    });
    expect(reportFor(adr, 'adr')?.passed).toBe(true);
  });

  it('no cuenta un encabezado que vive dentro de un bloque de código', () => {
    const adr = artifact({
      name: 'ADR-002',
      content: ['# ADR-002', '```md', '## Status', '## Context', '## Decision', '## Consequences', '```'].join('\n'),
    });
    const result = reportFor(adr, 'adr');
    expect(result?.passed).toBe(false);
    expect(result?.issues).toHaveLength(4);
  });

  it('detecta un ADR aunque lo hayan renombrado', () => {
    const renamed = artifact({
      name: 'Decisión sobre el core',
      content: ['## Estado', 'Aceptada', '## Contexto', 'x', '## Decisión', 'y', '## Consecuencias', 'z'].join('\n'),
    });
    expect(reportFor(renamed, 'adr')?.passed).toBe(true);
  });

  it('exige que el dialecto C4 abra una línea, no que aparezca en la prosa', () => {
    const prose = artifact({
      type: 'mermaid-c4-context',
      representation: 'diagram',
      content: 'Este diagrama sería un C4Context si lo dibujáramos.',
    });
    expect(reportFor(prose, 'c4')?.passed).toBe(false);

    const real = artifact({
      type: 'mermaid-c4-context',
      representation: 'diagram',
      content: 'C4Context\n  title Sistema de Siniestros\n  Person(a, "Perito")',
    });
    expect(reportFor(real, 'c4')?.passed).toBe(true);
  });

  it('no considera renderizable un párrafo de prosa', () => {
    const prose = artifact({
      type: 'mermaid-graph',
      representation: 'diagram',
      content: 'El sistema se comunica con el core mediante una API.',
    });
    const result = reportFor(prose, 'renderable-diagram');
    expect(result?.passed).toBe(false);
    expect(result?.issues[0].message).toMatch(/no se encontró un bloque de diagrama/i);
  });

  it('acepta Mermaid real y un grafo ReactFlow con nodos', () => {
    const mermaid = artifact({
      type: 'mermaid-graph',
      representation: 'diagram',
      content: 'graph TD\n  A[Core] --> B[API]',
    });
    expect(reportFor(mermaid, 'renderable-diagram')?.passed).toBe(true);

    const reactFlow = artifact({
      type: 'react-flow-graph',
      representation: 'diagram',
      content: JSON.stringify({ nodes: [{ id: 'a' }], edges: [] }),
    });
    expect(reportFor(reactFlow, 'renderable-diagram')?.passed).toBe(true);
  });

  it('rechaza un grafo ReactFlow que no es JSON con nodos', () => {
    const broken = artifact({
      type: 'react-flow-graph',
      representation: 'diagram',
      content: '{ nodes: rotos',
    });
    const result = reportFor(broken, 'renderable-diagram');
    expect(result?.passed).toBe(false);
    expect(result?.issues[0].message).toMatch(/JSON con nodos/i);
  });

  it('exige al menos una operación: un contrato con paths vacío ya no pasa', () => {
    // Endurecimiento deliberado. Antes `paths: {}` pasaba porque el validador
    // buscaba la subcadena "paths:"; un contrato de API sin operaciones no es
    // un entregable de la Oficina.
    const hollow = artifact({
      type: 'yaml',
      content: [
        'openapi: 3.1.0',
        'info:',
        '  title: X',
        '  version: 1.0.0',
        'paths: {}',
        'components:',
        '  securitySchemes:',
        '    bearerAuth:',
        '      type: http',
      ].join('\n'),
    });
    const result = reportFor(hollow, 'openapi');
    expect(result?.passed).toBe(false);
    expect(result?.issues.map((i) => i.code)).toContain('OPENAPI_STRUCTURE');
  });

  it('acepta un flow mapping con operaciones reales', () => {
    const inline = artifact({
      type: 'yaml',
      content: [
        'openapi: 3.1.0',
        'info:',
        '  title: X',
        '  version: 1.0.0',
        'paths: {/claims: {}}',
        'components:',
        '  securitySchemes:',
        '    bearerAuth:',
        '      type: http',
      ].join('\n'),
    });
    expect(reportFor(inline, 'openapi')?.passed).toBe(true);
  });
});
