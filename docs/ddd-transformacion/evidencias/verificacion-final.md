# Verificación final del plan — doble chequeo tarea por tarea

**Fecha:** 2026-09-26 · **Commit:** `5ac9bf0` (`main`, el mismo publicado en
producción) · **Pedido por:** el propietario, para asegurar que cada tarea está
hecha **y** que el repositorio y la aplicación lo reflejan.

## Método

Tres capas, y ninguna se fía de lo que dicen los documentos:

1. **Evidencia por tarea.** Para cada una de las 50 tareas del backlog se
   leyeron sus criterios de aceptación y se comprobó en el repositorio actual
   la evidencia concreta que prometen:
   - que el fichero, la prueba o la migración existen;
   - que la regla está **dentro** del SQL vigente (la última definición de cada
     función, no la primera);
   - que lo retirado ya no existe.

   Fueron **93 comprobaciones automáticas**. Cinco salieron en rojo. Cuatro
   eran falsos positivos de la búsqueda, comentarios que citan el nombre
   histórico de lo retirado; `types.ts` se confirmó con el analizador de
   TypeScript (0 imports). La quinta es real: F6-09.
2. **Gates sobre `main`**, ejecutados de nuevo hoy.
3. **Producción:** qué commit está publicado y qué comprobó su despliegue.

## Resultado por tarea

| Fase | Tareas | Verificadas | Pendientes |
|---|---|---|---|
| 1 · Modelo y línea base | 9 | 9 | — |
| 2 · Consistencia y gobernanza | 11 | 11 (una con resto: R-13) | — |
| 3 · Fronteras y contexto piloto | 8 | 8 | — |
| 4 · Proyectos y Entregables | 7 | 7 (criterio de cierre a medias: R-14) | — |
| 5 · Oficina, IA y proyecciones | 5 | 5 | — |
| 6 · Consolidación y cierre | 10 | 8 | **F6-03** (sólo el primer corte), **F6-09** (sin empezar) |
| **Total** | **50** | **48** | **2** |

**Comprobaciones que merecen nombre** porque podían haberse perdido en una fase
posterior:

- **F2-08.** La carrera entre borrar una iniciativa y guardar un proyecto se
  cerró con `for key share` en `save_project_aggregate`, y esa RPC se retiró en
  F4-06. **Su sustituta, `save_project`, conserva el bloqueo**, con un
  comentario que lo explica.
- **F2-01.** `decide_engagement` construye el documento desde la fila guardada
  (`current_row.data`) y no desde el que envía el cliente. Por eso ni la
  aprobación del charter (F6-08) ni el resto del encargo se pueden alterar al
  decidir.
- **F5-01, hallazgo del corte 6.** El camino de texto del transporte sin proxy
  quedó arreglado en #62, con su prueba (`geminiServiceFacade.test.ts`).

## Gates sobre `main` (2026-09-26)

| Gate | Resultado |
|---|---|
| `npm run test:ci` | **490 ficheros, 4 753 pruebas**, todas pasando |
| `npm run quality:static` | limpio: typecheck, strict, lint, `any` 7 de 7, tamaños y fronteras (3 ciclos de React, 0 módulos de dominio mutuamente alcanzables, 29 pares profundos, 0 pantallas sobre el fan-out) |
| `npm run build` + `check:bundle-budget` | carga inicial 310,1 de 340 KB gz; cada ruta bajo su techo |
| `check:bundle-secrets` | limpio |
| pgTAP (CI, PR #86) | **20 contratos, 528 aserciones**, todas pasando |
| E2E (CI, PR #86) | en verde, incluido `chunks.spec.ts` |

## Producción

El último despliegue de `ci.yml` publicó **`5ac9bf0`, que es `main`**. En ese
trabajo pasaron:

- la comprobación del destino Vercel;
- **«Production has every migration of this commit»**, con las 47 migraciones
  aplicadas en `ArkyDB-US`;
- la publicación;
- la prueba de humo contra el sitio publicado.

## Criterios de cierre de cada fase (`02-plan-maestro.md`)

| Fase | Criterio | Estado |
|---|---|---|
| 1 | línea base, hallazgos, invariantes con dueño, decisiones separadas de supuestos, backlog | ✅ |
| 2 | fallo sin entrega a medias; sin autoaprobación; transiciones ilegales rechazadas; charter sin aprobar no corre; sin duplicados; sin referencias rotas; RPC retiradas no invocables; fallo no comunicado como éxito | ✅ (la RPC retirada está revocada; no eliminada: R-13) |
| 3 | ciclos de 3+ detectados; Iniciativas probada sin React ni Supabase; patrón documentado; presupuestos que no suben | ✅ |
| 4 | frontera por ADR; concurrencia probada; editar no pisa; versionado y publicación fuera de React | ✅ |
| 4 | **migraciones con compatibilidad y reversión** | ⚠️ 8 de las 13 migraciones de la transformación no traen su reversión (R-14) |
| 5 | IA sin dependencias de negocio; contratos conservados; ciclos a cero; proyecciones observables, recuperables e idempotentes | ✅ |
| 6 | cero ciclos entre contextos (transitivos) | ✅ 0 |
| 6 | **cero accesos externos a implementaciones internas** | ⚠️ quedan 29 pares con import profundo, cada uno con su razón (F6-02), y barriles que publican implementaciones de Supabase (H04, R-10) |
| 6 | toda tabla, RPC e invariante con propietario | ✅ verificado por prueba (`dataOwnershipMatrix.test.ts`) |
| 6 | **el dominio probado sin infraestructura ni UI** | ⚠️ completo sólo en Iniciativas; F6-03 a medias |
| 6 | invariantes críticas en servidor | ✅ 36 de 43; las 7 restantes, en la deuda residual con responsable |
| 6 | decisiones ARB atómicas y auditables | ✅ |
| 6 | conflictos concurrentes explícitos y recuperables | ✅ salvo el historial de chat (R-03, decisión pendiente) |
| 6 | proyecciones durables idempotentes | ✅ |
| 6 | gates de calidad y rendimiento en verde | ✅ |
| 6 | **informe técnico y gerencial** | ❌ F6-09 |

## Documentación que decía algo que ya no es cierto (corregida aquí)

- `08-avance.md`: la cabecera decía «fase 5 en curso».
- `03-backlog.md`:
  - F5-01 terminaba en el corte 10 y decía que faltaba la vertical de
    artefactos (se hizo en el corte 14);
  - su hallazgo del corte 6 figuraba como no arreglado (se arregló en #62);
  - el pendiente de F2-01 no decía que la RPC se había revocado;
  - F6-03 no decía cuánto falta.
