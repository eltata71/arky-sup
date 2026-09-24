# Cierre de la fase 5 — Oficina, IA y proyecciones

**Fecha** 2026-09-24 · **Estado** cerrada en el repositorio; la migración de
F5-04 se aplica a `ArkyDB-US` con la aprobación del propietario ·
**Plan** `02-plan-maestro.md` § Fase 5

> **Objetivo de la fase.** Deshacer el componente conexo de nueve módulos y dar
> recuperación durable a lo que la necesita.

## El criterio de cierre, contrastado uno a uno

| Criterio (plan maestro) | Estado | Evidencia |
|---|---|---|
| El núcleo de IA no depende de implementaciones de negocio | ✅ | El motor entró en `services/ai` (F5-01, corte 14) y **no importa `artifacts`, `architectureOffice`, `agent` ni `chat`**: lo que necesitaba de ellos le llega por puertos (`ArtifactPersonaComposer`, `ArtifactGenerationSupport`). `artifactGenerationSupport.test.ts` lo afirma. Cierra **H12** |
| Cada extracción conserva contratos | ✅ | Catorce cortes, cada uno con su prueba de «el prompt no cambia» o de equivalencia (`artifactPersonaPort.test.ts`, `artifactGenerationSupport.test.ts`, las pruebas de cada vertical). Las firmas públicas de `services/ai` no cambiaron salvo `generateArtifactContent`, que ahora **exige** el soporte: el compilador comprobó los cuatro llamantes |
| Los ciclos entre contextos bajan hasta desaparecer | ✅ | **0 módulos de dominio mutuamente alcanzables** (eran 14 al empezar la fase) y 0 ciclos directos entre contextos. Queda el trío de React, que es la forma de la UI. F5-03: tres imports cortados (`evidencias/f5-03.md`) |
| Las proyecciones pendientes son observables y recuperables | ✅ | `api.projection_outbox`, escrita en la transacción del artefacto; `list_pending_projections` con intentos y último error; recuperación al arrancar (F5-05). Cierra **H11** |
| Reprocesar un evento no duplica efectos | ✅ | `save_graph_projection` no escribe una generación ya procesada ni una anterior. El contrato pgTAP lo prueba en los dos sentidos: la revisión no se mueve al reprocesar, y el grafo nuevo sobrevive a un evento viejo |

## Tareas

| Tarea | Estado | PR |
|---|---|---|
| F5-01 romper `services/ai -> services (raíz)` | ✅ catorce cortes | #56–#70 (y #62, el proxy en el camino de texto) |
| F5-02 políticas a su contexto propietario | ✅ | #71 |
| F5-03 el componente de dominio a cero | ✅ | #72 |
| F5-04 outbox transaccional | ✅ (migración pendiente de aplicar) | esta tanda |
| F5-05 recuperación de la proyección del grafo | ✅ | esta tanda |

## Hallazgos cerrados

| Hallazgo | Cómo |
|---|---|
| **H11** — el grafo derivado dependía del navegador y no tenía recuperación | La bitácora en la base (F5-04) y quien la procesa al arrancar (F5-05) |
| **H12** — el módulo de IA dependía de negocio a través del motor | El motor dentro de `services/ai` con sus dependencias ascendentes convertidas en puertos (F5-01) |
| **H03** (resto) — el componente conexo | De 14 módulos a 0 (F5-01, F5-03) |

Y uno que no estaba en la lista: **la revisión del grafo vivía en un `Map` por
instancia del repositorio.** Tras recargar la página, toda reconstrucción de un
grafo existente se rechazaba sin que nadie lo viera. Era la variante de **H10**
que F4-07 no alcanzó, porque estaba un contexto más allá. Corregido en F5-05.

## Cifras

Medidas con `node scripts/checkModuleBoundaries.mjs --report`,
`npm run check:any-budget`, `npm run check:bundle-budget` y la suite completa.

