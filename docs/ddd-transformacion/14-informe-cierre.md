# Informe de cierre — transformación DDD / monolito modular de Arky

**F6-09 · 2026-09-27.** Cierra el plan de seis fases de `02-plan-maestro.md`.
Línea base: 2026-09-20 sobre `fd590e7` (`00-linea-base.md`). Toda cifra de este
informe sale de un documento de esta carpeta o de un comando citado; donde una
cifra no se midió en la línea base, se dice.

El informe tiene dos partes. La **gerencial** (§1–§4) se lee en cinco minutos y
no necesita saber programar. La **técnica** (§5–§10) da las cifras, dónde se
comprueba cada una y lo que queda.

---

# Parte gerencial

## 1. Qué se pidió y qué se entregó

**Se pidió** ordenar la aplicación por dentro sin detenerla: que cada parte del
negocio —iniciativas, proyectos, encargos de la Oficina, artefactos— tuviera
sus reglas en un solo sitio, que las reglas importantes las hiciera cumplir el
servidor y no el navegador, y que el código no pudiera volver a enredarse sin
que una comprobación automática lo detectara. Sin microservicios, sin backend
propio y sin cambiar de tecnología.

**Se entregó** eso, en siete días y **unas 54 PR**, con la aplicación publicada
y funcionando durante todo el proceso:

- **Las 50 tareas del plan, hechas.** Cada una con su evidencia en el
  repositorio (`evidencias/verificacion-final.md` y este informe).
- **11 de los 12 problemas del diagnóstico inicial, cerrados**, y el que
  queda, casi cerrado (§6).
- **38 de las 43 reglas de negocio catalogadas las hace cumplir el servidor o
  una prueba automática.** Al empezar eran 17 de 33.
- **El despliegue se niega a publicar** una versión cuya base de datos no está
  al día, y **nada llega a producción sin pasar** las pruebas y los controles.

## 2. Qué gana el negocio

| Antes | Ahora |
|---|---|
| Un navegador manipulado podía entregar un encargo sin decisión del comité, aprobar lo suyo o ejecutar un charter sin aprobar | El servidor lo rechaza. La decisión del comité y el cambio de estado ocurren juntos o no ocurren |
| Editar un artefacto reescribía el proyecto entero, y dos personas podían borrarse el trabajo | Cada artefacto se guarda solo, con control de versión; un conflicto se detecta y se avisa |
| Un fallo al guardar podía mostrarse como éxito | Todo guardado informa su resultado real, y si la base no está disponible se conserva el trabajo en local y se dice |
| El grafo de conocimiento se perdía si se cerraba la pestaña a tiempo | El trabajo pendiente queda en la base y se recupera solo |
| La comprobación de estructura estaba en verde con nueve partes del negocio enredadas entre sí | Cero partes enredadas, y la comprobación ya puede verlo |
| La pantalla de inicio descargaba 617 KB extra al abrirse | 49 KB, y cada pantalla tiene un techo que no puede superar |

**Incidentes reales encontrados y corregidos durante el trabajo**, que no
estaban en el diagnóstico: el Workspace dejó de cargar en producción por un
detalle de empaquetado (F6-04); la carga de pantallas se tragaba los errores;
cada reconstrucción del grafo cambiaba la versión del proyecto y podía chocar
con una edición real; y la creación guiada fallaba en producción para quien no
tenía clave de IA propia (F6-01). Los cuatro tienen hoy una prueba que impide
que vuelvan.

## 3. Lo que queda, y quién lo decide

Nada de lo pendiente bloquea el uso actual del producto como prueba de
concepto. Todo está registrado en `13-deuda-residual.md`, con la condición que
obliga a retomarlo.

| Tema | Tipo | Cuándo hay que decidir |
|---|---|---|
| **Archivado y retención de datos** (R-01) | Decisión de negocio, tomada para la PoC: se conserva todo | **Antes de cargar datos reales** |
| **Quién aprueba un charter** (R-02) | Decisión de producto, **abierta** | Cuando haya varios usuarios con roles distintos |
| **El historial de chat con dos pestañas abiertas** (R-03) | Riesgo aceptado, **decisión técnica abierta** | Antes de tener varios usuarios |
| Tres reglas de la Oficina que aplica sólo la aplicación (R-05, R-06, R-07) | Riesgos aceptados | Si la auditoría pasa a tener valor legal, si las tareas se asignan a personas o si hay coste que facturar |
| La IA se descarga al abrir ocho pantallas (R-09) | Rendimiento, con techo | Si se nota en iPad |
| Una función de ~900 líneas en el generador (R-12) | Mantenibilidad, con techo | Al añadir el próximo tipo de artefacto |

## 4. Recomendación

1. **Dar por cerrada la transformación.** Los criterios de cierre de las seis
   fases se cumplen (§7), con dos matices escritos y medidos.
