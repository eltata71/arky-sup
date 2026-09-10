---
artifact_id: 03-COMP-SDD-EXT
version: 1.0.0
status: Approved
created: 2026-04-13
project: Arky 10 (arkypro-1.0)
standard: IEEE 1016
generated_by: Claude Code · SDD Architect
---

# Especificación del Módulo SDD — Extensión de Arky 10

---

## 1. Resumen del Módulo

La extensión SDD agrega soporte nativo para la metodología Specification-Driven Development en Arky 10. Es una extensión horizontal de los subsistemas existentes (tipos, plantillas, AI, UI) siguiendo los patrones arquitectónicos establecidos.

---

## 2. Archivos Modificados

| Archivo | Tipo de Cambio | Descripción |
|---------|---------------|-------------|
| `types.ts` | Extensión | +9 ArtifactType, +1 ArchitecturalView |
| `constants.ts` | Extensión | +9 ArtifactTemplate, +1 KANBAN_COLUMN |
| `services/geminiService.ts` | Extensión | +9 format handlers, +2 public functions |
| `components/ProjectHub.tsx` | Modificación | +prop `onOpenSDD`, +botón "Proceso SDD" |
| `pages/Workspace.tsx` | Modificación | +prop `onOpenSDD` wired to navigate |
| `App.tsx` | Extensión | +lazy import SDDProcessView, +route `/sdd-process/:projectId` |

## 3. Archivos Nuevos

| Archivo | Descripción |
|---------|-------------|
| `pages/SDDProcessView.tsx` | Dashboard de proceso SDD por proyecto |
| `specs/` | Estructura completa de documentación SDD |

---

## 4. Especificación de SDDProcessView

### 4.1 Responsabilidad
Visualizar el estado del proceso SDD para un proyecto específico, permitir generar artefactos SDD faltantes, y proporcionar análisis AI del proceso.

### 4.2 Props
```typescript
interface SDDProcessViewProps {
  projectId: string;  // ID del proyecto en Firestore/localStorage
}
```

### 4.3 Estado Interno
```typescript
activePhase: number                // 1-5, fase SDD activa en sidebar
sddPlan: string                    // Markdown del plan SDD generado
healthReport: string               // Markdown del reporte de salud
isGeneratingPlan: boolean          // Loading state del plan
isGeneratingReport: boolean        // Loading state del reporte
activeTab: 'process' | 'plan' | 'report'  // Tab activo
generatingArtifact: string | null  // Nombre del artefacto en generación
planHtml: string                   // HTML renderizado del plan
reportHtml: string                 // HTML renderizado del reporte
```

### 4.4 Dependencias de Contexto
```typescript
const { projects, settings, createArtifact } = useAppContext();
```

### 4.5 Flujo de Generación de Artefactos
```
Usuario click "Generar" →
  handleGenerateArtifact(templateName) →
    geminiService.generateArtifactContent(project, template, settings) →
      createArtifact(project.id, { ...templateData, content })
```

---

## 5. Especificación de Nuevos Tipos AI

### 5.1 `generateSDDProcessPlan(project, settings)`
- **Input:** Proyecto completo con artefactos existentes
- **Output:** Markdown con plan SDD de 5 fases + análisis de brechas + orden recomendado
- **Temperatura:** 0.5 (balance entre creatividad y estructura)
- **Modelo:** `settings.aiConfig.model` (configurable por usuario)

### 5.2 `generateSDDHealthReport(project, settings)`
- **Input:** Proyecto + lista de artefactos SDD existentes
- **Output:** Markdown con score SDD, análisis de completitud por fase, inconsistencias, acciones recomendadas
- **Temperatura:** 0.4 (más determinístico para análisis)
- **Modelo:** `settings.aiConfig.model`

---

## 6. Especificación de Prompts por Tipo SDD

| Tipo | Estándar | Output Format | Estructura Principal |
|------|---------|---------------|---------------------|
| `sdd-brd` | IEEE 830 | Markdown | 10 secciones: summary, problem, objectives, scope, stakeholders, requirements, assumptions, success criteria, risks, approval |
| `sdd-use-case` | UML 2.5 | Markdown | 5-8 UC con actor, flows, pre/postconditions, BR references |
| `sdd-user-story` | SAFe/Scrum | Markdown | 4-6 épicas, historias con AC, estimaciones, MoSCoW |
| `sdd-domain-model` | DDD | Markdown + Mermaid | Subdomain map, bounded contexts, context map, aggregates, events + diagram |
| `sdd-event-storming` | Brandolini | Markdown + Mermaid | Events, commands, actors, policies, read models, hot spots + sequence diagram |
| `sdd-glossary` | DDD | Markdown | Tabla 25-40 términos con bounded context, definición, alias, ejemplo |
| `sdd-nfr` | ISO 25010 | Markdown | 20+ NFRs categorizados: Performance, Security, Reliability, Scalability, Maintainability |
| `sdd-bdd` | Gherkin | Markdown + Gherkin | 4-6 Features con 3-5 Scenarios cada una, incluyendo happy path, edge cases, error cases |
| `sdd-traceability` | IEEE 29148 | Markdown | Coverage summary + forward/reverse matrix + gaps + health metrics |

---

## 7. Integración con Sistema Existente

### 7.1 Rendering (ArtifactCanvas)
No se requieren cambios. El rendering es polimórfico basado en `artifact.representation`:
- `'document'` → Markdown rendering (sdd-brd, sdd-use-case, sdd-user-story, sdd-glossary, sdd-nfr, sdd-bdd, sdd-traceability)
- `'hybrid'` → Markdown + Mermaid (sdd-domain-model, sdd-event-storming)

### 7.2 Persistencia (Firestore/localStorage)
Los artefactos SDD se almacenan idénticamente a los demás artefactos en `projects/{id}/artifacts`.

### 7.3 Versionado e Historial
Reutiliza el sistema existente de versiones (`versionGroupId`, `version`) sin cambios.

### 7.4 Chat AI
Los artefactos SDD soportan el copiloto contextual de ArtifactCanvas sin cambios.

### 7.5 Exportación
Los artefactos SDD pueden exportarse a PNG/SVG/Mermaid usando los botones existentes de ArtifactCanvas.
