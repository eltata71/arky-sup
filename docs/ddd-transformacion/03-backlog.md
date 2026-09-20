# Backlog

**Estados:** `pendiente` · `en curso` · `bloqueada` · `completada`.
Una tarea pasa a `completada` sólo con implementación **y** evidencia ejecutada.
`SQL-no-ejecutado` marca lo escrito pero no validable en este entorno.

**Tamaños:** S (≤½ día) · M (1–2 días) · L (3–5 días) · XL (>1 semana).

---

## Fase 1 — Modelo de dominio y línea base

### F1-01 · Línea base medida
- **Prioridad** P0 · **Tamaño** S · **Estado** `completada`
- **Objetivo.** Sustituir las cifras de `CLAUDE.md` por medición sobre `fd590e7`.
- **Alcance.** `docs/ddd-transformacion/00-linea-base.md`, `evidencias/`.
- **Aceptación.** Cada cifra con su comando; discrepancias con `CLAUDE.md` registradas.
- **Evidencia.** `00-linea-base.md` §1–§5; `evidencias/*.md`.

### F1-02 · Grafo de dependencias con ciclos transitivos
- **Prioridad** P0 · **Tamaño** S · **Estado** `completada` · **Depende de** F1-01
- **Objetivo.** Medir lo que el gate no mide.
- **Aceptación.** SCC calculados sobre el mismo grafo del gate, con sus aristas internas.
- **Evidencia.** `evidencias/scc-linea-base.md` — SCC de 9 módulos de dominio, 22 aristas.

### F1-03 · Verificación de los doce hallazgos
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada`
- **Aceptación.** Cada hallazgo clasificado, con fichero y línea, y con el tipo de evidencia diferenciado.
- **Evidencia.** `01-hallazgos.md`. 10 confirmados, 2 parciales, 0 descartados.

### F1-04 · Matriz de propiedad de tablas, RPC y datos
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada`
- **Aceptación.** Toda tabla `api.*` con contexto dueño, RPC de entrada y consumidores; los datos derivados marcados como reconstruibles.
- **Evidencia.** `06-propiedad-datos.md`.

### F1-05 · Lenguaje ubicuo y la colisión «Project / Attention / Proyecto / Atención»
- **Prioridad** P1 · **Tamaño** S · **Estado** `completada`
- **Aceptación.** Un nombre por concepto, con la decisión y el coste de cambiarlo.
- **Evidencia.** `04-lenguaje-ubicuo.md`, ADR-100.

### F1-06 · Catálogo de invariantes con autoridad de validación
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada`
- **Aceptación.** Cada invariante dice dónde se aplica (UI / TS / RPC / restricción SQL) y si esa autoridad basta.
- **Evidencia.** `07-invariantes.md`.

### F1-07 · Mapa de contextos y contratos
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada`
- **Evidencia.** `05-mapa-contextos.md`.

### F1-08 · ADR de la transformación
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada`
- **Evidencia.** `adr/ADR-100`…`ADR-104`.

### F1-09 · Backlog de las seis fases
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` — este documento.

---

## Fase 2 — Consistencia y gobernanza

### F2-01 · `DecideEngagement` como caso de uso, y su equivalente SQL transaccional
- **Prioridad** P0 · **Tamaño** L · **Estado** `pendiente` · **Resuelve** H01, H02
- **Alcance.** `services/architectureOffice/application/decideEngagement.ts` (nuevo),
  `context/OfficeContext.tsx`, `services/architectureOffice/OfficeEngagementRepository.ts`,
  `SupabaseOfficeEngagementRepository.ts`, migración nueva `api.decide_engagement`.
- **Cambios.** Una sola RPC que valida, transiciona, registra decisión y audita
  en una transacción, y devuelve la fila con su revisión. El caso de uso deja de
  hacer dos escrituras.
- **Aceptación.** Un fallo no deja encargo entregado sin decisión; el resultado
  distingue `success | conflict | permission-denied | failed`; la RPC rechaza un
  encargo que no está en `awaiting-arb`.
