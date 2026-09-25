# Catálogo de invariantes

La columna que importa es **Autoridad**: dónde se aplica de verdad la regla. Un
`if` en React no es autoridad, es cortesía con el usuario. La autoridad es lo
que un cliente manipulado no puede saltarse.

**Revisado el 2026-09-25 (F6-06), fila a fila contra las migraciones y los
contratos pgTAP vigentes.** El catálogo anterior conservaba el estado de la
línea base: ocho filas marcaban ❌ o ⚠️ sobre reglas que las fases 2 a 5 ya
habían llevado al servidor. La columna **Desde** dice qué fase lo cambió. La
fotografía original está en la historia de git de este fichero.

Leyenda: `UI` React · `TS` función de dominio en TypeScript ·
`RPC` guarda dentro de una función `SECURITY DEFINER` ·
`SQL` restricción declarativa (`check`, `foreign key`, `unique`, disparador) ·
`RLS` política de fila.

---

## Iniciativas y Portafolio

| # | Invariante | Autoridad | ¿Basta? | Desde |
|---|---|---|---|---|
| I-01 | Una iniciativa tiene título, necesidad declarada y responsable | `TS` (`businessInitiativeFactory`) + `RPC` (título o necesidad vacíos → `22023`; el responsable es el actor de la sesión) | ✅ | fase 3 |
| I-02 | El código es `NEG-YYYY-NNN` o vacío | `TS` (`toInitiativeCode`) | ⚠️ aceptable: degrada a vacío, no a algo plausible | — |
| I-03 | Una iniciativa citada por un proyecto no se borra | `RPC` + contrato `engagement_overload_and_initiative_references` | ✅ cierra **H08** | fase 2 |
| I-04 | El código es único en toda la base y lo asigna el servidor al crear | `RPC` (`pg_advisory_xact_lock` + siguiente libre del año) + `SQL` (`unique`) | ✅ | F6-04 |

## Proyectos de Arquitectura

| # | Invariante | Autoridad | ¿Basta? | Desde |
|---|---|---|---|---|
| P-01 | Un proyecto tiene nombre | `TS` + `RPC` (`22023`) | ✅ | — |
| P-02 | Un proyecto tiene al menos una iniciativa | `TS` (`createArchitectureProject`) + `RPC` | ✅ | — |
| P-03 | Las iniciativas citadas existen y son del actor | `RPC` | ✅ | — |
| P-04 | `artifactCount` y `artifactIndex` coinciden con los artefactos | `RPC` (recalculados desde las filas por cada comando) | ✅ | F4-03 |
| P-05 | Un artefacto pertenece a un solo proyecto | `RPC` (`23505`) | ✅ | — |
| P-06 | Una escritura desde vista obsoleta no pisa otra | `RPC` (revisión optimista → `P0001`) y la revisión viaja con el registro, sin mapas (`noRevisionCache.test.ts`) | ✅ cierra **H10** | F4-07, F5-05, F6-03 |
| P-07 | El dueño es el actor | `RPC` + `RLS` | ✅ | — |
| P-08 | Un borrado desde vista obsoleta no elimina una edición concurrente | `RPC` (`P0001`, y no borra nada) + contrato `project_deletion_conflict` | ✅ | F6-05 |

## Encargos y Gobernanza

| # | Invariante | Autoridad | ¿Basta? | Desde |
|---|---|---|---|---|
| E-01 | Un encargo tiene título, atención e iniciativa | `TS` (`officeEngagementFactory`) + `RPC` (título, brief y proyecto) | ⚠️ la RPC no exige iniciativa | — |
| E-02 | **Nadie ejecuta un charter sin aprobar** | `TS` en el runner (`canRunEngagement`) + `RPC` (`save_engagement`: `in-progress` exige charter aprobado; la aprobación es inmutable y la firma la sesión) + contrato `charter_approval_guard` | ✅ cierra **H06** | fase 2, F6-08 |
| E-03 | El estado sigue transiciones legales | `RPC` (`office_engagement_transition_allowed`) | ✅ cierra **H02** (transiciones) | fase 2 |
| E-04 | Un cambio de estado deja su rastro de auditoría | `TS` (`transitionEngagement`) + gate de pruebas | ⚠️ sólido en TS, invisible al servidor | — |
| E-05 | Productor y revisor de un entregable son distintos | `TS` (planificador y enrutador) | ⚠️ | — |
| E-06 | Sólo `arb:decide` lleva a `delivered` | `RPC` (`save_engagement` rechaza `delivered`: sólo `decide_engagement`) | ✅ | fase 2 |
| E-07 | Un encargo entregado no se vuelve a entregar | `RPC` | ✅ | — |
| E-08 | **El autor no aprueba su propio encargo** | `RPC` (`decide_engagement` → `42501`) + contrato `decide_engagement_atomic` | ✅ cierra **H02** (separación) — ADR-101 | fase 2 |
| E-09 | La decisión ARB es inmutable | `SQL` (sin `update`/`delete` concedidos) | ✅ | — |
| E-10 | La decisión se ata a la evidencia evaluada | `RPC` (evidencia canonizada en el servidor, nunca enviada por el cliente) | ✅ cierra **H02** (evidencia) | fase 2 |
| E-11 | Un veredicto de cambio o rechazo lleva motivo | `RPC` | ✅ | — |
| E-12 | La decisión y la transición ocurren juntas o no ocurren | `RPC` (`decide_engagement`, una transacción) | ✅ cierra **H01** — ADR-102 | fase 2 |
| E-13 | Un borrado desde vista obsoleta no elimina una edición concurrente | `RPC` (la sobrecarga de dos argumentos, retirada) + contrato | ✅ cierra **H09** | fase 2 |
| E-14 | El presupuesto de llamadas de IA no se excede | `TS` (runner) + `RPC` valida forma | ⚠️ el servidor valida la forma, no el consumo | — |
| E-15 | Ningún documento contiene `apiKey` | `SQL` (`check`) + `RPC` | ✅ declarativa | — |