2. **Antes de cargar datos reales o de sumar usuarios**, decidir R-01, R-02 y
   R-03. Son tres decisiones pequeñas, y las tres cambian el esquema de la base,
   así que conviene tomarlas juntas.
3. **Mantener las comprobaciones automáticas como están.** Son lo que impide
   volver atrás: cada presupuesto sólo puede bajar.

---

# Parte técnica

## 5. Cifras: línea base contra cierre

Mismos comandos que `00-linea-base.md`. Las de cierre son de 2026-09-26/27 sobre
`main`; `12-comparacion-linea-base.md` tiene la comparación completa del
2026-09-25 y sus salidas.

| Medida | Línea base (2026-09-20) | Cierre | Fuente |
|---|---|---|---|
| Módulos de dominio mutuamente alcanzables | **9** (el gate no los veía) | **0** | `check:module-boundaries` |
| Ciclos directos | 4 | 3 (el trío de React) | ídem |
| Pares con import profundo | 59 | **29** | ídem |
| Imports profundos totales | 264 | **127** | ídem, `--report` |
| Pantallas sobre el límite de servicios | 10 | **0** (la tabla ya no admite entradas) | ídem |
| Tipos `any` | 23 (16 en el motor) | **7** (0 en el motor) | `check:any-budget` |
| Motor de generación | 5 405 líneas, fuera de su capa | **1 695**, dentro de `services/ai` | `wc -l` |
| Declaraciones sin uso | no se medía | **0**, y `typecheck` falla si aparece una | `tsconfig.json` |
| Pruebas | 450 ficheros, 4 312 | **494 ficheros, 4 809** | `vitest run` |
| Cobertura (statements / branches / functions / lines) | no se medía | **67,73 / 58,55 / 60,59 / 69,71 %** | CI de `main`, trabajo *Merged coverage* |
| Carga inicial | 323,9 KB gz | **311,2** de 340 | `check:bundle-budget`, tras `npm ci` |
| Descarga por ruta | no se medía | con techo por ruta; Dashboard 48,9, Agentes 42,1, Configuración 20,5 KB gz | ídem |
| Chunks que se evalúan sin error en un navegador | no se medía | todos (`e2e/chunks.spec.ts`) | E2E en CI |
| Migraciones | 34 | **48** | `supabase/migrations/` |
| Contratos pgTAP | 11, **sin ejecutar** | **21, ejecutados en CI** contra una base real | `supabase.yml` |
| RPC retiradas con `drop function` | 0 | **3**: la sobrecarga de H09, la RPC compuesta de F4-06 y `record_arb_decision` (R-13) | `retiredRpcs.test.ts` |
| Tablas y RPC con dueño declarado | matriz sin verificar | **todas**, verificadas por prueba | `dataOwnershipMatrix.test.ts` |
| Invariantes con autoridad suficiente | 17 de 33 | **38 de 43** | `07-invariantes.md` |

**Lo que empeoró, dicho:** el mayor chunk compartido creció (1 427,9 → 1 792,7
KB sin comprimir). Agrupa ELK, el SDK de Gemini y el núcleo de IA, y lo
descargan las ocho rutas que usan IA. La línea base no medía descargas por
ruta, así que no se sabe si antes pagaban lo mismo; hoy tienen techo y tres
rutas dejaron de pagarlo. Es la deuda R-09.

## 6. Los doce hallazgos

| | Hallazgo | Estado | Cierre |
|---|---|---|---|
| H01 | Decisión ARB en dos escrituras | ✅ | `decide_engagement` atómica (ADR-102) |
| H02 | `save_engagement` sin transiciones, evidencia ni separación | ✅ | las tres en servidor (ADR-101) |
| H03 | Ciclos transitivos invisibles al gate | ✅ | el gate mide alcanzabilidad (ADR-104, ADR-105); 9 → 0 |
| H04 | APIs públicas exponen infraestructura | ⚠️ **casi cerrado** | quedan 29 pares profundos con su razón y **una** implementación publicada a propósito (R-10) |
| H05 | Escribir un artefacto reescribía el agregado | ✅ | comandos por artefacto; RPC compuesta retirada (ADR-106) |
| H06 | Charter validado fuera del servidor | ✅ | F6-08, migración `charter_approval_guard` |
| H07 | El runner ignoraba fallos de persistencia | ✅ | fase 2 |
| H08 | Borrar una iniciativa rompía proyectos | ✅ | la RPC se niega si un proyecto la cita |
| H09 | Sobrecarga `delete_engagement(text,text)` viva | ✅ | `drop function` |
| H10 | Revisiones en un mapa global | ✅ | la revisión viaja con el registro, sin excepciones |
| H11 | Proyección sin recuperación durable | ✅ | bitácora en la base (ADR-107) |
| H12 | El módulo de IA dependía de negocio | ✅ | el motor por puertos (ADR-108) |

## 7. Criterios de cierre del plan

