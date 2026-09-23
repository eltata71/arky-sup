# AGENTS.md — Arky 10 (Codex/Koder + Claude Code)

Este archivo define cómo deben operar los agentes de **OpenAI Codex/Koder** en este repositorio y cómo reutilizar la configuración ya existente de Claude Code sin duplicar lógica.

---

## Objetivo

Garantizar que el mismo set de capacidades (agentes especializados + skills) funcione de forma consistente cuando el mantenimiento/desarrollo se realiza desde:

- Claude Code
- OpenAI Codex/Koder

---

## Fuentes de verdad de capacidades AI

### 1) Agentes especializados (source of truth)

- Definición: `.claude/settings.json`
- Contenido: lista de agentes con `name`, `description` y `prompt`.

Agentes disponibles actualmente:

1. `code-reviewer`
2. `architect`
3. `debugger`
4. `tech-lead`
5. `test-author`
6. `gemini-prompt-engineer`
7. `lms-curator`

### 2) Skills de proyecto (source of truth)

- Carpeta: `.claude/skills/`
- Archivos markdown por skill (slash-command style).

Skills disponibles actualmente:

- `architecture`
- `code-review`
- `debug`
- `deploy-checklist`
- `documentation`
- `incident-response`
- `standup`
- `system-design`
- `tech-debt`
- `testing-strategy`
- `add-artifact-type`
- `write-test`
- `add-lms-course`
- `refresh-claude-md`

---

## Política de activación para Codex/Koder

Cuando una tarea coincida con uno de estos dominios, Codex/Koder debe activar el recurso equivalente:

1. **Activación por intención explícita**
   - Si el usuario menciona explícitamente un agente o skill, priorizar ese recurso.

2. **Activación por intención implícita**
   - Si el objetivo de la tarea coincide con la descripción de un agente/skill, usarlo aunque no haya sido mencionado por nombre.

3. **Mínimo conjunto efectivo**
   - Activar solo el subconjunto mínimo de agentes/skills necesario para completar la tarea.

4. **Orden recomendado de ejecución**
   - Diseño/plan: `tech-lead` / `system-design`
   - Implementación: agente de dominio (`gemini-prompt-engineer`, `lms-curator`, etc.)
   - Validación: `test-author` / `testing-strategy`
   - Cierre de calidad: `code-reviewer` / `code-review`

---

## Matriz de enrutamiento (intención → agente/skill)

| Tipo de solicitud | Agente recomendado | Skill recomendado |
|---|---|---|
| Diseño arquitectónico | `architect` | `architecture` / `system-design` |
| Plan de implementación | `tech-lead` | `system-design` |
| Bug o incidente | `debugger` | `debug` / `incident-response` |
| Revisión de cambios | `code-reviewer` | `code-review` |
| Estrategia o creación de tests | `test-author` | `testing-strategy` / `write-test` |
| Cambios en prompts Gemini | `gemini-prompt-engineer` | `documentation` (si requiere documentar) |
| Cursos/LMS | `lms-curator` | `add-lms-course` |
| Nuevo tipo de artefacto | `tech-lead` + `gemini-prompt-engineer` | `add-artifact-type` |
| Checklist de despliegue | `tech-lead` | `deploy-checklist` |
| Actualizar documentación interna | `code-reviewer` | `documentation` / `refresh-claude-md` |
| Oficina de Arquitectura (encargos, personas, orquestación, ARB) | `architect` + `tech-lead` | `architecture` / `system-design` |

---

## Oficina de Arquitectura Empresarial

`services/architectureOffice/` es el motor de **encargos**: recibe una necesidad
de negocio, propone un charter con entregables, asigna cada uno a una persona
especialista con un revisor distinto, ejecuta el DAG con reintentos acotados,
evalúa quality gates con evidencia y lo lleva a un comité humano (ARB).

