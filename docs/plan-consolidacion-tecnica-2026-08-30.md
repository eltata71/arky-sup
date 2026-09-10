# Plan de trabajo — Top 10 de consolidación técnica

> **Documento de origen:** [`top-10-consolidacion-tecnica-2026-08-30.md`](./top-10-consolidacion-tecnica-2026-08-30.md)
> **Estado:** las tres olas implementadas y verificadas. Los 10 puntos cerrados o acotados, con el resto declarado abajo.
> **Rama:** `claude/top-10-consolidacion-tecnica-2026-fawny4`

Este documento convierte el Top 10 en tareas ejecutables. Para cada punto: qué
se verificó contra el código, qué se hizo, cómo se cierra y **qué guarda impide
que vuelva**. Esa última columna es la que importa: las diecisiete superficies
XSS que la Ola 0 cerró no se añadieron por descuido, sino una a una, cada vez de
forma localmente razonable. Una norma escrita no las habría evitado, porque no
hubo ningún momento en que alguien estuviera rompiendo una.

---

## 0. Línea base real, medida

El documento original no pudo certificar la puerta de calidad: `npm ci` recibió
un HTTP 403 en su entorno de revisión (§2, §7). Aquí `npm ci` funciona sin
problema, así que la línea base está medida, no supuesta:

