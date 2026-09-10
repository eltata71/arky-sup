# Motor de Trazabilidad e Impacto Arquitectónico

> Parte del Architecture Knowledge Graph (`docs/architecture-knowledge-graph.md`).
> Implementado en `ArchitectureTraceabilityService.ts` e
> `ArchitectureImpactAnalysisService.ts`.

## 1. Trazabilidad bidireccional

`analyzeArchitectureTraceability(graph)` recorre el grafo y entrega un
`ArchitectureTraceabilityReport` con vacíos (`gaps`), cobertura de
requerimientos, cobertura de riesgos y número de enlaces. Funciones de
consulta (lecturas puras, nunca mutan estado):

| Función | Pregunta que responde |
|---|---|
| `getArtifactsSupportingEntity(graph, entityId)` | ¿Qué artefactos soportan una entidad? |
| `getEntitiesInArtifact(graph, artifactId)` | ¿Qué entidades aparecen en un artefacto? |
| `getRequirementsWithoutCoverage(graph)` | ¿Qué requerimientos no tienen cobertura? |
| `getRisksWithoutMitigation(graph)` | ¿Qué riesgos no tienen mitigación? |
| `getDecisionsWithoutImpact(graph)` | ¿Qué decisiones no declaran impacto? |
| `getTraceabilityLinks(graph)` | Todos los enlaces trazables del grafo |

Relaciones consideradas "trazables": `tracesTo`, `satisfies`, `implements`,
`validates`, `mitigates`, `derivedFrom`, `impacts`.

### Vacíos detectados — `ArchitectureTraceabilityGap`

`requirement-without-test`, `requirement-without-artifact`,
`nfr-without-quality-attribute`, `risk-without-mitigation`,
`decision-without-impacted-entity`, `data-entity-without-store`,
`event-without-consumer`, `use-case-without-actor`.

Cadenas cubiertas: requerimientos ↔ artefactos ↔ pruebas, NFR ↔ atributos de
calidad, riesgos ↔ mitigaciones, decisiones ↔ componentes, datos ↔ almacenes,
casos de uso ↔ actores, eventos ↔ productores/consumidores.

## 2. Análisis de impacto

`analyzeArchitectureImpact(graph, request)` — dado un `entity`, `relation` o
`artifact` — recorre el grafo (BFS hasta `maxDepth`, por defecto 2) y devuelve
un `ArchitectureImpactResult`:

- `impactedArtifacts` / `impactedArtifactIds` — artefactos a revisar;
- `relatedEntityIds` / `relatedRelationIds` — vecindad afectada;
- `severity` — `info … critical`, escalada por criticidad del elemento, por
  tipos de alto impacto (API, integración, datos, decisión, bounded context)
  y por amplitud del impacto;
- `reasons` — explicación legible;
- `recommendations` — próximos pasos;
- `requiresArtifactRegeneration` — si conviene regenerar artefactos;
- `requiresHumanReview` — si exige revisión humana;
- `resolved` — `false` cuando el `targetId` es desconocido (sin lanzar).

Ejemplo: cambiar una API identifica diagramas de contenedores y de secuencia,
documentos de integración, NFR de rendimiento y casos de prueba conectados.

## 3. Limitaciones

- El recorrido de impacto es estructural (vecindad en el grafo); no pondera
  aún la fuerza semántica de cada relación.
- La cobertura de requerimientos asume que la matriz de trazabilidad modela
  correctamente los enlaces; matrices mal formadas reducen el recall.