Contrato técnico completo: **`docs/oficina-arquitectura.md`**. Léelo antes de
tocar el planificador, el ejecutor o la gobernanza. La guía de uso para el
arquitecto está en **`docs/guia-oficina-arquitectura.md`**, y la alineación con
los principios de Anthropic para construir agentes —qué patrón se usa para qué,
con qué topes y con qué guardarraíles— en
**`docs/agentes-anthropic-alineacion.md`**.

Reglas que no se negocian al trabajar aquí:

1. **La Oficina orquesta, no reimplementa.** La producción de artefactos pasa
   por `executeAgentAction` (`services/agent/agentExecutor.ts`), nunca por una
   segunda ruta de generación.
2. El refinamiento de IA del charter **debe** superar `validateCharter` y la
   detección de ciclos; si no, se descarta entero y queda el plan determinista.
3. Productor y revisor de un entregable son **siempre** personas distintas.
4. La evidencia determinista (validadores + compilador) manda sobre el veredicto
   del modelo: un validador bloqueante es `changes-requested`.
5. El ejecutor no importa React ni ningún SDK; todo entra por puertos inyectados.
6. Un encargo llega a `delivered` solo vía `decideEngagement`, y esa transición
   exige el permiso `arb:decide` en cliente **y** en la RPC — no
   propiedad del proyecto: el que aprueba no es el autor.
7. **La ficha de un agente configura, no gobierna.** `officeAgentProfile.ts`
   deja cambiar nombre, avatar, habilidades, conocimiento, memoria, modelo y
   carga; **no** deja tocar qué produce, qué revisa ni su papel en la
   orquestación. Un formulario que pudiera apagar la separación productor /
   revisor apagaría la razón de existir de la Oficina.
8. **La orquestación tiene topes declarados**, no emergentes: 4 especialistas
   por operación, 3 en paralelo y **una** corrección del consolidador
   (evaluador-optimizador acotado, `officeConsolidationReview.ts`).
9. **Un formulario no se orquesta.** Completar un campo es tarea de un solo
   agente (`services/ai/generation/capture/`); el equipo completo se reserva
   para una pregunta de arquitectura. El razonamiento, con la tabla de cuándo
   usar cada patrón, está en `docs/agentes-anthropic-alineacion.md`.
10. **La ayuda de la plataforma tampoco se orquesta, y no depende del modelo.**
    «¿Cómo funciona esto?» la contesta un solo agente sobre el catálogo escrito
    de `lib/platformGuide`; si el proveedor falla, se muestran los temas del
    catálogo marcados como respuesta de la guía. Una ayuda que desaparece
    cuando falla la red desaparece justo cuando alguien la necesita. El reparto
    de agentes que cita se lee del registro
    (`application/platformGuidance.ts`), nunca de un texto fijo.
11. **El avance de un proyecto es dominio, no pantalla.**
    `services/architectureProjects/attentionTracking.ts` decide el progreso y
    la salud; lo no declarado vale `null` y nunca 0 %, y el semáforo se calcula
    —de hitos, riesgos y fecha— en vez de elegirse. Lo que un proyecto mueve en
    su iniciativa se declara con ids de resultados e indicadores existentes, y
    la consolidación (`initiativeDelivery.ts`) reporta las referencias rotas en
    lugar de descartarlas.

---

## Reglas de operación (Codex/Koder y Claude)

1. **El backend es Supabase, y Firebase ya no existe (F9, 2026-09-19).**
   Identidad (Supabase Auth), datos (PostgreSQL con RLS y RPC `SECURITY
   DEFINER`) y archivos (Storage privado) viven allí; la única pieza de servidor
   propia es la Edge Function `provision-user`, para lo único que exige clave de
   servicio. No quedan dependencia, reglas, emulador ni variables de Firebase, y
   `noSdkInUiLayers.test.ts` conserva sus módulos entre los prohibidos como
   sonda de regresión. Lo que **sigue prohibido**: microservicios, un backend de
   dominio propio, endpoints de dominio en `api/` y exponer `service_role` al
   cliente. `CLAUDE.md` § «El backend es Supabase» lleva la misma regla con la
   tabla de lo que cambió y lo que no; mantén los dos en el mismo cambio.
