# Catálogo de invariantes

La columna que importa es **Autoridad**: dónde se aplica de verdad la regla. Un
`if` en React no es autoridad — es cortesía con el usuario. La autoridad es lo
que un cliente manipulado no puede saltarse.

Leyenda: `UI` React · `TS` función de dominio en TypeScript ·
`RPC` guarda dentro de una función `SECURITY DEFINER` ·
`SQL` restricción declarativa (`check`, `foreign key`, `unique`) ·
`RLS` política de fila.

---

## Iniciativas y Portafolio

| # | Invariante | Autoridad hoy | ¿Basta? |
|---|---|---|---|
| I-01 | Una iniciativa tiene título, necesidad declarada y responsable | `TS` (`businessInitiativeFactory`) | ❌ la RPC no lo exige |
| I-02 | El código es `NEG-YYYY-NNN` o vacío | `TS` (`toInitiativeCode`) | ⚠️ aceptable: degrada a vacío, no a algo plausible |
| I-03 | Una iniciativa citada por un proyecto no se borra | **ninguna** | ❌ **H08** |

## Proyectos de Arquitectura

| # | Invariante | Autoridad hoy | ¿Basta? |
|---|---|---|---|
| P-01 | Un proyecto tiene nombre | `TS` + `RPC` (`project_name = ''` → 22023) | ✅ |
| P-02 | Un proyecto tiene al menos una iniciativa | `TS` (`createArchitectureProject`) + `RPC` | ✅ **la referencia del repositorio** |
| P-03 | Las iniciativas citadas existen y son del actor | `RPC` | ✅ al escribir — pero ver I-03 |
| P-04 | `artifactCount` y `artifactIndex` coinciden con los artefactos | `RPC` (recalculados **desde las filas** por cada comando, F4-03) | ✅ |
| P-05 | Un artefacto pertenece a un solo proyecto | `RPC` (23505) | ✅ |
| P-06 | Una escritura desde vista obsoleta no pisa otra | `RPC` (revisión optimista) | ⚠️ depende de que el cliente mande la revisión correcta — **H10** |
| P-07 | El dueño es el actor | `RPC` + `RLS` | ✅ |

## Encargos y Gobernanza

| # | Invariante | Autoridad hoy | ¿Basta? |
|---|---|---|---|
| E-01 | Un encargo tiene título, atención e iniciativa | `TS` (`officeEngagementFactory`) + `RPC` parcial (título y brief) | ⚠️ la RPC no exige iniciativa |
| E-02 | **Nadie ejecuta un charter sin aprobar** | `TS` (`canRunEngagement`), llamada desde `UI` | ❌ **H06** — el runner no la aplica; el servidor no la conoce |
| E-03 | El estado sigue transiciones legales | **ninguna** | ❌ **H02** — la RPC acepta cualquier salto entre 8 enums |
| E-04 | Un cambio de estado deja su rastro de auditoría | `TS` (`transitionEngagement`) + gate de pruebas | ⚠️ sólido en TS, invisible al servidor |
| E-05 | Productor y revisor de un entregable son distintos | `TS` (planificador) | ⚠️ |
| E-06 | Sólo `arb:decide` lleva a `delivered` | `RPC` | ✅ |
| E-07 | Un encargo entregado no se vuelve a entregar | `RPC` | ✅ |
| E-08 | **El autor no aprueba su propio encargo** | **ninguna** — y es imposible hoy | ❌ **H02** — `owner_id` es autor y frontera a la vez |
| E-09 | La decisión ARB es inmutable | `SQL` (sin `update`/`delete` concedidos) | ✅ |
| E-10 | La decisión se ata a la evidencia evaluada | **ninguna** | ❌ **H02** |
| E-11 | Un veredicto de cambio o rechazo lleva motivo | `RPC` | ✅ |
| E-12 | La decisión y la transición ocurren juntas o no ocurren | **ninguna** | ❌ **H01** |
| E-13 | Un borrado desde vista obsoleta no elimina una edición concurrente | `RPC` en la firma de 3 args; **saltable** por la de 2 | ❌ **H09** |
| E-14 | El presupuesto de llamadas de IA no se excede | `TS` (runner) + `RPC` valida forma | ⚠️ el servidor valida la forma, no el consumo |
| E-15 | Ningún documento contiene `apiKey` | `SQL` (`check`) + `RPC` | ✅ **la mejor del catálogo**: declarativa |

## Entregables y Publicación

| # | Invariante | Autoridad hoy | ¿Basta? |
|---|---|---|---|
| A-01 | Un artefacto tiene id, nombre, tipo, `versionGroupId` y versión numérica | `TS` (`artifactFactory`) + `RPC` | ✅ |
| A-02 | El versionado es monótono dentro de un `versionGroupId` | `SQL` (índice único `(project_id, version_group_id, version)`) + `RPC` (versión = máx + 1) — F4-03 | ✅ |
| A-03 | Editar un artefacto no borra los demás | Por construcción: ningún comando recibe la lista (F4-03, ADR-106); la ruta compuesta rechaza una lista distinta de la almacenada | ✅ |
| A-04 | Una decisión de revisión es inmutable | `RPC` (`on conflict do nothing`) | ✅ |

## Identidad y Acceso

| # | Invariante | Autoridad hoy | ¿Basta? |
|---|---|---|---|
| U-01 | El rol sale de una sola fila | `RPC` (`private.current_role()`) + `UI` lee lo mismo | ✅ |
| U-02 | Un perfil deshabilitado no autoriza nada | `RPC` (`current_role()` → `NULL`) | ✅ falla cerrado |
| U-03 | `admin` no concede roles privilegiados | `RPC` + `lib/authz` | ✅ |
| U-04 | `admin` no degrada a un `superadmin` | `RPC` + `lib/authz` | ✅ |
| U-05 | Nadie crea su propia cuenta | `RPC` + ausencia de formulario | ✅ |
| U-06 | La matriz de `lib/authz` y la de SQL coinciden | prueba (`sqlMatrixParity.test.ts`) | ✅ **el patrón a imitar** |

## Capacidades técnicas

| # | Invariante | Autoridad hoy | ¿Basta? |
|---|---|---|---|
| T-01 | No se persiste una URL firmada | convención + revisión | ⚠️ sin gate |
| T-02 | Una credencial no sale en un prompt | `TS` (`guardrails`, tres rutas) | ✅ |
| T-03 | Un secreto no entra en el bundle | gate de build | ✅ |
| T-04 | El grafo derivado refleja los artefactos actuales | `UI` (`setTimeout` de 2,5 s) | ❌ **H11** |

---

## Resumen

| Autoridad suficiente | Insuficiente | Total |
|---|---|---|
| 17 ✅ | 8 ❌ + 8 ⚠️ | 33 |

**Las ocho sin ninguna autoridad efectiva** (I-03, E-02, E-03, E-08, E-10, E-12,
E-13, A-02, T-04) son exactamente el alcance de la fase 2, más T-04 que es de la
fase 5. Ninguna es un `if` que falte: cada una necesita decidir *dónde vive la
regla* antes de escribirla.

**El patrón que funciona ya está en el repositorio y hay que copiarlo:** E-15
(`check` declarativo que ninguna ruta puede saltarse) y U-06 (una prueba que
compara las dos copias de la misma matriz celda por celda).
