# Acta de cierre — Fase 9: retiro de legado y cierre del proyecto

**Fecha:** 2026-09-19. **Base:** rama `claude/phase-nine-supabase-migration-4o4nvh`.
**Alcance:** `docs/plan-transformacion-supabase-ddd.md` §4, tareas F9.1–F9.5, más
lo que el mandato de esta sesión añadió explícitamente: *dejar la aplicación
funcionalmente habilitada sobre Supabase*, con IA, usuarios, datos, archivos y
despliegue cubiertos.

---

## 0. Lo que esta fase encontró, y que no era lo que decía el plan

F9 estaba escrita como una fase de limpieza: retirar SDK, adaptadores y
documentación obsoleta de un producto que ya corría sobre Supabase. **No era el
caso.** La auditoría de F0–F8 declaró 46 tareas verificadas, y lo estaban: el
esquema de los siete contextos existía, las 30 migraciones estaban aplicadas, la
matriz de permisos estaba duplicada en SQL con sus pruebas de paridad, y Storage
tenía sus políticas. Lo que no existía era la otra mitad:

| Lo que había | Lo que faltaba |
|---|---|
| 30 migraciones aplicadas en el remoto | `resolveBackend` devolvía `firebase` por defecto, en todos los contextos |
| `SupabaseSettingsRepository`, `…BusinessInitiative…`, `…OfficeEngagement…`, `…KnowledgeGraph…`, `…Learning…` | Dos de los cinco no los llamaba nadie; los otros tres sólo detrás de una bandera apagada |
| `services/adapters/supabaseDataBackend.ts` | Su función principal era `requireSupabaseDataBackend`, que **lanzaba siempre** |
| Storage con 12 migraciones y políticas | Ningún flujo del producto subía un archivo |

Dicho de otra forma: **la plataforma estaba construida y la aplicación seguía
enchufada al proveedor anterior.** Cerrar F9 como estaba escrita —borrar
Firebase— habría dejado un producto sin persistencia. Así que esta fase hizo
primero lo que faltaba de F5 y F6, y después el retiro.

---

## 1. Lo que faltaba en el esquema

Un inventario de `services/persistence/collectionPaths.ts` contra `api.*` dejó
seis huecos. Cada uno es un conjunto de datos del producto que se habría perdido
el día que se borre el proyecto de Firebase.

| Hueco | RPC nueva |
|---|---|
| Listar el portafolio (existía `load_project_aggregate(id)`, que sirve para abrir **uno**) | `list_project_aggregates` |
| Historial de chat por proyecto | `load_chat_history`, `save_chat_history` |
| Registro de acciones del agente | `list_agent_actions`, `append_agent_action` |
| Ficha configurada de cada agente, por usuario | `list_agent_profiles`, `save_agent_profile`, `delete_agent_profile` |
| Comentarios y decisiones de revisión | `list_artifact_comments`, `save_artifact_comment`, `delete_artifact_comment`, `list_artifact_review_decisions`, `record_artifact_review_decision` |
| Directorio de usuarios y perfil propio | `list_user_profiles`, `load_own_profile`, `update_own_display_name` |
| Borrar un proyecto entero | `delete_project_aggregate` |

Tres decisiones dentro de esas migraciones merecen quedar escritas:

- **El rastro de decisiones es inmutable de verdad.**
  `record_artifact_review_decision` hace `on conflict do nothing`: repetir el id
  no falla y **no reescribe**. Es la mitad de servidor de lo que en Firestore
  era `allow update: if false`, y sin ella el registro de quién aprobó qué sería
  una opinión con fecha.
- **La ficha de un agente no puede tocar la gobernanza.**
  `save_agent_profile` rechaza `orchestrationRole`, `producesArtifactTypes` y
  `reviewsArtifactTypes`. La pantalla ya no los ofrecía, pero una pantalla corre
  en un navegador que controla quien llama.
- **El borrado informa de lo que quitó.** `delete_project_aggregate` devuelve
  cuántos encargos y cuántos grafos se llevó por delante. Los artefactos, el
  historial, las acciones y los comentarios cuelgan por clave foránea en
  cascada; los encargos y el grafo **no** —se crearon en cortes anteriores,
  cuando el proyecto todavía vivía en Firebase— y se borran explícitamente. Un
  borrado que quita más de lo que dice es pérdida de datos con otro nombre.

