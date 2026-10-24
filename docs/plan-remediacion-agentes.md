# Plan de remediación de agentes (ola 21)

**Fecha:** 2026-10-24
**Estado:** aprobado por el propietario el 2026-10-24; en ejecución.
**Origen:** el doble chequeo del plan de agentes de IA
(`docs/plan-agentes-ia.md`, olas 15–20, cerrado el 2026-10-23) contrastó cada
tarea con sus criterios de aceptación. Las métricas del banco están en su
objetivo y CI está en verde, pero nueve criterios no se cumplieron del todo:
tres de peso medio (R1–R3) y seis menores (R4–R9). Este plan los cierra.
**Numeración:** sigue a la ola 20; las tareas son `21.x` y sus ramas
`remediacion/<id>-<tema>`.

---

## 1. Hallazgos

| # | Tarea de origen | Qué falta | Peso |
|---|---|---|---|
| R1 | 19.0 | El registro de herramientas, las cinco herramientas, sus puertos de lectura y `governTools` sólo los importan pruebas: ningún camino de producción ofrece una herramienta a un agente. `ROLE_TOOL_POLICY` sólo lo lee `validateAgentDefinition`. Además, el proxy (`api/ai.ts`) no transporta herramientas: con `tools` la petición sale directa al proveedor, y la política estricta de producción la rechaza para quien no tiene clave personal | medio |
| R2 | 18.0 / D-A3 | D-A3 decía «A si el banco muestra mejora; si no, B». Nadie registró la medición ni aplicó la consecuencia, y la llamada estructurada del coordinador sigue en cada operación | medio |
| R3 | 16.1 | El rol de la ficha es configurable pero no se ve: `AssistantDock.tsx` y `SpecialistLoadPanel.tsx` muestran el rol de fábrica. Tampoco existe el escáner monótono que impedía volver a leer `OFFICE_AGENT_PERSONAS[...]` para pintar un nombre en `components/` y `pages/` | medio |
| R4 | 15.1 | `agent.intent-llm` y `agent.memory-extract` nunca entraron al catálogo de prompts, aunque la nota de seguimiento decía que entrarían con 18.3 y 17.2 | menor |
| R5 | 16.0 | Falta la huella por agente (13): el catálogo fija sólo la persona de Felipe, así que cambiar la instrucción de Elena no falla ninguna prueba | menor |
| R6 | 20.0 | «Ver traza» existe en el dock pero no en la sala del encargo | menor |
| R7 | 15.0 | La familia de consolidación tiene 6 casos; el criterio pedía ≥ 8, con respuestas JSON válidas, inválidas y parciales | menor |
| R8 | 20.3 | axe sólo rechaza violaciones `critical`; el criterio decía «sin hallazgos» en `/agents` y en el dock | menor |
| R9 | 17.0 | No hay escáner estático en `__tests__/security/`; el vallado se comprueba sólo sobre prompts renderizados | menor |

Fuera de los criterios, pero visto en la revisión: Vitest no excluye
`.worktrees/**`, así que en un checkout con worktrees viejos `npm run eval:agents`
recoge sus copias y falla. Se corrige en 21.4.

## 2. Decisiones

| # | Decisión | Decidido |
|---|---|---|
| **D-R1** | ¿Las herramientas de 19.0 se retiran o se conectan? | **Se conectan** (propietario, 2026-10-24). Esto reabre, acotado, lo que 19.2 cerró por medición: una **ronda** de herramientas por especialista, no un bucle libre, con el presupuesto de handoff contando cada llamada |
| **D-R2** | ¿Cómo se resuelve D-A3? | **Por la regla ya decidida en D-A3**: el banco no puede mostrar mejora de la llamada del coordinador (sus respuestas están escritas a mano: mide la tubería, no el modelo), así que se aplica **B**: encuadre determinista sin llamada. Se registra la cifra: `llamadasPorOperacion` baja en una por operación. Reabrir A requiere un banco con respuestas de un modelo real |

## 3. Tareas

### 21.0 El proxy transporta herramientas *(P1 · M · R1)*
- **Objetivo:** que una petición con herramientas llegue al modelo en producción
  sin clave personal, por el mismo proxy apátrida.
- **Cambios:** `api/ai.ts` acepta `tools` (forma neutral `AIToolDefinition`) y
  devuelve `toolCalls` (`name`, `args`); cada proveedor las traduce en su
  frontera (Gemini `functionDeclarations`, OpenRouter `tools`/`tool_calls`).
  `aiProxyClient` las envía y lee; `legacyTransport.tryAiProxy` deja de
  devolver `null` por llevar `tools` en el camino sin streaming. El streaming
  con herramientas sigue sin proxy (fuera de alcance). Sin lógica de dominio en
  `api/`.
- **CA:** pruebas de `api/ai.ts` con herramientas para los dos proveedores
  (petición traducida, `toolCalls` devueltos, error normalizado);
  `aiProxyClient` y `legacyTransport` cubiertos; los guardarraíles de entrada
  siguen por encima; `check:bundle-secrets` limpio.

### 21.1 Herramientas conectadas a los especialistas *(P1 · L · R1 · 21.0)*
- **Objetivo:** que un especialista pueda consultar el proyecto con las
  herramientas de lectura que su rol permite antes de responder.
