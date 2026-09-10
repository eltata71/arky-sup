# La historia de un diagrama, y cómo cambiarlo sin rehacerlo

Guía de desarrollo para las dos capas que rodean al `DiagramIR`: **el plan de
historia** (en qué orden se lee un diagrama y qué no hay que perderse) y **el
patch semántico** (cómo se modifica el modelo sin regenerarlo).

El *por qué* de ambas está en `ADR-005` y `ADR-006`. Esto es el *cómo*.

---

## 1. El plan de historia

### Obtenerlo

```ts
import { buildStoryPlan } from '../services/diagram';

const plan = buildStoryPlan(ir);   // StoryPlan | null
```

`null` significa que no hay nada que contar (un IR sin nodos). No es un plan
vacío, y la diferencia importa: pintar «0 escenas» sobre un diagrama vacío
informa de un recorrido que falló, no de uno que no existe.

### Leerlo

| Campo | Qué es | Cuándo es `null` / vacío |
|---|---|---|
| `source` | `'authored'` o `'derived'` | nunca — siempre dice cuál |
| `primaryMessage` | la frase que el diagrama **sostiene** | siempre que nadie la escribió |
| `conclusion` | idem | hoy siempre: el IR aún no lo modela |
| `entryPointIds` | dónde debe caer la vista primero | nunca vacío si hay nodos |
| `readingDirection` | de `metadata.layoutPlan.direction`, `'TB'` por defecto | nunca |
| `steps` | el recorrido guiado, con ids por paso | nunca vacío si hay nodos |
| `primaryPath` | la ruta extremo a extremo de la que va el diagrama | cuando no hay ninguna que merezca llamarse principal |
| `secondaryContextIds` | todo lo que es contexto y no argumento | — |
| `hotspots` | riesgos, fallos, datos sensibles, decisiones | vacío cuando nada lo declara |
| `unresolvedReferences` | ids que la narrativa escrita cita y el IR ya no tiene | vacío en un plan derivado |

**`source` no es decoración.** Un plan derivado y uno escrito son afirmaciones
distintas sobre el mismo diagrama. Si vas a pintar el mensaje principal, o a
puntuar la narrativa, o a decidir si animas el recorrido, mira `source` antes.

**`primaryMessage` en `null` es una respuesta.** No lo rellenes con el título ni
con el resumen sintetizado por la reparación: una descripción presentada como
argumento se lee como escrita por el arquitecto.

### Enfocar

```ts
import { resolveStoryFocus, resolvePrimaryPathFocus } from '../services/diagram';

const focus = resolveStoryFocus(plan, plan.steps[0].id);  // { nodeIds, edgeIds } | null
const path  = resolvePrimaryPathFocus(plan);              // null si no hay ruta principal
```

Ambas devuelven `Set<string>`, listos para atenuar lo que queda fuera.
`resolvePrimaryPathFocus` es lo que resuelve «resalta únicamente el flujo
principal» sin llamar a nadie.

### En el canvas

`buildNarrativeScenes(nodes, edges, ir?)` construye el plan internamente y
camina las escenas escritas cuando las hay. Pásale el IR; sin él se comporta
exactamente como antes.

### Escribir una historia (desde el modelo)

El generador IR-direct la pide en `metadata.narrative`:

```json
{
  "summary": "El cobro depende de un único proveedor externo.",
  "scenes":   [{ "id": "sc-1", "title": "La petición entra",
                 "focusNodeIds": ["portal", "api"], "focusEdgeIds": ["e1"] }],
  "callouts": [{ "id": "co-1", "targetId": "pasarela", "targetKind": "node",
                 "text": "Punto único de fallo.", "severity": "critical" }]
}
```

El contrato vive en `services/ai/prompts/diagramStorySchema.ts`, en las dos
mitades a la vez —el JSON que el prompt imprime y el esquema que la petición
exige—, para que no puedan divergir. **Si añades un campo, añádelo ahí y en
`DiagramNarrative`, en el mismo commit.**

### La reparación y su marca

`autoRepairDiagramIR` sintetiza un resumen cuando el diagrama llega sin
narrativa, y lo marca `source: 'derived'`. Ese marcador es lo que impide que
una descripción de topología pase por una historia:

```ts
import { narrativeHasText, narrativeIsAuthored } from '../lib/diagram';

narrativeHasText(narrative)     // ¿hay algo en el campo?
narrativeIsAuthored(narrative)  // ¿lo escribió alguien?
```

Son **la** definición de cada pregunta. Si necesitas una tercera, probablemente
estás preguntando una de estas dos con otras palabras.

---

## 2. El patch semántico

### Aplicar