**Verificación independiente:** sonda transaccional contra ArkyDB-US,
`scripts/supabase/retirement-completeness-remote-probe.sql`, **14/14 OK**, cada
caso con su negativo (el ajeno no ve el portafolio, no escribe el historial, no
lee los comentarios; el arquitecto no lee el directorio; una clave pegada en el
chat se rechaza). Contratos pgTAP equivalentes en
`supabase/tests/database/retirement_completeness.test.sql`.

---

## 2. Los esquemas expuestos dejan de vivir en un panel

Todo el producto entra por RPC del esquema `api`. Si PostgREST no lo tiene en
`db-schemas`, **cada llamada devuelve 404** y la aplicación se lee como si no
hubiera datos. Esa configuración vivía sólo en el panel de Supabase: no se revisa
en una PR, no viaja con el repositorio y nadie se entera el día que alguien la
cambia.

La migración `data_api_exposed_schemas` la fija con
`alter role authenticator set pgrst.db_schemas`. Es el mismo argumento que puso
el interruptor de despliegue en `vercel.json` en vez de en el panel de Vercel, y
queda advertido en el runbook: cambiar «Exposed schemas» desde el panel puede
deshacerlo.

---

## 3. Identidad: un proveedor y una función de servidor

`services/identity` habla sólo con Supabase Auth. Lo que cambió, y lo que se
perdió a propósito:

- **El alta de cuentas está partida en dos.** La Edge Function `provision-user`
  invita —es lo único que exige la clave de servicio— y el navegador, con la
  sesión del administrador, llama a `api.provision_user_profile`. Ahí viven el
  permiso `users:create`, la regla de que sólo un `superadmin` concede roles
  administrativos, y la entrada de auditoría con el actor real. Escribir el
  perfil dentro de la función habría duplicado esas tres reglas, y la copia que
  se queda vieja siempre es la que concede de más.
- **No hay contraseña que elegir.** `inviteUserByEmail` crea la cuenta sin
  credencial y manda un enlace. El secreto de un solo uso que la versión anterior
  generaba desapareció con el API que lo exigía, que es una forma mejor de
  cumplir la misma regla.
- **El acceso con Google se retiró** con Firebase (ADR-004: proveedor único).
  Reponerlo es configurar OAuth en Supabase y añadir una llamada; no se ha hecho
  porque nadie lo pidió y un proveedor de identidad que nadie usa es superficie
  de ataque sin contrapartida.
- **El bypass de desarrollo ya no toca el backend.** Era una sesión anónima real
  con un perfil no privilegiado escrito en la base; ahora es una identidad en
  memoria. Su rol `superadmin` siempre vivió sólo en estado de React, y crear una
  cuenta de verdad para sostenerlo era el peor de los dos mundos.
- **`resolveEffectiveRole` desapareció, y eso cierra D-4 por construcción.**
  Existía para reconciliar dos fuentes —un *custom claim* y un documento— que
  podían discrepar. Ya no hay dos: `private.current_role()` y
  `api.load_own_profile` leen la misma fila, y el motor que la lee es el que
  aplica las políticas.

El proxy de IA cambió con ello: `verifyIdToken.ts` (RS256 contra el JWKS de
Google) desaparece, y lo que queda comprueba **dos** cosas —que el token es real
y que la identidad tiene un perfil activo—. Sustituye a la lista de correos del
piloto, que con un solo proveedor habría significado «sólo estos de entre los que
ya tienen cuenta»: una segunda autorización mantenida a mano y condenada a
quedarse vieja.

---

## 4. Almacenamiento: F6.5 cerrada con un flujo de producto

La auditoría dejó F6.5 abierta porque «necesita un flujo de producto y sesión
humana». El flujo existe ahora: **adjuntar un archivo a un documento de
iniciativa**, en `InitiativeDocumentsPanel`, sobre
`services/adapters/supabaseFileStorage.ts`.

La coreografía tiene tres pasos y no se puede simplificar, porque la política
exige que el nombre del objeto sea el id que **Storage asigna al crear la fila**:
subir con nombre provisional, mover al definitivo (lo que conserva la fila y su
id), registrar y confirmar. Lo que sí es una decisión es qué pasa cuando el
tercer paso falla: el binario se retira. Un objeto cuyo registro no llegó a
`ready` es ilegible por política, así que dejarlo sería pagar por algo que nadie
puede volver a encontrar.