- **Cambios:** en la coordinación, el especialista recibe las definiciones que
  `governTools(registry, allowedToolsFor(agente))` permite, construidas sobre
  los puertos reales (`contextReadPorts`) del proyecto del alcance. Si el
  modelo pide herramientas, se ejecutan (máximo 3 por especialista) y una
  segunda llamada responde con los resultados; **una sola ronda**. El
  presupuesto del handoff sube a 2 llamadas y `withHandoffBudget` las cuenta;
  cada llamada a herramienta emite un evento en el panel de coordinación y
  queda en la traza; las denegaciones se registran. Si el proveedor no declara
  `tools`, no se ofrecen y la operación sigue como hoy (se informa, no falla).
  Se carga en diferido con la capa de IA.
- **CA:** prueba de la ronda con transporte simulado (sin herramientas, con
  una, con una denegada, con un id inexistente); presupuesto respetado;
  `llamadasPorOperacion` del banco se registra antes/después; techos de ruta
  sin subida; las herramientas dejan de ser código sólo de pruebas.

### 21.2 Encuadre determinista del coordinador (D-A3 = B) *(P1 · M · R2)*
- **Objetivo:** aplicar la consecuencia de D-A3 que nadie aplicó.
- **Cambios:** `executeOfficeOrchestration` deja de invocar al coordinador: el
  brief es el plan determinista (`planOfficeWorkstreams`) renderizado, y el
  evento de coordinación lo dice («encuadre determinista»). Se retiran
  `COORDINATION_BRIEF_SCHEMA`, `readCoordinationBrief`/`applyCoordinationBrief`
  y la plantilla `office.coordination` del catálogo si quedan sin uso; el
  presupuesto por defecto baja a `especialistas + 1 + 1`; la cota de
  `planApproval` (20.2) se recalcula. La decisión queda escrita en el plan de
  agentes (D-A3) y en ADR-110.
- **CA:** `llamadasPorOperacion` baja en 1 en la línea base; ninguna operación
  invoca al coordinador (prueba); paridad dock/copiloto (16.3) en verde.

### 21.3 El rol configurado se ve, y un escáner lo sostiene *(P1 · S · R3)*
- **Objetivo:** que todo lo que la ficha configura y una pantalla muestra
  salga de la ficha.
- **Cambios:** `useAgentDisplayName` (o un hermano) da también el rol resuelto;
  `AssistantDock`, `SpecialistLoadPanel` y cualquier otra lectura de rol o alias
  de fábrica en `components/` y `pages/` pasan por él. Escáner monótono en
  `__tests__/architecture/` sobre `OFFICE_AGENT_PERSONAS[...]` en esas
  carpetas; la única excepción nombrada es el brief de `EngagementRoom`, que
  conserva el alias de fábrica para resolver menciones.
- **CA:** prueba de componente con un rol configurado; el escáner falla sobre
  `main` actual y pasa después.

### 21.4 Los seis criterios menores *(P2 · M · R4–R9)*
- **Cambios y CA:**
  - **R4:** `agent.intent-llm` y `agent.memory-extract` en el catálogo con caso
    canónico y huella; sus invocaciones llevan sello.
  - **R5:** caso canónico y huella de la persona de cada uno de los 13 agentes.
  - **R6:** «Ver traza» en la sala del encargo, sobre `describeRun`/`describeOperation`,
    con carga diferida y techo de ruta sin subida.
  - **R7:** consolidación con ≥ 8 casos, incluidos JSON inválido y parcial, en
    los dos caminos; la línea base no empeora.
  - **R8:** axe sin violaciones (no sólo críticas) en `/agents` y en el dock;
    se corrigen las que salgan.
  - **R9:** escáner estático en `__tests__/security/` sobre los compositores de
    agentes: un campo de usuario interpolado fuera de `wrapUntrustedContent` falla.
  - `.worktrees/**` en `SHARED_EXCLUDE` de `vite.config.ts`.

## 4. Orden

```
21.P → 21.2 → 21.0 → 21.1 → 21.3 → 21.4
```

21.2 va antes que las herramientas porque simplifica la orquestación sobre la
que se añade la ronda. Cada tarea sigue el flujo de siempre: worktree propio,
`npm run quality`, una PR, CI en verde, squash-merge y despliegue. Ninguna
tarea prevé migración.

## 5. Seguimiento

| Tarea | Prioridad · Complejidad | Estado | PR · nota |
|---|---|---|---|
| 21.P Plan y reserva | P1 · S | Hecha | #289 · `14f3f97` · plan en `PLANES` con prefijo `remediacion`; de paso, `zod` 4.6.7 por GHSA-mrhx-c7xc-m3w5 |
| 21.2 Encuadre determinista (D-A3 = B) | P1 · M | Hecha | #290 · ninguna operación invoca a la coordinadora; `llamadasPorOperacion` 4,6 → 3,6; sin análisis no se consolida |
| 21.0 El proxy transporta herramientas | P1 · M | Pendiente | — |
| 21.1 Herramientas conectadas | P1 · L | Pendiente | — |
| 21.3 Rol configurado y escáner | P1 · S | Pendiente | — |
| 21.4 Seis criterios menores | P2 · M | Pendiente | — |