2. No invocar la base de datos ni un modelo directamente desde componentes o
   páginas; usar siempre `services/`. El SDK se importa en **un** fichero de
   `services/adapters/`, se carga en diferido, y construye **un solo** cliente:
   dos con `persistSession` sobre la misma clave de almacenamiento se pelean por
   el refresh token y cierran la sesión de quien acaba de abrirla.
3. La autorización se pregunta como permiso (`can(profile, 'x:y')` desde
   `lib/authz`), nunca comparando cadenas de rol. PostgreSQL implementa la
   misma matriz —sembrada como datos en `private.role_permissions`— y
   `__tests__/authz/sqlMatrixParity.test.ts` compara ambas celda por celda.
   Nadie crea su propia cuenta: el alta es `services/identity` y la ejecuta un
   administrador.
4. Escribir código nuevo como si `strict: true` estuviera activo y sin `any`.
   (`tsconfig.json` habilita la strictness de forma incremental; el `strict`
   completo sigue bloqueado por el split de `services/geminiService.ts`.
   `tsconfig.strict.json` lista los módulos que ya lo cumplen y sólo crece;
   `npm run check:any-budget` sostiene el repositorio en 17 `any`. Al enrolar un
   módulo recuerda que `tsc` comprueba todo lo alcanzable: entran las reglas, no
   sus repositorios. Ver CLAUDE.md.)
5. Aplicar cambios mínimos, trazables y testeables.
6. El esquema se despliega aparte del hosting (Vercel): migraciones
   versionadas en `supabase/migrations/`, aplicadas con `supabase db push`
   **antes** que el código que las usa. Si un día todas las RPC devuelven 404,
   mira primero los esquemas expuestos de la Data API: `api` tiene que estar en
   `db-schemas`, y cambiar «Exposed schemas» desde el panel puede sacarlo.
   Detalle en CLAUDE.md → *Desplegar el esquema*.
7. **Las pruebas viven en dos proyectos de Vitest y la extensión decide cuál.**
   Un test que renderiza es `.test.tsx` y corre en jsdom con Testing Library;
   uno que no renderiza es `.test.ts` y corre en Node sin setup. Si un
   `.test.ts` necesita un DOM (localStorage, DOMPurify, `Blob`), lo declara en
   su cabecera con `// @vitest-environment jsdom`. No devuelvas la suite entera
   a jsdom para que funcione un archivo: construir el DOM costaba 212,9 s
   frente a 50,6 s de ejecución real. Detalle en CLAUDE.md → *Testing
   Conventions*.
8. **Un proyecto sólo se construye con `createArchitectureProject`**, que
   rechaza una atención sin iniciativa y devuelve un rechazo tipado; lo que
   construye es un `ProjectRoot` (regla 21). Desde la UI, `useCreateAttention()`.
   Cada contexto persiste por su repositorio sobre `services/persistence`; el
   SDK está restringido por lint a un fichero.
9. **Los módulos están declarados en `modules.json` y hay un gate que los
   defiende** (`npm run check:module-boundaries`). No introduzcas un ciclo
   entre módulos, **un grupo de módulos que pueda volver a sí mismo** aunque
   ningún par se importe mutuamente (ADR-104), una importación que suba por las
   capas (`lib`/`utils` no importan de `services`), una que entre a un módulo
   saltándose sus **puertas declaradas** (`api` puede ser una lista: F3-06), ni
   una pantalla que importe **más de dos** módulos de servicio. El grafo se
   construye con `import`, `export … from`, `import type` **e `import('…')`**,
   y sobre los ficheros de la raíz (`types.ts`, `utils.ts`, …) además de las
   carpetas (ADR-105). Cada arista entre módulos está **declarada** en
   `modules.json` → `allowedDependencies` (F3-03): una nueva es una decisión que
   se revisa en la PR que la necesita. Cada presupuesto es monótono —puede bajar
   y no subir sin la razón escrita al lado— y seis de ellos tienen objetivo y
   fecha en `scripts/budgetTargets.mjs` (F3-04): antes de la fecha informan,
   después fallan. Cuando dos contextos necesitan el mismo tipo, ese tipo baja
   a `lib/`; cuando la dependencia debe ir en un solo sentido, se declara un
   puerto en el que la recibe; cuando una pantalla necesita un tercer servicio,
   esa orquestación pasa a un servicio de aplicación al que la pantalla llama
   una vez. Detalle en CLAUDE.md → *Module boundaries*.