**Se guarda la ruta, nunca una URL.** Los cubos son privados y lo único que abre
un objeto es una URL firmada que caduca en cinco minutos: persistir una sería
guardar un enlace roto o —si no caducara— una puerta pública a un objeto privado
escrita en la base de datos.

---

## 5. Lo que el cambio de proveedor simplificó

Tres piezas desaparecieron, y ninguna se echa de menos:

- **La poda de artefactos.** `prepareArtifactForFirestore` recortaba el plan de
  maquetación y la traza de generación para caber en 1 MiB por documento. Una
  fila `jsonb` admite tres órdenes de magnitud más, así que el artefacto se
  guarda **entero**: era pérdida de datos silenciosa que sólo se descubría
  cuando un diagrama se abría vacío.
- **El índice de artefactos mantenido a mano.** Ahora lo mantiene
  `save_project_aggregate` en la misma transacción que las filas, que es el único
  sitio donde se puede garantizar que concuerdan.
- **El reintento contra la carrera de creación.** Existía porque
  `createArtifact` y el `updateArtifact` del render siguiente eran dos
  transacciones independientes y la segunda podía no ver a la primera. Ahora las
  dos leen y escriben el mismo agregado, y la revisión optimista convierte la
  carrera en un conflicto explícito en vez de en un «no existe».

Y una medida que conviene no perder: **la carga inicial bajó 115,9 KB gz**, de
439,1 a **323,2**. `vendor-firebase` pesaba 110,6 y era *eager*, porque
`firebase.ts` se inicializaba en el arranque para que `isFirebaseAvailable`
respondiera en la primera línea de cualquier repositorio. El SDK de Supabase pesa
59,3 y se importa dinámicamente. El presupuesto bajó con la mejora (450 → 340):
un número que ya no mide nada no impide la siguiente regresión.

---

## 6. F9.3 — la deuda objetivo, medida

El plan pide «ciclos y accesos prohibidos cero; strict productivo y `any` no
justificados cero». El estado real, sin redondear:

| Objetivo | Estado | Nota honesta |
|---|---|---|
| Cero ciclos **entre contextos de dominio** | ✅ | Los cuatro que había siguen rotos y `moduleBoundaries.test.ts` los afirma por nombre |
| Cero accesos prohibidos (capas, imports profundos nuevos, fan-out) | ✅ | `check:module-boundaries` en verde, y **dos presupuestos bajados** en esta fase |
| `strict` productivo | ⏳ **parcial y declarado** | `tsconfig.strict.json` cubre 31 entradas y sólo crece. El bloqueo es el mismo de siempre: `services/geminiService.ts` y su cierre transitivo |
| Cero `any` no justificados | ⏳ **23, todos nombrados** | 16 en `geminiService.ts`, 6 en la frontera sin tipos de Excalidraw, 1 en `ComponentType<any>` de React |
| Excepciones externas encapsuladas | ✅ | El SDK entra por **dos** ficheros, y ESLint lo exige |

**No se declara cerrado lo que no lo está.** Los dos ⏳ tienen la misma causa —el
motor legacy de 5 400 líneas— y el plan para resolverla no es moverlo: es la
migración por estrangulamiento vertical a vertical, con `learningService` como el
ejemplo hecho. Moverlo se intentó en Ola 5 y se revirtió porque convierte un
ciclo con un pseudo-módulo en cuatro ciclos entre contextos reales.

Un ciclo **sí** se retiró en esta fase: `services (raíz) <-> services/ai` sigue
en la lista, pero el censo bajó porque `verifyIdToken.ts`,
`firebaseIdentityAdapter.ts`, `pilotRouting.ts`, `supabaseProfileService.ts`,
`pilotLearningService.ts`, `artifactDocumentMapper.ts`, `firestoreData.ts`,
`artifactPersistenceGuards.ts` y `firebaseEmulatorPolicy.ts` dejaron de existir.

---

## 7. F9.4 — runbooks y onboarding

| Documento | Qué responde |
|---|---|
| `docs/fase-9/runbook-operacion.md` | Diagnóstico por síntoma, cambiar el esquema, altas y bajas, archivos, respaldo y recuperación, desplegar, y lo que no hay que hacer |
| `docs/primer-administrador.md` | Reescrito para Supabase: cinco minutos, sin programar, con la variante por CLI al final |
| `docs/ci-cd-pipeline.md` | El pipeline, sus secretos y la reversión (sin cambios de fondo en esta fase) |
| `CLAUDE.md` / `AGENTS.md` | La arquitectura vigente y sus reglas, actualizadas en este mismo cambio |

