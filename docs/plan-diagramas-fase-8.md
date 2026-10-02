# Plan de diagramas — Fase 8: de la respuesta del modelo a la presentación

Revisión del 2026-10-01, aprobada por el propietario el mismo día. Continúa
`docs/plan-mejora-diagramas.md` (fases 1–6) y `docs/plan-calidad-artefactos.md`
(olas 7.1–7.5).

## 1. Diagnóstico

Las fases 6 y 7 hicieron que **lo que se pide llegue al modelo**: brief único,
motivación, paquetes de dominio, contexto registrado y citado. Lo que queda
débil es lo que ocurre **después** de que el modelo responde: tres sitios
cambian el diagrama del usuario sin su permiso, y la presentación aplana a
cajas y flechas todo lo que no es un diagrama de flujo o un C4.

## 2. Top 10

| # | Hallazgo | Evidencia |
|---|---|---|
| 1 | **Editar en el lienzo destruye el diagrama.** Soltar un nodo reescribe el texto de cualquier `mermaid-*` no C4 con `irToMermaid`, que sólo escribe flowcharts: una secuencia, un ERD, un diagrama de estados o un Gantt se guardan como flowchart. Y el IR se reconstruye desde lo que muestra la pantalla —ya proyectado para la audiencia—, así que un arrastre en vista ejecutiva borra los nodos ocultos y guarda los `group_*` sintéticos | `hooks/artifacts/useDiagramRendering.ts` (`canvasChange`), `services/diagram/quality/canvasToIR.ts` (`mergeIRMetadata`) |
| 2 | **La puerta de calidad inventa arquitectura.** Inserta «API Gateway» o «X Service» que nadie pidió, reetiqueta todo ciclo como «Reintenta · …», agrupa por rol y sintetiza descripciones tautológicas. Corre al generar **y en cada render**: lo que se ve no es lo guardado, y con el nº 1 un arrastre lo vuelve permanente | `services/diagram/autoRepair.ts`, `qualityGate.ts`, `resolveRenderableDiagram.ts` |
| 3 | **Dos mundos de generación.** Sólo el C4 va por IR estructurado con brief, historia y corrección única; secuencia, ERD, estados, Gantt, flujo, híbrido y React Flow van por texto, sin brief ni corrección | `artifactGenerationEngine.ts`, `c4ArtifactGeneration.ts` |
| 4 | **La presentación aplana lo que no es grafo.** La vista preferida es ReactFlow; el parser descarta `alt/loop/opt/note`, los atributos del ERD, y lee el Gantt como flowchart | `artifactGenerationPipeline.ts` (`getArtifactViewCapabilities`), `mermaidToIR.ts` |
| 5 | **La validez sintáctica se juzga con una aproximación** (nuestro parser regex) y no con la gramática de Mermaid 11 | `assessMermaidArtifact` en el motor |
| 6 | **Layout por debajo de las referencias.** ELK no conoce los límites, sus rutas ortogonales se calculan y se descartan, hay parpadeo dagre → ELK, y abrir un artefacto escribe en él (`persistLayoutPlan`) | `lib/elkLayoutEngine.ts`, `useDiagramRendering.ts` |
| 7 | **La puntuación paga sus propias reparaciones** (descripciones, grupos, etiquetas) y no mira la geometría ni el dialecto | `services/diagram/quality/diagramScoring.ts` |
| 8 | **El refinamiento acepta sin mirar la intención**: basta con que la puntuación no baje | `artifactRefinementOrchestrator.ts` |
| 9 | **Conformidad de notación sin contrato**: título, leyenda, estereotipos, patas de gallo, autonumeración | `DiagramLegend`, `CustomNode` |
| 10 | **El banco no mide lo que hoy se rompe**: 10 de 14 casos son C4, sin estados, Gantt, flujo ni React Flow, sin métricas de invención, de ida y vuelta por el lienzo ni de geometría | `tests/fixtures/diagram-evals/` |

## 3. Olas y tareas

Tamaños: **S** 1–2 días · **M** 3–5 días · **L** 1–2 semanas. Reglas de
siempre: una PR por tarea, `npm run quality`, banco sin regresión, techos de
bundle por ruta.

### Ola 8.0 — Medir antes de tocar