10. **`types.ts` no importa nada, y no se le reexporta nada** (F3-07). `Artifact`
    vive en `lib/artifacts/artifactModel.ts` —lo lee la capa de fundación, así
    que es núcleo compartido—, y `Project` en `services/architectureProjects`
    (las pantallas lo reciben de `context/AppContext`). Reexportar un tipo
    «para que los imports existentes sigan funcionando» fue lo que creó cuatro
    ciclos y tres imports ascendentes: importa del contexto dueño.
11. **El barril de una capa no reexporta lo que la capa esconde.**
   `services/ai/index.ts` no puede importar `services/geminiService` — dentro de
   la capa el motor sí es una dependencia legítima, pero el barril es la API
   pública. Si un símbolo pertenece a esa API, dale casa en `services/ai/errors`,
   `services/ai/core` o `services/ai/generation`, o en `lib/artifacts` si es un
   contrato sin comportamiento. Regla de lint más prueba.
12. **Un agente es un contrato y el registro es su única puerta.**
   `agentDefinition.ts` declara qué es un agente —incluidos `scope.nonGoals`,
   que viajan al prompt, y su `modelTier` por defecto— y `agentRegistry.ts`
   responde toda pregunta de «¿qué agente?». Filtrar `OFFICE_AGENT_PERSONAS` en
   línea está prohibido y hay una prueba que lo escanea: tres puertas sobre una
   tabla es cómo aparecieron dos tablas de enrutado que discrepaban. La
   delegación se deriva de los roles (nadie delega en sí mismo; un especialista
   no delega), y `validateAgentRegistry()` corre en el suite. No añadas un campo
   al contrato que nadie lea. Detalle en ADR-004.
13. **Un agente conoce capacidades, no proveedores.** Toda llamada a un modelo
   atraviesa el kernel canónico: `Domain → services/ai → adaptador → API`. Cuatro
   reglas concretas, todas con prueba que las escanea
   (`__tests__/services/ai/kernelArchitectureRules.test.ts`): clasificar un fallo
   es trabajo del adaptador y decidir qué hacer con él es
   `services/ai/errors/retryDecisions.ts`, una sola vez para todos; una capacidad
   declarada la implementa alguien —no hay `embeddings`— y se lee del registro
   `AIProviderCapabilities`, nunca de un cast opcional; una capacidad `required`
   reenruta antes de gastar un token y falla si no hay ruta, jamás se degrada en
   silencio; y el contrato neutral no lleva payload de fabricante —contenido es
   `AIContentPart`, herramientas son `AIToolDefinition`, y `providerConfig` va
   indexado por proveedor. Elegir backend es `routeRequest`, no leer
   `settings.aiConfig.provider`. Detalle en `docs/ai-kernel.md` y ADR-002/003.
14. **Lo que no puede salir se para antes de gastar un token, y lo externo se
   valla.** `services/ai/guardrails` tiene tres severidades y la diferencia es
   qué puede hacer el llamante después: `warning` sigue y queda en la traza,
   `recoverable-block` no se reintenta igual, `hard-block` no se reintenta en
   absoluto —una credencial enviada a un tercero no se des-envía. Una frase de
   inyección **sólo avisa**: este producto escribe documentos de seguridad, y
   bloquear por la frase castiga escribir sobre el ataque más que al ataque. La
   mitigación es `wrapUntrustedContent` (`lib/untrustedContent.ts`) alrededor de
   todo lo que la aplicación no escribió. La posición es la mitad del requisito:
   el guard va **encima** de reintentos, cadena de modelos y fallback de
   proveedor —un bloqueo deja el contador de llamadas en cero— y corre en los
   tres caminos que alcanzan un backend (ejecutor canónico, cliente del proxy y
   `routeLegacyRequest` de la fachada legacy). Las formas de clave viven en
   `lib/secretShapes.ts` y las compara con las del escáner de bundle
   `__tests__/security/secretShapes.test.ts`. Detalle en `docs/ai-kernel.md`.