---

## 8. Estado de los gates

Medido sobre la rama, localmente, con los comandos que CI ejecuta:

| Control | Resultado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run typecheck:strict` | limpio |
| `npm run lint` | **0 errores, 0 avisos** |
| `npm run check:any-budget` | 23 / 23 |
| `npm run check:no-orphan-scripts` | limpio |
| `npm run check:module-size` | limpio |
| `npm run check:module-boundaries` | limpio, con dos presupuestos bajados |
| `npm run test:ci` | **447 ficheros, 4 285 pruebas**, todas en verde |
| `npm run test:coverage` | 65,3 / 56,6 / 57,8 / 67,2 — por encima de todos los suelos |
| `npm run build:placeholders` | limpio |
| `npm run check:bundle-secrets` | limpio |
| `npm run check:bundle-budget` | **323,2 KB gz de 340** |
| Supabase `get_advisors` (security) | 19 INFO `rls_enabled_no_policy` —la postura deny-by-default declarada— + 1 WARN HIBP |
| Sonda remota F9 | 14 / 14 |

---

## 9. Lo que queda abierto, con dueño

**Revisado el 2026-09-19 contra el estado real, y la revisión corrigió el acta.**
La versión anterior de esta sección listaba como abiertos cuatro puntos que ya
estaban atendidos: se escribieron desde la auditoría del 2026-09-13 y nadie los
volvió a medir. Un acta que no se vuelve a medir es una lista de tareas de otra
semana, y ésta llegó a afirmar que no había CI **mientras el CI estaba pasando
en verde sobre esta misma rama**.

Lo que se comprobó, y con qué:

| # | Punto | Estado | Evidencia |
|---|---|---|---|
| 1 | Variables en Vercel y secretos de despliegue | **Cerrado** | El despliegue de producción de `82be918` está `READY`. El build es *fail-closed* sobre `VITE_SUPABASE_*`: que compile es la prueba de que están puestas |
| 2 | GitHub Actions desbloqueado | **Cerrado** | Los cuatro workflows corren con duraciones reales. El CI de la PR #32 pasó: gates estáticos, los cuatro shards y la cobertura fusionada |
| 3 | Protección de rama sobre `main` | **Cerrado** | El ruleset `23685996` exigía `Firestore rules (emulator)`, un check que F9 borró y que por tanto no podía reportar nunca. Quitado por el titular; la PR #32 pasó a `mergeable_state: clean`. Detalle en `docs/ci-cd-pipeline.md` §4 |
| 4 | Acceso para la UAT | **Cerrado y verificado** | El preview de #32 responde 200 en `/auth` sin muro de *Vercel Authentication*, y el build es *fail-closed*: que exista prueba que `VITE_SUPABASE_*` están puestas. En el proyecto remoto hay **una** identidad con perfil `superadmin` activo, así que hay con qué entrar |
| 5 | UAT humana e inferencia autenticada real | **Abierto** | Requiere que una persona entre y recorra. No se puede cerrar desde aquí |
| 6 | *Leaked password protection* (HIBP) | **Abierto** | Sigue siendo el único `WARN` de `get_advisors`, medido hoy |
| 7 | SLO/RPO/RTO y respaldo remoto programado | **Abierto** | Decisión de negocio, no de código |

Quedan **tres**, no siete, y ninguno es código: son decisiones que sólo una
persona puede tomar. El punto 3 lo cerró el titular, que es quien tenía que
cerrarlo: el agente no puede cambiar la protección de rama —su GitHub App no
tiene permiso de administración— y es correcto que no pueda, porque modificar
esa protección es la forma más directa de desactivar el pipeline que la
protección existe para hacer cumplir.

**El punto 5 merece una frase.** No se puede cerrar desde aquí y no se va a
declarar cerrado: requiere que una persona inicie sesión en el despliegue y
ejecute los recorridos. Lo que sí cambió es que ahora hay algo que ejercitar —
antes de esta fase, una sesión humana contra producción habría encontrado la
aplicación hablando con Firebase.

**Y hay un punto nuevo, que es de configuración y no de código.** El acceso con
Google está implementado y probado, pero el proveedor sólo funciona cuando
alguien pega el client id y el secreto de un proyecto de Google Cloud en
*Authentication → Providers* y añade la URL del despliegue a *Redirect URLs*.
Hasta entonces el botón existe y devuelve el error del proveedor, que es lo que
la pantalla muestra. Los pasos están en `docs/primer-administrador.md`.

**Un detalle que decide si la primera prueba con Google funciona o no.** Entrar
con Google no crea cuenta: quien vuelva sin perfil en `api.user_profiles` acaba
otra vez en `/auth`. Supabase enlaza la identidad de Google con la de correo
cuando **el correo es el mismo y está confirmado**, que es el caso de la única
cuenta provisionada hoy. Así que la prueba tiene que hacerse con esa misma
dirección; con otra cuenta de Google el rebote a `/auth` no es un fallo, es la
regla funcionando, y el arreglo es provisionar antes esa dirección desde
`/users`.

### El punto 3, medido — y una deducción que no se sostuvo

El ruleset existía y era estricto; lo que fallaba era su contenido:

- **`Firestore rules (emulator)` seguía en la lista de checks obligatorios.** F9
  borró ese workflow, así que ese contexto no lo reportaba ya nadie y la PR se
  quedaba esperando un estado que no iba a llegar. No bloqueaba sólo a #32:
  bloqueaba **cualquier** PR futura contra `main`. El titular lo quitó, y **no**
  lo sustituyó por `database`, que se dispara por rutas y habría reproducido el
  mismo problema.

Se había señalado un segundo bloqueo —
`require_extra_approval_for_unattributed_changes`, activo mientras
`required_approving_review_count` es 0, sobre commits firmados
`Claude <noreply@anthropic.com>`— y **no era tal**: quitado el check obsoleto, la
PR pasó a `mergeable_state: clean` con la casilla todavía puesta. La deducción
encajaba con todo lo observable y aun así era falsa, porque `blocked` es un
estado agregado que no dice cuál de dos reglas manda. `docs/ci-cd-pipeline.md`
§4.2 conserva el razonamiento entero junto a su desmentido, que es lo que lo
hace útil.

---

## 9 bis. Lo que la primera revisión de esta PR encontró

Se anota porque es la lección más cara de la fase, y no la habría encontrado
ninguna prueba unitaria: **las 4 285 pasaban en verde mientras el producto era
inutilizable**.

Identidad y datos construían cada uno su `createClient`, los dos con
`persistSession: true` y, al no declarar `storageKey`, sobre la misma clave de
almacenamiento. Los dos con `autoRefreshToken`, así que los dos renovaban el
mismo refresh token; el segundo recibía `refresh_token_already_used`, el SDK
borraba la sesión y emitía `SIGNED_OUT`. El resultado visible era **iniciar
sesión correctamente y volver a la pantalla de inicio de sesión**, sin ningún
error.

Dos cosas que conviene quedarse:

- **Lo encontró la suite E2E**, que es la única que ejerce el producto entero
  contra un backend real. Los tres recorridos autenticados fallaron con
  `expect(page).toHaveURL(/\/$/)` recibiendo `/auth`. Un gate que corre el
  artefacto contra una base de datos de verdad no es una comodidad.
- **El comentario decía lo contrario de lo que el código hacía.** El docblock
  del segundo cliente afirmaba que compartir el almacenamiento hacía que
  compartieran la sesión. La regresión ahora la cubre una prueba que cuenta las
  llamadas a `createClient` —no los imports—, porque un comentario no falla.



## 10. Veredicto

Las 55 tareas del plan entre F0.1 y F9.5 quedan así: **48 implementadas y
verificadas**, **6 no aplicables al PoC por decisión registrada** (F4.4, F4.5,
F5.5, F6.4, F8.3, F8.5) y **1 abierta por dependencia de una persona** (F7.6,
con F8.4 colgando de ella).

El objetivo de la transformación —que la aplicación funcione sobre Supabase, con
la autorización hecha cumplir en el servidor y sin dependencia operativa de
Firebase— **está cumplido y es verificable de forma independiente**: 33
migraciones aplicadas al proyecto remoto, una Edge Function desplegada, la sonda
transaccional en verde, y un repositorio en el que `grep -ri firebase` sólo
devuelve las notas que explican por qué ya no está.
