# ADR-105 — El verificador mide todo el árbol, o no mide

**Fecha** 2026-09-21 · **Estado** aceptada · **Contexto** herramienta de build

## Problema

ADR-104 corrigió *qué* pregunta hace el gate de fronteras: de «¿se importan
estos dos?» a «¿puede este grupo volver a sí mismo?». Lo que no revisó es
**sobre qué grafo** la hace. Y el grafo tenía dos agujeros:

1. **Una sintaxis sin leer.** `localImports` reconocía `import`, `export … from`
   e `import type`, y no `import('…')`. En el repositorio hay 21 dependencias
   escritas así, en sus dos formas: la diferida de ejecución —`OfficeContext`
   carga la capa de IA con `await import` precisamente para mantenerla fuera del
   arranque— y la de posición de tipo, `import('…').T`, que acopla exactamente
   como el `import type` que el gate sí contaba.
2. **Ficheros que no son carpeta de nadie.** El escáner recorría ocho
   directorios. `types.ts`, `constants.ts`, `utils.ts`, `App.tsx` e `index.tsx`
   viven en la raíz, así que **no se abrieron nunca**. `types.ts` lo importan 25
   de los 34 módulos y él importa seis.

Un grafo incompleto no se ve incompleto: se ve sano. Es el mismo modo de fallo
de ADR-104 un nivel más abajo — allí el gate estaba verde porque medía una
propiedad más débil; aquí, porque medía un árbol más pequeño.

## Decisión

1. `localImports` lee también `import('…')`. **No se distingue la forma
   diferida de la de tipo**: la regla que aplican —ciclo, capa, API pública— es
   la misma para las dos, y una excepción por sintaxis es la puerta por la que
   entra la siguiente. (El presupuesto de descarga es otro gate:
   `check:bundle-budget` es quien sabe de chunks.)
2. `modules.json` admite módulos declarados **por fichero** (`files: [...]`)
   además de por carpeta. Se declaran cinco: `app` (`App.tsx` + `index.tsx`),
   `types.ts`, `constants.ts`, `utils.ts` y `types/` (los tipos del LMS).
3. Se declaran **por separado y no como un solo «núcleo compartido»** porque
   cada uno se arregla por su cuenta y el presupuesto tiene que poder bajar de
   uno en uno.
4. `types.ts`, `constants.ts` y `utils.ts` son **fundación**, no dominio. La
   capa se decide por lo que hay debajo: `lib` los importa, luego están por
   debajo de `lib`. Atribuirlos al dominio habría convertido el hallazgo en
   «`lib` importa dominio», señalando al consumidor en vez de a la causa.

## Lo que se ve al mirar

| | antes | después |
|---|---|---|
| Ciclos | 4 | **11** |
| Componentes fuertemente conexos | 3 + 9 módulos | **3 + 27** |
| Pares ascendentes | 0 | **7** (9 imports) |
| Pares con import profundo | 59 | **68** |

Ninguna de esas subidas es código nuevo. Siete de los once ciclos pasan por
`types.ts` o `utils.ts`; el componente de dominio pasa de nueve a veintisiete y
se traga `lib` y `utils`, que son la capa de fundación y no deberían poder
volver; y los siete pares ascendentes salen de esos mismos dos ficheros.

**La regla monótona se conserva, y esto no la rompe.** «Un número puede bajar y
nunca subir» es una regla sobre el código; lo que cambió aquí es la vista. ADR-104
sentó el precedente y la condición que lo hace legítimo: se registra lo que se
acaba de ver, con la fecha y la razón, y a partir de ahí sólo puede bajar.

## Los dos hallazgos, y por qué el barato va primero

- **`types.ts` es un reexportador que cierra el grafo.** Deshacerlo es mover
  declaraciones al contexto dueño y que cada consumidor importe de ahí — la
  regla que CLAUDE.md ya nombra («un contrato sin comportamiento baja a una
  hoja») y que la Ola 2 aplicó tres veces. No toca comportamiento.
- **`utils.ts` no es un fichero de utilidades.** `buildGlobalPrompt`,
  `buildBasePrompt` y `buildArtifactsContext` son composición de prompts, o sea
  capa de IA escrita en la raíz del repositorio; por eso importa `services/ai` y
  `services/memory`. Lo importan diez módulos, así que moverlo es una migración,
  no un renombrado.

El núcleo de nueve módulos sigue siendo el objetivo de la fase 5 y sigue
costando lo que costaba: estrangular un motor de 5 400 líneas. Lo que F3-02
añade es un objetivo **anterior y más barato**, y la prueba los afirma por
separado para que no se confundan.

## Lo que se queda fuera, y es comprobable

Pruebas, declaraciones `.d.ts`, `e2e/`, `supabase/`, `scripts/` y la
configuración de build. Ninguno participa del grafo que la aplicación ejecuta.
La lista vive en la cabecera del script para que la próxima ampliación empiece
por leerla en vez de por descubrirla.

## Consecuencia

`CLAUDE.md` afirmaba «0 upward pairs» y «2 SCC (3 + 9)». Las dos frases eran
ciertas sobre el grafo que el gate miraba y falsas sobre el repositorio; se
corrigen en el mismo cambio.