| # | Tarea | Tam. | Terminado cuando |
|---|---|---|---|
| 8.0a | Banco ampliado: estados, Gantt, flujo de proceso con ciclo legítimo, flujo con persona → datos, React Flow, secuencia con fragmentos, ERD con atributos | M | ≥ 22 casos; ningún tipo de diagrama sin caso |
| 8.0b | Métricas de integridad y de presentación: elementos inventados, etiquetas reescritas, descripciones sintéticas, render ≠ guardado, dialecto tras una edición en el lienzo, nodos perdidos por proyección, solapes y aristas que atraviesan nodos. La edición del lienzo sale del hook a `services/artifacts/application/diagramCanvasEdit.ts` sin cambiar su comportamiento, para poder medirla sin React | M | Línea base registrada con los defectos actuales |

**Lo que midió la 8.0** (22 casos; `linea-base.json`, clave `actual`). El
banco confirma los hallazgos 1, 2 y 4 sobre el pipeline real y encontró un
cuarto modo de invención que la revisión no había visto:

| Métrica | Valor | Qué significa |
|---|---|---|
| `aristasAlteradas` | 113 | Casi toda relación se guarda con una etiqueta distinta: `qualityRepair` añade un protocolo deducido del rol («· REST/HTTPS», «· JDBC») incluso cuando el modelo declaró otro (ESB/SOAP) y en las relaciones de un ERD |
| `gruposInventados` | 9 | Grupos por rol («Componentes», «Sistemas externos») que nadie declaró |
| `descripcionesSinteticas` | 12 | Descripciones tautológicas en solicitudes a demanda |
| `elementosInventados` | 1 | El servicio que la puerta interpone entre el auditor y el historial clínico |
| `dialectoTrasEdicion` | 0,737 | Mover un nodo convierte en flowchart la secuencia, el ERD y el diagrama de estados |
| `nodosPerdidosPorEdicion` | 57 | Todos en vista ejecutiva: lo que esa vista agrupa desaparece del IR |
| `nodosAnadidosPorEdicion` | 19 | Los nodos `group_*` de la vista ejecutiva guardados como reales |
| `aristasQueAtraviesanNodos` | 7 | Primer render (dagre), con segmento recto entre centros como aproximación. ELK no se mide aún: entra con la 8.3 |

El Gantt se rechaza con el parser regex y se guarda como un esqueleto tras tres
llamadas: queda marcado `defectoConocido: 8.3b` y entra en los agregados.

### Ola 8.1 — Integridad: el sistema deja de cambiar el diagrama por su cuenta

| # | Tarea | Tam. | Terminado cuando |
|---|---|---|---|
| 8.1a | La edición del lienzo parte del IR editable completo, aplica sólo el delta del lienzo y reescribe el texto sólo con `rewriteDiagramContent` | M | Arrastrar en una secuencia o un ERD deja el texto igual; en vista ejecutiva no se pierde ningún nodo |
| 8.1b | La puerta separa **reparar** (lo que impide renderizar) de **proponer** (gateway o servicio sintético, reetiquetar ciclos, grupos, descripciones, protocolos deducidos): lo segundo pasa a sugerencias con clic | M | Elementos, grupos, aristas alteradas y descripciones sintéticas = 0 en el banco |
| 8.1c | El render no corre la puerta: muestra lo guardado, más la proyección de audiencia | S | Render = guardado, salvo la proyección |
| 8.1d | Abrir un artefacto no escribe en él (`persistLayoutPlan`) | S | Cero escrituras al abrir |

### Ola 8.2 — Fidelidad de generación para todos los tipos

| # | Tarea | Tam. | Terminado cuando |
|---|---|---|---|
| 8.2a | `mermaid.parse` (diferido) como juez sintáctico; prompt alineado con Mermaid 11 | S | Ningún texto guardado falla en Mermaid |
| 8.2b | `buildDiagramGenerationBrief` también en la ruta de texto | M | Contexto entregado 100 % en los tipos nuevos |
| 8.2c | Ruta IR estructurada con corrección única para flujo y React Flow | L | Corrección única activa en ≥ 3 tipos |
| 8.2d | El refinamiento se acepta sólo si la fidelidad no baja y los elementos pedidos siguen | S | Caso del banco que lo rechaza |

### Ola 8.3 — Presentación fiel a la notación y layout de clase mundial

| # | Tarea | Tam. | Terminado cuando |
|---|---|---|---|
| 8.3a | Vista preferida por dialecto: secuencia, Gantt y estados en Mermaid nativo; flujo, C4 y ERD en el lienzo | M | Una secuencia abre con líneas de vida y bloques |
| 8.3b | IR extendido (opcional, vía `irMigration`): atributos de entidad, orden y fragmentos de secuencia, estados compuestos | L | Ida y vuelta sin pérdida en sus fixtures |
| 8.3c | ELK jerárquico con límites como nodos compuestos | M | Cero solapes de grupos en el banco |
| 8.3d | Aristas con la polilínea ortogonal de ELK; sin parpadeo | M | Aristas que atraviesan nodos = 0 |