- **Pruebas.** Unitaria del caso de uso con puerto doblado (conflicto, permiso,
  éxito); pgTAP con caso negativo por cada guarda.
- **Riesgo/reversión.** La RPC nueva convive con las dos antiguas hasta F2-09; revertir es dejar de llamarla.

### F2-02 · Guardas de servidor: transición, estado previo, evidencia
- **Prioridad** P0 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F2-01 · **Resuelve** H02
- **Cambios.** Tabla de transiciones legales en SQL; `decide_engagement` exige
  `awaiting-arb`; la decisión guarda la `revision` del encargo evaluado.
- **Aceptación.** Una transición ilegal por PostgREST devuelve `22023`; la fila de decisión lleva la revisión evaluada.

### F2-03 · Separación autor/aprobador — decisión de modelo
- **Prioridad** P0 · **Tamaño** L · **Estado** `bloqueada` · **Resuelve** H02
- **Bloqueo.** `owner_id` es a la vez frontera de autorización y autor, así que
  hoy la separación es imposible, no laxa. Requiere decidir el modelo de
  visibilidad (ver ADR-101) — es una **ambigüedad de negocio**: ¿quién debe poder
  ver y firmar un encargo ajeno?
- **Aceptación.** El autor no puede autoaprobarse cuando la política lo exige; un
  aprobador autorizado sí puede actuar sobre el encargo.

### F2-04 · `PersistenceResult` evaluado en toda la Oficina
- **Prioridad** P0 · **Tamaño** M · **Estado** `pendiente` · **Resuelve** H01, H07
- **Alcance.** `context/OfficeContext.tsx` (`persistAndTrack`, las seis operaciones),
  `OfficeEngagementRunner.ts` (`ports.persist` pasa a devolver `PersistenceResult`).
- **Aceptación.** Ninguna operación de `OfficeContext` devuelve `ok: true` tras
  una escritura no confirmada; el runner se detiene ante un fallo no recuperable
  y lo reporta.

### F2-05 · `StartEngagement` como entrada pública única de ejecución
- **Prioridad** P0 · **Tamaño** M · **Estado** `pendiente` · **Resuelve** H06
- **Cambios.** `runEngagement` deja de ser la puerta; un caso de uso aplica
  `canRunEngagement` y la exclusión de concurrencia antes de arrancar.
- **Aceptación.** Llamar al runner sin charter aprobado es imposible desde la API pública del módulo; una prueba lo demuestra sin React.

### F2-06 · Idempotencia y reanudación ante fallo de persistencia
- **Prioridad** P1 · **Tamaño** L · **Estado** `pendiente` · **Depende de** F2-04 · **Resuelve** H07

### F2-07 · Retirar la sobrecarga `api.delete_engagement(text, text)`
- **Prioridad** P0 · **Tamaño** S · **Estado** `completada (SQL-no-ejecutado)` · **Resuelve** H09
- **Evidencia.** Migración `20260920120000_engagement_overload_and_initiative_references.sql`
  (`revoke` + `drop function if exists`). Contrato pgTAP
  `engagement_overload_and_initiative_references.test.sql`: la función tiene
  **una** firma y es la de tres argumentos. Y una prueba estática nueva,
  `__tests__/supabase/rpcOverloads.test.ts`, que **reprodujo el defecto en su
  origen** antes del arreglo — señaló `20260912181347: crea
  api.delete_engagement/3 y deja viva api.delete_engagement/2` — y vuelve a
  fallar si se quita el `drop` (comprobado).
- **Pendiente.** Los contratos pgTAP no se ejecutaron: sin Docker ni CLI de
  Supabase en este entorno. Corren en `.github/workflows/supabase.yml`.
- **Cambios.** Migración correctiva con `drop function`; contrato pgTAP que
  afirma que la firma de dos argumentos **no existe**; y una prueba de
  repositorio que afirma que el cliente pasa siempre tres argumentos.
- **Riesgo.** Un cliente desplegado llamando la firma vieja fallaría. Mitigación:
  `grep` del repositorio confirma que sólo `SupabaseOfficeEngagementRepository`
  la invoca y siempre con `p_expected_revision`.

