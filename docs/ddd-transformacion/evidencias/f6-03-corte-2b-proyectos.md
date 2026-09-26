# F6-03 · Corte 2b — Proyectos cambia por operaciones con nombre

**Fecha:** 2026-09-26 · **Rama:** `codex/f6-03-proyectos-comandos`

El punto 2 del patrón del contexto piloto (`09-cierre-fase-3.md`) dice
«operaciones con nombre, no `update(partial)`». En Proyectos quedaba una sola
operación de escritura, `updateProject(id, patch)`, con un
`Partial<Omit<Project, 'id' | 'artifacts'>>`. Doce llamadas la usaban, y cada
una podía escribir cualquier combinación de campos.

## Las intenciones que había debajo de los doce parches

| Quién | Qué quería | Comando |
|---|---|---|
| Ficha del proyecto | cambiar el nombre / la descripción | `rename` / `describe` |
| Ficha del proyecto | añadir / quitar una entrada de contexto | `add-context-entry` / `remove-context-entry` |
| Paneles de seguimiento y contribución | cambiar el seguimiento | `update-tracking` |
| Ficha de capacidades y listado de proyectos | vincular iniciativas | `link-initiatives` |
| Centro de memoria, almacén del agente, lecciones | reemplazar una de las tres memorias | `replace-memory` |
| Publicación | guardar los paquetes | `set-publication-packages` |
| Sincronización del grafo | guardar el grafo reconstruido | **no es un comando**: `saveProjectGraph` |

`applyProjectCommand(project, command, { now })`, en
`services/architectureProjects/domain/projectCommands.ts`, es puro. Devuelve
los cambios con su fecha o un rechazo tipado, y nunca lanza.
`runProjectCommand`, en el proveedor, sólo hace lo que es de un proveedor: el
estado optimista, la escritura, el `rollback` y la revisión confirmada.

## Lo que un parche no podía decir

1. **P-02 también al cambiar.** «Un proyecto responde al menos a una
   iniciativa» lo aplicaban la fábrica al crear y el servidor al guardar.
   Entre los dos estaba la pantalla, y un parche con `initiativeIds: []`
   llegaba a la base para que ésta lo rechazara. Ahora `link-initiatives` sin
   iniciativas se rechaza en el dominio (`no-initiative`) y no se escribe nada.
2. **Un comando que no cambia nada no escribe.** Antes, `updateProject`
   escribía cualquier parche que le llegara, cambiara algo o no, y cada
   escritura subía la revisión. Ahora `changed: false` no toca la base.
3. **Las reglas salen de la pantalla.** La ficha recortaba la entrada de
   contexto y comprobaba que no estuviera repetida. Eso es del dominio, y la
   ficha sólo emite `add-context-entry`.

## Un defecto de paso: el grafo reescribía la raíz

`rebuildArchitectureGraph` guardaba el grafo con
`updateProject(id, { architectureKnowledgeGraph })`. `projectWrites.updateProject`
**reescribía primero la raíz del proyecto** —subiendo su revisión sin que el
proyecto hubiera cambiado— y después guardaba el grafo en su tabla. Cada
reconstrucción podía chocar así con una edición real hecha en otra pestaña, y
esa pestaña recibía un conflicto que no tenía nada que ver con lo que había
hecho.

El grafo va ahora por su propio camino (`saveProjectGraph` →
`repository.saveGraph`), sin tocar la raíz. `updateProject` en infraestructura
sólo acepta `ProjectRootChanges`.

## Pruebas

- `projectCommands.test.ts`: 14 pruebas sin mocks. Cubren los rechazos (nombre
  vacío, entrada vacía, ninguna iniciativa), los no-cambios, la normalización
  de códigos y seguimiento, y que la identidad, la creación y la revisión nunca
  salen en los cambios.
- `projectRevisionFlow.test.tsx`: la revisión que se compara y el `rollback`,
  ahora con comandos. Suma dos casos: un comando rechazado no llega a la base y
  uno sin cambios no escribe.
- `graphProjectionSync.test.tsx`: reconstruir el grafo llama a
  `saveProjectGraph` y **no** a `runProjectCommand`.
- `namedOperations.test.ts`: ninguna capa de la aplicación vuelve a llamar ni
  publicar `updateProject` o `updateInitiative`. Ignora los comentarios, porque
  explicar por qué algo ya no existe no es usarlo.

## Coste medido

- **Carga inicial: 310,1 → 310,7 KB gz** (de 340). Es `projectCommands`, que
  ahora está en el arranque porque el proveedor aplica los comandos. Entra por
  la puerta del dominio (`services/architectureProjects/domain`), declarada en
  el corte 2a, y no por ruta de fichero, que habría sido un import profundo
  nuevo.
- **Techos de tamaño.** Cuatro pantallas suben entre 7 y 77 bytes porque
  `runProjectCommand` y `kind: '…'` son más largos que el parche que
  sustituyen; cada techo lleva la razón en su línea. `ProjectHub` bajó
  (1 063 → 1 060 líneas, 78 862 → 78 777 bytes) y su techo baja con él.
- **Suite:** 493 ficheros y 4 786 pruebas, todas pasando.
