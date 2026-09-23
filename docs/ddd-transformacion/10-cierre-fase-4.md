# Cierre de la fase 4 — Proyectos y Entregables

**Fecha** 2026-09-23 · **Estado** cerrada · **Plan** `02-plan-maestro.md` § Fase 4

> **Objetivo de la fase.** Decidir la frontera Proyecto–Artefacto por
> invariantes, no por costumbre, y sacar la coordinación de React.

## El criterio de cierre, contrastado uno a uno

| Criterio (plan maestro) | Estado | Evidencia |
|---|---|---|
| La frontera, justificada por ADR | ✅ | ADR-106 (F4-02): el Artefacto es raíz de su propio agregado. Ninguna invariante lee el contenido de dos artefactos a la vez; P-04 (índice) y A-02 (versionado) son de conjunto y las sostiene el servidor. Nota de ejecución al pie del ADR |
| Concurrencia explícita y probada | ✅ | Revisión por fila en proyectos **y** en artefactos, viajando con el registro (F4-03, F4-07). Contratos pgTAP con `P0001` sobre copia vieja; `projectRevisionFlow.test.tsx` y `artifactRevisionFlow.test.tsx` en el cliente; `noRevisionCache.test.ts` impide el mapa global |
| Editar un artefacto no sobrescribe cambios independientes | ✅ | Un comando por intención y revisión **del artefacto** (F4-03): dos ediciones de artefactos distintos ya no chocan, y ningún comando recibe la lista del proyecto, así que ninguno puede borrar lo que no nombra. La RPC que sí podía se retiró (F4-06) |
| Versionado y publicación fuera de React | ✅ | Versionado, recompilación, elección de comando, revisión y reversión en `services/artifacts/application/artifactWorkflow` (F4-05); el hook sólo aplica el plan. La publicación ya lo estaba: sus transiciones son funciones puras de `publicationPipeline` |
| Migraciones con compatibilidad y reversión | ✅ | `20260922180000_artifact_commands.sql` (aditiva salvo la guarda de transición, explicada en su cabecera) y `20260923090000_retire_save_project_aggregate.sql` (con sus secciones *Compatibilidad* y *Reversión*). Ambas verificadas contra PostgreSQL 16 nativo y contra el stack real de Supabase en CI |
| El fan-out de las diez pantallas | ⚠️ parcial | **10 → 6**. Las cuatro de artefactos —lienzo, modal de exportación, inspector y Workspace— salieron. Las seis restantes son de la Oficina, las iniciativas y el asistente; su objetivo (0 antes del 2027-01-31) pasa a **F5-02** sin mover la fecha. Ver *Lo que la fase deja abierto* |

## Tareas

| Tarea | Estado | PR |
|---|---|---|
| F4-01 medir Proyecto–Artefacto | ✅ | #48 |
| F4-02 ADR: ¿Artefacto es raíz? | ✅ | #49 |
| F4-03 revisión y comandos por artefacto | ✅ | #50 |
| F4-04 raíz, documento persistido y modelo de lectura | ✅ | #53 |
| F4-05 coordinación de artefactos fuera de React | ✅ | #54 |
| F4-06 ruta de escritura única | ✅ | #54 |
| F4-07 revisiones de proyecto con el registro | ✅ | #53 |

## Hallazgos cerrados

| Hallazgo | Cómo |
|---|---|
| **H05** — escribir un artefacto reescribía el agregado entero y borraba lo que no viajaba | Comandos por artefacto (F4-03) y retirada de la RPC compuesta (F4-06) |
| **H10** (resto) — revisiones de proyecto en un mapa global | La revisión viaja en `Project.revision` (F4-07) |
| **H04** (proyectos) — el `index.ts` publicaba la caché de concurrencia | `knownProjectRevision` y `forgetProjectRevisions` ya no existen (F4-07) |

## Cifras

Medidas con `node scripts/checkModuleBoundaries.mjs --report`,
`npm run check:any-budget`, `npm run check:bundle-budget` tras
`npm run build:placeholders`, y la suite completa.

| | Cierre de la fase 3 | Cierre de la fase 4 |
|---|---|---|
| Ciclos directos | 4 | 4 |
| Componente de dominio | 14 módulos | 14 |
| Pares ascendentes | 0 | 0 |
| Pares con import profundo | 57 | **56** |
| Pantallas sobre el fan-out por defecto | 10 | **6** |
| Dependencias entre módulos declaradas | 246 | 257 |
| Tipos `any` | 23 | 23 |
| Carga inicial | 309,5 / 340 KB gz | 309,6 / 340 KB gz |
| Pruebas (Vitest) | 4 468 | **4 528** |
| Contratos pgTAP | 15 | 15 (dos reescritos, 64 aserciones nuevas o movidas) |

**Las dependencias declaradas subieron de 246 a 257**, y es el resultado
esperado, no una regresión: F3-07 y F4-05 bajaron decisiones de las pantallas
al dominio, y cada una que baja declara la arista que ahora usa el servicio de
aplicación en vez de la pantalla. El número que mide acoplamiento de la UI es el
fan-out, y ése bajó.

## Lo que la fase deja decidido

- **El Proyecto se escribe por una sola puerta y lo que se escribe es la raíz.**
  `ProjectRoot` no tiene artefactos; `Project` es el modelo de lectura.
- **El Artefacto se escribe por sus comandos**, y cada uno compara su propia
  revisión.
- **La coordinación no vive en React.** El patrón es
  `services/<contexto>/application/` con funciones puras y un hook que sólo
  aplica; `artifactWorkflow` es el ejemplo de referencia y
  `artifactCoordinationOutOfReact.test.ts` su guardia.
- **Una trampa de React, dos veces pagada.** Decidir qué persistir desde
  variables asignadas dentro del actualizador de `setState` funciona sólo en la
  primera actualización de un render. Salió en artefactos (F4-03) y en proyectos
  (F4-07), las dos veces como «la segunda edición consecutiva no se guarda», sin
  error. La regla está en `AGENTS.md` (regla 23) y en los dos flujos probados.

## Lo que la fase deja abierto, dicho como tal

- **Seis pantallas sobre el fan-out** (`ProjectCopilotChatModal`,
  `InitiativesPage`, `EngagementIntakeWizard`, `OfficeCapabilitiesPanel`,
  `AssistantPanel`, `ProjectsPage`). No son de artefactos: sus políticas son de
  la Oficina, las iniciativas y el asistente, que es **F5-02**. Ejemplo de lo que
  hay debajo: el asistente de alta de un entregable calcula en la pantalla el
  espejo de códigos `NEG-YYYY-NNN`, que es una regla de la fábrica del encargo.
- **La migración de F4-06 no está aplicada a `ArkyDB-US`.** El CI publica la
  aplicación, no el esquema. No rompe nada mientras tanto —el código ya no llama
  a la RPC retirada—, pero la puerta sigue concedida en la base hasta que se
  haga `supabase db push`. Aplicarla es una acción sobre producción y queda a
  decisión del propietario.
- **D-2** (archivado y retención) sigue abierta; bloquea F6-08.

## Lo que no se pudo ejecutar aquí

- El stack local de Supabase no arranca en el entorno de estas sesiones (el
  proxy responde 403 a Docker Hub). Los contratos se verificaron contra
  PostgreSQL 16 nativo con `scripts/supabase/test-native.py` —dos
  reconstrucciones desde cero, `plpgsql_check` sin hallazgos— y el workflow
  `supabase.yml` los ejecutó contra el stack real en #50, #53 y #54.
