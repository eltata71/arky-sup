# Plan de mejora de diagramas — de lo construido a clase mundial

**Fecha:** 2026-09-28
**Estado:** aprobado por el propietario el 2026-09-28 (#96), en ejecución
**Sustituye a:** la versión anterior de este fichero (commit `a80abea`), retirada por las razones de §1.

---

## 1. Por qué se reemplazó el plan anterior

El plan anterior comparaba Arky con dos repositorios externos (Archify y
diagram-design) y proponía importar sus funciones. Se revisó contra el código y
no se puede ejecutar tal cual, por tres motivos:

- **Partía de una línea base falsa.** Decía «6 tipos de diagrama» y «2
  variantes». El IR declara 12 tipos (`lib/diagram/DiagramIRTypes.ts`: C4 en
  cuatro niveles, integración, BPMN, cadena de valor, flujo de datos,
  despliegue, secuencia, ERD, genérico). Ya existen tres audiencias
  (`audienceProjector`: ejecutiva, técnica, operaciones), un modo historia
  (`storyPlanner` + `PresentationMode`), la persistencia de posiciones manuales
  y un motor de cambios semánticos (`semanticPatchEngine`). Un plan que no sabe
  lo que hay termina reconstruyéndolo.
- **Chocaba con decisiones de arquitectura vigentes.** Leer los colores de una
  web cualquiera desde el navegador lo bloquea CORS, así que exigiría un
  endpoint de dominio en `api/`, y eso está prohibido. Meter tres copias del IR
  dentro del propio IR duplica el modelo que el proyector ya deriva. Un campo
  `variant` obligatorio en el IR rompe los artefactos guardados. Imponer
  fuentes nuevas y prohibir sombras reescribe el aspecto de todo el producto
  sin que nadie lo haya decidido.
- **Arrastraba restos de otros proyectos:** publicar la galería en el dominio
  del autor de Archify, una skill `ascii-video` que no existe aquí, y una CLI
  distribuible con `npx` que queda fuera del alcance de un SaaS.

§6 recoge lo que sí se rescata.

## 2. Punto de partida real

El subsistema es el más probado del producto: 49 módulos en
`services/diagram/` y 110 suites en `__tests__/diagram/`. Esto es lo que ya
tiene:

| Capacidad | Dónde | Llega al usuario |
|---|---|---|
| Pipeline determinista Mermaid → IR → ReactFlow / Excalidraw / Mermaid | `services/diagram/` | Sí |
| 12 tipos con puertas de calidad por tipo, validación C4 y BPMN | `diagramTypeQualityGates`, `c4Validation`, `bpmnValidation` | Sí |
| Tres audiencias sobre un mismo modelo | `audienceProjector`, selector en `ArtifactCanvas` | Sí |
| Historia autoral o derivada, modo presentación | `storyPlanner`, `PresentationMode` | Sí |
| Posiciones manuales que sobreviven a la recarga | `ReactFlowCanvas` (ida y vuelta del arrastre) | Sí |
| Resumen accesible, contraste comprobado | `accessibleSummary`, `lib/colorContrast` | Sí |
| Exportación PNG/SVG con marco y recorte | `canvasImageExport`, `diagramExportFrame` | Sí |
| **Cambiar un diagrama sin regenerarlo** (13 operaciones, vista previa, rechazos tipados) | `semanticPatchEngine`, `diagramEditService` | **No: ninguna pantalla lo llama** |
| Historial de versiones | `ArtifactHistoryModal` | A medias: compara el **texto** Mermaid línea a línea, no el diagrama |
| Lectura de Mermaid | `mermaidToIR` | A medias: descarta `classDef`, `style` y `class` (`mermaidToIR.ts:195`) |
| Marca de la organización | `publicationPipeline/PublicationBrandingService` | En los paquetes de publicación, no en la exportación del diagrama |

**La conclusión guía todo el plan:** la distancia hasta clase mundial no está
en añadir tipos ni en importar funciones ajenas. Está en que quien usa Arky
pueda **modificar, comparar, reutilizar y entregar** un diagrama con la
confianza de una herramienta profesional. Buena parte de eso ya está escrito y
le falta la mitad visible.

## 3. Principios del plan (qué lo hace seguro)

1. **Primero la superficie de lo construido, luego lo nuevo.** Cada fase empieza
   por capacidades que ya tienen motor y pruebas.
2. **Cero regresiones por construcción:**
   - Todo campo nuevo del IR es **opcional**, y si cambia una forma pasa por
     `irMigration.ts` con prueba de compatibilidad sobre artefactos antiguos.
   - Toda función nueva de pantalla entra en un chunk diferido (`lazyWithRetry`
     o `import()`), y `check:bundle-budget` fija el techo por ruta.
   - Nada escribe en el diagrama sin un clic explícito (la regla de la captura
     asistida).
   - Ninguna dependencia nueva sin medir el bundle, y ningún endpoint en `api/`.
3. **Una PR por tarea**, con los gates completos (`npm run quality`, E2E, pgTAP
   si toca SQL) y fusión *squash*. Sin mega-PR.
4. **Cada tarea declara su criterio de terminado.** Si no se puede comprobar,
   no está terminada.

## 4. Fases y tareas

Tamaño: **S** ≈ 1–2 días · **M** ≈ 3–5 días · **L** ≈ 1–2 semanas.

### Fase 1 — Cambiar un diagrama sin perderlo *(la de mayor impacto)*

**Objetivo:** que ajustar un diagrama con IA cueste una frase y conserve todo
lo demás: ids, layout, posiciones manuales y narrativa.

**Beneficio:** hoy un cambio pequeño pedido a la IA regenera el diagrama entero,
así que el usuario deja de pedir cambios pequeños o pierde su trabajo manual.
Este es el comportamiento que distingue una herramienta profesional de un
generador.

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| **1.1** | **Panel «Modificar diagrama»** en el lienzo: la persona escribe una instrucción → `diagramEditService.proposeEdit` → se muestra la vista previa que escribe el **motor** (`describeSemanticPatch`): operaciones, cascadas y rechazos → «Aplicar» crea una versión nueva con `applySemanticPatch`. Orquestación en `services/artifacts/application/`, hook en `hooks/artifacts/` y panel diferido, para no hacer crecer `ArtifactCanvas` | M | La instrucción «renombra X y conéctalo a Y» cambia solo eso. Las posiciones manuales se conservan (prueba). Una propuesta rechazada deja el diagrama intacto y lo dice. Fan-out ≤ 2 |
| **1.2** | **Deshacer y rehacer semántico:** cada patch aplicado es una versión con descripción legible («Añadido nodo Auth; eliminada 1 conexión en cascada») | S | El historial muestra la frase del motor, no «Versión 7» |
| **1.3** | **Comparación semántica entre versiones:** función pura `diffDiagramIR(a, b)` en `services/diagram` (nodos y conexiones añadidos, eliminados, renombrados y reagrupados). `ArtifactHistoryModal` la usa para los diagramas en vez del diff de texto | M | Cambiar el orden de líneas del Mermaid sin cambiar el diagrama da «sin cambios». Suite con generador sembrado |
| **1.4** | **El copiloto usa patches para diagramas:** cuando el artefacto tiene IR, `interpretArtifactModification` pide un patch en lugar de reescribir el contenido. Si el patch falla, se usa el camino actual | M | Misma instrucción al copiloto → mismo resultado que 1.1. La prueba del camino de respaldo existe |

> **Cómo se resolvió 1.4 (2026-09-28).** Al implementarla apareció un defecto
> mayor que la tarea: el copiloto, guardar una edición del Mermaid a mano y
> «Mejorar con IA» escribían sólo el **texto**; el servidor fusiona el parcial y
> el IR viejo sobrevivía, así que el lienzo seguía dibujando el diagrama
> anterior. En vez de pedirle al modelo un patch (una llamada más y un prompt
> nuevo), el texto que ya devuelve se **convierte** en el patch mínimo sobre el
> IR existente (`reconcileIRWithContent`), con la misma regla de identidad que
> la comparación de 1.3. Cubre los cuatro caminos, conserva posiciones y los
> campos que Mermaid no expresa, y no cambia el prompt del copiloto.

### Fase 2 — Fidelidad de entrada y de entrega

**Objetivo:** lo que entra no pierde información y lo que sale puede entregarse
a un comité sin retoques.

**Beneficio:** Arky pasa de ser la herramienta donde se *dibuja* a la
herramienta que se *entrega*.

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| **2.1** | **Mermaid leído por su significado** *(rescatado de A4)*: `classDef`, `class` y `style` alimentan el tipo semántico del nodo (base de datos, externo, seguridad…) con heurísticas conservadoras. Lo que no se reconoce se registra en `MermaidToIRDiagnostics`, nunca se inventa | M | 10 fixtures nuevos en `tests/fixtures/`. Las suites existentes de `mermaidToIR` siguen en verde sin tocarlas |
| **2.2** | **Exportación autocontenida verificada** *(rescatado de A3)*: prueba que falla si el SVG o PNG exportado referencia un recurso externo (fuente, imagen o CSS) | S | Prueba en verde. Si encuentra fugas, se corrigen en la misma PR |
| **2.3** | **Marca de la organización en la exportación** *(B1 bien planteado)*: el marco de exportación lee el logo y los colores que ya gestiona `PublicationBrandingService`, en vez de extraerlos de una web. Pasa por la puerta de contraste | M | Un diagrama exportado lleva la marca configurada. Una paleta con contraste insuficiente se rechaza con motivo |
| **2.4** | **PDF vectorial del diagrama** con portada mínima (título, versión, autor, resumen accesible), reutilizando el adaptador PDF de `services/export` | M | El texto del PDF se puede seleccionar. Al pasar por `check:bundle-budget`, la ruta del Workspace no sube |

### Fase 3 — Coherencia visual *(rescata la intención de A1, con decisión)*

**Objetivo:** que dos diagramas cualesquiera parezcan hechos por la misma mano.

**Beneficio:** los diagramas se ven profesionales sin retoque manual.

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| **3.1** | **Auditoría de valores sueltos** en `CustomNode` y `CustomEdge`: colores, radios, sombras y tamaños tipográficos escritos en línea se pasan a `lib/diagramTokens.ts` / `lib/designTokens.ts`. No cambia el aspecto, solo su origen | M | Prueba que escanea ambos ficheros y falla si aparece un literal nuevo. Captura E2E sin diferencias |
| **3.2** | **Decisión del propietario:** ¿diagrama plano (sin sombras, línea fina) o con elevación sutil? ¿Fuentes nuevas o las actuales? Se registra como ADR | S | ADR aprobado |
| **3.3** | **Aplicar la decisión** de 3.2 solo en los tokens. Rejilla de 8 px al arrastrar a mano | S | Cambio en un solo sitio. Las pruebas de contraste siguen en verde |
| **3.4** | **Preset de exportación «editorial»:** fondo, densidad de anotaciones y leyenda pensados para diapositivas. Es una opción de exportación, no un campo del IR | S | Mismo diagrama en dos presets sin tocar el artefacto |

### Fase 4 — Navegación arquitectónica *(sustituye a B4)*

**Objetivo:** recorrer la arquitectura como la piensa un arquitecto, de un nivel
C4 al siguiente.

**Beneficio:** el conjunto de diagramas de un proyecto se convierte en un
modelo navegable, no en una colección de imágenes.

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| **4.1** | **Drill-down C4:** un nodo puede enlazar, **por id**, al artefacto que lo detalla (contexto → contenedores → componentes). Campo opcional en el nodo del IR y selector que solo ofrece artefactos existentes del proyecto | M | Doble clic abre el nivel siguiente. Un enlace roto se informa y nunca se descarta (regla del portafolio) |
| **4.2** | **Coherencia entre niveles:** una puerta de calidad avisa si un contenedor del diagrama de contenedores no aparece en el sistema que lo contiene. Se apoya en el grafo de conocimiento existente | M | Aviso con referencia al nodo. No bloquea |
| **4.3** | **Editor de escenas de la historia:** escribir y ordenar las escenas del modo presentación con las operaciones `add-callout` / `remove-callout` que ya existen | M | Una historia escrita queda marcada `authored` y gana a la derivada |

### Fase 5 — Ampliación bajo demanda *(opcional, tras fases 1–4)*

Solo si hay una necesidad de usuario que lo justifique:

- **5.1 Radar tecnológico y cuadrante** *(lo único de B2 con sentido para
  arquitectura empresarial)*: un tipo cada vez, con puerta de calidad, resumen
  accesible y fixture propios.
- **5.2 Importar draw.io** *(rescatado de B3)*: parser puro de XML en un chunk
  diferido, sin dependencia nueva, que produce IR y pasa por las puertas.

## 5. Recomendación de arranque

**Empezar por 1.1 (panel «Modificar diagrama»).** Tiene la mejor relación entre
impacto y riesgo:

- El motor, la vista previa, los rechazos y las pruebas ya existen. Lo que falta
  es la mitad visible.
- Es aditivo: no cambia ningún camino actual.
- Desbloquea 1.2, 1.3 y 1.4, y convierte en experiencia de usuario el principio
  del ADR-006 («un diagrama se cambia, no se regenera»).

En paralelo, por ser pequeña e independiente, **2.2** cierra una duda abierta
con una sola prueba.

## 6. Qué se rescató del plan anterior y qué se descartó

| Propuesta anterior | Decisión | Motivo |
|---|---|---|
| A1 Design system estricto | **Reformulado** → 3.1–3.3 | La intención (coherencia) vale. Fuentes y sombras son decisión del propietario, no un quick win |
| A2 Tres variantes en el IR | **Reformulado** → 3.4 | Como preset de exportación, sin campo obligatorio en el IR |
| A3 Export autocontenido | **Rescatado** → 2.2 | Pequeño y comprobable |
| A4 Mermaid semántico | **Rescatado** → 2.1 | Hueco real: `classDef`/`style` se descartan hoy |
| B1 Extraer marca de una URL | **Sustituido** → 2.3 | CORS lo impide sin backend. La marca ya existe en publicación |
| B2 15+ tipos nuevos | **Reducido** → 5.1 | Más tipos no suben el nivel de los existentes. Solo radar y cuadrante tienen uso en arquitectura |
| B3 Importadores | **Reducido** → 5.2 | Solo draw.io, y bajo demanda. Lucid ya tiene integración y PlantUML aporta poco |
| B4 Tres copias del IR | **Sustituido** → 4.1 | Las audiencias ya existen. El salto útil es entre niveles C4 |
| C1 Skill / CLI con `npx` | **Descartado** | Fuera del alcance del producto |
| C2 Cámara semántica y vídeo | **Descartado** (lo útil va en 4.3) | El modo historia ya existe; la skill de vídeo no existe |
| C3 Galería en dominio ajeno | **Descartado** | Resto copiado de Archify |
| C4 Ejemplos de la skill | **Descartado** | Dependía de C1 |

## 7. Seguimiento

Actualizar esta tabla en la PR de cada tarea.

| Tarea | Estado | PR |
|---|---|---|
| 1.1 Panel «Modificar diagrama» | Hecha | #97 |
| 1.2 Deshacer semántico | Hecha | #98 |
| 1.3 Comparación semántica | Hecha | #99 |
| 1.4 Copiloto con patches | Hecha (ver nota en §4) | esta rama (`feat/diagram-1-4-content-reconciliation`) |
| 2.1 Mermaid semántico | Pendiente | — |
| 2.2 Export autocontenido | Pendiente | — |
| 2.3 Marca en exportación | Pendiente | — |
| 2.4 PDF vectorial | Pendiente | — |
| 3.1 Auditoría de tokens | Pendiente | — |
| 3.2 ADR visual | Pendiente (decisión del propietario) | — |
| 3.3 Aplicar decisión visual | Pendiente | — |
| 3.4 Preset editorial | Pendiente | — |
| 4.1 Drill-down C4 | Pendiente | — |
| 4.2 Coherencia entre niveles | Pendiente | — |
| 4.3 Editor de escenas | Pendiente | — |
| 5.x Ampliación | Bajo demanda | — |
