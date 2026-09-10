---
artifact_id: 04-QUAL-RTM
version: 1.0.0
status: Approved
created: 2026-04-13
project: Arky 10 (arkypro-1.0)
standard: IEEE 29148
generated_by: Claude Code · SDD Architect
---

# Matriz de Trazabilidad de Requisitos (RTM)
## Extensión SDD de Arky 10

---

## 1. Coverage Summary

| Métrica | Cantidad | Cobertura |
|---------|----------|-----------|
| Business Requirements | 12 | 100% |
| Architecture Decisions | 1 (ADR-001) | 100% |
| Component Specs | 9 tipos + 2 funciones | 100% |
| BDD Scenarios | 15 escenarios | 100% |
| NFR | 7 NFRs | 100% |

---

## 2. Forward Traceability Matrix

| BR-ID | Requirement | Componente | Archivo | BDD | NFR |
|-------|-------------|-----------|---------|-----|-----|
| BR-001 | Soporte BRD (IEEE 830) | type `sdd-brd`, template BRD, prompt handler | types.ts, constants.ts, geminiService.ts | BDD-F1-S2 | NFR-001 |
| BR-002 | Soporte Casos de Uso (UML 2.5) | type `sdd-use-case`, template, prompt | types.ts, constants.ts, geminiService.ts | BDD-F3-S1 | NFR-001 |
| BR-003 | Soporte User Story Map (SAFe) | type `sdd-user-story`, template, prompt | types.ts, constants.ts, geminiService.ts | BDD-F3-S1 | NFR-001 |
| BR-004 | Soporte Domain Model DDD | type `sdd-domain-model`, template, prompt | types.ts, constants.ts, geminiService.ts | BDD-F1-S4, BDD-F4-S2 | NFR-001 |
| BR-005 | Soporte Event Storming | type `sdd-event-storming`, template, prompt | types.ts, constants.ts, geminiService.ts | BDD-F3-S1 | NFR-001 |
| BR-006 | Glosario Ubiquitous Language | type `sdd-glossary`, template, prompt | types.ts, constants.ts, geminiService.ts | BDD-F3-S1 | NFR-001 |
| BR-007 | Soporte NFR (ISO 25010) | type `sdd-nfr`, template, prompt | types.ts, constants.ts, geminiService.ts | BDD-F3-S1 | NFR-001 |
| BR-008 | Soporte BDD Gherkin | type `sdd-bdd`, template, prompt | types.ts, constants.ts, geminiService.ts | BDD-F3-S1, BDD-F4-S3 | NFR-001 |
| BR-009 | Traceability Matrix | type `sdd-traceability`, template, prompt | types.ts, constants.ts, geminiService.ts | BDD-F3-S1 | NFR-001 |
| BR-010 | Dashboard SDD por proyecto | SDDProcessView, ruta /sdd-process/:id, botón en ProjectHub | SDDProcessView.tsx, App.tsx, ProjectHub.tsx, Workspace.tsx | BDD-F1-S1, BDD-F2-S1 | NFR-002, NFR-003 |
| BR-011 | Plan SDD con AI | `generateSDDProcessPlan()` | geminiService.ts | BDD-F2-S1 | NFR-001 |
| BR-012 | Reporte de Salud SDD | `generateSDDHealthReport()` | geminiService.ts | BDD-F2-S2 | NFR-001 |

---

## 3. Reverse Traceability Matrix

| Archivo / Componente | Implementa | BR-ID |
|---------------------|-----------|-------|
| `types.ts` — ArtifactType 9 nuevos valores | 9 tipos SDD | BR-001 al BR-009 |
| `types.ts` — ArchitecturalView 'Vista SDD' | Agrupación en hub | BR-010 |
| `constants.ts` — 9 nuevas ArtifactTemplate | Plantillas SDD | BR-001 al BR-009 |
| `constants.ts` — KANBAN_COLUMNS 'SDD: Especificación' | Vista tablero | BR-010 |
| `services/geminiService.ts` — 9 format handlers | Generación AI SDD | BR-001 al BR-009 |
| `services/geminiService.ts` — `generateSDDProcessPlan` | Plan SDD AI | BR-011 |
| `services/geminiService.ts` — `generateSDDHealthReport` | Reporte SDD AI | BR-012 |
| `pages/SDDProcessView.tsx` | Dashboard proceso SDD | BR-010, BR-011, BR-012 |
| `App.tsx` — ruta `/sdd-process/:projectId` | Navegación dashboard | BR-010 |
| `components/ProjectHub.tsx` — botón "Proceso SDD" | Acceso al dashboard | BR-010 |
| `pages/Workspace.tsx` — `onOpenSDD` prop | Wire-up navegación | BR-010 |

---

## 4. Uncovered Requirements

No hay requisitos sin cobertura. Todos los 12 BRs tienen al menos una implementación y un escenario BDD asociado.

---

## 5. Traceability Health Metrics

| Métrica | Valor | Estado |
|---------|-------|--------|
| BRs con componente de implementación | 12/12 | ✅ 100% |
| BRs con escenario BDD | 12/12 | ✅ 100% |
| BRs con NFR relacionado | 12/12 | ✅ 100% |
| Archivos nuevos sin BR asociado | 0 | ✅ |
| Componentes sin trazabilidad hacia BR | 0 | ✅ |
| Cobertura RTM global | 100% | ✅ |
