---
artifact_id: 02-ARCH-ADR-006
version: 1.0.0
status: Accepted
created: 2026-09-07
project: Arky 10 (arkypro-1.0)
standard: Architecture Decision Record
---

# ADR-006: Editar un diagrama sin regenerarlo

**Status:** Accepted
**Date:** 2026-09-07

---

## Context and Problem Statement

Toda modificación asistida por IA de un diagrama era una regeneración.

«Resalta únicamente el flujo de autorización» y «mueve esta integración al
dominio externo» son ediciones pequeñas y locales. La única forma de hacer
cualquiera de las dos era `generateDiagramIR` otra vez: llamada al modelo,
IR nuevo, **ids nuevos**, layout nuevo, y con ello todo el trabajo manual que
el arquitecto llevara encima —posiciones fijadas, etiquetas renombradas,
agrupaciones curadas—. Un cambio de una palabra costaba el diagrama entero.

Las consecuencias no eran sólo de coste:

- **Nadie hacía cambios pequeños.** El consejo honesto era editar a mano, lo
  que convierte al asistente en algo que sólo sabe empezar de cero.
- **No había nada que previsualizar.** Un IR completamente nuevo no se puede
  comparar con el anterior por ids, porque los ids cambiaron. El requisito de
  «ver qué cambiará antes de aplicar» no tenía sobre qué apoyarse.
- **La única validación era la del generador.** Los ejecutores deterministas
  que ya existían (`suggestionActionExecutors`) cubren decisiones de *layout*
  —dirección, densidad, motor—, no el modelo: no hay forma de añadir un nodo,
  reetiquetar una conexión ni anotar un riesgo.

## Decision

**Un cambio se expresa como operaciones sobre el modelo, se comprueba antes de
aplicarse, y su previsualización la escribe el motor y no quien la propone.**

- `lib/diagram/semanticPatch.ts` — el vocabulario: trece operaciones sobre ids
  que ya existen, más los códigos de rechazo y la forma del resultado.
- `services/diagram/semanticPatchEngine.ts` — `applySemanticPatch` y
  `describeSemanticPatch`. Puro, síncrono, sin llamada al modelo.
- `services/ai/generation/diagramEdit/` — un agente, una llamada, que **propone
  un patch** en vez de un diagrama.

### Lo que el vocabulario no puede decir

No hay `move-node` con coordenadas ni `set-colour`. La posición es del motor de
layout y la apariencia del sistema de diseño, y una operación capaz de fijar
cualquiera de las dos dejaría a un modelo pasar por encima de ambos desde
dentro de un JSON. `set-layout-hint` es lo más cerca que se llega, y declara
una *intención* (una dirección, una densidad) que el motor sigue siendo libre
de satisfacer como quiera.

Por la misma razón, `update-edge` no puede repuntar una conexión: cambiar
origen o destino es quitar una y poner otra, y decirlo así mantiene las dos
mitades del cambio visibles en el registro.

### Las tres garantías del motor

1. **Se comprueba antes de aplicarse.** Un id inexistente, un id duplicado, una
   conexión a ninguna parte: cada uno vuelve como `PatchRejection` con la
   operación y el motivo. Aplicar lo que parsea y esperar es cómo el JSON
   verosímil de un modelo se convierte en un diagrama con conexiones al vacío.
   Y una operación mala no tira las nueve buenas que van a su lado.
2. **El resultado siempre es un IR válido.** Quitar un nodo se lleva sus
   conexiones, sus pertenencias a grupos y sus anotaciones — dejarlas es dejar
   exactamente las referencias colgantes que las reglas de lint existen para
   detectar. Cada arrastre se lista en `cascaded`: **un borrado que el usuario
   no pidió es uno del que se le informa.**
3. **Un patch que no cambia nada lo dice.** `changed: false` y el objeto
   original, para que quien llama se ahorre una versión, un re-layout y una
   escritura.

### La previsualización es la aplicación, sobre una copia

`describeSemanticPatch` recorre el mismo camino que `applySemanticPatch`. Una
previsualización compuesta a partir de las palabras de las propias operaciones
se separaría del motor la primera vez que un arrastre cambiara — y una
propuesta que describe un cambio y codifica otro es justo lo que una
previsualización existe para atrapar.

### El invariante se prueba como invariante

Cada operación tiene su prueba, pero lo que protege a los renderers es el
invariante: sobre secuencias sembradas de 1 a 21 operaciones, válidas y no, en
cualquier orden, y sobre ocho patches encadenados, el IR resultante siempre es
uno que el pipeline acepta.

## Consequences

**A favor.** Una edición cuesta una llamada y conserva el trabajo manual. Hay
algo concreto que previsualizar y que registrar. El motor es puro, así que un
patch se puede probar sin modelo, sin red y sin canvas.

**En contra, y aceptado.**

- Hay un segundo camino de modificación junto a los ejecutores de sugerencias
  deterministas. Se aceptan como capas distintas —uno decide layout, el otro
  modelo— y `set-layout-hint` marca `userOverride` igual que ellos para que el
  selector no revierta la preferencia en su siguiente pasada.
- El tope de **12 operaciones** es arbitrario en su número y no en su
  existencia: por encima de ahí la petición es una regeneración con pasos
  extra, y conviene que lo diga en vez de disfrazarse de edición.
- El motor no tiene *undo* propio. El canvas ya mantiene su pila de
  instantáneas y el artefacto su historial de versiones; añadir una tercera
  noción de deshacer sería una tercera cosa que se puede desincronizar.

**Lo que deliberadamente no se hizo.** No hay superficie de UI para la
propuesta todavía: `proposeEdit` devuelve el patch y la previsualización, y
ningún componente los pinta. Se dejó fuera a propósito — el contrato y sus
garantías son lo que hace que la pantalla sea segura de escribir, y escribirla
antes de tenerlos es cómo se acaba aplicando lo que parsea.
