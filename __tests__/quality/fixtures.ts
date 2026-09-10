import type { Artifact, ArtifactType } from '../../types';
import type { DiagramIR } from '../../lib/diagram';

export const baseArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'art-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-05-10T00:00:00.000Z',
  name: 'Artefacto de prueba',
  type: 'markdown' as ArtifactType,
  phase: 'Lógica',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '',
  objective: 'Objetivo del artefacto',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

export const fullDocumentContent = `# Documento de Diseño

## Objetivo
Definir la arquitectura del módulo X para sostener 10x el tráfico actual.

## Alcance
- **Incluye:** módulo de órdenes y pagos.
- **Excluye:** integraciones legadas pendientes de retiro.

## Contexto
El sistema actual no escala porque depende de una base monolítica.

## Supuestos
- El equipo de operaciones puede dedicar 2 ingenieros.
- La latencia objetivo p99 es 250ms.

## Riesgos
| Riesgo | Severidad | Mitigación |
|---|---|---|
| Migración de datos | Alta | Backfill incremental con verificación |
| Falta de observabilidad | Media | Dashboards Grafana antes del corte |

## Decisiones
- Se decide migrar a PostgreSQL particionado.

## Trazabilidad
| Requisito | Artefacto | Cobertura |
|---|---|---|
| RF-01 | API de Órdenes | Completa |

## Criterios de aceptación
- [ ] Latencia p99 < 250ms en pruebas de carga.
- [ ] Pruebas de regresión pasan al 100%.
`;

export const emptyDocumentArtifact = baseArtifact({ content: '' });
export const minimalDocumentArtifact = baseArtifact({ content: 'Texto breve.' });
export const richDocumentArtifact = baseArtifact({ content: fullDocumentContent });

export const tableOnlyContent = `# Diccionario de Datos

| Campo | Tipo | Sensibilidad |
|---|---|---|
| nombre | VARCHAR(100) | PII |
| fecha_nacimiento | DATE | PHI |
`;

export const validDiagramIR = (): DiagramIR => ({
  nodes: [
    { id: 'gateway', label: 'API Gateway', kind: 'Container', description: 'Recibe tráfico externo' },
    { id: 'svc', label: 'Order Service', kind: 'Container', description: 'Procesa órdenes' },
    { id: 'db', label: 'Order DB', kind: 'Database', description: 'PostgreSQL 15', technology: 'PostgreSQL 15' },
  ],
  edges: [
    { id: 'e1', source: 'gateway', target: 'svc', label: 'REST / HTTPS' },
    { id: 'e2', source: 'svc', target: 'db', label: 'JDBC' },
  ],
  groups: [],
  metadata: { sourceFormat: 'mermaid', generatedAt: '2026-05-10T00:00:00.000Z', title: 'Order System' },
});

export const emptyDiagramIR = (): DiagramIR => ({
  nodes: [],
  edges: [],
  groups: [],
});

export const diagramWithOrphans = (): DiagramIR => ({
  nodes: [
    { id: 'a', label: 'Service A', kind: 'Container' },
    { id: 'b', label: 'Service B', kind: 'Container' },
    { id: 'orphan', label: 'Orphan', kind: 'Container' },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b', label: 'Calls' }],
  groups: [],
});

export const diagramWithInvalidRef = (): DiagramIR => ({
  nodes: [
    { id: 'a', label: 'Service A', kind: 'Container' },
    { id: 'b', label: 'Service B', kind: 'Container' },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'missing', label: 'Calls' }],
  groups: [],
});
