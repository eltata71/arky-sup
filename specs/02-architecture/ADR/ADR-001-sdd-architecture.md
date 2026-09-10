---
artifact_id: 02-ARCH-ADR-001
version: 1.0.0
status: Approved
created: 2026-04-13
project: Arky 10 (arkypro-1.0)
standard: Architecture Decision Record
generated_by: Claude Code · SDD Architect
---

# ADR-001: Adopción de la Arquitectura SDD en Arky 10

**Status:** Accepted  
**Date:** 2026-04-13  
**Deciders:** Claude Code (SDD Architect), Usuario (Product Owner)

---

## Context and Problem Statement

Arky 10 soporta la generación de 47 artefactos arquitectónicos en 15 tipos diferentes, pero carece de soporte nativo para la metodología Specification-Driven Development (SDD). Los arquitectos que desean seguir SDD deben gestionar manualmente los artefactos de especificación (BRD, Casos de Uso, Modelos de Dominio DDD, etc.) fuera de la plataforma.

¿Cómo extender Arky 10 para soportar SDD de forma nativa sin romper las capacidades existentes?

---

## Decision Drivers

- Mantener compatibilidad con los 47 artefactos existentes
- No introducir dependencias externas nuevas
- Reutilizar la infraestructura AI existente (geminiService.ts)
- Seguir los patrones de código establecidos (TypeScript strict, React Context, Tailwind)
- No requerir un backend personalizado (app es frontend-only)

---

## Considered Options

**Opción A:** Crear un módulo SDD completamente separado con su propia store y servicio AI independiente.

**Opción B:** Extender el sistema de artefactos existente con nuevos tipos SDD, reutilizando toda la infraestructura existente.

**Opción C:** Crear una aplicación separada para SDD y linkearla desde Arky 10.

---

## Decision Outcome

**Elegida: Opción B** — Extensión del sistema de artefactos existente.

### Positive Consequences
- Zero duplicación de código: reutiliza geminiService, AppContext, Firestore, ArtifactCanvas
- Los artefactos SDD se almacenan en la misma colección Firestore `projects`
- Los artefactos SDD aparecen en el ProjectHub bajo "Vista SDD"
- El versionado, historial y chat AI funcionan para artefactos SDD sin cambios adicionales
- El rendering se basa en `artifact.representation` (document/hybrid), no en el tipo específico

### Negative Consequences
- El tipo union `ArtifactType` crece (9 nuevos valores)
- `ARTIFACT_TEMPLATES` crece (~9 entradas más)

---

## Implementation Strategy

### 1. Extensión de tipos (`types.ts`)
```typescript
// Nuevos valores en ArtifactType:
| 'sdd-brd' | 'sdd-use-case' | 'sdd-user-story'
| 'sdd-domain-model' | 'sdd-event-storming' | 'sdd-glossary'
| 'sdd-nfr' | 'sdd-bdd' | 'sdd-traceability'

// Nueva ArchitecturalView:
| 'Vista SDD'
```

### 2. Plantillas (`constants.ts`)
Cada tipo SDD tiene su plantilla con `phase: 'SDD: Especificación'` y `architecturalView: 'Vista SDD'`.

### 3. Generación AI (`geminiService.ts`)
En `generateArtifactContent`, se añaden bloques `else if` para cada tipo SDD con instrucciones de formato altamente específicas (IEEE 830, UML 2.5, Gherkin, ISO 25010, etc.).

Dos nuevas funciones públicas:
- `generateSDDProcessPlan(project, settings)` → Plan SDD personalizado en Markdown
- `generateSDDHealthReport(project, settings)` → Reporte de salud SDD

### 4. Dashboard SDD (`SDDProcessView.tsx`)
Nueva página en `/sdd-process/:projectId` que muestra:
- 5 fases SDD con barras de progreso
- Estado (present/missing) de cada artefacto por fase
- Botón para generar artefactos faltantes con AI
- Panel para generar Plan SDD y Reporte de Salud

### 5. Integración en Workspace
Botón "Proceso SDD" en ProjectHub header → navega a `/sdd-process/:projectId`.

---

## Rendering Strategy for SDD Types

Los tipos SDD se renderizan usando el campo `representation`:
- `representation: 'document'` → Markdown rendering (ArtifactCanvas existente)
- `representation: 'hybrid'` → Markdown + Mermaid diagram (lógica híbrida existente)

**No se requieren cambios en ArtifactCanvas** — el rendering ya es polimórfico basado en `representation`.

---

## Pros and Cons of Options

### Option A — Módulo Separado
- **Pro:** Separación de concerns completa
- **Con:** Duplicación masiva de código, mantenimiento costoso, user experience fragmentada

### Option B — Extensión de Sistema Existente ✅
- **Pro:** Zero duplicación, UX coherente, aprovecha toda la infraestructura
- **Con:** Type union más grande (trade-off aceptable)

### Option C — Aplicación Separada
- **Pro:** Total independencia
- **Con:** Complejidad operacional extrema, autenticación duplicada, costos de hosting adicionales