### F2-08 · Proteger el borrado de iniciativas referenciadas
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada (SQL-no-ejecutado)` · **Resuelve** H08
- **Cambios.** `delete_business_initiative` rechaza si algún proyecto la cita
  (`errcode` propio, no `42501`); alternativa de archivado.
- **Aceptación.** Borrar una iniciativa citada falla con un mensaje que nombra los
  proyectos; ningún proyecto queda imposible de guardar.
- **Evidencia.** Misma migración. `delete_business_initiative` cuenta los
  proyectos que la citan y falla con `23503` nombrando hasta cinco. La ventana de
  carrera se cierra en los **dos** lados: `save_project_aggregate` toma
  `for key share` sobre las iniciativas citadas y el borrado toma `for update`
  antes de contar — el mecanismo de una clave foránea real, escrito a mano porque
  el enlace vive en una columna de array. Seis afirmaciones pgTAP, incluidas las
  tres negativas y la que comprueba que el proyecto **sigue siendo guardable**
  después del borrado rechazado, que es lo que el defecto rompía.

### F2-09 · Auditoría de sobrecargas y RPC sin consumidor
- **Prioridad** P1 · **Tamaño** M · **Estado** `parcial` · **Depende de** F2-07
- **Hecho.** `__tests__/supabase/rpcOverloads.test.ts` lee las migraciones en
  orden, simula `create`/`drop` y afirma que **ninguna función tiene dos aridades
  vivas**. Lee el texto y no el catálogo a propósito: el catálogo necesita Docker,
  así que una prueba que lo consultara no correría en el bucle interno, que es
  justo cuando alguien añade la sobrecarga.
- **Pendiente.** Enumerar las firmas concedidas a `authenticated` contra las que
  el repositorio declara consumir — eso sí necesita el catálogo, y va en pgTAP.

### F2-10 · La revisión viaja con el snapshot
- **Prioridad** P0 · **Tamaño** M · **Estado** `pendiente` · **Resuelve** H10
- **Alcance.** `SupabaseOfficeEngagementRepository.ts`, `OfficeEngagementRepository.ts`,
  `OfficeTypes.ts`, y la auditoría del mismo patrón en proyectos e iniciativas.
- **Aceptación.** Guardar desde un snapshot obsoleto produce `conflict`; el `Map`
  global deja de decidir la revisión.

### F2-11 · Pruebas de concurrencia y fallo parcial
- **Prioridad** P1 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F2-01, F2-10

---

## Fase 3 — Fronteras y contexto piloto

### F3-01 · El gate detecta componentes fuertemente conexos
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Resuelve** H03
- **Adelantada** desde la fase 3: es la herramienta que mide si la fase 5 avanza.
- **Evidencia.** `scripts/checkModuleBoundaries.mjs` (Tarjan iterativo, `ALLOWED_SCCS`,
  `--report` imprime el presupuesto copiable); `__tests__/scripts/moduleBoundaries.test.ts`
  pasa de 19 a **36** pruebas, **seis de ellas negativas** (componente nuevo, componente
  que crece nombrando el módulo entrante, dos que se funden, uno que encoge, uno roto,
  uno sin cambios). Gate en verde: `4 cycles, 2 strongly connected components (3 + 9 modules)`.
- **Cambios.** Tarjan en `scripts/checkModuleBoundaries.mjs`; presupuesto
  monótono `ALLOWED_SCCS` con los dos componentes de hoy; `--report` los imprime.
- **Aceptación.** Un ciclo de tres módulos nuevo falla el gate; los dos
  componentes actuales quedan registrados y no pueden crecer.
- **Riesgo.** El gate no puede empezar en rojo. El presupuesto registra lo que hay.

### F3-02 · Ampliar el alcance del verificador
- **Prioridad** P1 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F3-01

### F3-03 · Declarar dependencias permitidas entre contextos
- **Prioridad** P1 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F3-01

### F3-04 · Presupuestos decrecientes con objetivo y fecha
- **Prioridad** P2 · **Tamaño** S · **Estado** `pendiente`

### F3-05 · Iniciativas como contexto piloto — dominio puro
- **Prioridad** P0 · **Tamaño** L · **Estado** `pendiente`
- **Cambios.** `services/businessInitiatives/domain/` con reglas puras;
  puertos de repositorio; comandos/consultas/DTO publicados; objetos de valor
  para identificador, código y revisión; operaciones de negocio explícitas en
  lugar de `update(partial)`.
- **Aceptación.** Las reglas se prueban sin React ni Supabase; los consumidores
  no importan infraestructura; el presupuesto de descarga no empeora.

### F3-06 · Entradas públicas pequeñas compatibles con carga diferida
- **Prioridad** P1 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F3-05

---

## Fase 4 — Proyectos y Entregables

### F4-01 · Medir volumen y conflictos del agregado Proyecto–Artefacto
- **Prioridad** P0 · **Tamaño** M · **Estado** `pendiente` · **Resuelve** H05

### F4-02 · ADR: ¿Artefacto es raíz de agregado?
- **Prioridad** P0 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F4-01

### F4-03 · Revisión y comandos por artefacto
- **Prioridad** P0 · **Tamaño** L · **Estado** `pendiente` · **Depende de** F4-02

### F4-04 · Separar dominio, documento persistido y modelo de lectura
- **Prioridad** P1 · **Tamaño** L · **Estado** `pendiente`

### F4-05 · Sacar de React la coordinación de artefactos
- **Prioridad** P0 · **Tamaño** XL · **Estado** `pendiente`

### F4-06 · Migración por cortes verticales con ruta de escritura única
- **Prioridad** P0 · **Tamaño** L · **Estado** `pendiente` · **Depende de** F4-03

---

## Fase 5 — Oficina, IA y proyecciones

### F5-01 · Romper `services/ai -> services (raíz)`
- **Prioridad** P0 · **Tamaño** XL · **Estado** `pendiente` · **Resuelve** H12, H03
- **Nota.** 20 ficheros bajo `services/ai` importan `geminiService`. Es la arista
  que cierra el SCC de nueve. La estrangulación va vertical por vertical, cortando
  primero la dependencia ascendente de cada una (patrón `learningService`).

### F5-02 · Políticas de negocio a su contexto propietario
- **Prioridad** P1 · **Tamaño** L · **Estado** `pendiente` · **Depende de** F5-01

### F5-03 · Eliminar las 22 aristas internas del SCC
- **Prioridad** P0 · **Tamaño** XL · **Estado** `pendiente` · **Depende de** F5-01

### F5-04 · Outbox transaccional para trabajo durable
- **Prioridad** P0 · **Tamaño** L · **Estado** `pendiente` · **Resuelve** H11
- **Aceptación.** Cerrar el navegador no pierde un trabajo declarado durable;
  reprocesar no duplica; un evento viejo no sobrescribe una proyección más nueva.

### F5-05 · Recuperación de la proyección del grafo de conocimiento
- **Prioridad** P1 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F5-04

---

## Fase 6 — Consolidación y cierre

### F6-01 · Retirar rutas antiguas y adaptadores sin consumidor · P1 · M · `pendiente`
### F6-02 · Dependencias no autorizadas entre contextos a cero · P0 · L · `pendiente`
### F6-03 · Aplicar el patrón al resto de contextos · P1 · XL · `pendiente`
### F6-04 · Pruebas integrales de los flujos críticos · P0 · L · `pendiente`
### F6-05 · Verificar rendimiento, descarga, concurrencia y recuperación · P0 · M · `pendiente`
### F6-06 · Documentación, ADR, instrucciones y runbooks · P1 · M · `pendiente`
### F6-07 · Comparación final contra la línea base · P0 · S · `pendiente`
### F6-08 · Deuda residual con responsable y justificación · P1 · S · `pendiente`
### F6-09 · Informe técnico y gerencial de cierre · P1 · M · `pendiente`
