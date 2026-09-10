# Motor de Consistencia Arquitectónica

> Parte del Architecture Knowledge Graph (`docs/architecture-knowledge-graph.md`).
> Implementado en `services/architectureKnowledgeGraph/ArchitectureConsistencyService.ts`.

El motor de consistencia lee el grafo de conocimiento y detecta
**inconsistencias entre artefactos**. Solo *detecta* — nunca muta el grafo.
`analyzeArchitectureConsistency(graph, artifacts?)` es puro y nunca lanza.

## Detecciones

| Tipo de issue | Severidad | Qué detecta |
|---|---|---|
| `naming-divergence` | low | Una entidad nombrada de formas distintas entre artefactos |
| `undocumented-external-system` | medium | Sistema externo dibujado pero no documentado |
| `api-not-in-diagram` | medium | API mencionada en documentos, ausente de diagramas |
| `data-entity-without-erd` | low | Entidad de datos sin ERD ni modelo de dominio |
| `requirement-without-traceability` | high | Requerimiento sin trazabilidad |
| `nfr-without-metric` | medium | NFR sin métrica medible |
| `risk-without-mitigation` | high | Riesgo sin mitigación |
| `decision-without-impact` | medium | Decisión sin impacto declarado |
| `component-without-container` | low | Componente sin contenedor padre |
| `dangling-relation` | medium | Relación con extremo no reconocido |
| `integration-without-protocol` | low | Integración sin protocolo declarado |
| `event-without-producer-or-consumer` | medium | Evento sin productor/consumidor |
| `test-without-requirement` | medium | Caso de prueba sin requerimiento asociado |
| `user-story-without-acceptance` | low | Historia de usuario sin criterios de aceptación |
| `ambiguous-glossary-term` | low | Término de glosario ambiguo o sin definir |
| `contradicting-artifacts` | high | Misma entidad con tipos incompatibles entre artefactos |
| `duplicate-entities` | medium | Entidades con alta similitud (posible duplicado) |
| `low-graph-coverage` | low | Artefacto que no aporta entidades al grafo |

## Forma de cada inconsistencia — `ArchitectureConsistencyIssue`

`id`, `severity`, `type`, `message`, `recommendation`, `affectedArtifactIds`,
`affectedEntityIds`, `affectedRelationIds`, `autoFixable`, `confidence`.

## Reporte — `ArchitectureConsistencyReport`

`issues`, `countsBySeverity` y un `verdict`: `clean` · `warning` · `blocked`
(`blocked` cuando hay alguna inconsistencia crítica). El veredicto permite que
el compilador o la UI decidan **advertir o bloquear**.

## Integración

`ArchitectureGraphQualityBridge` filtra las inconsistencias que referencian a
un artefacto concreto y las expone al Motor de Compilación, sin duplicar
lógica: el grafo aporta consistencia; el compilador decide calidad y contrato.

## Limitaciones

- La detección de contradicciones se basa en colisiones de nombre/tipo; no
  hay aún un análisis semántico profundo de afirmaciones contradictorias.
- `autoFixable` está marcado solo para `naming-divergence`; la auto-corrección
  efectiva queda como deuda (requiere UX de revisión previa).
