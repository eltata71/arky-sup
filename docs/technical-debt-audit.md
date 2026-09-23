# Auditoría de deuda técnica — Arky 10 (`arkypro-1.0`)

> **Estado actual de la deuda del motor (23 sep 2026):** F5-01 continúa por
> cortes; en el corte 12, `services/geminiService.ts` baja a 1 923 líneas
> según el gate y ya sólo contiene la generación principal; en el corte 13
> deja de importar la Oficina (la persona llega por un puerto).
> `artifactGenerationService` sigue siendo su único importador dentro de
> `services/ai`. El riesgo pendiente es moverla sin introducir ciclos con
> Oficina, grafos o calidad. Ver
> [`f5-01-corte-13.md`](./ddd-transformacion/evidencias/f5-01-corte-13.md).

> **Revisión vigente (1 sep 2026):** el Top 10 de **monolito modular, DDD,
> deuda técnica y CI/CD** — con el grafo de dependencias medido, las duraciones
> reales del pipeline y la causa del paso de pruebas de 8 m 49 s — está en
> [`top-10-monolito-modular-ddd-2026-09-01.md`](./top-10-monolito-modular-ddd-2026-09-01.md).
> Sustituye al anterior como revisión abierta; el de agosto queda como historial
> de la consolidación de seguridad y calidad ya ejecutada.
>
> **Revisión anterior:** el Top 10 priorizado para consolidación técnica, con
> evidencia, criterios de cierre y hoja de ruta, está en
> [`top-10-consolidacion-tecnica-2026-08-30.md`](./top-10-consolidacion-tecnica-2026-08-30.md),
> y su plan de ejecución —con el estado de cada punto— en
> [`plan-consolidacion-tecnica-2026-08-30.md`](./plan-consolidacion-tecnica-2026-08-30.md).
> Este documento se conserva como historial de deuda cerrada y fases anteriores.
>
> **F9 retiró Firebase (19 sep 2026).** Este documento se conserva como
> historial y su vocabulario es el de la infraestructura anterior: `firestore.rules`,
> el emulador, los custom claims y el límite de 1 MiB por documento describen un
> backend que ya no existe. Lo que seguía anotado aquí como **pendiente** está
> reconciliado, entrada por entrada, en
> [§ Reconciliación con F9](#reconciliación-con-f9-19-sep-2026) al final del
> fichero. No se reescribe el historial: una auditoría que se edita para
> parecerse al presente deja de servir para saber qué se decidió y cuándo.

> **Rama de trabajo:** `claude/world-class-technical-debt-hardening-B7LCv`
> **Fecha:** mayo 2026
> **Alcance:** seguridad, persistencia, generación de artefactos, calidad
> de código, observabilidad, testing y CI/CD.

---

## 1. Resumen ejecutivo

La aplicación es funcionalmente rica pero acumulaba deuda técnica crítica
en seis frentes: (1) bypass de autenticación con escalamiento de
privilegios, (2) registro público que aceptaba roles privilegiados desde
el cliente, (3) consultas Firestore sin auth que devolvían toda la
colección de proyectos, (4) updates optimistas sin rollback que dejaban la
UI inconsistente cuando Firestore fallaba, (5) IDs basados en `Date.now()`
con riesgo de colisión y (6) cero capa de lint y TS strict desactivado.

El presente PR cierra los seis frentes con cambios pequeños, atómicos y
verificados (440 → **450 tests verdes**, 0 errores de typecheck, 0
errores de ESLint). La deuda remanente — refactor del `geminiService` de
5,150 líneas, migración de Tailwind CDN a build, subcolección de
artefactos, backend proxy para Gemini — queda explícitamente documentada
y priorizada para la siguiente fase.

| Métrica                  | Antes              | Después                          |
| ------------------------ | ------------------ | -------------------------------- |
| TypeScript strict flags  | 0 activos          | 5 activos (sin `strictNullChecks`) |
| ESLint                   | No configurado     | Flat config 9 con tiers          |
| Tests                    | 416                | **450**                          |
| Bypass `superadmin`      | Visible y libre    | Gated DEV + flag explícito       |
| `getAllProjects` sin auth | Devolvía todos     | Devuelve `[]` + warning observable |
| IDs                      | `Date.now()`       | UUID v4                          |
| Rollback optimistic      | Ausente            | Helper `persistArtifacts`        |
| Fallback localStorage para permission-denied | Sí (peligroso) | No (re-throw + observability) |
| Validación runtime de Firestore | No          | `validateProject` / `validateArtifact` |

---

## 2. Hallazgos por severidad

### 🟥 Críticos (resueltos)

| # | Hallazgo | Archivo(s) | Decisión |
| - | -------- | ---------- | -------- |
| C-1 | `signInAsDeveloper` otorgaba `superadmin` vía login anónimo y persistía el rol a Firestore. | `context/AuthContext.tsx:120` | Bypass requiere `import.meta.env.DEV && VITE_ENABLE_DEV_LOGIN==='true'`. El rol superadmin queda **efímero en memoria**; Firestore recibe sólo un perfil `student`. Producción: el botón se oculta y la función lanza error. |
| C-2 | `register(...)` aceptaba `role` desde el cliente, incluyendo `admin` y `superadmin`. | `context/AuthContext.tsx:186`, `pages/AuthPage.tsx:16` | ~~Sanitización en `lib/security`.~~ **Cerrado de raíz el 2026-08-30:** el registro público ya no existe. `register` se eliminó del contexto, `/auth` es solo acceso y recuperación, y las cuentas las crea un administrador (`services/userProvisioningService.ts`). `firestore.rules` rechaza que una identidad escriba su propio `users/{uid}`. |
| C-3 | `getAllProjects(undefined, undefined)` consultaba toda la colección `projects`. | `services/firestoreService.ts:52` | Nuevo guard: sin `userId` y sin admin devuelve `[]` y emite warning. Sólo admin puede pedir la colección completa. |
| C-4 | El fallback a localStorage enmascaraba `permission-denied` como "operación offline exitosa". | Todos los métodos de `firestoreService` | Nuevo `handleFirestoreError`: errores de seguridad se re-lanzan; sólo `unavailable`/`deadline-exceeded` permiten fallback con warning. |
| C-5 | Updates optimistas sin rollback dejaban estado UI desfasado cuando Firestore fallaba. | `context/AppContext.tsx` | Nuevo helper `persistArtifacts` captura snapshot previo y revierte. `addProject`, `updateProject`, `deleteProject` también incluyen rollback con observability. |

### 🟧 Altos (resueltos)

| # | Hallazgo | Decisión |
| - | -------- | -------- |
| H-1 | IDs basados en `Date.now()` (proj_*, art_*, course_*, mod_*, les_*) con riesgo de colisión en mismo tick. | Nueva utilidad `lib/ids.ts` con `crypto.randomUUID()` + fallback a `uuid` v4. |
| H-2 | Mock-user fallback en `signInAnonymously` enmascaraba Firebase mal configurado. | Eliminado. El error real se muestra al operador. |
| H-3 | `isFirstUser` → `superadmin` automático sin auditoría. | **Eliminado el 2026-08-30.** Sin registro público el arranque no tenía camino de ejecución, y una vía de escalada latente sigue siendo una vía de escalada. `VITE_ALLOW_FIRST_USER_SUPERADMIN` desapareció; el primer administrador se siembra una vez con clics en la consola de Firebase — guía no técnica en `docs/primer-administrador.md`. |
| H-4 | Sin control de concurrencia en `updateProjectArtifacts`. | Nuevo parámetro opcional `expectedUpdatedAt` + retorno `{ updatedAt, conflict? }`. La UI puede detectar conflictos y avisar al usuario. |
| H-5 | TS sin `strict`, sin lint real (`npm run lint` era `tsc --noEmit`). | Activadas `noImplicitThis`, `noFallthroughCasesInSwitch`, `alwaysStrict`, `useUnknownInCatchVariables`, `forceConsistentCasingInFileNames`. ESLint 9 flat config con tiers. |
| H-6 | Reads de Firestore confiaban ciegamente en el shape devuelto. | `lib/runtimeValidation` valida `Project`/`Artifact`; documentos corruptos se descartan con warning observable. |

### 🟨 Medios (parcialmente resueltos / documentados)

| # | Hallazgo | Estado | Plan |
| - | -------- | ------ | ---- |
| M-1 | `services/geminiService.ts` con 5,150 líneas concentra prompts, retry logic, fallback de diagrama, error mapper, etc. | **No refactorizado** | Dividir en `aiClient`, `artifactGenerationService`, `diagramGenerationService`, `diagramFallbackService`, `geminiErrorMapper`, `promptBuilders`, `generationTraceService`. Es el siguiente PR mayor — no se acometió aquí por riesgo de regresión sin contrato de tipos completo. |
| M-2 | Tailwind cargado por CDN con configuración inline en `index.html` (576 líneas). | **RESUELTO (2026-08-25)** | Migrado a build-time: `tailwind.config.cjs` + `postcss.config.cjs` + `src/index.css` (importado en `index.tsx`). Eliminados el `<script>` CDN y el config inline del `index.html`; el `<style>` con CSS crítico (design tokens, resilience, print) se conservó. Verificación: build PASS, smoke E2E 4/4, `tsc` exit 0, QA visual OK. |
| M-3 | Artefactos persistidos como array dentro del documento del proyecto. | **Mitigado parcialmente** (control de concurrencia y validación). Migración a subcolección `projects/{id}/artifacts/{id}` pendiente. | Cambio de schema requiere migración de datos existentes con compatibilidad backward. |
| M-4 | `Workspace.tsx` con 921 líneas asume demasiadas responsabilidades. | **No refactorizado** | Extraer hooks: `useArtifactGeneration`, `useArtifactPersistence`, `useArtifactDeepLink`, `useGenerationTrace`, `useArtifactConflictResolution`. |
| M-5 | API key Gemini expuesta al navegador (modelo frontend-only). | **Documentado**, sin migrar a proxy backend. | Ver `docs/security-hardening.md`. |
| M-6 | `strictNullChecks` y `noImplicitAny` desactivados. | **Pendiente** — necesario el split de `geminiService` primero. | Habilitar incrementalmente por carpeta. |
| M-7 | Botón "Revisión guiada" dispara `guidedReviewSoon` (placeholder). | **Pendiente** — implementar o esconder hasta que esté listo. | Una de las funcionalidades "soon" pendientes. |

### 🟦 Bajos (informados)

| # | Hallazgo | Estado |
| - | -------- | ------ |
| L-1 | `package.json.name === "arky-5"` (histórico). | Sin cambio (ningún consumidor lo usa). |
| L-2 | 104 warnings de ESLint pre-existentes (unused vars, `confirm()` en danger zone, escapes redundantes). | Documentados como deuda; no rompen CI. |
| L-3 | Sin Prettier configurado. | Pendiente: integrar `prettier` + script `format`. |
| L-4 | Scripts `.cjs` legacy (`createLMSComponents.cjs` (eliminado), `updateGemini.cjs` (eliminado), etc.) sin mantenimiento. | Excluidos de lint/TypeScript. Recomendado eliminar en limpieza futura. |

---

## 3. Decisiones aplicadas (resumen técnico)

### 3.1 Centralización en `lib/`

- `lib/security.ts` — único lugar donde se decide si un rol es válido,
  si el bypass dev está permitido, si el bootstrap superadmin está
  permitido. Toda la app llama a estos helpers.
- `lib/ids.ts` — generación uniforme de identificadores con UUID v4.
- `lib/runtimeValidation.ts` — validación de shape de Firestore reads.

### 3.2 `services/firestoreService.ts`

- Clasificador `isSecurityError` / `isOfflineError`.
- `handleFirestoreError(operation, error)`: re-lanza errores de seguridad,
  permite fallback offline con observability.
- `getAllProjects` rechaza llamadas sin `userId`/admin.
- `updateProjectArtifacts` acepta `expectedUpdatedAt` y reporta
  `conflict` en lugar de sobrescribir.

### 3.3 `context/AppContext.tsx`

- Helper `persistArtifacts(projectId, next, previous, op)` con rollback.
- Snapshot en `updateProject`/`deleteProject` con rollback en error.
- `addProject` revierte el insert local si Firestore rechaza.

### 3.4 Calidad

- `tsconfig.json`: `noImplicitThis`, `noFallthroughCasesInSwitch`,
  `alwaysStrict`, `useUnknownInCatchVariables`,
  `forceConsistentCasingInFileNames`.
- `eslint.config.js` (flat config 9): security/correctness rules a
  `error`; quality rules a `warn`. `lib/security.ts` y `lib/ids.ts` con
  reglas estrictas.
- `package.json`: scripts `typecheck`, `lint`, `lint:fix`, `quality`.

### 3.5 Tests añadidos

- `__tests__/lib/security.test.ts` — 12 tests
- `__tests__/lib/ids.test.ts` — 6 tests
- `__tests__/lib/runtimeValidation.test.ts` — 10 tests
- `__tests__/services/firestoreServiceGuards.test.ts` — 6 tests

---

## 4. Deuda remanente y plan de continuación

| Prioridad | Trabajo | Justificación |
| --------- | ------- | ------------- |
| Alta | Reglas Firebase Security Rules + Custom Claims que **rechazen** writes a `users/{uid}/role` desde sesiones no admin. | El frontend ya filtra; sin rules el filtro es bypasseable con un cliente custom. Ver `docs/security-hardening.md`. |
| Alta | Backend proxy o serverless function para Gemini. | La API key sigue expuesta al navegador. |
| Alta | Split de `services/geminiService.ts` (5,150 líneas). | Bloquea testing fino, `strict: true` y co-ubicación de prompts. |
| Media | Migrar Tailwind CDN → build-time + `tailwind.config.ts`. | Performance, CSP, mantenibilidad. |
| Media | Sub-colección `projects/{id}/artifacts/{id}` con compatibilidad backward. | Resuelve límite de tamaño de documento y concurrencia fina. |
| Media | Implementar `guidedReviewSoon` o esconder el flujo hasta que exista. | Evita prometer capacidades inexistentes. |
| Baja | `strictNullChecks` y `noImplicitAny` por carpeta. | Una vez splittado `geminiService`. |
| Baja | Prettier + script `format`. | Calidad visual de diffs. |
| Baja | Eliminar `*.cjs` legacy si ya no se usan. | Limpieza. |

### Hotfix posterior — Vercel ERESOLVE (resuelto)

Tras fusionar a `main`, el deploy de Vercel falló con
`npm error ERESOLVE` porque `@eslint/js@^10.0.1` (latest) requiere
`eslint@^10` mientras el proyecto usa `eslint@^9.39.4`. Localmente el
problema estaba enmascarado por `npm install --legacy-peer-deps`.

Corregido en commit `claude/fix-vercel-deploy-eresolve`:

- Pin `@eslint/js` a `^9.39.0` para alinear con la major de `eslint`.
- `.npmrc` con `legacy-peer-deps=true` como red de seguridad para futuros
  conflictos transitivos (Vercel y `npm ci` lo respetan automáticamente).
- `package-lock.json` regenerado limpio (sin flags).
- GitHub Actions ya no necesita `--legacy-peer-deps` explícito.

**Lección aprendida:** validar `npm install` *sin* `--legacy-peer-deps`
**y** `npm run build` con vars de producción **antes** del merge a
`main`. Idealmente añadir el job de Vercel al checklist de PR.

---

## 5. Cómo validar este PR localmente

```bash
npm install
npm run typecheck   # 0 errores
npm run lint        # 0 errores (104 warnings pre-existentes)
npm run test:ci     # 450 tests verdes
npm run quality     # corre los tres en cadena
npm run build       # vite build (validación final)
```

---

## 6. Motor de Compilación de Artefactos (fase posterior)

Se incorporó el **Artifact Compilation & Review Engine**
(`services/artifactCompiler/`) como etapa formal entre la
generación/normalización y la persistencia. Ver `docs/artifact-compiler.md`.

**Deuda cerrada:**

- Validación documental y SDD superficial → validadores estrictos por
  contrato para las 13 familias documentales/SDD.
- Ausencia de un contrato formal por tipo de artefacto → 16 contratos
  registrados (`markdown`, `hybrid-text-diagram`, `presentation-*`,
  `sdd-*`, `mermaid-*`, `react-flow-graph`, `yaml`).
- Score fragmentado entre documento/diagrama/exportación → score unificado
  de compilación con 10 dimensiones y ladder de tiers fijo.
- Falta de gobierno previo a la persistencia → `attachCompilerSummary`
  observe-only en `createArtifact` / `createArtifactVersion`, sin romper
  el rollback optimista.
- Trazabilidad de compilación inexistente → `ArtifactCompilationTrace` y
  bloque persistible `Artifact.compilation` (aditivo, retro-compatible).

**Deuda remanente:**

- Auto-reparación dentro del flujo de persistencia (requiere UX de revisión
  previa); el motor ya soporta `applyRepairs: true`.
- Integración del compilador dentro de `geminiService` para corrección
  iterativa pre-persistencia, sin refactor masivo del servicio.
- Extender la UI del compilador más allá de `GenerationTracePanel`
  (`ArtifactQualityPanel`, `ArtifactInspectorPanel`, `ArtifactExportModal`).

---

*Última actualización: rama `claude/world-class-technical-debt-hardening-B7LCv`.*
*Motor de compilación: rama `claude/artifact-compiler-engine-iGBLH`.*

---

## Fase 2 — Architecture Knowledge Graph + Consistencia y Trazabilidad

**Problemas atacados:**

- Artefactos aislados sin fuente canónica de conocimiento → módulo
  `services/architectureKnowledgeGraph/` con grafo tipado y persistible
  (`Project.architectureKnowledgeGraph`, aditivo y retro-compatible).
- Imposibilidad de detectar inconsistencias entre artefactos → motor de
  consistencia con 18 detecciones y veredicto `clean/warning/blocked`.
- Falta de trazabilidad bidireccional → motor de trazabilidad
  (requerimientos ↔ pruebas ↔ artefactos, riesgos ↔ mitigaciones, …) y
  análisis de impacto sobre el grafo.
- Generación sin conocimiento compartido → `ArchitectureGraphPromptContextBuilder`
  que complementa `projectContext`/`keyConcepts` sin romper prompts actuales.

**Deuda remanente:**

- Extracción 100% determinística (alta precisión, recall moderado); un
  extractor asistido por IA elevaría la cobertura semántica.
- Persistencia en el documento de proyecto (límite 1 MB de Firestore); el
  `ArchitectureGraphPersistenceAdapter` ya prevé la migración a subcolección.
- Inyección automática del contexto del grafo dentro de `geminiService`
  (hoy disponible como API opt-in para evitar refactor masivo del servicio).
- Auto-corrección de inconsistencias `autoFixable` (requiere UX de revisión).
- Naming canónico de entidades extraídas de frases libres.


---

## Pipeline de Publicación Profesional (tercera recomendación)

**Brechas cerradas:**

- Artefactos sin camino a entregable publicable → módulo
  `services/publicationPipeline/` con perfiles, paquetes, preflight de 27
  verificaciones, readiness, manifiesto y reporte.
- Sin gobierno de publicación → flujo de aprobación
  (`draft → ready-for-review → approved → published`) con reglas duras y
  auditoría append-only.
- Sin validación de accesibilidad de entregables → `PublicationAccessibilityService`.
- Sin versionado de entregables ni detección de drift → `PublicationVersionService`
  (`current/stale/outdated`).
- Persistencia aditiva en `Project.publicationPackages` con validación runtime.

**Deuda remanente:**

- Exportación consolidada (ZIP maestro, DOCX/PDF maestro único) pendiente; hoy
  la exportación es individual coordinada + manifiesto + reporte. La base
  extensible ya existe (`PublicationExportJob`, `runPublicationExportBatch`).
- Plantillas editoriales sin layout corporativo configurable por organización.
- Branding mínimo (sin editor de marca corporativa).
- Aprobación de un solo nivel: faltan flujos multi-aprobador y firma digital
  formal con evidencia criptográfica.
- Persistencia en el documento de proyecto (límite 1 MB de Firestore); el
  `PublicationPersistenceAdapter` ya prevé la migración a subcolección.
- Colaboración multiusuario avanzada sobre paquetes (revisión concurrente).

---

## Oficina de Arquitectura Empresarial (2026-08-26)

**Brechas cerradas:**

- Personas decorativas → `producesArtifactTypes`, `reviewsArtifactTypes`,
  `standardIds` y `maxConcurrentTasks` hacen que `generate` y `validate` sean
  datos que el router consulta, no texto de prompt. Trece personas, incluidas
  tres de dominio asegurador (core insurance, datos/actuarial, cumplimiento).
- Orquestación que solo devolvía texto → motor de encargos con charter, DAG,
  asignación real, revisión cruzada y consolidación, que **produce artefactos**
  a través de `executeAgentAction`.
- Sin cola de trabajo, asignación, SLA ni handoff → `OfficeTask` con
  `assigneeId`, `reviewerId`, `dependsOn`, `dueAt`, `attempts`/`maxAttempts`.
- Orquestación efímera → subcolección `projects/{id}/engagements/{id}` con
  persistencia por transición y reanudación tras recarga.
- Sin separación de funciones → la decisión del comité exige claim admin en
  cliente **y** en `firestore.rules`; `arbDecisions` es inmutable
  (`allow update: if false`).
- `compliance-check` permanentemente `conditional` → cobertura por dimensión
  con evidencia por artefacto.
- Dos pilas de gobernanza incomunicadas → `officePublicationBridge` traduce los
  gates de la Oficina a hallazgos de preflight de publicación.
- `agent_actions` sin regla Firestore (toda escritura remota fallaba) y sin
  ningún lector → regla añadida y bitácora de la Oficina que la consume.

**Defectos corregidos de paso:**

- `resolveOfficeAgentMention` devolvía la primera persona en orden de registro,
  no la primera mencionada: `"@Lucía coordina con @Felipe"` resolvía a Felipe.
- El invoker prefijaba `@Alias` al prompt y el brief de coordinación se
  concatenaba en cada workstream, así que un `@Alias` dentro del brief
  secuestraba la persona del especialista.
- `planOfficeWorkstreams` usaba `crypto.randomUUID()`, que lanza fuera de
  contexto seguro.
- `HomePage.handleChatComplete` fabricaba su propio id de proyecto mientras
  `addProject` acuña el suyo: "crear proyecto" desde el dashboard navegaba a un
  proyecto inexistente y descartaba los artefactos iniciales.
- La señal `cloud` del router se activaba con "Health Cloud" y "Financial
  Services Cloud" (productos de Salesforce) y asignaba ese trabajo al arquitecto
  AWS.

**Deuda cerrada en el mismo cambio (segunda pasada):**

- *Validadores por subcadena.* `officeArtifactValidators.ts` juzgaba documentos
  por prosa: `content.includes('paths:')` acierta dentro de una descripción, un
  comentario o un ejemplo. Ahora:
  - `yamlStructure.ts` lee el árbol de indentación, así que las preguntas son
    estructurales (¿es clave raíz?, ¿existe la ruta?, ¿tiene entradas?). No es
    un parser YAML y el módulo lo dice: no desciende a estilo flow anidado, ni
    anclas, ni alias, ni multi-documento. Lo que no puede leer no resuelve, así
    que degrada a "no declarado" y nunca a un falso aprobado. Se evaluó
    `js-yaml` y se descartó: no es dependencia declarada del proyecto y meterla
    al bundle para cuatro preguntas estructurales es mal negocio.
  - `openapi`/`asyncapi` validan versión, `info.title`, `info.version` y una
    colección de rutas/canales **no vacía**. Su `applies` exige la clave raíz,
    así que un documento que solo menciona la palabra deja de tratarse como
    contrato.
  - ADR lee encabezados markdown reales, acepta español e inglés y cualquier
    nivel, ignora los que viven dentro de un bloque de código, y detecta un ADR
    renombrado por su estructura.
  - `c4` exige que el dialecto abra una línea, que es como Mermaid lo lee.
  - `renderable-diagram` usa la extracción Mermaid real y el parseo JSON de
    ReactFlow, así que "renderizable" significa que un renderer puede
    consumirlo, no que la cadena no esté vacía.
  - **Endurecimiento deliberado:** un contrato con `paths: {}` ya no pasa. Un
    entregable de API sin operaciones no es un contrato; antes pasaba solo por
    la coincidencia de subcadena. Hay test explícito de ambos lados.
- *Revisión sin guardas.* `services/review/reviewTransitions.ts` declara la
  tabla de transiciones y `artifactReviewService.recordDecision` la aplica en
  el punto único por el que pasa toda la UI. Aprobar o rechazar exige que el
  artefacto esté en revisión; todo estado terminal puede volver a `draft`.
  `previousStatus` se resuelve del log en vez de confiarse del llamador — que
  es justo como un log se desincroniza de la realidad. `ReviewPanel` ofrece
  solo movimientos legales y explica el motivo si el log cambió por debajo.

**Corrección de una afirmación previa de esta auditoría.** Se registró que
`ArtifactCanvas.tsx:784` escribía `reviewStatus` saltándose `recordDecision`.
Leído el código: `ReviewPanel` llama `recordDecision` y **después**
`onStatusChange`, que es lo que llega al canvas. El canvas espeja la decisión,
no la evita. El defecto real era la ausencia de guardas, ya cerrado arriba.

**Deuda remanente:**

- El ejecutor corre en el cliente: el encargo no avanza con la pestaña cerrada.
  Resolverlo exige un ejecutor de servidor, hoy excluido por `CLAUDE.md`
  (`api/` es solo proxy sin lógica de dominio). Es el techo real de la
  automatización, y es una decisión de producto, no un descuido.
- Los paquetes de publicación siguen sin reglas Firestore propias — viven en el
  documento del proyecto, así que `PublicationApprovalService` sigue siendo
  gobernanza solo de cliente. El ARB de la Oficina sí está respaldado por
  reglas. **Se evaluó migrarlos a subcolección y se descartó para este
  cambio:** toca 9 archivos de producción de un subsistema ajeno a este
  trabajo y exige migrar datos ya persistidos dentro de los documentos de
  proyecto. Merece su propio cambio, con su propia migración de lectura y sus
  pruebas; bundlearlo aquí volvería el conjunto irrevisable y arriesgaría una
  funcionalidad en uso. El seam ya existe
  (`PublicationPersistenceAdapter.getPublicationSubcollectionPath`).
- Los validadores restantes (`threat-model`, `cost-model`, `software-design`,
  `manifest`, `erd`) siguen siendo heurísticos de palabra clave sobre el
  contenido. Son advertencias útiles, no verificaciones; endurecerlos requiere
  un modelo de secciones por tipo de artefacto, que es trabajo de los contratos
  de `artifactCompiler`, no de estos validadores.
- El presupuesto del encargo cuenta llamadas de IA, no tokens ni coste: el
  proveedor no expone el consumo por la ruta de chat que usa la Oficina.
- El desempate por LLM del router está diseñado pero no implementado: hoy el
  routing es enteramente determinista, lo cual es preferible por defecto
  (reproducible y testeable).


---

## Actualización 2026-08-30 — D-4 cerrado: autenticación, autorización y roles

**D-4 no era "las reglas están mal".** Era que las reglas y la UI sostenían cada
una una idea coherente y *distinta* de quién es administrador —las reglas leían
`request.auth.token.role`, un custom claim que nada en el código sembraba jamás;
la UI leía el documento `users/{uid}`— y nada las comparaba. 32 cláusulas
permanentemente falsas mientras la interfaz ofrecía funciones que el servidor
rechazaba.

| Entrega | Qué cambió |
| --- | --- |
| **S0** | `lib/authz/permissions.ts`: seis roles, 18 permisos, una matriz. 131 pruebas que la transcriben independientemente, con énfasis en las negativas — «revisor aprueba» es la funcionalidad; «arquitecto no aprueba» es la separación de funciones, y es la que un refactor rompe en silencio. |
| **S1** | `resolveEffectiveRole` enuncia una vez la precedencia claim/documento, y `callerRole()` en `firestore.rules` la refleja. Un claim presente pero ilegible resuelve a *ningún rol*, no al documento. |
| **S2/S3** | Registro público eliminado; alta por administrador con app secundaria de Firebase, secreto de un solo uso que nadie ve e invitación por correo. |
| **S4** | `AccountPanel`: contraseña (con reautenticación), recuperación y nombre. El rol se muestra y no se ofrece. |
| **S5** | 15 comparaciones de cadena de rol convertidas a `can(...)`. Dos discrepancias reales encontradas por el camino: la analítica de formación excluía a `reviewer` por construcción, y la puerta del ARB excluía al único rol cuyo propósito es gobernar. `lib/security.ts` tenía un segundo modelo de roles completo; purgado. |
| **S6** | `firestore.rules` reescrito. 51 pruebas contra el emulador real (`npm run test:rules`) más un test que compara la matriz de las reglas con la del cliente celda por celda. |

### Hallazgos colaterales, todos corregidos

- Cualquiera podía **editar y eliminar cualquier curso** desde el menú del panel
  de formación. Ahora `canManageCourse` separa el curso propio (generado en el
  AI Lab) del currículo compartido (`training:author`).
- Estar autenticado bastaba para **crear proyectos e iniciativas**; un `viewer`
  los creaba. Ahora exige permiso de escritura, en la UI y en las reglas.
- Un `reviewer` que no era dueño del proyecto **no podía firmar la entrega**, que
  es exactamente el caso para el que existe la separación de funciones. Lo
  encontró la suite del emulador, no la lectura del archivo.
- Un administrador podía **degradar a un superadmin**, sorteando así la regla de
  que no puede acuñar administradores.

### Deuda que esto deja anotada

| # | Hallazgo | Estado |
| - | -------- | ------ |
| S-1 | Los perfiles heredados (`student`, `teacher`) se migran en memoria en cada lectura. Funciona indefinidamente, pero el vocabulario viejo sigue en la base. | **Aceptado.** Una migración de datos es un cambio con riesgo propio; conviene hacerla cuando haya una ventana de mantenimiento, reasignando roles desde `/users`. |
| S-2 | `npm run test:rules` no corre en CI porque requiere Java y el emulador. | **Pendiente.** Añadir un job aparte en `.github/workflows/ci.yml` con `actions/setup-java`. |
| S-3 | El comité (`reviewer`) lee todo el portafolio. Es intencional —no se puede gobernar lo que no se puede leer— pero es un ensanchamiento real frente al modelo anterior de solo-propietario. | **Documentado** en `docs/security-hardening.md` §3.1. |
| S-4 | Eliminar una cuenta borra el documento `users/{uid}` pero no la identidad de Firebase Auth, que sigue pudiendo autenticarse (y ahora se cierra sesión al no encontrar perfil). | **Aceptado**: el efecto es correcto, pero conviene una función server-side que borre también la identidad. |

---

## Reconciliación con F9 (19 sep 2026)

F9 sustituyó Firebase por Supabase: identidad en Supabase Auth, datos en
PostgreSQL con RLS deny-by-default y RPC `SECURITY DEFINER`, y archivos en
Storage privado. Un cambio de proveedor cierra algunas deudas y **no cierra
otras**, y confundir las dos es la forma habitual de perder una: esta tabla
recorre lo que este fichero seguía presentando como abierto.

| Entrada | Estado tras F9 |
| --- | --- |
| **S-1** — perfiles heredados (`student`, `teacher`) migrados en memoria en cada lectura | **Sigue abierta, sin cambios.** `parseAuthRole` los traduce al leer y los rechaza al escribir; el vocabulario viejo sigue en los datos. La migración continúa siendo un cambio con riesgo propio, y ahora se haría con una migración SQL sobre `api.user_profiles`. |
| **S-2** — `npm run test:rules` no corre en CI porque requiere Java y el emulador | **Cerrada, y por eliminación de la causa.** No hay reglas de Firestore, ni emulador, ni script `test:rules`. Su equivalente son los contratos pgTAP de `supabase/tests/database/`, que corren contra una base real en el trabajo `database` de `.github/workflows/supabase.yml` — sin Java y sin emulador. La diferencia que importa: aquellas pruebas leían un fichero de reglas; éstas ejercitan las políticas que el motor aplica de verdad. |
| **S-3** — el comité (`reviewer`) lee todo el portafolio | **Sigue abierta y sigue siendo intencional.** Ahora está escrita en dos sitios que se comparan solos: `lib/authz/permissions.ts` y `private.role_permissions`, celda por celda, en `__tests__/authz/sqlMatrixParity.test.ts`. |
| **S-4** — borrar una cuenta deja viva la identidad del proveedor | **Sigue abierta, con el mismo efecto y otro proveedor.** `api.delete_user_profile` borra el perfil; la fila de `auth.users` permanece, así que esa identidad puede seguir autenticándose y vuelve a `/auth` al no encontrar perfil. El efecto visible es correcto —no entra— y el residuo no: cerrarla pide una Edge Function con clave de servicio, que es el mismo sitio donde ya vive `provision-user`. |
| **§4 · «Reglas Firebase Security Rules + Custom Claims que rechacen writes a `users/{uid}/role`»** | **Cerrada de raíz.** Ya no hay ninguna escritura directa a una tabla: los privilegios están revocados sobre todas ellas y lo único ejecutable por `authenticated` son las RPC de `api`, que comprueban permiso y sesión viva antes de tocar nada. El rol lo resuelve `private.current_role()` desde la fila del perfil activo, así que la doble fuente que causó D-4 —un claim que nada sembraba frente a un documento— no tiene dónde reaparecer. |
| **§4 · «Backend proxy o serverless function para Gemini»** | **Cerrada.** `api/ai.ts` y `api/gemini.ts`, apátridas y sin lógica de dominio. |
| **§4 · «Sub-colección `projects/{id}/artifacts/{id}`»** y las dos notas sobre el **límite de 1 MiB por documento** | **Cerradas por el cambio de motor.** Los artefactos son filas de `api.project_artifacts` y el agregado se guarda en una transacción. Con ellas se fue la poda silenciosa del plan de maquetación y de la traza de generación, que era pérdida de datos que sólo se descubría al abrir un diagrama vacío. |
| **§4 · «Migrar Tailwind CDN → build-time»** | **Cerrada** antes de F9; el CDN no vuelve y el humo E2E lo comprueba. |

Lo que F9 **no** cerró y no pretendía cerrar: el tamaño de
`services/geminiService.ts`, `strict` por carpeta y la ausencia de Prettier
siguen donde estaban. Las tres son deuda de código, y un cambio de proveedor no
toca ninguna.

## Aviso de build observado durante F4-01 (22 sep 2026)

Vite/Rollup advierte que `artifactGenerationService` se reexporta por
`services/ai/index.ts` mientras ambos terminan en chunks que dependen entre sí.
El build y `check:bundle-budget` pasan (308,6/340,0 KB gzip eager), pero Rollup
avisa de un posible orden de ejecución roto. Revisar las importaciones del
barril en el trabajo de fronteras/IA; F4-01 sólo midió Proyecto–Artefacto y no
modificó ese módulo. Salida y comandos: `docs/ddd-transformacion/evidencias/f4-01-proyecto-artefacto.md`.