15. **Un barril desde código perezoso; un archivo desde código del arranque.**
   Entrar por el `index.ts` de un módulo desde algo que alcanza el chunk de
   entrada mete el módulo entero en la carga eager: ha costado el build cuatro
   veces (658→1.126, 659→1.125, 660→1.126 y 660→1.098 KB gz).
   ReactFlow y su CSS pertenecen al `Workspace` perezoso: Dagre y ReactFlow
   llevan chunks separados, y los servicios de dominio sólo importan tipos de
   ReactFlow. `check:bundle-budget` prohíbe que `vendor-reactflow` vuelva al
   arranque. El gate es lo que distingue un caso del otro, no el criterio.
16. **`context/AppContext.tsx` es composición y nada más.** Un `useState`, un
   `useEffect` o una importación de `services/` en ese archivo es un hallazgo:
   cada concern vive en un hook bajo `context/app/`, y `projects` tiene un solo
   dueño (`useProjectsState`). El diccionario `en`/`es` está en `lib/i18n/` y
   ambos idiomas llevan las mismas claves. Detalle en CLAUDE.md →
   *`AppContext` is one context composed of seven hooks*.
17. **Producción la publica un solo camino, y es `ci.yml`.** El contrato
    versionado `docs/operacion/despliegue.json` fija el repositorio
    `eltata71/arky-sup`, `main`, el equipo y proyecto Vercel `arky-sup`
    (`team_HGSWQHORpMV8wQUQf3mAdWEl` / `prj_Sr0cq7A21ZX8MfEmyLBbEkpO0Bfk`) y
    `https://arky-sup.vercel.app`. Tras `vercel pull`, `ci.yml` compara el
    proyecto resuelto con ese contrato antes de construir o publicar; una
    credencial para otro destino falla cerrada. La integración Git de Vercel se
    apaga con `git.deploymentEnabled: { main: false }` — sólo `main`, para que
    cada PR conserve su preview. Las dos mitades están afirmadas por separado
    en `__tests__/config/ciPipeline.test.ts`. Vive en el repositorio y no en el
    panel a propósito: un interruptor del dashboard no se revisa en una PR. No
    despliegues desde una estación de trabajo ni vuelvas a encender el
    disparador automático. Detalle en `docs/ci-cd-pipeline.md`.
18. **Cinco dependencias no pueden subir, y las cinco pasan la suite entera.**
   `vite` 8 (cambia a Rolldown: la carga inicial se multiplica),
   `@excalidraw/excalidraw` 0.18 (pierde la carga diferida: 1 938 KB gz),
   `typescript` 7
   (`typescript-eslint` no lo soporta todavía), `mermaid` 12 (`chevrotain` →
   `lodash-es` con 5 advisories altos) y `react-dom` 19 (la PR deja `react` en
   18). Antes de intentar cualquiera de ellas, lee CLAUDE.md →
   *Dependencias que no pueden subir*. Y **no fusiones una rama de Dependabot
   tal cual**: las de la cola nacieron de un `main` anterior y reintroducen
   `mirror-source.yml`; aplica la subida sobre `main` actual.
19. **Iniciativas es el contexto piloto: copia su forma** (F3-05,
    `docs/ddd-transformacion/09-cierre-fase-3.md`). `domain/` guarda las reglas
    sin E/S, sin React y sin reloj implícito (`now` entra por parámetro);
    `infrastructure/` guarda el adaptador y el repositorio, y ninguna pantalla lo
    importa; `domainPurity.test.ts` escanea `domain/` porque el compilador no ve
    ese acoplamiento. Los cambios son **operaciones con nombre** —una unión de
    comandos y `applyInitiativeCommand`, que devuelve el agregado nuevo o un
    rechazo tipado—, nunca `update(partial)`, y el proveedor de React sólo hace
    lo que es de un proveedor: estado optimista, la escritura y revertir.
