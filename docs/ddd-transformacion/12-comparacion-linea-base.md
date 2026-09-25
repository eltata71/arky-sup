# Comparación final contra la línea base

**F6-07 · 2026-09-25.** Mismos comandos que `00-linea-base.md`, sobre `main`
en `87172fd`. Las salidas están en `evidencias/f6-07-mediciones.md`.

| | Línea base | Hoy |
|---|---|---|
| Fecha | 2026-09-20 | 2026-09-25 |
| Commit | `fd590e7` | `87172fd` |
| Node | v22.22.2 (el repositorio pide 24; quedó **pendiente** repetir) | **v24.21.0**: el pendiente queda cumplido |

**Antes de leer las cifras: el instrumento cambió, y a peor para las cifras de
hoy.** Desde F3-02 (ADR-105), el verificador de fronteras lee también
`import type`, `import()` y los ficheros de la raíz (`types.ts`, `utils.ts`,
`App.tsx`…). Por eso hay **39 módulos declarados** donde había 34. Las cifras de
fronteras de hoy se miden sobre un grafo más grande que el de la línea base, y
su mejora es, si acaso, conservadora.

---

## 1. Gates del repositorio

| Gate | Línea base | Hoy | |
|---|---|---|---|
| `typecheck` | limpio | limpio | = |
| `typecheck:strict` | 31 entradas | **47** | +16 módulos bajo `strict` |
| `lint` | 0 / 0 | 0 / 0 | = |
| Tipos `any` | 23 (16 en el motor) | **7** (0 en el motor) | −70 % |
| Tamaño de módulo | ningún módulo sobre su techo | ninguno | = |
| Motor de generación | 5 405 líneas en `services/geminiService.ts` | **1 786** en `services/ai/generation/artifacts/` | −67 %, y dentro de su capa |
| Suite | 450 ficheros, 4 312 pruebas | **489 ficheros, 4 739 pruebas** | +427 pruebas |
| Cobertura | no medida | 67,66 / 58,51 / 60,56 / 69,63 % (statements, branches, functions, lines; CI, `main`) | — |

## 2. Fronteras

| Medida | Línea base | Hoy | |
|---|---|---|---|
| Módulos declarados | 34 | 39 | el grafo creció (ver arriba) |
| Ciclos directos | 4 | **3** | queda el trío de React, que es la forma de la UI |
| **Módulos de dominio mutuamente alcanzables** | **9** (invisibles para el gate) | **0** | la corrección más importante del diagnóstico, cerrada |
| Aristas dentro del componente de dominio | 22 | 0 | |
| Pares ascendentes | 0 | 0 | = |
| Pares con import profundo | 59 | **29** | −51 % |
| Imports profundos totales | 264 | **173** | −34 % |
| Pantallas sobre el fan-out | 10 | **0** | la tabla está vacía y ya no admite entradas |
| Ficheros sueltos en la raíz de `services/` | 1 (el motor) | 0 | |

El gate de la línea base **no podía ver** los nueve módulos de dominio
mutuamente alcanzables, porque sólo detectaba ciclos de longitud 2. Hoy los
mide (ADR-104) y la cifra es cero.

## 3. Bundle

| Medida | Línea base | Hoy | |
|---|---|---|---|
| Carga inicial | 323,9 KB gz | **310,1** | −13,8 |
| Entrada (`index-*.js`) | 195,8 KB gz | **182,5** | −13,3 |
| Secretos en `dist/` | ninguno | ninguno | = |
| Descarga por ruta | **no se medía** | medida y con techo por ruta; Dashboard 48,8, Agentes 42,0, Configuración 20,4 | — |
| Chunks que se evalúan sin error | **no se medía** | los 151 (`e2e/chunks.spec.ts`) | — |
| Chunk más grande (sin Excalidraw) | 1 427,9 KB raw | **1 792,7 KB raw** | **peor** |