```ts
import { applySemanticPatch } from '../services/diagram';

const result = applySemanticPatch(ir, {
  id: 'p1',
  source: 'user',
  operations: [
    { op: 'update-edge', edgeId: 'e1', changes: { criticality: 'critical' } },
    { op: 'add-callout', callout: { id: 'c1', targetId: 'e1', text: 'Camino crítico.' } },
  ],
});
```

`result` trae cuatro cosas y ninguna es opcional de mirar:

- `ir` — el resultado. **Es el objeto original cuando `changed` es `false`**, así
  que puedes comparar por identidad para saltarte una versión y un re-layout.
- `applied` — qué hizo cada operación, en la frase que se le enseña a una
  persona, más `cascaded` cuando arrastró algo.
- `rejected` — qué no se pudo hacer y por qué, con un código (`unknown-node`,
  `duplicate-id`, `no-effect`, …). **Enséñalos.** Una operación rechazada en
  silencio es un cambio que el usuario cree hecho.
- `changed` — si algo cambió.

El motor nunca lanza y nunca muta el IR que recibe.

### Previsualizar

```ts
import { describeSemanticPatch } from '../services/diagram';

const preview = describeSemanticPatch(ir, patch);  // applied / rejected / changed
```

Es el mismo camino, sobre una copia. **No construyas una previsualización
resumiendo las operaciones**: se separaría del motor en cuanto un arrastre
cambiara, y la previsualización existe justo para atrapar una propuesta que
describe una cosa y codifica otra.

### Las operaciones

| Grupo | Operaciones |
|---|---|
| Nodos | `add-node`, `remove-node`, `update-node` |
| Conexiones | `add-edge`, `remove-edge`, `update-edge` |
| Agrupaciones | `group-nodes`, `ungroup`, `add-to-group`, `remove-from-group` |
| Anotaciones | `add-callout`, `remove-callout` |
| Layout | `set-layout-hint` |

**Lo que no hay, y no por olvido:** ninguna operación fija posición, tamaño ni
color. La geometría es del motor de layout y la apariencia del sistema de
diseño; una operación capaz de fijar cualquiera de las dos deja a un modelo
pasar por encima de ambos desde dentro de un JSON. `update-edge` tampoco puede
cambiar `source`/`target`: repuntar una conexión es quitar una y poner otra, y
decirlo así deja las dos mitades del cambio en el registro.

### Añadir una operación

1. Añade la variante a `DiagramPatchOperation` en `lib/diagram/semanticPatch.ts`.
   Si necesita expresar una coordenada o un color, **es la operación equivocada**.
2. Añade su `case` en `applyOne` (`services/diagram/semanticPatchEngine.ts`).
   Devuelve `reject(code, mensaje)` o `done(descripción, cascaded?)`, nunca
   lances y nunca `return` sin una de las dos.
3. Si puede dejar referencias colgantes, arrástralas **y dilo** en `cascaded`.
4. Añade su entrada al `enum` de `PATCH_SCHEMA` en `diagramEditService` si un
   modelo debe poder proponerla.
5. Añade su caso al generador sembrado de
   `__tests__/diagram/semanticPatchEngine.test.ts` — el invariante tiene que
   seguir aguantando con la operación nueva dentro.

### Pedirle un patch a un modelo

```ts
import { diagramEditService } from '../services/ai';

const { ok, patch, preview, reason } =
  await diagramEditService.proposeEdit({ ir, instruction: 'resalta el flujo de autorización' }, settings);
```

Propone y **nunca aplica**. `preview` lo escribe el motor, no el modelo. Todo
fallo devuelve `ok: false` con una frase en castellano y el diagrama intacto;
una petición cancelada devuelve `reason: ''`, porque decir «no disponible»
sobre una llamada que el usuario abortó es mentir sobre la salud del sistema.

Tope de **12 operaciones**: por encima de eso la petición es una regeneración
con pasos extra, y conviene que lo diga.

---

## 3. Diagnosticar

| Síntoma | Dónde mirar |
|---|---|
| El modo presentación no usa la historia escrita | `plan.source` — si es `derived`, la narrativa está vacía o marcada `derived`. `plan.unresolvedReferences` si apunta a ids que ya no existen |
| La puntuación *narrativa* bajó | `narrativeDepth` en `diagramScoring`: una síntesis de la reparación vale poco a propósito |
| Aparece `NARRATIVE_STALE_REFERENCE` | la narrativa cita ids borrados; reescríbela o actualiza las escenas |
| Un patch «no hizo nada» | `result.rejected` — el motivo está ahí, con código |
| Un patch borró más de lo pedido | `applied[].cascaded` — lo dice, elemento a elemento |
