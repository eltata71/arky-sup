# Alineación con los principios de Anthropic para construir agentes

**Fecha:** 2026-09-05 · **Alcance:** `services/architectureOffice/`, `services/ai/generation/capture/`, `lib/capture/`

Este documento dice, principio a principio, **qué hace este producto**, **por qué**
y **dónde está el código**. No es una lista de buenas intenciones: cada fila
apunta a un fichero y, donde hay una regla, a la prueba que la sostiene.

> **Nota sobre las fuentes.** El entorno de desarrollo donde se escribió esta
> revisión tiene bloqueado el egreso a `anthropic.com`, así que el material de
> referencia no se pudo citar literalmente. Los principios que se aplican aquí
> son los de la guía pública *Building Effective Agents* —flujos vs. agentes,
> encadenamiento de prompts, enrutado, paralelización, orquestador-trabajadores
> y evaluador-optimizador, más las reglas transversales de simplicidad,
> transparencia y diseño cuidadoso de la interfaz agente-herramienta— tal como
> los recoge la documentación de la disciplina. Donde una decisión depende de
> una lectura concreta del texto original, se dice.

---

## 1. El patrón más simple que resuelve la tarea

**El principio.** Empezar por un prompt; añadir flujo cuando el prompt no basta;
añadir un agente cuando el flujo no basta. La orquestación es un coste —latencia,
llamadas, superficie de fallo— que hay que justificar tarea a tarea.

**Lo que hicimos.** La Oficina tenía **un solo modo**: cualquier solicitud
pasaba por coordinador, especialistas y consolidador. Para una pregunta de
arquitectura eso es correcto y es la premisa del producto. Para *«ayúdame a
redactar el driver de esta iniciativa»* es caro y peor: cinco llamadas, varios
segundos y una respuesta consolidada donde hacía falta una frase.

Así que la captura asistida es **un solo agente, sin orquestación**:

| | Captura asistida | Guía de la plataforma | Consulta a la Oficina |
|---|---|---|---|
| Entrada | un campo de un formulario | «¿cómo funciona esto?» | una pregunta de arquitectura |
| Patrón | un agente, una llamada | un agente, una llamada, sobre un catálogo escrito | orquestador-trabajadores + evaluador |
| Agente | Arky, el generalista configurado | Arky, el generalista configurado | coordinadora, especialistas, consolidador |
| Código | `services/ai/generation/capture/` | `services/ai/generation/platformGuide/` | `services/architectureOffice/officeCoordination.ts` |

El razonamiento está escrito en la cabecera de `captureAssistantService.ts`, que
es donde lo va a leer quien se plantee «¿y si esto también pasara por el
equipo?».

La guía de la plataforma añade una vuelta de tuerca al mismo principio: además
de no orquestarse, **no depende del modelo para existir**. `lib/platformGuide`
tiene las respuestas escritas y `findGuideTopics` elige las cercanas; el modelo
redacta sobre ellas, y cuando falla —sin clave, sin red, un 503— se muestran los
temas tal cual, marcados como respuesta de la guía. Es la aplicación más literal
de «el patrón más simple que resuelve la tarea»: para una parte de las preguntas
de uso, el patrón más simple no es un agente, es un texto bien escrito.

## 2. Enrutado (routing)

**El principio.** Clasificar la entrada y mandarla al camino especializado.

**Dónde está.** `planOfficeWorkstreams` en `officeOrchestration.ts`: reglas
deterministas de dominio → especialista. Es enrutado *sin* una llamada al modelo
para decidir el enrutado, que es la versión barata y la que se puede probar.

**Lo que se añadió.** El enrutado ahora respeta dos cosas que antes no existían:
los agentes que el usuario ha desactivado en su ficha (`unavailable`) y un tope
de especialistas (`maxSpecialists`, por defecto 4).

## 3. Paralelización con límites

**El principio.** Ejecutar en paralelo lo independiente, con un límite explícito.

**Dónde está.** `executeOfficeOrchestration` ejecuta los workstreams con un pool
de concurrencia acotado (máximo 3, configurable), y el consolidador **espera** a
todos: consolidar con la mitad de los análisis es firmar una recomendación que
no se ha leído entera.

## 4. Orquestador-trabajadores

**El principio.** Un LLM central descompone, delega y sintetiza.

**Dónde está.** Es la forma de la Oficina desde el principio: Lucía encuadra,
los especialistas trabajan, Alejandro consolida. Dos reglas que no son
negociables y están en el código, no en la costumbre:

- **Coordinador y consolidador nunca son la misma persona** (`teamFromPlan`), por
  la misma razón por la que el productor de un artefacto no es su revisor.
- **El ámbito viaja con cada prompt** (`buildScopeBriefing`), una sola vez y
  compuesto en un solo sitio, para que un especialista y el consolidador no
  puedan estar trabajando sobre dos fotos distintas del registro.

## 5. Evaluador-optimizador — **nuevo**

**El principio.** Un agente produce, otro evalúa contra criterios explícitos, y
el productor corrige. Vale la pena cuando los criterios son claros y la
corrección mide algo.

**Lo que hicimos.** `officeConsolidationReview.ts` evalúa la consolidación
**sin llamar a ningún modelo** — los cuatro criterios son mecánicos, y un
segundo modelo juzgando al primero costaría otra llamada para contestar algo que
una función pura contesta con certeza:

1. cierra con un veredicto (Ready / Conditional / Blocked);
2. cita a cada especialista que entregó;
3. reconoce explícitamente cuando alguno no entregó;
4. tiene cuerpo suficiente para estar consolidando algo.