20. **El Artefacto es la raíz de su propio agregado** (ADR-106). Se escribe con
    **un comando por intención** —`create_artifact`, `create_artifact_version`,
    `update_artifact`, `delete_artifact`, `revise_artifacts`—, compara la
    revisión **del artefacto** y ningún comando recibe la lista del proyecto. El
    contador y el índice del proyecto son una proyección que recalcula el
    servidor; el versionado monótono por grupo (A-02) lo sostiene un índice
    único en la base.
21. **El Proyecto se escribe por una sola puerta, y lo que se escribe es la
    raíz** (F4-04, F4-06). `ProjectRoot` es el agregado y **no tiene
    artefactos**; `Project extends ProjectRoot` es el modelo de lectura que les
    añade artefactos, índice, contador y grafo. La fábrica, la creación y el
    repositorio sólo aceptan la raíz, y `toProjectDocument` es el único que
    produce el documento persistido, sin campos derivados. `api.save_project`
    crea (revisión esperada 0) y actualiza; la RPC compuesta
    `save_project_aggregate` se retiró, y `__tests__/supabase/retiredRpcs.test.ts`
    falla si una migración la recrea, si el cliente la llama o si el tipo
    generado la ofrece. Retirar una RPC es `revoke` + `drop` más esa entrada.
22. **La revisión viaja con el registro, nunca en un mapa** (F2-10, F4-07).
    Proyectos, artefactos, iniciativas y encargos la leen de la lectura, la
    envían como `expectedRevision` y guardan la que la base confirma. Un `Map`
    de revisiones a nivel de módulo —y peor, exportado— es el defecto H10;
    `__tests__/services/noRevisionCache.test.ts` lo impide.
23. **La coordinación no vive en React** (F4-05). Lo que una pantalla o un hook
    *decide* va a `services/<contexto>/application/`, como funciones puras que
    se prueban sin montar nada; el hook sólo aplica el plan. Ejemplo de
    referencia: `services/artifacts/application/artifactWorkflow` decide
    versión, recompilación, comando, revisión y qué se revierte, y
    `useArtifactsState` lo ejecuta; `artifactCoordinationOutOfReact.test.ts`
    impide que vuelva. Y una trampa de React que ya costó dos defectos: **no
    decidas qué persistir desde variables asignadas dentro del actualizador de
    `setState`** —React sólo lo ejecuta en el acto para la primera
    actualización de un render, así que la segunda edición consecutiva no se
    guardaba—. Lee la instantánea antes (`projectsRef`/`getProject`) y aplica el
    mismo cambio puro dentro del actualizador.
24. **El motor se estrangula por verticales, y lo que sale, sale tipado**
    (F5-01). El transporte —proxy, reintentos, tope de tiempo, cambio de
    modelo— ya no vive en `services/geminiService.ts` sino en
    `services/ai/generation/legacyTransport.ts`; una fachada que sólo envía su
    propio prompt entra por `aiGateway` y no carga el motor. Las que todavía lo
    importan están listadas en `__tests__/services/ai/engineImporters.test.ts`
    y la lista sólo puede encoger: añadir un importador falla, y retirar uno
    obliga a anotarlo. El código que sale del motor no se lleva sus `any`:
    `evaluateChallenge` (corte 2) salió a `learning/challengeEvaluation.ts`
    con la respuesta del modelo reducida campo a campo, y con él
    `learningService` dejó de importar el motor.
25. Antes de cerrar una tarea de código:
   - correr la puerta de calidad (`npm run quality` compone exactamente lo mismo que el job de CI;
     `npm run quality:fast` es la variante rápida del bucle de desarrollo;
     ESLint debe quedar en 0 errores y 0 avisos),
   - si se tocó una migración, correr además `bash scripts/supabase/local.sh test`
     contra una base real: leer el SQL es exactamente lo que no detectó D-4,
   - documentar comandos ejecutados,
   - registrar riesgos o deuda técnica detectada.

