# ADR-106 — El Artefacto es raíz de su propio agregado

**Fecha** 2026-09-22 · **Estado** aceptada · **Resuelve** D-4 · **Contexto**
Proyectos de Arquitectura y Entregables · **Evidencia** F4-01
(`evidencias/f4-01-proyecto-artefacto.md`)

## Problema

Hoy el Artefacto es una entidad **dentro** del agregado Proyecto, y la única
ruta de escritura es `api.save_project_aggregate(p_project, p_artifacts,
p_expected_revision)`. F4-01 midió lo que eso cuesta, sobre el contrato y no
sobre suposiciones:

| Efecto de editar **un** artefacto | Hoy |
|---|---|
| Cuerpos enviados | `N` de `N` |
| Filas de artefacto reescritas | `N` de `N` |
| Revisión que se compara | la del **proyecto** |
| Dos ediciones de artefactos distintos | una gana; la otra recibe `P0001` |
| Una lista incompleta | **borra** los artefactos omitidos |

La tercera fila es el defecto de modelado: la revisión optimista protege una
invariante que no existe. Nada del contenido de un artefacto depende del
contenido de otro, y sin embargo dos personas —o una persona y el runner de la
Oficina— que editan dos diagramas distintos del mismo proyecto se tratan como
si se pisaran. La quinta es el riesgo: la invariante A-03 («editar un
artefacto no borra los demás») sólo la sostiene la revisión del proyecto.

El mismo nudo aparece en el grafo de módulos: `Project` declara
`artifacts: Artifact[]` y el contexto de artefactos necesita `Project`, así que
`types.ts` conserva sus dos últimas aristas de salida (F3-07) y el componente
fuertemente conexo sigue en 27 módulos. **Es la misma decisión vista desde dos
sitios.**

## Lo que decide: qué invariantes cruzan la frontera

Un agregado es la frontera de consistencia **inmediata**. La pregunta no es
cuántos artefactos hay, sino qué reglas necesitan ver a más de uno a la vez.
Del catálogo de F1-06 (`07-invariantes.md`), y de las rutas de escritura
actuales:

| Invariante | ¿Necesita el agregado Proyecto? | Cómo se sostiene con el Artefacto como raíz |
|---|---|---|
| **P-04** contador e índice coinciden con las filas | No: es una **proyección** que calcula el servidor | La RPC de cada comando recalcula `artifact_count` y `artifact_index` desde las filas, en la misma transacción. Nadie más los escribe |
| **P-05** un artefacto pertenece a un solo proyecto | No | Clave foránea `project_id` + `project_id` inmutable tras la creación |
| **P-07** el dueño es el actor | No | Igual que hoy: `owner_id = auth.uid()` en la RPC, RLS deny-by-default |
| **A-01** forma del artefacto | No | La validación de forma de la RPC actual se reutiliza por artefacto |
| **A-02** versionado monótono dentro de `versionGroupId` | Cruza artefactos, **no** el proyecto | Índice único `(project_id, version_group_id, version)` y versión siguiente calculada **en el servidor**. Pasa de ❌ (sólo TS) a autoridad de base de datos |
| **A-03** editar uno no borra los demás | — | Desaparece como riesgo: ninguna operación recibe la lista completa |
| **A-04** decisión de revisión inmutable | No | Sin cambio (`artifact_review_decisions`) |
| **T-04** el grafo refleja los artefactos | No: es derivado | Sin cambio en esta decisión; su durabilidad es F5-05 |

**Ninguna invariante necesita leer el contenido de dos artefactos en la misma
transacción.** Las dos que cruzan filas —P-04 y A-02— son de *conjunto*, no de
contenido, y la base de datos las sostiene mejor con una restricción y un
recálculo que el cliente enviando la lista entera.

## Decisión

1. **El Artefacto (cada versión, identificada por su `id`) es raíz de agregado**
   y referencia a su proyecto **por id**. Su frontera de concurrencia es su
   propia `revision` —la columna ya existe en `api.project_artifacts` y ya se
   incrementa; hoy nadie la compara—.
2. **El Proyecto deja de contener artefactos.** Su revisión cubre sólo los
   campos raíz (nombre, iniciativas, seguimiento, datos). `artifact_count` y
   `artifact_index` pasan a ser una **proyección mantenida por el servidor**:
   los escriben únicamente los comandos de artefacto, recalculando desde las
   filas, y **no** incrementan la revisión del proyecto — lo que cambió no es
   nada que el usuario del proyecto haya editado.
3. **Un comando por intención, no una lista.** El contrato del servidor (lo
   implementa F4-03):

   | RPC | Revisión que compara | Qué hace |
   |---|---|---|
   | `api.create_artifact(p_project_id, p_artifact)` | — | Inserta, fija `project_id`, recalcula índice |
   | `api.create_artifact_version(p_project_id, p_version_group_id, p_artifact)` | — | Calcula `version = max + 1` en el servidor bajo el índice único |
   | `api.update_artifact(p_artifact_id, p_expected_revision, p_artifact)` | la del artefacto | Actualiza uno; `P0001` si la revisión no coincide |
   | `api.delete_artifact(p_artifact_id, p_expected_revision)` | la del artefacto | Borra uno; recalcula índice |
   | `api.revise_artifacts(p_project_id, p_changes)` | la de **cada** artefacto tocado | Varias versiones nuevas en **una** transacción (ver 4) |

   Cada una: permiso `project:write`, `private.assert_session_active()`,
   `revoke` a `public`/`anon`, contrato pgTAP con el caso negativo, y bloqueo
   de la fila del proyecto (`for no key update`) sólo mientras recalcula el
   índice — serializa escrituras concurrentes del mismo proyecto durante
   milisegundos **sin** convertirlas en un conflicto visible.