| Fase | Criterio (`02-plan-maestro.md`) | Estado |
|---|---|---|
| 1 | línea base, hallazgos, invariantes con dueño, decisiones separadas, backlog | ✅ |
| 2 | fallo sin entrega a medias; sin autoaprobación; transiciones ilegales rechazadas; charter sin aprobar no corre; sin duplicados; sin referencias rotas; **RPC retiradas no invocables**; fallo no comunicado como éxito | ✅ — la RPC retirada, además, eliminada (R-13) |
| 3 | ciclos de 3+ detectados; Iniciativas probada sin React ni Supabase; patrón documentado; presupuestos que no suben | ✅ |
| 4 | frontera por ADR; concurrencia probada; editar no pisa; versionado fuera de React; **migraciones con compatibilidad y reversión** | ✅ — la reversión de las 8 que no la traían está escrita (R-14) |
| 5 | IA sin dependencias de negocio; ciclos a cero; proyecciones observables, recuperables e idempotentes | ✅ |
| 6 | cero ciclos entre contextos, leídos transitivamente | ✅ 0 |
| 6 | cero accesos externos a implementaciones internas | ⚠️ 29 pares con import profundo, cada uno con su razón, y una implementación publicada (R-10). Cada número sólo puede bajar |
| 6 | toda tabla, RPC e invariante con propietario | ✅ por prueba |
| 6 | el dominio probado sin infraestructura ni UI | ✅ en los **cuatro agregados** (`contextDomainPurity.test.ts`); los módulos de apoyo, en R-15 |
| 6 | invariantes críticas en servidor | ✅ 38 de 43; las 5 restantes con responsable |
| 6 | decisiones ARB atómicas y auditables | ✅ |
| 6 | conflictos concurrentes explícitos y recuperables | ✅ salvo el historial de chat (R-03, decisión abierta) |
| 6 | proyecciones durables idempotentes | ✅ |
| 6 | gates de calidad y rendimiento en verde | ✅ |
| 6 | informe técnico y gerencial | ✅ este documento |

## 8. La arquitectura que queda

- **Cuatro agregados con la misma forma** —Iniciativa, Proyecto, Encargo,
  Artefacto—: `domain/` puro (sin E/S, comprobado por el cierre de imports y
  con una regla de dirección), `application/` que orquesta puertos e
  `infrastructure/` con Supabase. Cada uno con su fábrica, que rechaza lo que
  el negocio no admite, y cambios por **operaciones con nombre**, no por
  parches.
- **El servidor como autoridad**: RLS deny-by-default, privilegios revocados
  en todas las tablas, y RPC `SECURITY DEFINER` que comprueban permiso,
  sesión, revisión y regla de negocio en la misma transacción.
- **La IA en su capa**: el motor estrangulado corte a corte hasta quedar
  dentro de `services/ai`, sin importar ningún contexto de negocio; recibe lo
  que necesita por puertos (ADR-108).
- **Trabajo derivado durable**: la bitácora de proyecciones se escribe en la
  transacción que la causa (ADR-107).
- **Diez ADR** (ADR-100…109) con las decisiones y lo que se descartó.

## 9. Cómo se impide volver atrás

Cada una de estas comprobaciones corre en cada PR y **bloquea el despliegue**:

- fronteras de módulo: ciclos, alcanzabilidad, capas, puertas públicas,
  fan-out de pantallas y dependencias declaradas, con presupuestos que sólo
  bajan;
- tamaño de módulo en líneas y en bytes, `any`, código sin uso y `strict` en
  una lista que sólo crece;
- presupuesto de descarga inicial y **por ruta**, y ningún secreto en el
  bundle;
- pureza de los cuatro dominios, operaciones con nombre, ausencia de mapas de
  revisión, RPC retiradas que no vuelven y matriz de propiedad al día;
- contratos pgTAP contra una base real, E2E sobre el build que se publica, y
  la sonda que impide publicar sin las migraciones aplicadas (F6-10).

## 10. Operación

- **Runbooks** en `docs/operacion/`: aplicar una migración a `ArkyDB-US`
  (con el anexo de reversión), una ruta que no carga, un grafo que no se
  actualiza y la suite E2E.
- **Las migraciones se aplican a mano, con aprobación**, antes de fusionar el
  código que las usa, y el despliegue falla cerrado si falta una.
- **Medir el bundle siempre tras `npm ci`.** Un `node_modules` local desviado
  del lockfile dio cifras 0,3 KB gz bajas durante una semana
  (`evidencias/revision-deuda-tecnica.md`).

## Documentos de referencia

`00-linea-base.md` · `01-hallazgos.md` · `02-plan-maestro.md` · `03-backlog.md`
· `07-invariantes.md` · `08-avance.md` · `12-comparacion-linea-base.md` ·
`13-deuda-residual.md` · `adr/` · `evidencias/verificacion-final.md` ·
`evidencias/revision-deuda-tecnica.md`.
