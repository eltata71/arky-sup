# Cierre de la fase 3 — Fronteras y contexto piloto

**Fecha** 2026-09-22 · **Estado** cerrada · **Plan** `02-plan-maestro.md` § Fase 3

> **Objetivo de la fase.** Que el gate mida lo que dice medir, y que un contexto
> enseñe el patrón.

## El criterio de cierre, contrastado uno a uno

| Criterio (plan maestro) | Estado | Evidencia |
|---|---|---|
| El detector encuentra ciclos de tres o más módulos | ✅ | F3-01 (Tarjan, `ALLOWED_SCCS`) y F3-02 (ADR-105: `import()` y ficheros de la raíz). `moduleBoundaries.test.ts`, negativos incluidos |
| Las reglas de Iniciativas se prueban sin React ni Supabase | ✅ | `services/businessInitiatives/domain/`; `initiativeCommands.test.ts` (14 pruebas, sin un mock) y `domainPurity.test.ts` |
| Sus consumidores no tocan infraestructura interna | ✅ | Ninguna pantalla importa `businessInitiatives/infrastructure` (lo afirma `domainPurity.test.ts`); el módulo sólo depende, en dominio, de `persistence` y `adapters` (lo afirma `moduleBoundaries.test.ts`) |
| El presupuesto de excepciones no sube | ✅ | Todos los presupuestos bajaron o se mantuvieron; tabla de abajo. Los techos de tamaño que suben lo hacen por bytes de ruta de import (F3-07), y cada uno lo dice en su línea |
| El de descarga no empeora | ✅ | Carga inicial **309,5 KB gz** (308,6 en F4-01, antes de F4-03; 309,4 tras F4-03 y F3-07). F3-05 costaba 1,2 KB gz y se devolvió cargando los comandos en diferido por una puerta propia (F3-06) |
| Queda un patrón documentado y replicable | ✅ | § *El patrón* de este documento |

## Tareas

| Tarea | Estado | PR |
|---|---|---|
| F3-01 gate transitivo | ✅ | #41 |
| F3-02 alcance del verificador | ✅ | #44 |
| F3-03 dependencias permitidas declaradas | ✅ | esta tanda |
| F3-04 presupuestos con objetivo y fecha | ✅ | esta tanda |
| F3-05 Iniciativas como contexto piloto | ✅ | esta tanda |
| F3-06 entradas públicas pequeñas | ✅ | esta tanda |
| F3-07 deshacer el reexportador `types.ts` | ✅ | #45 (parcial), #51 |
| F3-08 `utils.ts` no es utilidades | ✅ | #45 |

## Cifras

Medidas con `node scripts/checkModuleBoundaries.mjs --report`,
`npm run check:any-budget` y `npm run check:bundle-budget` tras
`npm run build:placeholders`.

| | Línea base (F1-01) | Tras F3-02 (alcance completo) | Cierre de la fase 3 |
|---|---|---|---|
| Ciclos directos | 4 | 11 | **4** (3 de la UI + `services (raíz) <-> services/ai`) |
| Componente de dominio | 9 módulos | 27 | **14** |
| Pares ascendentes | 0 | 7 | **0** |
| Pares con import profundo | 59 | 68 | **57** |
| Dependencias entre módulos declaradas | — | — | **246**, todas; una nueva falla |
| Tipos `any` | 23 | 23 | 23 (objetivo 7, 2027-06-30) |
| Carga inicial | — | — | 309,5 / 340 KB gz |
| Pruebas | 4 312 | 4 419 | **4 468** |

## El patrón, para el siguiente contexto

Iniciativas es el primer contexto que tiene la forma completa. Para repetirla en
otro contexto (F6-03):

1. **`domain/`**: la forma del agregado, sus identidades y su revisión, la
   lectura de lo almacenado (`initiativeRecord`), la fábrica que decide si puede
   existir, las **operaciones con nombre** y los cálculos. Sin E/S, sin React, sin
   reloj implícito: `now` entra por parámetro.
2. **Operaciones con nombre, no `update(partial)`.** Una unión discriminada de
   comandos y una función pura que devuelve el agregado nuevo o un rechazo
   tipado (`applyInitiativeCommand`). Las reglas que vivían en `useCallback`s de
   los paneles —fechar una medición, cerrar un hito, ordenar el calendario— son
   ahora casos del `switch`, probados con datos.
3. **`infrastructure/`**: el adaptador de base de datos y el repositorio con su
   espejo. Lo único que publica hacia fuera son las operaciones del repositorio.
4. **Una prueba de pureza** que escanee `domain/` (`domainPurity.test.ts`): el
   compilador no ve un import de `persistence` en el dominio, porque es válido.
5. **Puertas declaradas en `modules.json`** (F3-06): la principal, una pequeña
   para el dominio, y las que haga falta cargar en diferido. Entrar por una puerta
   declarada no es un import profundo; entrar por un fichero interno sí.
6. **El proveedor de React sólo hace lo que es de un proveedor**: estado
   optimista, la escritura, y revertir si la base no confirma. Aplica el comando
   del dominio y no decide nada.
7. **La revisión viaja con el registro** (F2-10) y se lee con su objeto de valor
   (`initiativeRevision`): desconocida se compara como «sin guardar», nunca
   como 1.

## Lo que la fase 3 deja decidido, y lo que no

- **D-4** (¿el Artefacto es raíz?) — resuelta por ADR-106, y ejecutada: F4-03
  (#50) y F3-07 (#51).
- **D-3** (¿«revisión» se llama «versión de fila» en la UI?) — **ya no bloquea
  nada.** Se comprobó que ninguna pantalla muestra el contador (búsqueda en
  `components/` y `pages/`), y en el código tiene nombre y objeto de valor
  propios. Queda como decisión de producto para el día que se muestre.
- **D-2** (archivado y retención) — sigue abierta; bloquea F6-08.

## Lo que no se pudo ejecutar aquí, dicho como tal

- El stack local de Supabase (`scripts/supabase/local.sh verify`) no arranca en
  el entorno de esta sesión: el proxy responde 403 a las descargas de Docker
  Hub. Los contratos SQL se verificaron contra PostgreSQL 16 nativo con
  `scripts/supabase/test-native.py`, y el workflow `supabase.yml` los ejecutó
  contra el stack real en CI (#50: 15 contratos, 426 pruebas, lint, advisors y
  tipos generados).
