---
artifact_id: 01-REQ-BRD
version: 1.0.0
status: Approved
created: 2026-04-13
project: Arky 10 (arkypro-1.0)
domain: SaaS — Arquitectura de Soluciones / Insurance Tech
standard: IEEE 830
generated_by: Claude Code · SDD Architect
---

# BRD — Business Requirements Document
## Arky 10: Potencialización SDD

---

## 1. Executive Summary

**Arky 10** es una aplicación SaaS para arquitectos de soluciones que combina gestión de proyectos arquitectónicos, generación AI de artefactos y un LMS especializado. El objetivo de esta iniciativa es **extender la plataforma para soportar la metodología Specification-Driven Development (SDD) de forma nativa**, permitiendo que arquitectos generen, gestionen y traceen todos los artefactos requeridos por SDD directamente desde la aplicación.

---

## 2. Business Problem Statement

**Problema:** Los arquitectos de soluciones en el sector de seguros generan artefactos arquitectónicos de forma ad-hoc, sin una metodología estructurada que garantice trazabilidad desde el requisito de negocio hasta la implementación. Esto resulta en:
- Especificaciones incompletas o inconsistentes
- Falta de trazabilidad entre decisiones de negocio y técnicas
- Código implementado sin especificaciones aprobadas
- Revisiones tardías de requisitos con alto costo de corrección

**Solución:** Integrar SDD en Arky 10 para que la aplicación guíe al arquitecto a través del proceso completo de especificación antes de cualquier implementación, generando los artefactos correctos en el orden correcto.

---

## 3. Project Objectives (SMART)

| ID | Objetivo | Medición | Plazo |
|----|----------|----------|-------|
| OBJ-001 | Soportar 9 nuevos tipos de artefactos SDD en la plataforma | 9 tipos implementados y verificables | Sprint 1 |
| OBJ-002 | Proporcionar un dashboard de proceso SDD por proyecto | SDDProcessView accesible desde el workspace | Sprint 1 |
| OBJ-003 | Generar artefactos SDD con AI específica por tipo | 9 prompts especializados en geminiService | Sprint 1 |
| OBJ-004 | Documentar el proceso SDD del propio proyecto (specs/) | 11 artefactos generados en specs/ | Sprint 1 |
| OBJ-005 | Proveer indicadores de completitud SDD por proyecto | Métrica de completitud en SDDProcessView | Sprint 1 |

---

## 4. Scope

### 4.1 In-Scope
- Adición de 9 nuevos `ArtifactType` SDD al tipo union en `types.ts`
- Nueva `ArchitecturalView` "Vista SDD" para agrupar artefactos en el hub
- 9 nuevas plantillas (`ARTIFACT_TEMPLATES`) en `constants.ts`
- Prompts AI especializados por tipo SDD en `services/geminiService.ts`
- Funciones `generateSDDProcessPlan` y `generateSDDHealthReport` en geminiService
- Nuevo componente de página `pages/SDDProcessView.tsx`
- Ruta `/sdd-process/:projectId` en `App.tsx`
- Botón "Proceso SDD" en el `ProjectHub` para acceder al dashboard
- Estructura `specs/` con artefactos SDD del proyecto documentados
- Columna Kanban "SDD: Especificación" en `KANBAN_COLUMNS`

### 4.2 Out-of-Scope
- Cambios al backend (la app es frontend-only)
- Introducción de nuevas dependencias npm
- Modificaciones al sistema de autenticación o roles
- Cambios a los 47 artefactos existentes
- Integración con herramientas externas (Jira, Confluence, etc.)
- Tests automatizados (no hay test runner configurado)

---

## 5. Stakeholder Analysis

| Stakeholder | Rol | Interés Principal | Influencia |
|-------------|-----|-------------------|-----------|
| Arquitecto de Soluciones | Usuario primario | Generar especificaciones completas eficientemente | Alta |
| Arquitecto de Software | Usuario secundario | Recibir especificaciones claras antes de implementar | Media |
| Director de TI / CTO | Sponsor | Reducir retrabajo y deuda técnica | Alta |
| Business Analyst | Colaborador | Validar que los requisitos están completos | Media |
| QA Engineer | Beneficiario | Obtener criterios de aceptación BDD ejecutables | Media |

