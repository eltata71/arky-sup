# Plan de clase mundial: fiabilidad, consistencia y experiencia de los artefactos

**Fecha:** 2026-10-03
**Estado:** aprobado por el propietario el 2026-10-03, con R-16 = B y R-17 = A (ver sección 7)
**Continúa:** `docs/plan-diagramas-fase-8.md` (cerrada con #138–#152) y
`docs/plan-calidad-artefactos.md` (cerrada con #121–#137). La transformación DDD
está cerrada desde el 2026-09-27 (`docs/ddd-transformacion/14-informe-cierre.md`).
**Numeración:** las olas siguen la de los planes anteriores (6.x, 7.x y 8.x) y
empiezan en la **9**.

---

## 0. Cómo leer este documento

Las secciones 1 a 3 son el diagnóstico: qué se revisó, qué ya es de clase mundial
y no debe tocarse, y qué se encontró, con su evidencia `fichero:línea`. La
sección 4 define qué significa «clase mundial» para este producto, en cifras. Las
secciones 5 a 8 son el plan: principios, olas, tareas con criterios de
aceptación, orden y seguimiento. La sección 9 es la plantilla con la que Claude
ejecuta cada tarea.

Cada tarea está escrita para que **una sesión de Claude Code la ejecute de
principio a fin en una PR**, con el flujo del repositorio: rama desde `main`,
`npm run quality` en verde, PR, CI, squash-merge y comprobación del despliegue.

---

## 1. Qué se revisó

La revisión siguió el recorrido completo de quien usa el producto: entrar,
crear una iniciativa, abrir un proyecto, pedir un entregable, generar un
artefacto, mirarlo, corregirlo, revisarlo, presentarlo, exportarlo y publicarlo.
En cada paso se leyó el código que lo atiende y se midió.

| Área | Qué se midió |
|---|---|
| Generación | `pages/Workspace.tsx`, `components/CustomArtifactRequestModal.tsx`, `lib/artifacts/generationPhase.ts` y el motor |
| Lienzo | `components/ArtifactCanvas.tsx`, las barras de `components/artifacts/toolbar/` y las vistas por formato |
| Salida | Los doce adaptadores de `services/export/adapters/`, en especial DOCX, PDF y PPTX |
| Catálogo | Los 55 `ARTIFACT_TEMPLATES` de `constants.ts` y la unión `ArtifactType` de `types.ts:207` |
| Disciplina | Cobertura frente a TOGAF ADM, ArchiMate 3.2, C4, BPMN 2.0, ISO/IEC/IEEE 42010 y 25010 |
| Interfaz | Uso de `motion/react`, movimiento reducido, i18n, primitivas `components/ui/`, accesibilidad |
| Rendimiento | `ROUTE_BUDGETS_GZIP_KB` en `scripts/checkBundleBudget.mjs` |
| Pruebas | 548 ficheros bajo `__tests__/`, 7 especificaciones E2E y los bancos `diagram-evals` y `artifact-evals` |

---

## 2. Lo que ya es de clase mundial, y no se toca

Este plan **no** reabre trabajo cerrado. Lo que sigue es la base sobre la que
construye, y cualquier tarea que lo degrade falla su criterio de aceptación.

- **Arquitectura interna.** Monolito modular con fronteras declaradas
  (`modules.json` y `check:module-boundaries`), cero ciclos de dominio, cuatro
  agregados con fábrica e invariantes, y operaciones con nombre en lugar de
  `update(partial)`.
- **Seguridad del dato.** RLS con denegación por defecto, RPC `SECURITY DEFINER`,
  paridad de la matriz de permisos verificada celda a celda, y 18 contratos pgTAP.
- **Canalización de diagramas.** Mermaid → DiagramIR → render determinista, cada
  dialecto conservado sin pérdida, parches semánticos en lugar de regenerar, la
  historia leída del modelo, y la notación C4 aplicada en cada superficie.
- **Contexto de IA.** Contexto entregado al 100 % en los ocho caminos, todo
  cercado, con manifiesto registrado y citas verificables (`[ctx:*]`).
- **Honestidad de las cifras.** Lo no medido es `null`, lo derivado se distingue
  de lo declarado y lo roto se informa.
- **Gates.** Presupuestos monótonos de bundle por ruta, de `any`, de tamaño y de
  fronteras.

**El hallazgo general:** la ingeniería interna está muy por delante de lo que el
usuario recibe en la mano. El modelo de un documento es rico, pero su exportación
DOCX no tiene estilos. El pipeline emite doce fases observables, y la generación
principal muestra una barra indeterminada. El IR conoce las notaciones, pero el
catálogo no habla ArchiMate. Este plan cierra esa distancia.

---

## 3. Hallazgos

Ordenados por gravedad. **C** = corrección (hoy se pierde o se deforma algo),
**E** = experiencia, **D** = disciplina de arquitectura, **R** = rendimiento,
**A** = accesibilidad.

### 3.1 La salida pierde o deforma el trabajo *(C)*

| # | Hallazgo | Evidencia |
|---|---|---|
| H1 | **El DOCX no lleva `styles.xml`.** Se usan los estilos `Title`, `Heading1`…`Heading3`, pero ningún fichero los define. Word los pinta como `Normal`: no hay jerarquía, ni panel de navegación, ni índice posible | `services/export/adapters/docxExporter.ts:63-70`. El paquete solo contiene `document.xml`, las relaciones y `docProps` |
| H2 | **El DOCX descarta las filas de tabla con un número de celdas distinto al de la cabecera.** Ocurre sin aviso, y es el tipo de tabla que más produce un modelo | `docxExporter.ts:26`: `if (row.length === headers.length) rows.push(row)` |
| H3 | **El DOCX no incluye diagramas**, no tiene listas numeradas y elimina el énfasis (`*`, `_` y `` ` `` se borran). Además, las tablas del artefacto van al final como apéndice, separadas de la sección donde se citan | `docxExporter.ts:34-35` y `:59`. No existe ninguna `w:drawing` |
| H4 | **El PPTX aplana tablas, KPI y avisos a texto** con el formato `a \| b`, **no exporta las notas del orador** y deja caer el *layout* de la diapositiva. El modelo declara catorce *layouts* y siete tipos de bloque (`PresentationBlockKind`) | `services/export/adapters/pptxExporter.ts:64-77`. No hay `a:tbl` ni `notesSlide`, aunque `PresentationTypes.ts:98` define `speakerNotes` |
| H5 | **El PDF usa Helvetica Type1 con codificación WinAnsi**: sustituye por `?` cualquier carácter fuera de Latin-1. Afecta a flechas (→ ⇒), comparadores (≥ ≤), marcas (✓ ✗), letras griegas y emojis, que son habituales en documentos de arquitectura | `services/export/adapters/pdfExporter.ts:69-80` |

### 3.2 La generación se vive como una espera ciega *(E)*

| # | Hallazgo | Evidencia |
|---|---|---|
| H6 | **La generación principal bloquea toda la pantalla** con un diálogo modal y una barra indeterminada. El usuario no puede seguir trabajando, y la opción de liberar la pantalla solo aparece a los 20 s | `pages/Workspace.tsx:544-575` (`fixed inset-0 … z-[200]`, `progress-indeterminate`) |
| H7 | **Las doce fases que emite el pipeline no llegan a la generación principal.** Solo las pinta la solicitud personalizada, y lo hace en jerga interna: «Parsing», «Quality gate», «Fallback» | `components/CustomArtifactRequestModal.tsx:30-43` (`STAGE_LABELS`) y `:110`, `:615` |
| H8 | **No hay vista previa progresiva.** El contenido aparece de golpe al final, aunque la capa de IA soporta *streaming* (SSE en `api/ai.ts`) | La superposición de `Workspace.tsx` no muestra contenido parcial |
| H9 | **No hay cola de generaciones.** Mientras genera un artefacto, no se puede pedir el siguiente ni seguir navegando. Un paquete típico (contexto, contenedores, ADR y NFR) se genera en serie y con la pantalla bloqueada | `Workspace.tsx:417` (`if (!project \|\| isGenerating) return;`) |
| H10 | **Un cambio de la IA no se deshace en un clic.** Para volver atrás hay que abrir el historial de versiones. Las herramientas de clase mundial ofrecen «Deshacer» en el mismo aviso que confirma el cambio | No existe «Deshacer» en `ArtifactCanvas.tsx`, `hooks/artifacts/`, `components/copilot/` ni `components/assistant/` |

### 3.3 El catálogo no cubre la disciplina *(D)*

| # | Hallazgo | Evidencia |
|---|---|---|
| H11 | **No existe ArchiMate**, el lenguaje estándar de arquitectura empresarial (The Open Group). No hay vistas de capas (negocio, aplicación, tecnología), de motivación ni de implementación y migración | No hay ninguna coincidencia de `archimate` en `lib/`, `services/`, `components/` ni `constants.ts` |
| H12 | **No hay repositorio empresarial entre proyectos.** El grafo de conocimiento vive dentro de cada proyecto. La misma aplicación «Core de Pólizas», nombrada en diez proyectos, son diez entidades distintas. Sin un inventario común no hay portafolio de aplicaciones, ni mapa de capacidades con mapa de calor, ni análisis de impacto transversal | `services/architectureKnowledgeGraph/` trabaja con un grafo por `projectId` (`api.architecture_knowledge_graphs`) |
| H13 | **Faltan artefactos centrales de TOGAF y de la práctica EA.** No hay análisis de brechas (línea base → objetivo), arquitecturas de transición ni hoja de ruta por mesetas, racionalización del portafolio (TIME), radar tecnológico, contrato de arquitectura ni evaluación de cumplimiento | Lista de 55 plantillas en `constants.ts:86-790` |
| H14 | **Hay dos plantillas de ADR casi iguales**: «Catálogo de Decisiones (ADR)» y «Registro de Decisiones Arquitectónicas (ADR)». Además, el mapa de capacidades es un grafo genérico de React Flow, no un mapa por niveles L1/L2/L3 con mapa de calor | `constants.ts:444`, `:456` y `:86-87` |
| H15 | **Las fases del catálogo son propias**, no del ciclo de referencia. «Fase 1: Estratégica…» a «Fase 4» y «SDD» no se corresponden con las fases del TOGAF ADM (Preliminar y A–H) ni con un ciclo de vida de solución reconocible | `constants.ts:74-81` (`KANBAN_COLUMNS`) |

### 3.4 Rendimiento percibido *(R)*

| # | Hallazgo | Evidencia |
|---|---|---|
| H16 | **Abrir un artefacto descarga 1 139 KB gz** (unos 4–5 MB de JavaScript). ProjectsPage descarga 752 y SDDProcessView 675. Cada ola de los planes de diagramas y artefactos subió el techo entre 1 y 3 KB, y ninguna lo bajó | `scripts/checkBundleBudget.mjs:110-117` |
| H17 | **Ocho pantallas descargan la capa de IA al abrirse** (unos 600 KB gz) aunque nadie pulse el asistente. Es la deuda R-09 | `docs/ddd-transformacion/13-deuda-residual.md` (R-09) |

### 3.5 Consistencia y accesibilidad *(A/E)*

| # | Hallazgo | Evidencia |
|---|---|---|
| H18 | **24 de los 31 componentes que animan con `motion/react` ignoran «reducir movimiento».** La regla CSS de `index.html:176` detiene las animaciones CSS, pero no las de JavaScript, y en todo el repositorio no hay un `MotionConfig` | `grep "from 'motion/react'"` frente a `useReducedMotion`. Ejemplos: `ArtifactCanvas.tsx`, `Modal.tsx`, `CommandPalette.tsx`, `PresentationMode.tsx` |
| H19 | **Ajustes ofrece el inglés, pero solo 7 ficheros de UI usan `t()`.** Elegir «English» deja el 95 % de la interfaz en español: es una promesa que el producto no cumple | `pages/SettingsPage.tsx:143`, `:566-572`. Solo 7 ficheros de `components/` y `pages/` llaman a `t(` |
| H20 | **No hay comprobación automática de accesibilidad** (axe) ni regresión visual en E2E. Las reglas de accesibilidad se verifican por escaneo estático y en revisión | No hay `axe` ni `toHaveScreenshot` en `e2e/` |
| H21 | **Hay elementos `div` clicables sin teclado** en el LMS y en ProjectsPage, y superposiciones hechas a mano en lugar de `Modal`/`Drawer` | `pages/LMS/LMSCatalog.tsx:301`, `LMSDashboard.tsx:363`, `LessonModal.tsx:642` y `:710`, `StudentContextModal.tsx:36` |
| H22 | **Los ficheros de UI más grandes concentran la deuda de experiencia**: `ReactFlowCanvas.tsx` (1 925 líneas), `ProjectHub.tsx` (1 059), `MemoryCenterModal.tsx` (1 016), `CustomArtifactRequestModal.tsx` (841) y `CustomArtifactBriefWizard.tsx` (839) | `wc -l` |

---

## 4. Qué significa «clase mundial» aquí

### 4.1 Referentes

No se trata de copiar pantallas, sino de igualar lo que estos productos hacen
bien:

| Referente | Qué hace bien | Qué toma este plan |
|---|---|---|
| **LeanIX / Ardoq / Bizzdesign HoriZZon / Avolution ABACUS** | Repositorio empresarial único, metamodelo, mapa de capacidades con mapa de calor, portafolio de aplicaciones (TIME), hojas de ruta por mesetas | Olas 11 y 12: inventario empresarial, mapa de calor, TIME y hoja de ruta |
| **Sparx EA / Archi** | Conformidad con ArchiMate 3.2, vistas por punto de vista, intercambio en formato estándar | Ola 11: ArchiMate como dialecto del IR, con exportación *Open Exchange* |
| **Structurizr / IcePanel** | Modelo C4 único y vistas derivadas, navegación por niveles con zoom | Ya está en la base. La ola 12 añade la navegación entre niveles |
| **Notion AI / Linear / Figma** | La IA trabaja sin bloquear, muestra el progreso con palabras humanas, deshace en un clic y anima con propósito | Ola 10: generación en segundo plano, *streaming*, «Deshacer» y movimiento con sentido |
| **Microsoft Word / Google Docs / PowerPoint** | Ficheros nativos: estilos, índice, tablas, imágenes y notas | Ola 9: exportación con fidelidad nativa |

### 4.2 Cuadro de mando: línea base y objetivo

Cada cifra se mide con un comando del repositorio, y la tarea que la mueve la
registra en su PR.

| Métrica | Hoy | Objetivo | Cómo se mide |
|---|---|---|---|
| Fidelidad de exportación (DOCX/PPTX/PDF) | DOCX: filas, tablas, títulos y diagramas 100 % (9.1). PPTX: tablas, filas y notas 100 %, *layouts* 14/14 (9.2). PDF: filas 81,6 %, diagramas 0 % (9.0) | 100 % de tablas, filas, diagramas y notas preservados | `npm run eval:exports` |
| Caracteres perdidos en el PDF | 27 en el corpus (9.0) | 0 en el corpus | `npm run eval:exports` |
| Fases visibles en la generación principal | 0 de 12 | 100 %, con nombre en español | Prueba de componente |
| Tiempo hasta el primer contenido visible al generar | fin de la generación | menos de 3 s con proveedor simulado | E2E con `page.route('**/api/ai')` |
| Generaciones en paralelo sin bloquear | 1, bloqueante | cola de N (por defecto 3) y navegación libre | E2E |
| Fidelidad de documentos (`artifact-evals`) | 73,7 % | ≥ 90 % | `npm run eval:artifacts` |
| Calidad media de diagramas (`diagram-evals`) | 73,53 | ≥ 78, sin inflar | `npm run eval:diagrams` |
| Descarga de la ruta Workspace | 1 139 KB gz | ≤ 700 KB gz | `check:bundle-budget` |
| Rutas que descargan IA al abrirse | 8 | 0 | `check:bundle-budget` |
| Violaciones axe graves o críticas | sin medir | 0 en las 10 rutas | E2E con `@axe-core/playwright` |
| Animaciones JS que respetan movimiento reducido | 7 de 31 | 31 de 31 | Prueba de escaneo |
| Cobertura de i18n | 7 ficheros | decisión R-16 (sección 7) | Prueba de escaneo |
| Plantillas con estándar declarado | sin campo | 100 % (TOGAF, ArchiMate, C4, BPMN, 42010…) | Prueba sobre `ARTIFACT_TEMPLATES` |

---

## 5. Principios de ejecución

1. **Lo que pierde trabajo va primero.** La ola 9 corrige la salida antes de
   embellecer nada. Un documento precioso que se exporta roto es un documento
   roto.
2. **Medir antes de cambiar.** Toda ola abre con su banco o su medición (9.0,
   10.0…), y toda tarea registra su cifra antes y después en la PR.
3. **Ni una regla del repositorio se relaja.** Fronteras, `any`, tamaño,
   pureza del dominio y presupuestos de bundle siguen siendo monótonos. Si una
   tarea necesita subir un techo, lo justifica con la cifra medida, igual que en
   las olas 7 y 8.
4. **Ninguna dependencia nueva sin medir.** Un exportador nativo puede necesitar
   una librería (por ejemplo, para incrustar una fuente TrueType en el PDF). Se
   carga con `import()` dentro del adaptador, se mide en
   `check:bundle-budget` y pasa `npm audit --audit-level=high`. Las librerías de
   gráficos están vetadas (ver *What NOT to Do*).
5. **La IA propone, la persona decide.** Toda escritura de la IA se ve, se aplica
   con un clic y se deshace con otro.
6. **Animación con propósito.** El movimiento explica un cambio de estado
   (aparecer, mover, completar) y nunca decora. Todo se apaga con «reducir
   movimiento».
7. **La disciplina, de una sola fuente.** Los metamodelos (ArchiMate, TOGAF y
   los demás) se declaran en `lib/`, igual que `lib/domainPacks`, y los leen el
   prompt, el validador y la vista.
8. **Documentación en el mismo commit.** Cada regla nueva actualiza CLAUDE.md y
   AGENTS.md, con su ancla en `assistantDocsParity.test.ts`. Si una pantalla se
   mueve, se actualiza `lib/platformGuide/platformGuideTopics.ts`.
9. **Las migraciones se aplican a `ArkyDB-US` solo con aprobación**, y antes de
   fusionar el código que las usa (`docs/operacion/runbook-migraciones.md`).

---

## 6. Olas, fases y tareas

Cada tarea indica: **Objetivo**, **Cambios** (dónde), **Criterios de
aceptación** (verificables) y **Tamaño** (S: menos de 1 día, M: 1–2 días, L:
3–5 días). Además de los suyos, todas cumplen los **criterios comunes**:

> **CA-común:** `npm run quality` en verde (typecheck, strict, lint 0/0, los
> cuatro presupuestos, cobertura por encima de los suelos, build y bundle);
> pruebas nuevas en la convención del repositorio (`.test.ts` sin DOM,
> `.test.tsx` con DOM); `diagram-evals` y `artifact-evals` sin regresión;
> CLAUDE.md y AGENTS.md actualizados si cambia una regla; una PR por tarea,
> fusionada y con el despliegue de producción en verde.

---

### Ola 9 — La salida es fiel *(fiabilidad)*

**Meta:** lo que sale de Arky en DOCX, PPTX o PDF contiene todo lo que había en
pantalla, con la forma nativa del formato.
**Criterio de cierre de la ola:** el banco `export-evals` llega al 100 % de
preservación en los tres formatos, y H1–H5 están cerrados.

#### 9.0 Banco de evaluación de exportación *(medición · M)*
- **Objetivo:** medir la fidelidad antes de tocar nada.
- **Cambios:** `tests/fixtures/export-evals/`, con al menos doce artefactos
  reales: un documento con tablas irregulares, otro con caracteres
  no-Latin-1, un ADR, un NFR, un híbrido texto+diagrama y decks ejecutivo y
  técnico con todos los *layouts*. Además, `__tests__/export/evals/`, que
  descomprime cada OOXML, lee el XML y cuenta lo preservado, y el script
  `npm run eval:exports` con su `linea-base.json`.
- **Métricas:** `filasPreservadas`, `tablasNativas`, `encabezadosConEstilo`,
  `diagramasIncrustados`, `notasOrador`, `caracteresPerdidosPdf` y
  `layoutsRespetados`.
- **CA:** el banco corre en CI con `test:ci`; la línea base registra los
  defectos actuales (H1–H5) como `defectoConocido`; el informe se imprime con
  `eval:exports`.
- **Medido (2026-10-03):** DOCX filas 79,6 %, tablas nativas 100 %, títulos
  con estilo 0 %, diagramas 0 %; PPTX filas 0 %, tablas nativas 0 %, diagramas
  100 %, notas 0 %, *layouts* 0/14; PDF filas 81,6 %, títulos 98 %, diagramas
  0 %, 27 caracteres perdidos. Cada cifra bajo su objetivo está en
  `defectosConocidos` con la tarea que la cierra.
- **Hallado al medir, sin tarea en el plan:** el PDF de un documento (1)
  **trunca sin aviso** las celdas sobrantes de una fila más larga que la
  cabecera —el mismo defecto que H2, en otro formato— y (2) **imprime el código
  Mermaid** en vez del diagrama; sólo el PDF desde el lienzo lo dibuja. Como el
  cierre de la ola exige el 100 % en los tres formatos, se proponen para el
  alcance de 9.3; queda registrado en la línea base como H2 y H3 del PDF.

#### 9.1 DOCX nativo *(corrección · L)*
- **Objetivo:** un DOCX que Word abre con estilos, índice, listas, énfasis,
  tablas en su sitio y diagramas.
- **Cambios:**
  - `services/export/adapters/docxExporter.ts` se divide en `docx/styles.ts`
    (con `styles.xml`: Title, Heading1–3, Caption, TableGrid y Quote, con la
    tipografía del producto), `docx/numbering.ts` (viñetas y numeradas,
    anidadas), `docx/markdown.ts` (negrita, cursiva, código en línea, enlaces y
    citas) y `docx/images.ts` (diagramas rasterizados con
    `diagramExporter`/`diagramPdf`, `w:drawing` y relaciones).
  - Un campo de índice (`TOC \o "1-3"`) tras la portada.
  - Las tablas se quedan donde las cita el documento. La tabla de metadatos pasa
    a la portada.
  - **Las filas irregulares se rellenan o se truncan, y el truncado se avisa**
    en la nota de exportación. Nunca se descartan.
- **CA:** en `export-evals`, `filasPreservadas` = 100 %,
  `encabezadosConEstilo` = 100 % y `diagramasIncrustados` = 100 % para híbridos
  y diagramas. El fichero se abre sin reparación en Word y en LibreOffice (se
  valida contra el esquema con una prueba que comprueba `[Content_Types]`,
  relaciones y partes). La prueba de H2 falla con el código anterior.
- **Medido (2026-10-03):** filas, tablas nativas, encabezados con estilo y
  diagramas incrustados llegan al 100 % en el corpus. Un DOCX con tabla
  irregular, lista, enlace y diagrama se abrió y renderizó en LibreOffice sin
  reparación; el banco retira H1–H3 de DOCX de `defectosConocidos`.
  El adaptador se carga al pedir DOCX: Workspace pasa de 1 138,9 a
  1 138,0 KB gz de descarga por ruta, sin subir el techo.

#### 9.2 PPTX nativo *(corrección · L)*
- **Objetivo:** cada *layout* y cada tipo de bloque tiene su forma nativa en
  PowerPoint.
- **Cambios:** `services/export/adapters/pptx/` contendrá:
  - tablas `a:tbl` con cabecera destacada;
  - KPI como tarjetas (forma + valor grande + tendencia con flecha y palabra,
    nunca solo con color);
  - avisos (*callouts*) con su tono;
  - `notesSlide` con `speakerNotes`;
  - un *layout* maestro por cada uno de los catorce `PresentationLayout`;
  - diagramas rasterizados (ya existen) y una línea de tiempo dibujada con
    formas.
  
  El tema (colores y fuentes) sale de `lib/designTokens.ts` y de la paleta de
  `tailwind.config.cjs`, mediante un único módulo de marca para la exportación.
- **CA:** en `export-evals`, `tablasNativas` = 100 %, `notasOrador` = 100 % y
  `layoutsRespetados` = 14/14. Ningún bloque se exporta como `a | b`. Se abre
  sin reparación en PowerPoint, Keynote y LibreOffice.

#### 9.3 PDF sin pérdidas *(corrección · L)*
- **Objetivo:** cero caracteres y contenido perdidos en el PDF.
- **Cambios:** se incrusta un subconjunto de una fuente TrueType libre (Inter o
  Noto Sans, con licencia OFL) con codificación Identity-H y `ToUnicode`, para
  que el texto se pueda copiar y buscar. La fuente se carga con `import()` desde
  el adaptador, nunca en la carga inicial. `sanitizeForPdf` deja de reemplazar
  por `?`, y lo que siga sin poder representarse se informa. Además: marcadores
  (*outline*) por encabezado, metadatos de documento y PDF etiquetado básico
  (`/StructTreeRoot` para títulos, párrafos y tablas), en línea con
  `docs/publication-accessibility.md`. Las filas con más celdas que la cabecera
  conservan todas sus celdas o notifican cualquier truncado antes de descargar.
  Los diagramas Mermaid de un documento se incrustan como imagen mediante la
  misma ruta de rasterización que usa la exportación desde el lienzo.
- **CA:** `caracteresPerdidosPdf` = 0 en el corpus (→ ⇒ ≥ ≤ ✓ ✗ α β, emoji
  básico); `filasPreservadas` = 100 % y `diagramasIncrustados` = 100 % en PDF;
  el texto se puede seleccionar y buscar; hay *outline* presente; la carga
  inicial no cambia, y la ruta Workspace sube como máximo lo medido y
  justificado.

#### 9.4 La exportación dice lo que hizo *(experiencia · S)*
- **Objetivo:** que nadie descubra en una reunión que faltaba algo.
- **Cambios:** `ArtifactExportModal` muestra, antes de descargar, una vista
  previa de la primera página o diapositiva. Después muestra un recibo: «12
  tablas, 3 diagramas, 14 diapositivas con notas; 1 fila truncada en la tabla
  “Riesgos”». El recibo sale de la nota de exportación de 9.1–9.3, no se
  recalcula.
- **CA:** prueba de componente del recibo; todo aviso de pérdida es visible
  antes de cerrar el modal; se mantiene el foco (`useFocusTrap`) y se anuncia
  con `useAriaAnnouncer`.

---

### Ola 10 — Generar es una experiencia, no una espera *(experiencia de IA)*

**Meta:** generar se siente como ver trabajar a un equipo. Se ve el progreso con
palabras humanas, el contenido aparece mientras se escribe, nada bloquea y todo
se deshace.
**Criterio de cierre:** H6–H10 cerrados; tiempo hasta el primer contenido
visible por debajo de 3 s con proveedor simulado; cola de tres generaciones
navegando libremente.

#### 10.0 Medir el recorrido de generación *(medición · S)*
- **Cambios:** un E2E `e2e/generation-experience.spec.ts` con proveedor
  simulado (`page.route('**/api/ai')`, como `artifact-and-graph.spec.ts`), con
  respuestas en *streaming* retrasadas. Mide el tiempo hasta la primera fase,
  hasta el primer contenido, hasta el final y si la UI responde mientras tanto.
- **CA:** las cifras de hoy quedan registradas en la PR y el informe se publica
  como artefacto de CI.

#### 10.1 Un solo vocabulario de fases, en español *(consistencia · S)*
- **Objetivo:** que las doce fases tengan un nombre humano y uno solo.
- **Cambios:** `lib/artifacts/generationPhaseCopy.ts`, con el nombre visible,
  una frase de qué está pasando y el icono de cada `ArtifactGenerationStage`.
  Ejemplos: «Leyendo el contexto del proyecto», «Escribiendo»,
  «Comprobando la notación», «Puliendo el resultado» o «Guardando». Elimina
  `STAGE_LABELS` de `CustomArtifactRequestModal.tsx:30-43`.
- **CA:** una prueba de escaneo impide otro mapa de etiquetas de fases fuera de
  ese fichero; no queda ninguna etiqueta en inglés ni de jerga («Parsing»,
  «Fallback», «Quality gate») en la UI.

#### 10.2 Generación en segundo plano con cola *(experiencia · L)*
- **Objetivo:** pedir, seguir trabajando y recibir el resultado.
- **Cambios:**
  - `services/artifacts/application/generationQueue.ts`: una cola pura con
    concurrencia N (por defecto 3), prioridad, cancelación y reanudación tras
    un error. Siguiendo el patrón de la ola 4, el servicio decide y el hook
    aplica.
  - `hooks/artifacts/useGenerationQueue.ts`.
  - Un **centro de generaciones**: un panel acoplable, alcanzable desde el raíl,
    con una tarjeta viva por trabajo (fase actual, tiempo, cancelar, abrir).
  - Se retira la superposición modal de `Workspace.tsx:544-575`.
  - Al terminar, un aviso con «Abrir» y, si falló, «Reintentar» con el
    diagnóstico de `generationFailure`.
  - Se respeta `callControl` (cooldown y presupuesto): la cola espera en lugar
    de disparar llamadas que serán 429.
- **CA:**
  - Se pueden encolar tres artefactos y navegar a otra ruta sin perder ninguno
    (E2E).
  - Cancelar no persiste nada.
  - La cola se pierde al cerrar la pestaña y **se dice** («2 generaciones
    interrumpidas»), sin trabajo fantasma.
  - `appContextComposition.test.ts` sigue verde, porque la cola no es otro dueño
    de `projects`.
  - El fan-out de UI no sube.

#### 10.3 Vista previa en *streaming* *(experiencia · L)*
- **Objetivo:** ver el documento escribirse.
- **Cambios:**
  - Exponer el camino de *streaming* que ya existe en el transporte
    (`legacyTransport` y `api/ai.ts` SSE) a la generación de documentos y
    presentaciones con un `onPartial(text)` en `ArtifactGenerationSupport` o en
    las opciones, sin romper la regla de que el motor no importa contextos.
  - En la tarjeta del centro y en un lienzo provisional se ve el Markdown
    parcial, en modo de solo lectura y con un cursor animado.
  - Para diagramas, que devuelven IR y no se pueden mostrar parciales con
    honestidad, se muestran los nombres de los elementos a medida que el
    lector los valida, nunca un diagrama a medias.
- **CA:**
  - El primer contenido aparece en menos de 3 s en el E2E de 10.0.
  - El contenido final es idéntico con y sin *streaming* (prueba).
  - Si el *streaming* falla, se usa la respuesta completa sin que el usuario
    note nada.
  - Las reglas de `guardrails/` se aplican antes de la primera llamada, igual
    que hoy.

#### 10.4 «Deshacer» en un clic para todo cambio de la IA *(confianza · M)*
- **Objetivo:** que nadie tema pulsar «Mejorar».
- **Cambios:** todo comando que cree una versión desde la IA (refinar,
  copiloto, parche de documento o de diagrama, auto-mejora) devuelve la versión
  anterior. El aviso de confirmación lleva «Deshacer» (tecla `Z` con
  modificador), que restaura con `artifactWorkflow` como una versión nueva,
  sin reescribir la historia. Además, un `diff` en línea opcional reutiliza
  `lib/textDiff.ts` y `ArtifactVersionComparison`.
- **CA:** prueba por cada camino de escritura de la IA; deshacer crea una
  versión, no borra ninguna; se anuncia con `useAriaAnnouncer`; existe el atajo
  de teclado y aparece en `KeyboardShortcutsModal`.

#### 10.5 La IA explica qué cambió *(confianza · M)*
- **Cambios:** tras un cambio de la IA, una tarjeta con el resumen del cambio:
  secciones tocadas, filas añadidas y nodos y aristas para diagramas. Sale de
  `describeSemanticPatch`/`documentPatchEngine` (la misma ruta de código que
  aplica, regla de ADR-006), con resaltado temporal en el lienzo de lo cambiado
  (animación de 600 ms, que se apaga con movimiento reducido).
- **CA:** el resumen y la aplicación salen del mismo código (prueba); el
  resaltado no se activa con `prefers-reduced-motion`.

---

### Ola 11 — La disciplina de arquitectura empresarial *(dominio)*

**Meta:** que un arquitecto empresarial reconozca su disciplina: ArchiMate, el
ciclo TOGAF ADM, el inventario empresarial y los artefactos de planificación.
**Criterio de cierre:** H11–H15 cerrados; el banco de diagramas cubre
ArchiMate; el catálogo declara un estándar en cada plantilla.

> **Decisión del propietario antes de la 11.2 (R-17), resuelta el 2026-10-03:
> opción A, inventario por usuario por ahora.** El inventario
> empresarial necesita tablas nuevas y su migración. Se presentó con dos
> opciones: **A**, un inventario por usuario, con el mismo modelo de propiedad
> que hoy; **B**, un inventario compartido por organización, que exige el
> concepto de organización, hoy inexistente.

#### 11.0 Catálogo con estándar declarado y fases de referencia *(consistencia · M)*
- **Cambios:**
  - Se añade a `ArtifactTemplate` el campo `standard` (por ejemplo, `'TOGAF ADM
    · Fase B'`, `'ArchiMate 3.2 · Punto de vista de cooperación de
    aplicaciones'`, `'C4 · Nivel 2'`, `'ISO/IEC 25010'`) y un `admPhase`
    opcional.
  - El catálogo de `ProjectHub` permite agrupar por ADM (Preliminar, A–H y
    Gestión de requisitos) además de las fases actuales, que se conservan por
    compatibilidad con los artefactos guardados.
  - Las dos plantillas ADR (`constants.ts:444` y `:456`) se fusionan en una: el
    registro, con vista de catálogo. Los artefactos existentes migran al leer.
- **CA:** una prueba exige `standard` en las 55 plantillas; ningún artefacto
  guardado pierde su fase; la guía de la plataforma se actualiza en el mismo
  commit.

#### 11.1 ArchiMate como dialecto del IR *(dominio · L)*
- **Objetivo:** vistas ArchiMate de verdad, con su notación.
- **Cambios:**
  - `lib/archimate/`: el metamodelo con los elementos y relaciones de ArchiMate
    3.2 de las capas de estrategia, negocio, aplicación, tecnología, motivación
    e implementación, y la tabla de relaciones permitidas.
  - `DiagramIR.notation` con un dialecto `archimate` (el mismo patrón que
    secuencia, ERD y estados en la 8.3b).
  - Iconografía y colores por capa como tokens en `lib/diagramTokens.ts` (los
    estándar de la especificación, con el contraste verificado en
    `lib/colorContrast.ts`).
  - Validador: una relación no permitida por el metamodelo es una violación con
    nombre.
  - Plantillas nuevas por punto de vista: Cooperación de Aplicaciones, Uso de
    Aplicaciones, Capas, Motivación, Estrategia y Tecnología.
  - Exportación en **ArchiMate Model Exchange File Format** (XML de The Open
    Group) desde `services/export`.
- **CA:**
  - Al menos seis casos ArchiMate en `diagram-evals`, con `notacionSinPerdida` =
    1 y `contratoNotacion` = 1.
  - El fichero de intercambio se importa en Archi (prueba de esquema XSD en CI y
    comprobación manual registrada en la PR).
  - Una relación prohibida aparece en la traza.
  - Los paquetes de dominio (`lib/domainPacks`) se aplican también a
    ArchiMate.

#### 11.2 Inventario empresarial *(dominio · L · necesita migración y R-17)*
- **Objetivo:** que una aplicación, una capacidad o una tecnología existan una
  sola vez y se vean desde todos los proyectos.
- **Cambios:**
  - Un contexto nuevo, `services/enterpriseRepository/`, con la forma piloto:
    `domain/` (elemento, identidad, deduplicación por nombre normalizado y
    alias, ciclo de vida), `infrastructure/` y `application/`.
  - Migración con tablas, RLS, privilegios revocados, RPC y contrato pgTAP con
    caso negativo.
  - El grafo de cada proyecto **referencia** elementos del inventario por id
    (las relaciones son claves, nunca texto).
  - Promoción asistida: «Esta entidad aparece en 4 proyectos: ¿unificarla?», con
    clic explícito (regla de la captura asistida).
- **CA:** `contextDomainPurity.test.ts` incluye el contexto nuevo; la matriz de
  propiedad (`06-propiedad-datos.md`) y los invariantes se actualizan; ningún
  proyecto existente cambia de comportamiento sin la promoción explícita;
  migración aplicada con aprobación antes de fusionar.

#### 11.3 Mapa de capacidades con mapa de calor *(dominio · L)*
- **Cambios:**
  - Una vista dedicada para el mapa de capacidades: rejilla anidada L1/L2/L3,
    no un grafo.
  - Capas superpuestas seleccionables: madurez, inversión, riesgo, número de
    aplicaciones que la soportan (del inventario) y cobertura de iniciativas
    (del `portfolioGraph`).
  - Leyenda con valores en palabras, nunca color solo (regla de `StatusDot`), y
    exportación a PNG/PPTX con la ola 9.
  - Animación de transición al cambiar de capa (escala de color interpolada en
    300 ms, que se apaga con movimiento reducido).
- **CA:** las cifras de cada celda salen de reglas puras con prueba y lo no
  medido se pinta como «sin medir», nunca como 0. Cumple axe. La ruta respeta
  su techo sin depender de librerías de gráficos.

#### 11.4 Línea base, objetivo, brechas y hoja de ruta *(dominio · L)*
- **Cambios:**
  - Plantillas y modelo para el **análisis de brechas** (TOGAF fases B–D):
    elementos de la línea base y del objetivo, sacados del inventario, con la
    clasificación conservar / eliminar / nuevo / modificar calculada, no
    escrita.
  - **Arquitecturas de transición** (mesetas).
  - **Hoja de ruta** por mesetas y paquetes de trabajo, enlazada a los hitos de
    `ProjectAttentionTracking`.
  - Vista temporal interactiva con arrastre y alternativa de teclado
    (`useResizablePanel` como patrón WCAG 2.5.7).
- **CA:** la brecha se deriva de las dos listas (prueba); las mesetas se
  vinculan a hitos por id; la exportación a PPTX usa la línea de tiempo nativa
  de la 9.2.

#### 11.5 Portafolio de aplicaciones y radar tecnológico *(dominio · M)*
- **Cambios:**
  - Racionalización **TIME** (Tolerar, Invertir, Migrar, Eliminar) a partir de
    dos ejes medidos (aptitud funcional y técnica), con cuadrante calculado.
  - **Radar tecnológico** (Adoptar, Probar, Evaluar, Retener) alimentado por
    los estándares de la Oficina.
  - **Contrato de arquitectura** y **evaluación de cumplimiento** como
    plantillas con contrato en `contractDefinitions.ts`.
- **CA:** el cuadrante TIME se calcula y nunca se elige; sin las dos
  puntuaciones es «sin evaluar»; las plantillas pasan el validador de
  disciplina (`documentDisciplines`).

---

### Ola 12 — El lienzo y los documentos, de clase mundial *(UI/UX)*

**Meta:** ver, leer, navegar y presentar un artefacto es rápido, bonito y
memorable.
**Criterio de cierre:** ruta Workspace ≤ 700 KB gz; los cinco ficheros de UI más
grandes, por debajo de su techo actual; las vistas de documento, diagrama y
presentación cumplen axe.

#### 12.0 Adelgazar la ruta Workspace *(rendimiento · L)*
- **Objetivo:** pasar de 1 139 a ≤ 700 KB gz.
- **Cambios:**
  - Medir con un visualizador del build qué compone el chunk.
  - Diferir por vista: ELK, Excalidraw, Lucid, exportadores y motor de calidad
    se cargan solo al usarse.
  - Cerrar R-09 (la IA se carga en el primer uso del asistente o de la captura)
    con `import()` detrás de una puerta pequeña (patrón ADR-109).
  - Comprobar barriles contra el bundle (*The barrel against the bundle*).
- **CA:** `ROUTE_BUDGETS_GZIP_KB.Workspace` ≤ 700; las ocho rutas de R-09 bajan
  a menos de 100 KB gz; `e2e/chunks.spec.ts` en verde; ninguna función se
  vuelve más lenta en su primer uso por encima de 300 ms (medido en el E2E de
  10.0).

#### 12.1 Partir los cinco ficheros de UI más grandes *(mantenibilidad · L)*
- **Cambios:** `ReactFlowCanvas.tsx` (1 925), `ProjectHub.tsx` (1 059),
  `MemoryCenterModal.tsx` (1 016), `CustomArtifactRequestModal.tsx` (841) y
  `CustomArtifactBriefWizard.tsx` (839) se descomponen en hooks y subvistas
  siguiendo el patrón de `ArtifactCanvas` y `hooks/artifacts/`. Las decisiones
  van a servicios de aplicación, nunca a la vista.
- **CA:** cada uno queda por debajo de 500 líneas o con su techo rebajado en
  `check:module-size`; el comportamiento no cambia (las pruebas existentes
  pasan sin editarlas, salvo los imports).

#### 12.2 Documento de lectura editorial *(UI · M)*
- **Cambios:** `DocumentPaper` con índice lateral fijo y sección activa
  (`DocumentOutline`); anclas compartibles por sección; tablas con cabecera fija
  y desplazamiento horizontal accesible; medida de línea de 65–75 caracteres;
  tipografía de la escala de `TYPE` en `designTokens`; modo de lectura y modo
  de revisión con comentarios anclados a una sección (`CommentThread`); citas
  `[ctx:*]` como chips con vista previa de la fuente.
- **CA:** el índice refleja la jerarquía de encabezados (prueba); la navegación
  por teclado entre secciones está documentada en `KeyboardShortcutsModal`;
  axe 0.

#### 12.3 Navegación C4 por niveles con zoom semántico *(UI · M)*
- **Cambios:** desde un elemento de contexto, «Entrar» abre el diagrama de
  contenedores que lo detalla (relación por id, de `notationContract` y la
  procedencia del nivel superior de la 6.2), con una transición animada de
  zoom: el nodo se expande hasta el lienzo hijo. Lleva miga de pan C4 y vuelta
  con `Esc`.
- **CA:** la transición dura como máximo 400 ms y se sustituye por un fundido
  con movimiento reducido; la navegación funciona igual con teclado; no se
  regenera nada.

#### 12.4 Modo presentación memorable *(UI · M)*
- **Cambios:**
  - `PresentationMode` con transiciones con propósito: la historia del
    diagrama (`buildStoryPlan`) anima escena por escena, resaltando nodos y
    atenuando el resto, y los KPI cuentan hasta su valor.
  - Vista del presentador con notas, siguiente diapositiva y reloj.
  - Puntero láser con teclado.
  - Las diapositivas usan los catorce *layouts* con la misma marca que el PPTX de
    la 9.2: lo que se ve es lo que se exporta.
- **CA:** el orden de las escenas sale solo de `buildStoryPlan` (no hay un
  tercer recorrido); la vista del presentador funciona en una segunda ventana;
  con movimiento reducido no hay animación y la información es la misma.

#### 12.5 Barras del lienzo por intención *(UI · M)*
- **Cambios:** se reorganizan las seis agrupaciones de
  `ArtifactBottomToolbar.tsx` (Navegación, Presentación, Edición, Calidad e IA,
  Observabilidad, Configuración) en torno a tres intenciones visibles,
  **Revisar · Mejorar · Compartir**, más un menú de comandos (`Cmd+K` en
  contexto). La observabilidad pasa a un panel de detalle para usuarios
  avanzados.
- **CA:** las acciones principales están a un clic y cada una tiene atajo; las
  pruebas de componente cubren los tres grupos; ninguna acción se pierde
  (inventario antes/después en la PR).

---

### Ola 13 — Consistencia, accesibilidad y movimiento *(transversal)*

**Meta:** todo el producto se siente como uno: el mismo movimiento, el mismo
idioma, las mismas primitivas y accesible de verdad.
**Criterio de cierre:** H18–H21 cerrados; axe con 0 violaciones graves o
críticas en las diez rutas; regresión visual en CI.

> **Decisión del propietario antes de la 13.2 (R-16), resuelta el 2026-10-03:
> opción B, el inglés se requiere desde ahora y se traduce de verdad.** Ajustes
> no retira el idioma. Se presentó así: **A**, retirarlo hasta traducir de verdad (recomendado: un idioma completo es
> mejor que dos a medias). **B**, internacionalización completa, que extrae
> todas las cadenas literales de la UI (miles) y sube la carga inicial con el diccionario, salvo que se
> cargue por idioma.

#### 13.0 Accesibilidad y regresión visual en E2E *(medición · M)*
- **Cambios:** `@axe-core/playwright` (dependencia de desarrollo, no llega al
  bundle) en un `e2e/accessibility.spec.ts` que recorre las diez rutas
  protegidas y las vistas del artefacto. Regresión visual (`toHaveScreenshot`)
  de seis diagramas canónicos y tres documentos contra `dist/` (era un
  adicional de la fase 8), solo en Chromium de escritorio y con tolerancia
  declarada.
- **CA:** el informe base se registra; las violaciones actuales quedan como
  lista monótona que solo puede bajar, igual que los otros presupuestos.

#### 13.1 Movimiento reducido en todas partes *(accesibilidad · S)*
- **Cambios:** `<MotionConfig reducedMotion="user">` en la raíz
  (`index.tsx`) y `lib/designTokens.ts` como única fuente de duraciones y
  curvas (`MOTION`), además de una prueba de escaneo: todo `motion.*` usa
  duraciones de `MOTION` y la raíz conserva el `MotionConfig`.
- **CA:** 31 de 31 componentes respetan la preferencia (prueba con
  `matchMedia` simulado); no quedan duraciones literales en animaciones de
  `motion/react`.

#### 13.2 Idioma: una sola verdad *(consistencia · S o L, según R-16)*
- **Opción A (S):** se retira `en` del selector, `settings.language` queda en
  `es`, y una prueba impide ofrecer un idioma cuyo diccionario no cubra la UI.
- **Opción B (L):** extracción por pantalla con un escaneo que cuente las
  cadenas literales en JSX; el diccionario se carga por idioma con `import()`;
  y `translations.test.ts` se amplía.
- **CA (ambas):** ninguna opción de idioma ofrece una interfaz parcialmente
  traducida.

#### 13.3 Primitivas en todo el producto *(consistencia · M)*
- **Cambios:** se sustituyen las superposiciones hechas a mano
  (`LessonModal.tsx:710`, `StudentContextModal.tsx:36`, `LMSDashboard.tsx:406`
  y `:455`, `LMSSmartNotes.tsx:100`) por `Modal`/`Drawer` con `useFocusTrap`, y
  los `div` clicables (`LMSCatalog.tsx:301`, `LMSDashboard.tsx:363`,
  `LessonModal.tsx:642`) por `button`/`Card` interactiva. Se añade una prueba
  de escaneo que impide `<div … onClick` sin `role` ni teclado en
  `components/` y `pages/`.
- **CA:** el escaneo pasa en verde; axe sin `click-events-have-key-events` ni
  violaciones de foco.

#### 13.4 Estados vacíos, de carga y de error, uno por forma *(UX · M)*
- **Cambios:** hoy hay 30 ficheros con spinner frente a 6 con `PageSkeleton`.
  Cada vista con estructura conocida pasa a esqueleto con la forma que llega
  (regla de CLAUDE.md), y cada error ofrece una acción («Reintentar», «Ver
  diagnóstico»). Los estados vacíos llevan el siguiente paso de la jerarquía,
  con el enlace que conserva el contexto.
- **CA:** inventario antes/después en la PR; ningún spinner donde se conoce la
  estructura; las pruebas de componente cubren los estados vacío, cargando y
  error de las cinco pantallas principales.

#### 13.5 Microinteracciones con propósito *(UX · M)*
- **Cambios:** un vocabulario corto, en `designTokens` y documentado en
  `docs/`:
  - aparecer (fundido y desplazamiento de 8 px, 180 ms);
  - completar (marca que se dibuja, 400 ms, solo al terminar una generación o
    al aprobar un charter);
  - reordenar (diseño animado en listas del portafolio);
  - celebrar una vez (al publicar un paquete, sin confeti repetido).
  
  Se aplica en el centro de generaciones, el tablero, la sala del entregable y
  la publicación.
- **CA:** cada animación tiene un evento de dominio que la justifica (tabla en
  el documento); ninguna se repite en bucle salvo los indicadores de progreso;
  todas se apagan con movimiento reducido.

---

### Ola 14 — Gobierno y colaboración *(clase mundial operativa)*

**Meta:** que el artefacto viva en una organización: revisión, aprobación,
publicación y trazabilidad hasta la decisión.
**Criterio de cierre:** el ciclo borrador → revisión → aprobado → publicado es
visible en cada artefacto y en el tablero.

> **Decisiones del propietario:** R-02 (`charter:approve`) y R-03 (historial de
> chat) siguen abiertas en `13-deuda-residual.md`. La 14.1 necesita R-02, y la
> 14.3 necesita R-03 y una migración.

#### 14.0 Ciclo de vida del artefacto visible *(UX · M)*
- **Cambios:** un indicador de estado único (`ArtifactStatusBadge`) con las
  etapas borrador, en revisión, cambios pedidos, aprobado y publicado, salidas
  de `reviewTransitions` y del pipeline de publicación, nunca escritas a mano.
  Lleva una línea de tiempo del artefacto (versiones, revisiones, decisiones y
  publicaciones) en el inspector.
- **CA:** el estado se deriva (prueba); se muestra la misma etiqueta en el
  lienzo, en ProjectHub y en el tablero.

#### 14.1 Revisión con separación de funciones *(gobierno · M · R-02)*
- **Cambios:** según R-02, «Aprobar» exige `charter:approve` y el autor no
  aprueba lo suyo, igual que el ARB (`describeArbDecisionEligibility` como
  patrón). Al pedir cambios, la sugerencia queda como tarea enlazada a la
  sección.
- **CA:** el contrato pgTAP tiene el caso negativo (el autor no puede aprobar);
  la UI explica por qué un control no está disponible.

#### 14.2 Trazabilidad de requisito a decisión a artefacto *(EA · M)*
- **Cambios:** una vista de trazabilidad que une los KPI y resultados de la
  iniciativa, los requisitos (SDD), los ADR, los elementos del diagrama y la
  publicación, con los servicios existentes (`ArchitectureTraceabilityService`
  y `portfolioGraph`). Desde cualquier elemento se puede preguntar «¿por qué
  existe?» y «¿qué rompe si lo cambio?» (impacto). Las referencias rotas se
  informan.
- **CA:** las relaciones solo se apoyan en ids; la vista muestra los huecos
  («requisito sin decisión», «decisión sin artefacto») como hallazgos
  accionables.

#### 14.3 Historial de chat sin pérdida *(fiabilidad · M · R-03 + migración)*
- **Cambios:** la opción elegida en R-03 (revisión optimista o un registro por
  mensaje), con migración, contrato pgTAP y actualización de T-06 en
  `07-invariantes.md`.
- **CA:** el E2E con dos pestañas en el mismo proyecto no pierde mensajes.

---

## 7. Orden, dependencias y decisiones

```
9.0 ─▶ 9.1 ─┬─▶ 9.4
      9.2 ─┤
      9.3 ─┘
10.0 ─▶ 10.1 ─▶ 10.2 ─▶ 10.3 ─▶ 10.4 ─▶ 10.5
13.0 ─▶ 13.1 ─▶ 13.3 ─▶ 13.4 ─▶ 13.5      (13.2 es la opción B, L)
11.0 ─▶ 11.1 ─▶ 11.2 (R-17) ─▶ 11.3 ─▶ 11.4 ─▶ 11.5
12.0 (tras 10.2) ─▶ 12.1 ─▶ 12.2 / 12.3 / 12.4 / 12.5
14.0 ─▶ 14.1 (R-02) · 14.2 · 14.3 (R-03)
```

**Orden recomendado:** 9 → 10 → 13.0/13.1 → 12.0 → 11 → resto de 12 → resto de
13 → 14. La ola 9 corrige pérdidas; la 10 cambia la experiencia que más se
repite; la 13.0 pone el medidor antes de rediseñar; la 12.0 libera el
presupuesto que consumirán las olas 11 y 12.

| Decisión | Pregunta | Recomendación |
|---|---|---|
| **R-16** | ¿Inglés completo o fuera del selector? | **Resuelta: B** (2026-10-03). El inglés se requiere desde ahora: internacionalización completa, con diccionario por idioma cargado con `import()` |
| **R-17** | ¿Inventario por usuario o por organización? | **Resuelta: A** (2026-10-03): por usuario ahora, diseñado para que B sea una migración aditiva |
| **R-02** | ¿Exigir `charter:approve`? | Exigirlo cuando haya un segundo usuario con otro rol |
| **R-03** | ¿Revisión optimista o un registro por mensaje en el chat? | Un registro por mensaje: no hay conflicto que resolver |
| **Dependencias** | ¿Aceptar una fuente OFL para el PDF y `@axe-core/playwright` (desarrollo)? | Sí, cargadas con `import()` y medidas |

---

## 8. Seguimiento

| Tarea | Estado | PR |
|---|---|---|
| 9.0 Banco de exportación | Hecha | #154 |
| 9.1 DOCX nativo | Hecha | #156 |
| 9.2 PPTX nativo | Hecha | #157 |
| 9.3 PDF sin pérdidas | Hecha | #158 |
| 9.4 Recibo de exportación | Hecha | #159 |
| 10.0 Medición del recorrido de generación | Hecha | #160 |
| 10.1 Vocabulario único de fases | Hecha | #161 |
| 10.2 Cola en segundo plano | Hecha | #162 |
| 10.3 *Streaming* | Hecha | #163 · cierre 10.3b (lienzo provisional, nombres validados, E2E <3 s, guardrail antes del stream) |
| 10.4 «Deshacer» en un clic | Hecha | #164 · cierre 10.4b (asistente, agente, copiloto y cola, con prueba por camino) |
| 10.5 La IA explica qué cambió | Hecha | tarjeta de resumen derivada del mismo resultado del motor + resaltado de 600 ms (apagado con movimiento reducido) |
| 11.0 Estándar declarado y fases ADM | Pendiente | |
| 11.1 ArchiMate | Pendiente | |
| 11.2 Inventario empresarial | Pendiente (R-17 resuelta: A) | |
| 11.3 Mapa de calor de capacidades | Pendiente | |
| 11.4 Brechas y hoja de ruta | Pendiente | |
| 11.5 TIME, radar y contrato | Pendiente | |
| 12.0 Workspace ≤ 700 KB gz | Hecha | Workspace 1 119 → 657,1 KB gz, Projects 753,8 → 708,6: lienzo, asistente y modales diferidos |
| 12.1 Partir los cinco ficheros grandes | Pendiente | |
| 12.2 Documento editorial | Pendiente | |
| 12.3 Zoom semántico C4 | Pendiente | |
| 12.4 Modo presentación | Pendiente | |
| 12.5 Barras por intención | Pendiente | |
| 13.0 axe y regresión visual | Hecha (#169) | axe y regresión visual en E2E con referencias medidas en CI. Cerró también un defecto real: el enlace profundo `?artifact=` no reintentaba la hidratación si el portafolio llegaba tras montar `Workspace` (`useProjectArtifacts` depende ahora de la llegada del proyecto) |
| 13.1 Movimiento reducido | Hecha | `MotionConfig reducedMotion="user"` en la raíz, `MOTION` en `lib/designTokens.ts` como fuente única de duraciones y curvas, y un escáner que impide literales en `motion/react` |
| 13.2 Idioma | En curso (R-16: B, tamaño L) | Infraestructura entregada: un módulo por idioma, inglés lazy, presupuesto monótono de literales (1 321 medidos); raíl y navegación móvil migrados. Falta la campaña de extracción hasta 0 |
| 13.3 Primitivas | Pendiente | |
| 13.4 Estados vacío, carga y error | Pendiente | |
| 13.5 Microinteracciones | Pendiente | |
| 14.0 Ciclo de vida visible | Pendiente | |
| 14.1 Separación de funciones | Pendiente (R-02) | |
| 14.2 Trazabilidad | Pendiente | |
| 14.3 Chat sin pérdida | Pendiente (R-03) | |

---

## 9. Plantilla de ejecución para Claude

Cada tarea se lanza en una sesión nueva con este mensaje, cambiando el
identificador:

> Ejecuta la tarea **⟨ID⟩** de `docs/plan-clase-mundial.md`.
> 1. Lee CLAUDE.md, la tarea, sus dependencias y los documentos que cita.
> 2. Antes de cambiar nada, **mide** la cifra que la tarea mueve y anótala.
> 3. Reserva la tarea con `bash scripts/agentes/nueva-tarea.sh ⟨agente⟩ ⟨id⟩
>    ⟨tema⟩`: crea la rama `clase-mundial/⟨id⟩-⟨tema⟩` desde `main` en un
>    worktree propio y abre la PR en borrador que la marca como tomada (ver
>    `docs/operacion/multiagente.md`).
> 4. Implementa con pruebas que fallen con el código anterior. Respeta
>    fronteras, pureza del dominio, presupuestos y la regla de «una puerta».
> 5. Ejecuta `NODE_OPTIONS=--max-old-space-size=3072 npm run quality` y el banco
>    afectado (`eval:exports`, `eval:diagrams` o `eval:artifacts`). Si una
>    cifra sube un techo, justifícala con lo medido.
> 6. Actualiza CLAUDE.md y AGENTS.md (con su ancla de paridad) si cambia una
>    regla, la guía de la plataforma si se mueve una pantalla, y la fila de la
>    tabla de seguimiento con el número de PR.
> 7. Abre la PR con el antes/después de cada criterio de aceptación, espera a
>    CI, fusiona con *squash* y comprueba el despliegue.
> 8. **Si la tarea incluye una migración, para y pide aprobación** antes de
>    aplicarla a `ArkyDB-US`. Aplícala antes de fusionar.
> 9. Si un criterio no se cumple, dilo en la PR con la cifra; no lo des por
>    cumplido.