4. **La operación de varios artefactos es atómica por intención, no por
   agregado.** `applyConsistencySuggestion` (`context/app/useArtifactsState.ts`)
   crea versiones nuevas de varios artefactos a la vez para resolver una
   inconsistencia entre ellos. Aplicar la mitad no es peor que no aplicar nada,
   pero sí es un estado que nadie pidió. PostgreSQL permite una transacción
   sobre varias raíces, y usarla para **un único comando del usuario** es
   correcto; lo que este ADR prohíbe es convertir esa transacción en una
   frontera permanente. `revise_artifacts` compara la revisión de cada artefacto
   tocado y aborta entero si una no coincide.
5. **`save_project_aggregate` se retira por corte**, no de golpe (F4-06): deja
   de aceptar `p_artifacts` cuando el último llamante migra, y entonces se
   elimina como se eliminó la sobrecarga de F2-07, con un gate estático que
   impida su vuelta.
6. **Los tipos siguen a la frontera** (desbloquea F3-07):
   - `Project` (`services/architectureProjects`) pierde `artifacts: Artifact[]`
     y conserva `artifactIndex`/`artifactCount`. El resumen del índice
     (`ArtifactSummary`) es un contrato sin comportamiento que leen el portafolio
     y el proyecto: baja a `lib/artifacts/` (criterio de ADR-103).
   - `Artifact` (`services/artifacts`) lleva `projectId` y no importa `Project`.
   - La vista que hoy combina ambos —«el proyecto con sus artefactos», que
     necesitan el Workspace y el lienzo— es un **modelo de lectura**, no el
     agregado. Vive del lado de artefactos (F4-04), que es el que puede importar
     al proyecto.
   - Dirección resultante: `services/artifacts → services/architectureProjects
     → lib`. Sin ciclo, y sin que `types.ts` tenga que reexportar ninguno de
     los dos.
7. **La concurrencia se compara por revisión, nunca por reloj.** El
   `expectedUpdatedAt` que `updateArtifact` compara hoy en el cliente depende
   del reloj de quien escribió; se sustituye por la revisión del artefacto.

## Sobre la ausencia de volumen

F4-01 midió **0 proyectos y 0 artefactos** en ArkyDB-US (confirmado de nuevo el
2026-09-22: 0 proyectos, 0 artefactos, 0 iniciativas, 0 encargos, 1 perfil). La
tasa de conflictos es **no estimable**, no cero.

La decisión **no depende de ese número**. Se apoya en dos hechos que sí están
medidos: ninguna invariante cruza el contenido de dos artefactos, y el contrato
actual amplifica cada edición `N:1` y serializa escrituras independientes. Con
volumen, esos costes crecen; sin volumen, siguen siendo un modelo que afirma
una invariante inexistente. El volumen serviría para *priorizar* F4-03, no para
decidir la frontera — y el orden de la fase ya lo fija F3-07, que está
bloqueada por esta decisión.

## Alternativas descartadas

- **Mantener el Artefacto dentro del Proyecto y enviar sólo el delta.** Quita la
  amplificación de red pero no la de contención: la revisión seguiría siendo
  del proyecto y dos ediciones independientes seguirían chocando. Tampoco
  rompe la arista de tipos, porque `Project` seguiría conteniendo `Artifact`.
- **El grupo de versiones como raíz** (`versionGroupId` como identidad, las
  versiones como entidades). Ajusta mejor A-02, pero todo lo que referencia un
  artefacto apunta a una **versión**: `artifact_comments.artifact_id`,
  `artifact_review_decisions.artifact_id`, `OfficeTask.producedArtifactId`.
  Cambiar la identidad raíz obligaría a re-clavear tres contextos para ganar
  una garantía que un índice único ya da.
- **Esperar a tener volumen.** Una base de datos de prueba de concepto vacía no
  va a producirlo sola, y la espera mantiene bloqueadas F3-07, F4-03 y F4-07.
  Esperar sería decidir el statu quo sin escribirlo.

## Consecuencias

- **Ganan:** A-02 obtiene autoridad de servidor; A-03 deja de ser un riesgo;
  editar un artefacto envía un cuerpo y compara una revisión; F3-07 puede
  cerrar las dos aristas de `types.ts`.
- **Cuesta:** cinco RPC nuevas con sus contratos pgTAP, una migración que
  añade el índice único (en una base vacía no hay datos que reconciliar; en
  otra, la migración tendría que detectar duplicados antes de crearlo), y
  migrar `useArtifactsState` y `artifactPersistence` de «lee, muta en memoria,
  guarda todo» a comandos.
- **Se revisa si** aparece una regla de negocio que necesite leer el
  **contenido** de varios artefactos en la misma transacción y que no sea
  expresable como comando atómico (punto 4). Un paquete de publicación que
  congela un conjunto de artefactos **no** lo es mientras referencie versiones
  por id: congelar es no volver a escribir esas versiones, no leerlas juntas.
- **Orden que fija:** F4-03 (comandos y migración) → F4-07 (el mapa de
  revisiones de proyectos, que ya no tendrá que cubrir artefactos) → F4-04
  (modelo de lectura) → cierre de F3-07 → F4-06 (retirada de
  `save_project_aggregate`).
