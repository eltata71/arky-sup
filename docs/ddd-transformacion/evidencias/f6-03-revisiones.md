# F6-03, primer corte — las dos últimas revisiones en un mapa

**Fecha:** 2026-09-25 · **Base:** F6-02 (#75).

F6-03 es «aplicar el patrón al resto de contextos». Su primer corte es lo que
F5-05 dejó señalado: al ampliar `noRevisionCache.test.ts` para que buscara mapas
de revisiones **a cualquier nivel**, aparecieron dos más, en `settings` y en
`learning`. Quedaron registrados como excepciones con nombre, y esta es su
retirada.

## Por qué, si no eran el defecto vivo

Cada uno tenía **una sola instancia memorizada**, así que lectura y escritura
compartían el mapa, y hoy funcionaban. Eran la misma forma que en el grafo de
conocimiento sí rompía (dos instancias, un mapa cada una). Lo que separa un caso
del otro es un segundo `create…Repository` en otro fichero, que nadie tiene por
qué saber que es peligroso. La regla existe para que no dependa de eso.

## Qué cambia

| Contexto | Antes | Ahora |
|---|---|---|
| `settings` | `Map<userId, revision>` en la fábrica | `Settings.revision`: llega con la lectura, el guardado compara contra ella, la base confirma la nueva y `useSettingsState` la **devuelve al estado**, así que la siguiente escritura parte de ella |
| `learning` | `Map<courseId, revision>` en la fábrica | `Course.revision`: llega con la lista; `saveCourse` compara contra la del curso y `updateCourse` contra la del curso recién leído, igual que antes |

En los dos, el documento guardado **nunca** lleva la revisión: se quita antes de
enviarlo, porque es de la fila.

`KNOWN_PER_INSTANCE_MAPS` queda vacío, así que un mapa nuevo, a cualquier nivel,
falla sin excepción que lo absorba.

## Pruebas

- `supabaseSettingsRepository.test.ts` y `supabaseLearningRepository.test.ts`:
  la revisión llega con el registro, se envía la del registro (también desde
  otra instancia) y no va dentro del documento. Las dos pruebas que fijaban el
  diseño anterior, «memoriza su revisión sin exponerla al dominio», se
  reescribieron: ese era justamente el diseño que se retira.
- `settingsRevisionFlow.test.tsx`: dos escrituras seguidas comparan cada una
  contra la revisión que confirmó la anterior, y una rechazada deja la revisión
  donde estaba.