| Comprobación | Resultado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run lint` | **0 errores**, 90 avisos |
| `npm run test:ci` | 340 archivos, 2 995 pruebas en verde |
| `npm run test:rules` (emulador real) | 51 en verde |

Tras la Ola 0: **0 errores, 90 avisos** (idéntico), **3 102 pruebas** en verde y
**58** de reglas. El presupuesto de avisos no subió ni un punto.

---

## 1. Cinco afirmaciones del documento que no resistieron la verificación

Se registran con su evidencia porque cambian el trabajo, no sólo el texto.

| # | El documento dice | Verificado en el código |
|---|---|---|
| **3** | «`Project` mantiene `artifacts: Artifact[]` en el agregado raíz» | **Ya estaba resuelto.** `toProjectDocument` (`services/firestoreService.ts`) es una lista blanca que nunca emite `artifacts`; `updateProject` hace `delete sanitizedUpdates.artifacts`; los artefactos viven en `projects/{id}/artifacts/{id}` con `artifactStorage:'subcollection-v1'`. `Project.artifacts` es un campo de vista en memoria. **El riesgo real era otro** y sí estaba abierto: el grafo de arquitectura y los paquetes de publicación viajaban dentro del documento de proyecto, sin guarda de tamaño. |
| **1** | «`api/ai.ts` sólo limita tasa» | Subestimado. Ya verificaba **ID token de Firebase RS256** contra JWKS y limitaba por `uid`. El hueco real era el *fail-open* del cliente. |
| **2** | «no hay saneador» | Existía `sanitizeGeneratedHtml`, pero cubría **1 de 20** sumideros. |
| **5** | «233 apariciones de `any`» | 233 es el conteo de la *palabra*. En **posición de tipo** son **72**, y 51 (71 %) están en 5 archivos. El backlog es mucho menor de lo que sugiere. |
| **6** | «el workflow ejecuta Vitest, no Playwright» | `e2e.yml` **sí corre en cada PR**. Los huecos reales: sin umbral de cobertura, `test:rules` nunca en CI, y las mitades autenticadas de 2 specs se saltan siempre porque `PLAYWRIGHT_AUTH_E2E` no se define. |

El documento también omite `services/diagramQualityService.ts` (1 357 líneas),
que es en realidad el **tercer** archivo más grande.

---

## Ola 0 — Contención · **completada**

### Punto 1 — Proxy de IA fail-closed · ✅

**Estado.** Implementado tras `VITE_AI_STRICT_PROXY`, **apagado por defecto**.
Con la variable sin definir el comportamiento es idéntico al anterior, bit a bit.

| Entrega | Archivo |
|---|---|
| Unión discriminada de resultados y la regla de decisión | `services/ai/aiProxyPolicy.ts` |
| Consentimiento BYOK (preferencia **y** clave guardada) | `services/ai/byokConsent.ts` |
| Composición, registro observable y excepción tipada | `services/ai/aiProxyEnforcement.ts` |
| Resultados detallados sin romper los llamadores existentes | `services/ai/aiProxyClient.ts` |
| Escáner de secretos en el bundle + paso en CI | `scripts/checkBundleSecrets.mjs`, `.github/workflows/ci.yml` |

**Criterio de cierre.** Con el flag activo, ningún fallo del proxy produce una
llamada directa al proveedor salvo BYOK consentido; el fallo es tipado,
recuperable y visible en el centro de observabilidad.

**Guarda.** `__tests__/services/ai/aiProxyPolicy.test.ts` recorre la matriz
completa flag × motivo × BYOK, con las negativas explícitas. El escáner falla el
build ante una clave con forma real.

**Nota de configuración.** `api/ai.ts` y `api/gemini.ts` dejaron de aceptar los
nombres con prefijo `VITE_`. Si un despliegue tenía `VITE_GEMINI_API_KEY` en
Vercel satisfaciendo al proxy, **debe** renombrarla a `GEMINI_API_KEY`: antes esa
configuración funcionaba *y* enviaba la clave a cada navegador.

### Punto 2 — Un solo renderer seguro · ✅

**Estado.** Los 17 sumideros sustituidos; queda exactamente uno en toda la
aplicación.

| Entrega | Archivo |
|---|---|
| Saneador único, DOMPurify, políticas separadas Markdown/SVG | `lib/richText/sanitizeHtml.ts` |
| Renderizar y sanear como un solo paso indivisible | `lib/richText/renderMarkdown.ts` |
| El único `dangerouslySetInnerHTML` | `components/ui/SafeRichText.tsx` |
| CSP y cabeceras (`Report-Only`) | `vercel.json` |

**Criterio de cierre.** Cero `dangerouslySetInnerHTML` fuera del componente
aprobado; suite negativa de payloads OWASP + mXSS; CSP desplegada.

**Guarda.** `__tests__/security/noRawHtmlSinks.test.ts` recorre el árbol
rastreado por git y falla si aparece el sumidero decimoctavo — o si alguien
vuelve a llamar a `marked.parse` dentro de un componente.

**Pendiente para promover la CSP a bloqueante:** hashear los scripts inline de
`index.html` y retirar `'unsafe-inline'` de `script-src`. Es ese cambio el que
da a la política la mayor parte de su valor.

### Punto 3 — Acotar el documento de proyecto · ✅

**Estado.** Reorientado al riesgo real, con la evidencia de por qué el enunciado
original ya estaba cerrado (§1).

| Entrega | Ruta / archivo |
|---|---|
| Grafo fuera del documento de proyecto | `projects/{id}/aggregates/architectureGraph` |
| Un documento por paquete de publicación | `projects/{id}/publications/{packageId}` |
| Guarda de tamaño que nombra el campo culpable | `lib/artifactPersistenceGuards.ts` |
| Tope al historial de chat, con digest determinista | `services/firestoreService.ts` |
| Reglas de las rutas nuevas | `firestore.rules` |

**Criterio de cierre.** El documento de proyecto no contiene ningún agregado de
crecimiento no acotado; superarse produce un error accionable que nombra el
campo; las reglas nuevas están cubiertas por el emulador.

**Guarda.** `__tests__/services/projectAggregateStorage.test.ts` (10),
`__tests__/services/chatHistoryCap.test.ts` (8),
`__tests__/lib/projectDocumentGuard.test.ts` (7) y 7 pruebas de emulador para las
rutas nuevas.

**Dos defectos encontrados de paso, ambos corregidos:** `toProjectDocument`
omitía `attention`, así que un proyecto creado con seguimiento de atención lo
perdía en silencio; y `saveChatHistory` reescribía `messages[]` entero sin tope
alguno — una segunda superficie sin límite que el documento no menciona.

---

## Ola 1 — Fundaciones · **completada**

### 1.1 — El N+1 de arranque · ✅

*(No estaba en el Top 10; resultó el punto de mayor valor de la ola.)*
`getAllProjects` descargaba el cuerpo de cada artefacto de cada proyecto antes
de renderizar una sola pantalla, para pantallas que sólo los cuentan y agrupan.

`projects/{id}/aggregates/artifactIndex` guarda identidad y versión a unos cien
bytes por artefacto, en la colección que una lectura de proyecto ya visita. El
grafo y los paquetes se cargan al abrir el proyecto. **Cierre:** el arranque no
lee ningún documento de artefacto.

**Guarda.** El índice registra el recuento que describía y sólo se acepta si
coincide con `artifactCount`; cualquier desfase carga los artefactos. Un índice
obsoleto cuesta una lectura lenta y nunca un número equivocado.
`__tests__/portfolioGraph/unhydratedProjects.test.ts` fija que el portafolio no
reporta cero con proyectos sin hidratar.

**Defecto encontrado:** `validateProject` reconstruye el proyecto con una lista
fija de campos y descartaba `artifactsLoaded` —toda la propiedad de seguridad—
antes de que nadie lo leyera.

### 1.2 — Cobertura, reglas y E2E como puertas de CI · ✅

- Cobertura con `include` explícito y umbrales medidos (62,18 / 53,69 / 54,45 /
  63,90), con mínimos más altos por ruta para autorización, renderizado seguro,
  política del proxy y guardas de persistencia. Verificado con control negativo.
- `test:rules` en job propio con Java y caché del emulador. **Cierra la deuda
  S-2.** `test:rules` ya no exige instalación global.
- E2E autenticado conectado a secretos: se activa solo cuando existan. Forzarlo
  con los placeholders actuales lo haría *fallar*, no ejecutarse.

**Hueco que queda abierto y declarado:** sin esos secretos, la puerta E2E sigue
siendo el smoke no autenticado. Y `services/userService.ts` (7 % de cobertura) y
`services/firestoreService.ts` (44 %) son los dos vacíos nominales de la Ola 2.

### 1.3 — Primer vertical del strangler · ✅

El monolito baja de 6.775 a 6.333 líneas: las diez funciones del LMS viven en
`services/ai/generation/learning/`. Se eligió por ser demostrablemente
autocontenido —cero llamadas internas, tres dependencias con equivalente
neutral—, no por parecer ordenado. La fachada no cambió de forma.

**Guarda.** `learningVertical.test.ts` falla si un método reaparece en el
monolito, si un módulo extraído importa el motor o un SDK, o si supera las 500
líneas.

### 1.4 — Presupuesto de `any` · ✅

58 en posición de tipo (no 233: esa es la cuenta de la *palabra*), ahora **39**.
`lib/errorMessage` y `lib/speechRecognition` sustituyen los atajos por tipos
reales. `scripts/countAnyTokens.mjs` fija el presupuesto monotónico en CI.

**Dos defectos propios corregidos antes de confiar en la puerta, ambos la hacían
pasar:** un pathspec con glob recursivo se saltaba todo archivo en la raíz de un
directorio (reportaba 19 donde había 58), y enumerar sólo archivos rastreados
dejaba pasar módulos nuevos enteros.

### 1.5 — `traceId` extremo a extremo · ✅

`lib/traceId` define el formato una vez para ambos lados del cable. El cliente
acuña y envía `x-arky-trace-id`, el proxy lo adopta tras validarlo, y el evento
de observabilidad lo lleva. La cabecera la escribe quien llama y termina en un
log: un valor con salto de línea falsifica entradas, así que se valida antes de
ecoarla.

Es la mitad del punto 7 que hay que hacer primero: enviar eventos sin
correlacionar a un backend remoto no resuelve el problema que el punto describe.
El adapter remoto queda para la Ola 2.

## Ola 2 — Escala y modificabilidad · **completada**

### 2.1 — `strict: true` (punto 5) · ✅ acotado y creciente

**El hallazgo que el documento no menciona: `@types/react` y `@types/react-dom`
no estaban instalados.** Una aplicación React 18 en TypeScript sin definiciones
de React: cada elemento JSX, cada hook y cada prop era `any` en silencio.
`components/ErrorBoundary.tsx` llevaba un `Component` casteado a mano con un
comentario que lo declaraba como condición del entorno. Eso explica también por
qué el conteo de `any` parecía bajo: los tipos no estaban ahí para violarlos.

Instalarlos destapó 34 errores, **varios defectos vivos**:

| Defecto | Efecto real |
|---|---|
| `LMSCatalog` nunca recibía `progress` | Ordenar el catálogo lanzaba |
| `markerEnd`/`markerStart` recibían objetos donde va `url(#id)` | Las puntas de flecha BPMN y bidireccionales **no se dibujaban** |
| `CanvasErrorBoundary` no declaraba `fallback` | `DiagramView` creía mostrar `ViewerCrashFallback`; salía el panel genérico |
| `title` en un icono SVG | No es atributo válido ni recurso de accesibilidad; sin nombre accesible |

`tsconfig.strict.json` aplica `strict` completo más cuatro flags que `strict` no
implica, a ocho módulos que ya lo sostienen. Activar `strict` en todo el
repositorio no es un cambio —`strictNullChecks` por sí solo sigue produciendo
miles de errores— y por eso el punto llevaba abierto. **Mueve la frontera en
lugar del flag**, y la lista sólo crece.

### 2.2 — Presupuestos de bundle (punto 8) · ✅

Medido **659,3 KB gzip** eager. La cifra que importa no es el total del build:
la mayor parte es carga perezosa. La puerta lee el conjunto eager del
`index.html` construido, así que sigue siendo exacta cuando cambia el troceado.

El recorte pendiente quedó cerrado el 2026-09-03: `vendor-graph` se separó en
`vendor-dagre` y `vendor-reactflow`, el único valor runtime de ReactFlow salió
del serializador de dominio y su CSS se movió junto al canvas perezoso. El
payload eager bajó de 661,5 a 580,3 KB gzip; el gate prohíbe que
`vendor-reactflow` vuelva al arranque.

### 2.3 — Monolitos y aislamiento de SDK (punto 9) · ✅ fronteras / acotada la descomposición

- **`services/authService.ts`**: Firebase Auth era la única violación de la
  regla que quedaba. No rompía ninguna regla de lint —`no-restricted-imports`
  nunca mencionó Firebase—, así que era una infracción de convención: la clase
  que sobrevive a las revisiones. Ahora es mecánica en dos capas.
- **`check:module-size`**: 49 techos medidos más un máximo de 500 líneas.
  CLAUDE.md pedía no hacer crecer estos archivos y nada lo comprobaba; así
  llegaron a 6.300 y 1.230 líneas. Ahora sólo pueden moverse hacia abajo.
- **Los 90 avisos de ESLint: 0.** Revisarlos uno a uno destapó cinco defectos
  reales —una descripción accesible que se quedaba con la etiqueta anterior,
  cuatro props muertas del canvas alimentadas por tres estados congelados del
  Workspace, un `agent` capturado obsoleto en el asistente, dos fallos de
  generación que se tragaban la causa, y un `/^[*⏱🔁]/` sin bandera `u` que
  hacía coincidir medias parejas suplentes—, además de dos `window.confirm()`
  sustituidos por `ConfirmDialog`. Ese es el argumento contra tolerarlos: un
  aviso deja de leerse en cuanto hay diez.
- **`ReactFlowCanvas`: 2.715 → 1.946 líneas.** Layout, escenas narrativas, zonas
  de grupo, leyenda y el pipeline de exportación salen a
  `components/reactFlowCanvas/`. La superficie pública no cambió —los cinco
  símbolos que importan tests y componentes hermanos se reexportan— así que 769
  líneas se movieron sin tocar un solo punto de llamada. 43 pruebas nuevas sobre
  código que antes sólo se podía ejercitar montando un canvas.
- **`diagramQualityService`: 1.357 → 569 líneas.** Tipos, conversión de canvas a
  IR, reglas de lint, ponderación y adaptadores de hallazgos pasan a
  `services/diagram/quality/`. Los símbolos que el resto del código importa se
  reexportan desde el módulo original.
- **`ArtifactCanvas`: 1.226 → 1.126 líneas.** Los comandos de storytelling y el
  despachador de acciones de sugerencia son ahora hooks con dependencias
  nombradas. Lo que se ve al nombrarlas es el punto: el despachador necesitaba
  un IR, un toast y cinco callbacks, y eso no era visible mientras leía
  `renderable.ir`, `diagram`, `project.id` y `artifact.id` del cierre.
- **`Workspace`: 1.217 → 745 líneas.** Las 489 líneas entre el clic en
  «Generar» y la escritura —generación, tres redes de respaldo determinista,
  quality gate, validación de render, refinamiento y la traza— salen a
  `services/artifacts/artifactGenerationRun.ts`,
  `artifactGenerationFallbacks.ts` y `artifactGenerationTrace.ts`. La regla dura
  del producto (**el canvas nunca se abre en blanco**) y la precedencia del
  estado de la traza (un *fallback* jamás puede leerse como `clean`) sólo se
  podían ejercitar montando un árbol de React sobre un proveedor de IA; ahora
  tienen 31 pruebas propias, y cada red se rompe por separado para comprobar
  que las otras no la tapan.

### 2.4 — Cadena de suministro (punto 10) · ✅

Once `.cjs` muertos y el árbol `app/` retirados, con `check:no-orphan-scripts`
para que la raíz no vuelva a acumularlos. Dependabot agrupado, CodeQL
`security-extended`, `npm audit` en alto/crítico (hoy: 0), SBOM por ejecución.
`package.json` pasa de `arky-5`/`0.0.0` a `arkypro`/`1.0.0`.

---

## Lo que queda abierto, declarado

Ninguno de estos se da por cerrado:

- **La descomposición de los monolitos de UI.** Los cuatro que el punto 9 dejó
  abiertos están hechos: `ReactFlowCanvas` 2.715 → 1.946
  (`components/reactFlowCanvas/`), `diagramQualityService` 1.357 → 569
  (`services/diagram/quality/`), `ArtifactCanvas` 1.226 → 1.126
  (`hooks/artifacts/`) y `Workspace` 1.217 → 745
  (`services/artifacts/artifactGeneration*`). Queda `AppContext` (830), que
  CLAUDE.md declara en su techo práctico y cuya división cambia el contrato en
  memoria del portafolio: es trabajo de diseño, no de extracción.
- **`strict` en todo el repositorio.** Ocho módulos dentro; el resto necesita
  que `strictNullChecks` se pague componente a componente.
- **El strangler de `geminiService`.** 6.333 líneas tras el primer vertical.
- **E2E autenticado.** Sin los secretos de Firebase la puerta sigue siendo el
  smoke no autenticado. iPad Safari no puede ejecutarse en este entorno.
- **Cobertura de `userService` (7 %) y `firestoreService` (44 %).**
- **La CSP en modo bloqueante**, que exige hashear los scripts inline.
- ~~**`vendor-graph` fuera del arranque.**~~ ✅ Resuelto 2026-09-03; ReactFlow queda detrás de `Workspace` y protegido por el gate de bundle.

---

## Puertas de calidad activas

| Puerta | Qué impide |
|---|---|
| `typecheck` + `typecheck:strict` | Regresión de tipos; frontera estricta que sólo crece |
| `lint` (0 errores **y 0 avisos**) | SDK en capas de UI; motor heredado fuera de `services/ai` |
| `check:any-budget` | Un `any` nuevo (39, monotónico) |
| `check:no-orphan-scripts` | Andamiaje en la raíz |
| `check:module-size` | Que un módulo grande crezca |
| `test:coverage` | Caída de cobertura, con mínimos por ruta |
| `test:rules` (emulador) | Divergencia entre `lib/authz` y `firestore.rules` |
| `check:bundle-secrets` | Una clave de proveedor en `dist/` |
| `check:bundle-budget` | Crecimiento del payload de arranque |
| `security.yml` | Avisos de dependencias y hallazgos de CodeQL |
| `noRawHtmlSinks` · `noSdkInUiLayers` · `learningVertical` · `strictBoundary` | Que las fronteras arquitectónicas se deshagan |

## Verificación

```bash
npm ci
npm run quality          # typecheck estricto + lint + presupuestos + 3.227 pruebas
npm run test:coverage    # los mismos tests, más los umbrales
npm run build && npm run check:bundle-secrets && npm run check:bundle-budget
npm run test:rules       # 59, requiere Java
npm run e2e              # Chromium + iPad Safari
```

Para el punto 1, además de la suite: con `VITE_AI_STRICT_PROXY` **sin definir**,
el comportamiento de IA debe ser idéntico al anterior; con `=true` y el proxy
caído, debe verse un error tipado y **cero** llamadas directas al SDK.
