---
artifact_id: 00-INDEX
version: 1.0.0
status: Active
created: 2026-04-13
project: Arky 10 (arkypro-1.0)
domain: SaaS — Arquitectura de Soluciones / Seguros
generated_by: Claude Code · SDD Architect
---

# Índice de Artefactos SDD — Arky 10

Este directorio contiene los artefactos de especificación del proyecto **Arky 10** siguiendo la metodología **Specification-Driven Development (SDD)**.

---

## Estructura de Carpetas

```
specs/
├── 00-index.md                   ← Este archivo
├── 01-requirements/              ← FASE 1: Especificación de Requisitos
│   ├── BRD.md                    ← Business Requirements Document (IEEE 830)
│   ├── use-cases/
│   │   └── use-cases-spec.md     ← Especificación de Casos de Uso (UML 2.5)
│   └── user-stories/
│       └── user-story-map.md     ← User Story Map + Backlog (SAFe/Scrum)
├── 02-architecture/              ← FASE 2: Especificación de Arquitectura
│   ├── ADR/
│   │   ├── ADR-001-sdd-architecture.md   ← Decision de adoptar SDD
│   │   ├── ADR-002-canonical-ai-kernel.md ← El contrato canónico de IA
│   │   ├── ADR-003-model-routing-strategy.md ← Elegibilidad, ranking y fallback
│   │   ├── ADR-004-agent-contract-and-registry.md ← Contrato de agente y registro
│   │   ├── ADR-005-diagram-story-plan.md ← La historia es parte del modelo
│   │   └── ADR-006-semantic-diagram-patches.md ← Editar sin regenerar
│   ├── domain-model/
│   │   └── domain-model-ddd.md   ← Modelo de Dominio DDD
│   └── event-storming/
│       └── event-storming.md     ← Event Storming
├── 03-components/                ← FASE 3: Especificación de Componentes
│   ├── glossary/
│   │   └── ubiquitous-language.md ← Glosario de Lenguaje Ubicuo
│   └── component-specs/
│       └── sdd-extension.md      ← Especificación del módulo SDD
├── 04-quality/                   ← FASE 4: Especificación de Calidad
│   ├── nfr-spec.md               ← Non-Functional Requirements (ISO 25010)
│   ├── bdd-scenarios/
│   │   └── bdd-sdd-features.md   ← Escenarios BDD en Gherkin
│   └── traceability/
│       └── traceability-matrix.md ← Matriz de Trazabilidad (IEEE 29148)
└── session-log.md                ← Log de decisiones de la sesión SDD
```

---

## Índice de Artefactos

| # | Artefacto | Ruta | Estado | Versión | Estándar |
|---|-----------|------|--------|---------|----------|
| 1 | BRD | `specs/01-requirements/BRD.md` | ✅ Aprobado | 1.0.0 | IEEE 830 |
| 2 | Casos de Uso | `specs/01-requirements/use-cases/use-cases-spec.md` | ✅ Aprobado | 1.0.0 | UML 2.5 |
| 3 | User Story Map | `specs/01-requirements/user-stories/user-story-map.md` | ✅ Aprobado | 1.0.0 | SAFe/Scrum |
| 4 | ADR-001 | `specs/02-architecture/ADR/ADR-001-sdd-architecture.md` | ✅ Aprobado | 1.0.0 | — |
| 4 | ADR-002 | `specs/02-architecture/ADR/ADR-002-canonical-ai-kernel.md` | ✅ Aprobado | 1.0.0 | — |
| 4 | ADR-003 | `specs/02-architecture/ADR/ADR-003-model-routing-strategy.md` | ✅ Aprobado | 1.0.0 | — |
| 4 | ADR-004 | `specs/02-architecture/ADR/ADR-004-agent-contract-and-registry.md` | ✅ Aprobado | 1.0.0 | — |
| 4 | ADR-005 | `specs/02-architecture/ADR/ADR-005-diagram-story-plan.md` | ✅ Aprobado | 1.0.0 | — |
| 4 | ADR-006 | `specs/02-architecture/ADR/ADR-006-semantic-diagram-patches.md` | ✅ Aprobado | 1.0.0 | — |
| 5 | Domain Model DDD | `specs/02-architecture/domain-model/domain-model-ddd.md` | ✅ Aprobado | 1.0.0 | DDD/Evans |
| 6 | Event Storming | `specs/02-architecture/event-storming/event-storming.md` | ✅ Aprobado | 1.0.0 | Brandolini |
| 7 | Glosario UL | `specs/03-components/glossary/ubiquitous-language.md` | ✅ Aprobado | 1.0.0 | DDD |
| 8 | SDD Extension Spec | `specs/03-components/component-specs/sdd-extension.md` | ✅ Aprobado | 1.0.0 | IEEE 1016 |
| 9 | NFR (ISO 25010) | `specs/04-quality/nfr-spec.md` | ✅ Aprobado | 1.0.0 | ISO 25010 |
| 10 | BDD Scenarios | `specs/04-quality/bdd-scenarios/bdd-sdd-features.md` | ✅ Aprobado | 1.0.0 | Gherkin |
| 11 | Traceability Matrix | `specs/04-quality/traceability/traceability-matrix.md` | ✅ Aprobado | 1.0.0 | IEEE 29148 |

---

## Convención de Versionado

- `x.0.0` — Versión mayor: cambio estructural significativo
- `x.1.0` — Versión menor: adición de contenido
- `x.x.1` — Parche: corrección de errores o aclaraciones

## Guía de Contribución

1. Nunca modificar un artefacto sin actualizar su `version` y `status`
2. Cambios que afectan trazabilidad deben actualizarse en `traceability-matrix.md`
3. Nuevos términos de dominio deben añadirse a `ubiquitous-language.md`
4. Decisiones arquitectónicas significativas requieren un nuevo ADR