## Entregables y Publicación

| # | Invariante | Autoridad | ¿Basta? | Desde |
|---|---|---|---|---|
| A-01 | Un artefacto tiene id, nombre, tipo, `versionGroupId` y versión numérica | `TS` (`artifactFactory`) + `RPC` (`artifact_shape_is_valid`) | ✅ | F4-03 |
| A-02 | El versionado es monótono dentro de un `versionGroupId` | `SQL` (índice único) + `RPC` (versión = máx + 1) | ✅ | F4-03 |
| A-03 | Editar un artefacto no borra los demás | Por construcción: ningún comando recibe la lista (ADR-106); la RPC compuesta, retirada (`retiredRpcs.test.ts`) | ✅ | F4-03, F4-06 |
| A-04 | Una decisión de revisión es inmutable | `RPC` (`on conflict do nothing`) | ✅ | — |

## Identidad y Acceso

| # | Invariante | Autoridad | ¿Basta? | Desde |
|---|---|---|---|---|
| U-01 | El rol sale de una sola fila | `RPC` (`private.current_role()`) + `UI` lee lo mismo | ✅ | — |
| U-02 | Un perfil deshabilitado no autoriza nada | `RPC` (`current_role()` → `NULL`) | ✅ falla cerrado | — |
| U-03 | `admin` no concede roles privilegiados | `RPC` + `lib/authz` | ✅ | — |
| U-04 | `admin` no degrada a un `superadmin` | `RPC` + `lib/authz` | ✅ | — |
| U-05 | Nadie crea su propia cuenta | `RPC` + ausencia de formulario | ✅ | — |
| U-06 | La matriz de `lib/authz` y la de SQL coinciden | prueba (`sqlMatrixParity.test.ts`) | ✅ | — |

## Capacidades técnicas

| # | Invariante | Autoridad | ¿Basta? | Desde |
|---|---|---|---|---|
| T-01 | No se persiste una URL firmada | convención + revisión | ⚠️ sin gate | — |
| T-02 | Una credencial no sale en un prompt | `TS` (`guardrails`, tres rutas) | ✅ | — |
| T-03 | Un secreto no entra en el bundle | gate de build | ✅ | — |
| T-04 | El grafo derivado acaba reflejando los artefactos actuales | `SQL` (disparador en la transacción del artefacto) + `RPC` (`save_graph_projection` idempotente) + recuperación al arrancar | ✅ cierra **H11** — ADR-107. Eventual: se procesa la próxima vez que alguien abre la aplicación | F5-04, F5-05 |
| T-05 | Cada chunk del build se evalúa sin error | gate E2E (`chunks.spec.ts`) + `noBarrelSelfImport.test.ts` | ✅ — ADR-109 | F6-04, F6-05 |
| T-06 | Dos pestañas no se borran mutuamente el historial de chat | **ninguna**: `save_chat_history` reescribe la lista entera sin revisión | ❌ necesita migración; en F6-08 | F6-05 (hallazgo) |

---

## Resumen

| Autoridad suficiente | Insuficiente | Total |
|---|---|---|
| **36 ✅** | 1 ❌ + 6 ⚠️ | 43 |

En la línea base eran 17 ✅, 8 ❌ y 8 ⚠️ sobre 33. **De las ocho sin autoridad
efectiva, siete tienen hoy servidor detrás.** H02 se cerró en sus tres partes
(transiciones, separación y evidencia), además de H01, H08, H09, H10 y H11.
A-02 ya estaba marcada ✅ en el catálogo anterior.

**Lo que queda, y por qué:**

- **E-01, E-04, E-05, E-14** y **T-01**: reglas que hoy sólo aplica
  TypeScript o la revisión de código.
- **T-06**: el único ❌, encontrado en F6-05.

Todas están en el registro de deuda residual (`13-deuda-residual.md`), con responsable y condición de revisión. E-02 se cerró en F6-08.

**Los dos patrones que funcionan siguen siendo los de siempre:** E-15, un
`check` declarativo que ninguna ruta puede saltarse, y U-06, una prueba que
compara las dos copias de la misma matriz celda por celda. T-04 añade un
tercero: el trabajo derivado se escribe en la transacción que lo causa.