Si falla, el consolidador corrige **una sola vez**, con los huecos delante. El
tope es deliberado: la segunda pasada ya tiene toda la información que va a
tener, y un bucle sin límite es la forma cara de no converger. Si la corrección
falla, se conserva la respuesta original — una recomendación imperfecta vale más
que un error donde debería estar la respuesta.

Pruebas: `__tests__/architectureOffice/officeConsolidationReview.test.ts`.

## 6. Condiciones de parada y presupuesto

**El principio.** Un sistema de agentes necesita límites declarados, no
emergentes.

| Límite | Dónde | Valor |
|---|---|---|
| Especialistas por operación | `planOfficeWorkstreams` | 4 |
| Concurrencia de especialistas | `executeOfficeOrchestration` | 3 |
| Correcciones del consolidador | `executeOfficeOrchestration` | 1 |
| Tareas simultáneas por agente | ficha del agente | 1–5, por defecto la de su persona |
| Llamadas de IA por encargo | `OfficeBudget` (ya existía) | por encargo |
| Cooldown tras un 429 | `services/ai/callControl` (ya existía) | global |

## 7. Guardarraíles: no responder es una respuesta válida

**El principio.** Un agente que siempre produce algo produce ficción cuando no
tiene con qué.

**Dónde está.**

- `describeInsufficientContext` (`lib/capture`) **rechaza la llamada antes de
  hacerla** cuando el registro está vacío. Un modelo al que se le piden
  objetivos para una ficha en blanco los produce: genéricos, plausibles y sobre
  nada. Ese resultado es peor que ninguno porque parece trabajo.
- Las `openQuestions` son parte del contrato de salida: lo que no se deduce del
  contexto se devuelve como pregunta al negocio, no como campo rellenado.
- La normalización de la respuesta descarta lo que no se pidió y recorta las
  listas al máximo declarado por campo.

- Y, por debajo de todos ellos, los guardarraíles del kernel
  (`services/ai/guardrails`): lo que no puede salir se para **antes** de gastar
  un token —encima de reintentos, cadena de modelos y fallback de proveedor, así
  que un bloqueo deja el contador de llamadas en cero— y lo que la aplicación no
  escribió viaja vallado (`wrapUntrustedContent`) para que el modelo sepa que es
  material a analizar y no órdenes. Una frase de inyección **sólo avisa**, y esa
  es la decisión más discutible del conjunto: bloquear por la frase impediría a
  este producto escribir sus propios documentos de seguridad, y un guardarraíl
  que estorba el trabajo normal es uno que alguien apaga —llevándose por delante
  la comprobación de credenciales, que es la que no se puede deshacer. Detalle
  en `docs/ai-kernel.md`.

## 8. La interfaz agente-formulario, documentada

**El principio.** La calidad de un agente depende de lo bien descrita que esté
la herramienta que usa. Anthropic insiste en invertir en esa descripción tanto
como en el prompt.

**Lo que hicimos.** `lib/capture/captureFields.ts` es esa descripción: cada
campo declara su forma, su guía, su límite y **sus reglas de la disciplina** —
«un objetivo dice QUÉ, nunca CÓMO», «un indicador sin unidad no sirve», «no
inventes marcos regulatorios». Las reglas viajan literales al prompt. Antes cada
pantalla escribía su propia versión, y la creación y el mantenimiento de una
iniciativa acabaron pidiendo lo mismo con palabras distintas.

## 9. Transparencia: la coordinación se emite, no se reconstruye

**El principio.** Mostrar lo que el sistema hace de verdad.

**Dónde está.** Cada hand-off emite un `CoordinationEvent` en el momento en que
ocurre y `TeamCoordinationPanel` lo pinta. Se añadió lo que faltaba: la pasada
de corrección emite su propio evento —dos «recomendación firmada» seguidas no
se distinguen— y el evento de cierre dice si la recomendación conserva
salvedades y cuáles.

## 10. La persona humana decide

**El principio.** Human-in-the-loop en los puntos que importan.

**Dónde está.** Nada de lo que propone la captura asistida se escribe solo: la
propuesta se ve y se acepta con un clic, entrada a entrada en las listas. El
charter de un entregable sigue necesitando aprobación humana antes de ejecutarse
y el comité (ARB) sigue decidiendo al final. Y la ficha de un agente **no puede
apagar el gobierno**: qué produce y qué revisa cada uno, y el papel de cada uno
en la orquestación, no son configurables — un agente que produce y revisa lo
mismo dejaría de ser una revisión.

---

## Lo que deliberadamente **no** hicimos

- **No convertimos la Oficina en un agente autónomo con bucle abierto.** El plan
  es determinista y auditable; un planificador LLM sin tope habría sido más
  flexible y menos explicable, y el producto vende exactamente lo contrario.
- **No añadimos un LLM evaluador.** Los criterios de la consolidación son
  mecánicos. Un juez-modelo se justifica cuando el criterio es de calidad
  subjetiva; aquí sería una llamada por respuesta para comprobar si aparece la
  palabra «Conditional».
- **No añadimos moderación de contenido ni redacción de datos personales.** Un
  detector de PII sin catálogo del dominio marca nombres de sistemas y de
  personas —que es de lo que trata una arquitectura— y el que se apaga por
  ruidoso es el mismo que comprobaba las claves.
- **No degradamos el fallo del coordinador a un plan silencioso.** Cuando Lucía
  no puede encuadrar, la operación falla y lo dice. Presentar como recomendación
  del equipo algo que el equipo no llegó a coordinar sería mentir con la
  interfaz.