**Lo que empeoró, dicho:** el mayor chunk compartido creció. Hoy es el que
agrupa ELK, el SDK de Gemini y el núcleo de IA (F6-05), y lo descargan al
abrirse las ocho rutas que usan IA, en torno a 600 KB gz cada una. La
línea base no medía descargas por ruta, así que no se puede decir si esas
rutas pagaban lo mismo antes: se puede decir que hoy **tres rutas dejaron de
pagarlo** y que las ocho restantes tienen techo. Bajarlas es la deuda
«la IA en el primer uso» de F6-08.

## 4. Superficie SQL

| Medida | Línea base | Hoy |
|---|---|---|
| Migraciones | 34 | 45 |
| Contratos pgTAP | 11, **no ejecutados** (sin Docker) | **18, ejecutados en CI**: 501 aserciones, todas en verde |
| `drop function` en migraciones | 0: una sobrecarga antigua podía seguir concedida (H09) | 2 sentencias: la sobrecarga de H09 y la RPC compuesta de F4-06. Las retiradas son explícitas |
| RPC y tablas con dueño declarado | matriz sin verificar | 58 RPC y 20 tablas, **verificadas por prueba** (`dataOwnershipMatrix.test.ts`) |
| Invariantes con autoridad suficiente | 17 de 33 | **35 de 43** |

## 5. Los doce hallazgos

| | Hallazgo | Estado | Dónde se cerró |
|---|---|---|---|
| H01 | Decisión ARB en dos escrituras | ✅ | `decide_engagement` atómica (ADR-102) |
| H02 | `save_engagement` sin transiciones, evidencia ni separación | ✅ | las tres partes en servidor (ADR-101) |
| H03 | Ciclos transitivos invisibles al gate | ✅ | el gate mide alcanzabilidad (ADR-104); el componente, 9 → 0 |
| H04 | APIs públicas exponen infraestructura | ⚠️ **parcial** | ver abajo |
| H05 | Escribir un artefacto reescribía el agregado | ✅ | comandos por artefacto y RPC compuesta retirada (ADR-106) |
| H06 | Charter validado fuera del runner | ⚠️ **parcial** | el runner lo aplica; el servidor no (invariante E-02) |
| H07 | El runner ignoraba fallos de persistencia | ✅ | fase 2 |
| H08 | Borrar una iniciativa rompía proyectos | ✅ | la RPC se niega si un proyecto la cita |
| H09 | Sobrecarga `delete_engagement(text,text)` viva | ✅ | retirada con `drop function` |
| H10 | Revisiones en un mapa global | ✅ | la revisión viaja con el registro; sin excepciones (F6-03) |
| H11 | Proyección sin recuperación durable | ✅ | bitácora en la base (ADR-107) |
| H12 | El módulo de IA dependía de negocio | ✅ | el motor por puertos (ADR-108) |

**Diez cerrados y dos parciales.**

- **H04.** Se fueron las cachés de revisión publicadas y los imports
  profundos bajaron un tercio. Pero varios barriles siguen exportando
  **instancias** de repositorio o sus implementaciones concretas de Supabase.
  Verificados: `services/settings` (`SupabaseSettingsRepository`),
  `services/architectureKnowledgeGraph`
  (`createSupabaseKnowledgeGraphRepository`), `services/learning`
  (`createSupabaseLearningRepository`), `services/architectureOffice`
  (`SupabaseOfficeEngagementRepository`) y `services/review` (sus
  repositorios local, remoto e híbrido). Es infraestructura en la superficie
  pública.
- **H06.** Un cliente manipulado aún puede escribir `in-progress` sobre un
  charter sin aprobar, porque la transición es legal en el servidor.

Los dos pasan a F6-08 con su propuesta.

## 6. Lo que no se puede comparar

- **Cobertura, E2E y descarga por ruta** no se midieron en la línea base. Se
  dan las cifras de hoy sin delta.
- **Los tiempos de CI** tampoco tienen línea base en este registro. Hoy: gates
  estáticos 97 s, cuatro shards de 49–69 s, E2E 5 min 19 s
  (`evidencias/f6-05-rendimiento-concurrencia.md`).
