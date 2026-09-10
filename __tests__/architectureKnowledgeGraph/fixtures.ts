/**
 * Shared fixtures for the Architecture Knowledge Graph test suite.
 */

import type {
  ArchitectureGraphArtifactInput,
  ArchitectureGraphBuildInput,
} from '../../services/architectureKnowledgeGraph';

export const NOW = '2026-05-17T00:00:00.000Z';

export const makeArtifact = (
  overrides: Partial<ArchitectureGraphArtifactInput> & Pick<ArchitectureGraphArtifactInput, 'id' | 'name' | 'type'>,
): ArchitectureGraphArtifactInput => ({
  objective: '',
  representation: 'document',
  keyConcepts: [],
  content: '',
  ...overrides,
});

/** A C4 container diagram artifact with a populated DiagramIR. */
export const c4ContainerArtifact: ArchitectureGraphArtifactInput = makeArtifact({
  id: 'art-c4',
  name: 'Diagrama de Contenedores',
  type: 'mermaid-c4-container',
  representation: 'diagram',
  objective: 'Mostrar los contenedores del Sistema de Pagos.',
  ir: {
    nodes: [
      { id: 'sys', label: 'Sistema de Pagos', kind: 'System' },
      { id: 'api', label: 'API de Pagos', kind: 'Container' },
      { id: 'ext', label: 'Pasarela Stripe', kind: 'System_Ext' },
      { id: 'db', label: 'Base de Datos de Pagos', kind: 'ContainerDb', shape: 'cylinder' },
    ],
    edges: [
      { id: 'e1', source: 'api', target: 'ext', label: 'procesa pagos', relation: 'sync', protocol: 'REST' },
      { id: 'e2', source: 'api', target: 'db', label: 'persiste', relation: 'data-flow' },
    ],
    groups: [],
  },
});

/** A BRD document artifact with structured requirement ids. */
export const brdArtifact: ArchitectureGraphArtifactInput = makeArtifact({
  id: 'art-brd',
  name: 'Documento de Requerimientos de Negocio',
  type: 'sdd-brd',
  objective: 'Definir los requerimientos del Sistema de Pagos.',
  content: [
    '# Requerimientos',
    'RF-001: El sistema debe procesar pagos con tarjeta.',
    'RF-002: El sistema debe emitir comprobantes.',
    'El Servicio de Pagos se integra con la Pasarela Stripe.',
  ].join('\n'),
});

/** An NFR document artifact. */
export const nfrArtifact: ArchitectureGraphArtifactInput = makeArtifact({
  id: 'art-nfr',
  name: 'Requisitos No Funcionales',
  type: 'sdd-nfr',
  content: [
    '# NFR',
    'RNF-001: La latencia de la API debe ser menor a 200 ms.',
    'RNF-002: Disponibilidad del 99.9%.',
  ].join('\n'),
});

/** A requirements traceability matrix. */
export const traceabilityArtifact: ArchitectureGraphArtifactInput = makeArtifact({
  id: 'art-trace',
  name: 'Matriz de Trazabilidad',
  type: 'sdd-traceability',
  content: [
    '| Requerimiento | Caso de Uso | Caso de Prueba |',
    '| --- | --- | --- |',
    '| RF-001 | UC-001 | TC-001 |',
    '| RF-002 | UC-002 | TC-002 |',
  ].join('\n'),
});

/** A glossary artifact. */
export const glossaryArtifact: ArchitectureGraphArtifactInput = makeArtifact({
  id: 'art-glossary',
  name: 'Glosario',
  type: 'sdd-glossary',
  keyConcepts: [
    { term: 'Pago', definition: 'Transacción monetaria efectuada por un cliente.' },
  ],
  content: [
    '| Término | Definición |',
    '| --- | --- |',
    '| Conciliación | Proceso de validación contable de las transacciones de pago. |',
  ].join('\n'),
});

/** A full, multi-artifact build input. */
export const fullBuildInput: ArchitectureGraphBuildInput = {
  projectId: 'project-1',
  projectName: 'Plataforma de Pagos',
  projectDescription:
    'Plataforma de Pagos que usa PostgreSQL como base de datos principal y se integra con servicios externos.',
  projectContext: ['Decidimos usar una arquitectura de microservicios.'],
  agentMemory: ['Riesgo: la Pasarela Stripe puede tener caídas.'],
  initialCapture: ['El proyecto debe cumplir la regulación PCI-DSS.'],
  artifacts: [c4ContainerArtifact, brdArtifact, nfrArtifact, traceabilityArtifact, glossaryArtifact],
  now: NOW,
};