---

## Sincronización de capacidades

Para mantener paridad entre Claude Code y Codex/Koder:

1. Si se agrega o modifica un agente en `.claude/settings.json`, actualizar este archivo (`AGENTS.md`) en la misma PR.
2. Si se agrega o modifica una skill en `.claude/skills/`, actualizar la sección de skills y la matriz de enrutamiento.
3. **Todo cambio de `CLAUDE.md` actualiza `AGENTS.md` en el mismo commit**, y
   al revés (decisión del propietario, 2026-09-23). No sólo cuando «cambia la
   arquitectura base»: esa condición es la que dejó a este archivo sin las
   fases 3 y 4 enteras mientras `CLAUDE.md` las describía. `AGENTS.md` no
   copia el detalle —lo resume como regla operativa y apunta a la sección de
   `CLAUDE.md`—, pero una regla que está en uno y falta en el otro es una regla
   que la mitad de los asistentes no conoce.
   `__tests__/config/assistantDocsParity.test.ts` comprueba que los conceptos
   anclados en los dos archivos sigan en los dos.

---

## Nota de compatibilidad

Este repositorio utiliza `CLAUDE.md` como guía detallada de arquitectura y convenciones, y `AGENTS.md` como contrato operativo interoperable para asistentes basados en Codex/Koder.

---

## Enrutamiento de skills — Hermes Agent (mantenimiento profesional)

Cuando el mantenimiento se realiza con **Hermes Agent** (asistente por defecto de este
espacio de trabajo), se activa el mejor skill/habilidad para cada tipo de tarea.
Esta sección es un contrato adicional y **no reemplaza** las reglas de arriba.

### Herramientas de mantenimiento del workspace
- `make health` / `.hermes/bin/health.sh` — diagnostica tools, deps, calidad, seguridad.
- `make quality` / `make ci-check` — puerta de calidad completa (igual que CI).
- `make audit` — revisión de vulnerabilidades de dependencias.
- Reportes de baseline en `.hermes/workspace/reports/`.

### Enrutamiento por tipo de tarea (Hermes)
| Tipo de solicitud | Skill / herramienta a activar |
|---|---|
| Mejora de una función existente | `test-driven-development` (RED-GREEN-REFACTOR) |
| Bug / error / comportamiento roto | `systematic-debugging` (4 fases, causa raíz) |
| Nueva feature / refactor grande | `brainstorming` → `writing-plans` → `subagent-driven-development` |
| Revisión de cambios antes de commit | `requesting-code-review` / `github-code-review` |
| Planear arquitectura | `architecture-decision-record` (ADR) |
| QA de la app / verificar que funciona | `webapp-testing` / `dogfood` |
| Seguridad (OWASP / vulnerabilidades) | revisión de seguridad + `npm audit` |
| Documentación | `doc-coauthoring` / actualizar `docs/` |
| Despliegue a producción | PR contra `main` → los gates de `ci.yml` → su trabajo `deploy`. **Nunca** `vercel --prod` a mano |

### Reglas operativas del mantenimiento (Hermes)
1. **Nunca** romper el quality gate: `make ci-check` debe quedar verde antes de un PR.
2. Seguir la arquitectura aprobada (React + Supabase + capa de IA propia); usar
   `services/` para todo acceso a datos y a modelos (ver CLAUDE.md).
3. Código nuevo sin `any` y a nivel `strict` (strictness incremental en `tsconfig.json`).
4. Cambios mínimos, trazables, testeables; registrar deuda técnica en `docs/technical-debt-audit.md`.
5. Documentar comandos ejecutados y riesgos detectados en cada tarea cerrada.
6. Usar ramas de feature (`make new-feature`) y PRs contra `main`.
7. Antes de cerrar: `npm run quality` y reportar el estado con evidencia real.