---

## 6. Business Requirements

**BR-001**: El sistema debe soportar la creación de artefactos de tipo BRD (Business Requirements Document) con formato IEEE 830. *Prioridad: Alta*

**BR-002**: El sistema debe soportar la creación de Especificaciones de Casos de Uso con formato UML 2.5 (actores, flujos, precondiciones, postcondiciones). *Prioridad: Alta*

**BR-003**: El sistema debe soportar User Story Maps con épicas, historias y criterios de aceptación siguiendo SAFe/Scrum. *Prioridad: Alta*

**BR-004**: El sistema debe soportar Modelos de Dominio DDD incluyendo Bounded Contexts, Aggregates, Entities y Domain Events. *Prioridad: Alta*

**BR-005**: El sistema debe soportar diagramas de Event Storming con la notación de Brandolini. *Prioridad: Media*

**BR-006**: El sistema debe mantener un Glosario de Lenguaje Ubicuo (Ubiquitous Language) por proyecto. *Prioridad: Alta*

**BR-007**: El sistema debe soportar especificaciones NFR (Non-Functional Requirements) basadas en ISO 25010 con métricas verificables. *Prioridad: Alta*

**BR-008**: El sistema debe soportar escenarios BDD en sintaxis Gherkin (Given/When/Then). *Prioridad: Alta*

**BR-009**: El sistema debe proveer una Matriz de Trazabilidad de Requisitos según IEEE 29148. *Prioridad: Alta*

**BR-010**: El sistema debe mostrar un dashboard de proceso SDD por proyecto con indicadores de completitud por fase. *Prioridad: Alta*

**BR-011**: El sistema debe poder generar un Plan SDD personalizado para cada proyecto usando AI. *Prioridad: Media*

**BR-012**: El sistema debe poder generar un Reporte de Salud SDD que evalúe la completitud y consistencia de los artefactos. *Prioridad: Media*

---

## 7. Assumptions and Constraints

**Suposiciones:**
- El usuario tiene una API key de Gemini válida configurada
- Los proyectos existentes no se verán afectados negativamente
- Tailwind CSS cubre todos los estilos necesarios sin CSS adicional

**Restricciones:**
- La app es frontend-only (Firebase + Gemini API)
- No se pueden instalar nuevas dependencias npm
- TypeScript strict mode debe mantenerse
- El estado global se gestiona con React Context (sin Redux/Zustand)

---

## 8. Success Criteria and KPIs

| KPI | Línea Base | Meta | Método de Medición |
|-----|-----------|------|-------------------|
| Tipos de artefacto SDD soportados | 0 | 9 | Verificación en types.ts |
| Plantillas SDD en catálogo | 0 | 9 | Verificación en constants.ts |
| Funciones AI especializadas SDD | 0 | 2 nuevas + 9 handlers | Verificación en geminiService.ts |
| Cobertura de fases SDD en dashboard | 0% | 100% (5 fases) | SDDProcessView funcional |
| Artefactos SDD del propio proyecto | 0 | 11 | specs/ completado |

---

## 9. Risks and Mitigation

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Artefactos SDD tipo `hybrid` no renderizan correctamente | Baja | Alto | Reutilizar lógica de `hybrid-text-diagram` existente |
| Prompts AI generan contenido genérico | Media | Medio | Instrucciones de formato específicas y detalladas por tipo |
| SDDProcessView no puede acceder al proyecto | Baja | Alto | Validación de projectId y fallback a página de proyectos |
| Tipos SDD rompen el filtrado en ProjectHub | Baja | Medio | ArchitecturalView 'Vista SDD' agrupa todos los nuevos tipos |

---

## 10. Approval and Sign-off

| Rol | Nombre | Estado | Fecha |
|-----|--------|--------|-------|
| SDD Architect | Claude Code | ✅ Aprobado | 2026-04-13 |
| Product Owner | Usuario | ✅ Aprobado | 2026-04-13 |
