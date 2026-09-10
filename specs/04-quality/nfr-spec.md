---
artifact_id: 04-QUAL-NFR
version: 1.0.0
status: Approved
created: 2026-04-13
project: Arky 10 (arkypro-1.0)
standard: ISO 25010
generated_by: Claude Code · SDD Architect
---

# NFR — Non-Functional Requirements Specification
## Extensión SDD de Arky 10

---

## Quality Model Reference (ISO 25010)

Características aplicadas: Performance Efficiency, Security, Reliability, Usability, Maintainability, Compatibility.

---

## NFR Catalog

**NFR-001**: Tiempo de generación de artefactos SDD
- **Category:** Performance Efficiency
- **Statement:** La generación AI de artefactos SDD debe completarse en tiempo razonable
- **Metric:** Tiempo de respuesta del endpoint Gemini
- **Target:** ≤ 180s (timeout configurado en geminiService)
- **Priority:** High
- **Verification Method:** Timeout existente en `withTimeout()` + retry con backoff
- **Related Requirements:** BR-001 al BR-009

**NFR-002**: Disponibilidad del dashboard SDD
- **Category:** Reliability
- **Statement:** SDDProcessView debe cargarse correctamente incluso si el proyecto no tiene artefactos SDD
- **Metric:** Porcentaje de carga exitosa sin errores
- **Target:** 100% — empty state manejado con UI clara
- **Priority:** Critical
- **Verification Method:** Prueba manual con proyecto nuevo vacío
- **Related Requirements:** BR-010

**NFR-003**: Compatibilidad con temas (light/dark)
- **Category:** Usability
- **Statement:** SDDProcessView debe funcionar correctamente en modo claro y oscuro
- **Metric:** Verificación visual de todos los elementos UI en ambos temas
- **Target:** 100% elementos con clases `dark:` correctas
- **Priority:** High
- **Verification Method:** Toggle de tema en Settings y verificación visual
- **Related Requirements:** BR-010

**NFR-004**: Consistencia con el sistema de diseño
- **Category:** Usability
- **Statement:** Los nuevos componentes SDD deben usar exclusivamente Tailwind CSS (sin estilos inline ni CSS modules)
- **Metric:** Ausencia de atributos `style=` no dinámicos en SDDProcessView
- **Target:** 0 violaciones de la convención de estilo
- **Priority:** Medium
- **Verification Method:** Revisión de código
- **Related Requirements:** CLAUDE.md — Styling Conventions

**NFR-005**: Type safety
- **Category:** Maintainability
- **Statement:** Toda la extensión SDD debe compilar sin errores de TypeScript en modo strict
- **Metric:** Salida de `npm run lint` para archivos SDD nuevos
- **Target:** 0 errores de lógica de tipos (errores de módulos faltantes son de entorno, no de código)
- **Priority:** High
- **Verification Method:** `npm run lint` + revisión manual
- **Related Requirements:** CLAUDE.md — TypeScript Conventions

**NFR-006**: No regresión de artefactos existentes
- **Category:** Compatibility
- **Statement:** Los 47 artefactos existentes deben seguir funcionando exactamente igual después de la extensión
- **Metric:** Verificación de tipos existentes en ArtifactType union
- **Target:** 0 artefactos existentes afectados
- **Priority:** Critical
- **Verification Method:** Los nuevos tipos son aditivos; no se modifica el rendering existente
- **Related Requirements:** ADR-001

**NFR-007**: Persistencia de artefactos SDD
- **Category:** Reliability
- **Statement:** Los artefactos SDD generados deben persistir en Firestore (o localStorage) como cualquier otro artefacto
- **Metric:** Presencia del artefacto en `project.artifacts` después de generación
- **Target:** 100% persistencia usando el mismo `createArtifact()` del AppContext
- **Priority:** Critical
- **Verification Method:** Verificación en consola de Firebase o localStorage
- **Related Requirements:** BR-001 al BR-009