| | Cierre de la fase 4 | Cierre de la fase 5 |
|---|---|---|
| Ciclos directos | 4 | **3** (los de React) |
| Módulos de dominio mutuamente alcanzables | 14 | **0** |
| Ficheros sueltos en la raíz de `services/` | 1 | **0** |
| Pares ascendentes | 0 | 0 |
| Pares con import profundo | 56 | **44** |
| Pantallas sobre el fan-out por defecto | 6 | **0** (tabla vacía) |
| Dependencias entre módulos declaradas | 257 | **241** |
| Tipos `any` | 23 | **7** |
| Motor de generación | 5 405 líneas en `services/` | 1 786 en `services/ai/generation/artifacts/` |
| Carga inicial | 309,6 / 340 KB gz | **310,1** / 340 KB gz |
| Contratos pgTAP | 15 | **16** |

**Los cuatro objetivos con fecha de la fase en `budgetTargets.mjs` están
cumplidos**, el más holgado seis meses antes de su plazo, y además el de `any`
(11 → 7), que la fase compartía con F6-01.

**La carga inicial sube 1,0 KB gz** respecto a F5-03 (309,1 → 310,1), y es el
único número de la tabla que empeora. Es el protocolo de la bitácora dentro del
repositorio del grafo, que está en el arranque porque `projectReads` lo usa. La
recuperación en sí se carga en diferido por su propia puerta
(`services/architectureProjects/graphProjection.ts`); entrar por el barril
costaba 0,2 KB más.

**Las dependencias declaradas bajaron**, de 257 a 241. En la fase 4 subieron, y
se explicó que era esperable porque las decisiones bajaban de las pantallas al
dominio. En esta fase se retiraron aristas enteras: la raíz de `services/` con
todas las suyas, `chat -> ai`, `diagram -> architectureProjects` y
`architectureKnowledgeGraph -> architectureOffice`.

## Lo que la fase deja decidido

- **Una dependencia que apunta hacia arriba se convierte en un puerto que
  declara quien la necesita.** Pasó cinco veces: la persona de la Oficina, el
  soporte de artefactos, la conversación del asistente, la señal de un proyecto
  para un diagrama y la conversación que se compacta. Es la regla que más veces
  se aplicó, y la que hizo posible todo lo demás.
- **El tamaño de un componente conexo no dice lo difícil que es deshacerlo.** Lo
  dice cuántas aristas contradicen el orden de capas. Trece módulos cayeron con
  tres imports; F5-01 había predicho mal justamente por mirar el tamaño.
- **Ninguna pantalla puede alcanzar un tercer servicio**, y ya no hay presupuesto
  que lo absorba. Hay tres salidas según el caso: la regla va a su dueño, dos
  contextos se juntan en un hook, o el tipo lo entrega su contexto
  (`evidencias/f5-02.md`).
- **Un trabajo derivado que tiene que ocurrir se escribe en la base, en la
  transacción que lo causa.** Si se queda en un temporizador del navegador, se
  pierde exactamente cuando más se nota. La bitácora es genérica por proyección
  (`projection`), aunque hoy solo la use el grafo.

## Lo que la fase deja abierto, dicho como tal

- **Aplicar `20260924120000_projection_outbox` a `ArkyDB-US`.** Es aditiva y el
  cliente degrada sin ella, así que el orden de despliegue no rompe nada. Hasta
  aplicarla, producción no tiene recuperación durable, aunque el defecto del
  `Map` ya está corregido.
- **El gate que compare las migraciones del repositorio con las aplicadas**
  (propuesto en la fase 4) sigue sin existir. Esta fase lo vuelve a necesitar:
  es la tercera migración que depende de que alguien se acuerde de aplicarla.
  Pasa a la fase 6.
- `_generateArtifactContentInternal` (~900 líneas) sigue siendo un método
  enorme. Partirlo es descomposición ordinaria dentro de su módulo.
- **D-2** (archivado y retención) sigue abierta y bloquea F6-08.

## Lo que no se pudo ejecutar aquí

En este equipo no hay Docker ni PostgreSQL, así que el contrato
`projection_outbox.test.sql` se ejecutó en el workflow `supabase.yml` del CI,
contra el stack real de Supabase. Ver el resultado en la PR.