### Ola 8.4 — Medición honesta y notación verificable

| # | Tarea | Tam. | Terminado cuando |
|---|---|---|---|
| 8.4a | Lo `derived` (descripciones, grupos, etiquetas) no puntúa | S | Reparar no sube la puntuación |
| 8.4b | Rúbrica por dialecto y dimensión geométrica | M | Secuencia y ERD no dependen de grupos |
| 8.4c | Contrato de notación por tipo, verificado en lienzo y exportación | M | Un C4 exportado siempre lleva título, leyenda y estereotipos |

### Adicionales

- Retirar la ruta heredada del render que llama a un modelo para convertir Mermaid a ReactFlow.
- Tipo BPMN con carriles para procesos de negocio.
- Regresión visual (Playwright) de seis diagramas canónicos contra `dist/`.
- `generateDiagramIR` en `diagramGenerationService` no tiene llamador fuera de las pruebas.

## 4. Seguimiento

| Tarea | Estado | PR |
|---|---|---|
| 8.0 Banco ampliado y métricas de integridad | Hecha: 22 casos, once tipos, ocho métricas nuevas; la edición del lienzo sale a `diagramCanvasEdit` sin cambiar su comportamiento | #138 |
| 8.1a Edición del lienzo sin pérdida | Hecha (#139): la diferencia del lienzo se aplica como parche al IR guardado y el texto sólo cambia por `rewriteDiagramContent`; lo mismo para «Guardar» (que convertía todo en React Flow), «Modificar diagrama» y «Auto-mejora». Banco: dialecto tras editar 73,7 % → 100 %, nodos perdidos 57 → 0 | #139 |
| 8.1b Reparar ≠ proponer | Hecha (#140): alcance `structural` por defecto y `full` sólo desde «Auto-mejora»; la traza lista lo propuesto y no aplicado. Banco: inventados, grupos, aristas alteradas e inventadas y descripciones sintéticas → 0; calidad media 75,3 → 72,9 a propósito (la rúbrica pagaba las invenciones, 8.4a) | #140 |
| 8.1c Render = guardado | Hecha (#141): el render ya no corre la puerta; sólo la clasificación semántica de tipos (iconos y formas), y `renderShowsStored.test.ts` lo fija | #141 |
| 8.1d Abrir no escribe | Hecha (#141): el plan de ELK queda en memoria (`layoutPlan`); sólo `applyLayoutOverride`, la elección de una persona, se guarda | #141 |
| 8.2a Juez sintáctico | Hecha: `checkMermaidSyntax` (gramática de Mermaid, diferida) juzga el texto en el motor y en la compuerta de renderabilidad; el reintento recibe el error real; Gantt, journey y mindmap no se leen como grafos. Banco en jsdom: el Gantt se guarda como Gantt, esqueletos 4,8 % → 0, dialecto 95,2 % → 100 %, fidelidad 0,877 → 0,93 | #142 |
| 8.2b Brief en ruta de texto | Hecha: secuencia, ERD, estados, Gantt, flujo, híbrido y React Flow reciben el mismo `buildDiagramGenerationBrief` que C4. La audiencia pedida gobierna tamaño y nivel técnico; el banco exige el brief y detecta mandatos ejecutivos contradictorios. | #144 |
| 8.2c Ruta IR para flujo y React Flow | Hecha: flujo y React Flow pasan por la ruta IR con corrección única (`generation/diagram/structuredDiagramArtifactGeneration`), como C4; la serialización sale por `serializeFlowArtifact`. El banco exige que la corrección actúe en C4, flujo y React Flow. | #145 |
| 8.2d Refinamiento fiel | Hecha: `isRefinedCandidateSafe` rechaza un candidato que deja de cumplir algo que se cumplía (`fidelityLosses`), aunque puntúe más; compara el IR con los metadatos que persistirá y el banco fija un caso que pierde un criterio. La lectura de la solicitud es una sola (`diagramFidelityReport`). | #143 |
| 8.3a Vista preferida por dialecto | Hecha: nueva vista «Notación» (`MermaidNotationView`), que dibuja el texto guardado con Mermaid; secuencia, Gantt, estados, journey y mindmap abren en ella (`nativeNotationDialect`), flujo, C4 y ERD siguen en el lienzo con la notación como alternativa. El banco mide `vistaFiel`: 0,826 → 1 | esta PR |
| 8.3b–d | Pendiente | — |
| 8.4a–c | Pendiente | — |
