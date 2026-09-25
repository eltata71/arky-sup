# ADR-107 — El trabajo derivado durable es una fila, escrita en la transacción que lo causa

**Fecha** 2026-09-24 (registrada en F6-06, 2026-09-25) · **Estado** aceptada ·
**Resuelve** H11 · **Tareas** F5-04, F5-05 · **Evidencia**
`evidencias/f5-04-f5-05.md`, `supabase/tests/database/projection_outbox.test.sql`,
`e2e/artifact-and-graph.spec.ts`

## Problema

El grafo de conocimiento es una **proyección** de los artefactos: se deriva de
ellos y se guarda aparte porque reconstruirlo cuesta. Su actualización era un
`setTimeout` en el navegador, lanzado después de guardar un artefacto.

Tres escenarios lo perdían, y ninguno dejaba rastro:

- Cerrar la pestaña antes de que venciera el temporizador.
- Guardar desde otro dispositivo.
- Que falle la escritura del grafo tras una escritura de artefacto que sí
  llegó.

El grafo quedaba desfasado sin que nada lo supiera, y ninguna consulta podía
responder qué grafos estaban pendientes.

## Decisión

1. **El pendiente es una fila de `api.projection_outbox`, escrita por un
   disparador en la transacción del artefacto.** Si el artefacto se confirma,
   el pendiente existe; si se revierte, tampoco existe. Ningún navegador
   interviene.
2. **Una fila por proyecto y proyección, con un contador de generación.** Dos
   cambios seguidos son un pendiente con la generación 2, no dos pendientes.
3. **Guardar la proyección y marcarla procesada es una operación**
   (`save_graph_projection(p_generation)`):
   - una generación ya procesada no se vuelve a escribir (`already-processed`);
   - una anterior no pisa a una más nueva (`stale`).
   Reprocesar es inocuo.
4. **Sólo los proyectos que ya tienen grafo acumulan pendientes.** Empezar un
   grafo es una decisión, no un efecto colateral de escribir un artefacto.
5. **Lo procesa el cliente al arrancar** (`recoverGraphProjections`, cargado
   de forma diferida), y los fallos se anotan con intentos y último error
   (`fail_projection`), así que un pendiente atascado es observable.

## Alternativas descartadas

- **Un trabajador en el servidor (cron o Edge Function que reconstruya).** El
  constructor del grafo es TypeScript de dominio que vive en el cliente.
  Duplicarlo en el servidor crea dos definiciones de la misma proyección, y la
  que se queda vieja es la que nadie ejecuta en local. Además, ADR-001 y el
  mandato de F1 no autorizan un backend de dominio.
- **Reconstruir siempre al leer.** Convierte cada apertura de proyecto en el
  trabajo más caro del producto.
- **Mantener el temporizador y reintentarlo.** Un reintento en una pestaña
  cerrada sigue sin existir.

## Consecuencias

- La recuperación depende de que alguien abra la aplicación. Es aceptable en
  una prueba de concepto de un solo inquilino. Si hiciera falta frescura sin
  usuarios, el siguiente paso es un procesador en servidor que lea esta misma
  tabla: el contrato ya está escrito.
- La regla se generaliza: **el trabajo derivado que tiene que ocurrir no vive
  en un temporizador del navegador** (CLAUDE.md, *What NOT to Do*).
- Qué hacer cuando un pendiente no se procesa: `docs/operacion/runbook-proyecciones.md`.
