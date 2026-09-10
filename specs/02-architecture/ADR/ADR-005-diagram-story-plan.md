---
artifact_id: 02-ARCH-ADR-005
version: 1.0.0
status: Accepted
created: 2026-09-07
project: Arky 10 (arkypro-1.0)
standard: Architecture Decision Record
---

# ADR-005: La historia es parte del modelo

**Status:** Accepted
**Date:** 2026-09-07

---

## Context and Problem Statement

El producto tenía storytelling en los tipos y en la animación, y en ningún
sitio más.

`DiagramIR.metadata.narrative` acepta desde hace tiempo un `DiagramNarrative`
con `scenes` —cada una con los ids que enfoca— y `callouts` —cada uno atado al
elemento del que habla, con severidad—. `ReactFlowCanvasProps.presentation`
declaraba un campo `scenes` para transportarlas. Medido sobre el repositorio:

- **Nadie producía una.** El esquema de salida estructurada del generador
  IR-direct declaraba `narrative: string`, así que el único componente capaz de
  escribir una historia sólo podía devolver una frase. `DiagramCallout` era una
  declaración sin implementación: cero productores, cero consumidores.
- **Nadie leía la que hubiera.** `presentation.scenes` no lo pasaba ningún
  llamante y no lo leía ningún cálculo de escenas. Había **tres derivaciones
  independientes** del mismo recorrido —`canvasNarrative.buildNarrativeScenes`,
  `PresentationMode.deriveDefaultScenes` y el estado de escenas del canvas—, y
  las tres partían de niveles BFS del grafo.
- **Y lo derivado era indistinguible de lo escrito.** `qualityRepair` sintetiza
  un resumen de una línea («flujo centrado en X, optimizado para…») y lo
  escribía como `string` en el mismo campo donde un arquitecto escribe el suyo.

El tercer punto tenía una consecuencia medible en el rubric: la dimensión
*narrativa* daba **10 puntos planos** por que `metadata.narrative` no estuviera
vacío, y la reparación garantizaba eso en todo diagrama que tocaba. La rúbrica
pagaba por su propia reparación, y *preparación ejecutiva* pagaba otros 15 por
lo mismo.

El resultado neto: el modo presentación animaba una secuencia verosímil en vez
de la real. Es exactamente el defecto que el panel de coordinación de la Oficina
existe para evitar —«una animación que reproduce una secuencia plausible en
lugar de la real es una mentira contada con movimiento»— y engaña justo cuando
algo importa.

## Decision

**Una regla responde «¿en qué orden se lee esto?», y siempre dice si la
respuesta estaba escrita o la dedujo.**

- `lib/diagram/storyPlan.ts` — el contrato. Mensaje principal, puntos de
  entrada, orden de lectura, camino principal, contexto secundario, hotspots,
  conclusión, referencias sin resolver, y `source: 'authored' | 'derived'`.
- `services/diagram/storyPlanner.ts` — `buildStoryPlan(ir)`. Lee la narrativa
  escrita cuando la hay; deriva del grafo cuando no. Puro y sin llamada al
  modelo.
- `DiagramNarrative.source` — para que una síntesis no sea *almacenable* con la
  forma de una historia escrita. `narrativeHasText` y `narrativeIsAuthored` son
  la única definición de cada pregunta; la reparación y el planner habían
  divergido sobre ella.

Las tres derivaciones son ahora una: `PresentationMode` perdió su BFS privado y
`canvasNarrative` entra por el plan.

### Las cuatro reglas del plan

1. **Lo escrito gana.** Una escena escrita es la historia; un nivel BFS es una
   conjetura sobre ella. La derivación corre sólo cuando no hay nada que honrar.
2. **Lo derivado es distinguible de lo declarado.** `source` viaja con el plan,
   y los dos campos que una derivación no puede llenar honestamente
   —`primaryMessage` y `conclusion`— quedan en `null` en vez de componerse. Una
   topología descrita y presentada como argumento es una frase que el arquitecto
   nunca escribió apareciendo bajo su firma.
3. **Lo roto se informa, nunca se descarta.** Una escena que apunta a un nodo
   que ya no existe sigue reproduciéndose, y reproduce otra historia.
   `unresolvedReferences` y la regla de lint `NARRATIVE_STALE_REFERENCE` son
   cómo eso se dice en voz alta.
4. **Sin nada que contar devuelve `null`.** Un diagrama vacío no recibe un plan
   vacío — la misma razón por la que `attentionProgress` devuelve `null` y no
   0 %.

### La rúbrica califica el recorrido, no la presencia del campo

Crédito graduado: historia escrita con escenas y callouts = todo; resumen
escrito = la mayor parte; síntesis de la reparación = poco, porque se le muestra
al lector y sigue sin ser un argumento sobre la arquitectura; nada = cero.

### El generador puede, por fin, producir una

`services/ai/prompts/diagramStorySchema.ts` lleva la narrativa estructurada a
las dos mitades del contrato —el JSON que el prompt imprime y el esquema que la
petición exige—, con la regla que importa: **el modelo escribe significado,
nunca geometría.** Las escenas son ids y un título; los callouts son ids y una
frase. Nada ahí deja elegir una posición, un tamaño ni un color.

## Consequences

**A favor.** El modo presentación reproduce la historia que alguien escribió.
La rúbrica mide una historia en vez de un campo relleno. Una narrativa obsoleta
se informa en vez de reproducirse a medias. Y hay una sola travesía del grafo
donde había tres.

**En contra, y aceptado.**

- La carga *eager* sube 0,9 KB gz: el contrato estructurado llega a la entrada
  a través de `diagramPrompts`, que ya era eager por una razón anterior a este
  cambio. Está registrado en `bootPathStaysLight` con su motivo.
- Las puntuaciones bajan en diagramas que sólo tienen la síntesis de la
  reparación. Es el efecto buscado: eran puntos que la rúbrica se pagaba a sí
  misma. El fixture llamado «world-class» del preflight se subió al listón que
  su nombre ya prometía en vez de bajar el listón.
- `primaryMessage` en `null` obliga a los consumidores a manejar el caso. Es
  preferible a una frase compuesta que se lee como del arquitecto.

**Lo que deliberadamente no se hizo.** No hay generación de historia por
modelo *a posteriori* sobre un diagrama existente: el planner no llama a nadie.
Un orden de lectura se deriva del grafo de forma fiable, y gastar una llamada
en algo que un algoritmo resuelve es el intercambio que este repositorio
rechaza en todas partes. Lo que sí necesita un modelo —qué SOSTIENE el
diagrama— se pide en el momento en que se genera, que es cuando hay contexto
para responderlo.
