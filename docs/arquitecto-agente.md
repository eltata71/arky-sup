# Arquitecto Agente

Documento técnico de referencia para la consolidación del chat de IA bajo el nombre **Arquitecto Agente** y la arquitectura de su capacidad agentic + composición de contexto.

> Para guía de uso de subagentes/skills internos ver `CLAUDE.md` (raíz). Este documento es el contrato técnico, no el manual de usuario.

---

## 1. Concepto

El **Arquitecto Agente** es el único agente de IA visible para el usuario en la aplicación. Combina:

| Capacidad | Descripción | Implementación |
|---|---|---|
| **Consultiva** | Responder preguntas, explicar, analizar, recomendar. | `processAssistantChat*` (`services/agent/agentConversation`) |
| **Agentic** | Modificar, regenerar, mejorar artefactos, aplicar sugerencias, guardar memoria. | `services/agent/agentExecutor.ts` + `agentPlanner` + `intentClassifier` |

El agente decide cuál de las dos capacidades activar a partir del intent classifier (heurístico, refinable con LLM cuando la confianza es baja).

---

## 2. Identidad y nombre

| Lugar | Mecanismo |
|---|---|
| Constante centralizada | `constants.ts` → `AI_AGENT_DISPLAY_NAME = 'Arquitecto Agente'` |
| i18n | `context/AppContext.tsx` keys `aiAssistant`, `toggleAssistant`, `agentMemory`, `agentMemoryDescription` |
| Avatar/chip | `components/ui/AIArchitectIdentity.tsx` |
| System prompt | `services/agent/agentContextComposer.ts` (sección base) |

**No se introducen** nuevas referencias a "Arquitecto Jefe", "Copiloto Global", "Asistente Inteligente", "AI Assistant" o "Global Copilot" en superficies visibles. El persona LMS "Chief Architect" (evaluador pedagógico en `pages/LMS/LessonModal.tsx` y los métodos LMS de `services/geminiService.ts`, construido vía `buildLMSTutorPersona` en `utils.ts`) es intencional: es un rol pedagógico separado del agente de chat.

---

## 3. Centro de Memoria

`MemoryScope` (en `types.ts`) expone seis ámbitos:

| Scope | Almacén físico | Propósito |
|---|---|---|
| `'agent-base'` | `Settings.agentMemory` | **Memoria del Agente (Base)** — identidad, rol, restricciones. Carga ANTES de cualquier acción. |
| `'global'` | `Settings.globalContext` | Reglas/estándares aplicables a todos los proyectos del usuario. |
| `'project'` | `Project.projectContext` | Notas específicas del proyecto. |
| `'agent'` | `Project.agentMemory` | Aprendizajes del agente específicos para este proyecto. |
| `'initial-capture'` | `Project.initialCapture` | Información clave registrada al crear el proyecto. |
| `'artifact'` | `Artifact.artifactMemory` | Notas asociadas a un artefacto. |
| `'chat-history'` | Per-project chat collection | Conversaciones (gestión, depuración, compactación). |

Todas se editan/consultan desde `components/MemoryCenterModal.tsx`.

### 3.1 Notas estructuradas (`MemoryEntry`)

Cada ámbito de bullets mantiene **dos campos paralelos**:

- El espejo legacy `string[]` (`globalContext`, `projectContext`, `agentMemory`, `initialCapture`, `artifactMemory`) sigue siendo el canon de QUÉ notas existen — todos los consumidores históricos siguen funcionando sin cambios.
- El campo `*Entries: MemoryEntry[]` (`globalContextEntries`, `projectContextEntries`, `agentMemoryEntries`, `initialCaptureEntries`, `artifactMemoryEntries`) conserva los metadatos por nota: `id`, `createdAt` (fecha/hora ISO), `updatedAt`, `authorId`/`authorName` (quién la creó: usuario o agente) y `priority` (`'high' | 'medium' | 'low'`, por omisión `'medium'`).

`services/memory/memoryEntries.ts` es la única fuente de verdad del modelo: `reconcileMemoryEntries(texts, entries)` une ambos campos en lectura (los textos sin metadatos se tratan como notas legacy "sin fecha"), `createMemoryEntry` estampa autor + timestamp, `appendMemoryNotes` deduplica y anexa, y los sorters implementan el contrato de orden:

- **Visualización (Centro de Memoria):** cronológico, de la más reciente a la más antigua (`sortMemoryEntriesByRecency`); las notas sin fecha van al final.
- **Ensamblado de contexto:** prioridad del usuario (alta > media > baja) y, a igual prioridad, recencia (`sortMemoryEntriesForContext`).

El usuario puede cambiar la prioridad de cualquier nota directamente desde la tarjeta en el Centro de Memoria. Las notas guardadas por el Arquitecto Agente (`memory.save.*`) quedan firmadas con el actor que confirmó la acción.

**Fallback seguro:** Si `Settings.agentMemory` está vacío o es `undefined`, `getAgentBaseMemory()` devuelve `DEFAULT_AGENT_MEMORY` (siete bullets que describen la identidad profesional del agente para una multinacional de seguros). El usuario nunca se queda sin instrucción base.

---

## 4. Composición del contexto enviado al modelo

El módulo `services/agent/agentContextComposer.ts` es el **único** lugar que compone el system instruction para el chat. Cualquier refactor de presupuestos, prioridad de memoria o embeddings sucede ahí sin tocar `geminiService`.

Jerarquía siempre aplicada:

1. **Base persona** (rol Arquitecto Agente para multinacional de seguros)
2. **Memoria del Agente (Base)** — `Settings.agentMemory` (identidad, casi siempre completa)
3. **Configuración del agente** (tono, idioma preferido)
4. **Memoria Global** — `Settings.globalContext` (relevancia + prioridad + recencia + budget)
5. **Project header** (nombre, descripción)
6. **Contexto del Proyecto** — `Project.projectContext` (relevancia + prioridad + recencia + budget)
7. **Captura Inicial** — `Project.initialCapture` (objetivos/alcance/stakeholders, budget propio)
8. **Memoria del Agente (Proyecto)** — `Project.agentMemory` (relevancia + prioridad + recencia + budget)
9. **Inventario de artefactos** — una línea por grupo de versiones (último estado) para que el agente conozca todo lo ya generado
10. **Artefacto activo** (sólo cuando hay uno: nombre, tipo, objetivo, contenido truncado)
11. **Memoria del Artefacto** — `Artifact.artifactMemory` (relevancia + prioridad + recencia + budget)
12. **Jerarquía y consistencia de memoria** (reglas fijas, ver abajo)
13. **Reglas de ejecución** (catálogo de capacidades ejecutables, cuándo usar `modifyArtifact`, cuándo asesorar, cuándo escalar al orquestador)
14. **Historial de chat** (sólo si `aiConfig.includeChatHistoryByDefault === true`)
15. **Solicitud actual del usuario**

**Jerarquía de resolución de conflictos** (instrucción explícita al modelo): ante información contradictoria entre ámbitos, prevalece `contexto del artefacto > contexto del proyecto > contexto global > memoria del agente`; dentro de un mismo ámbito prevalece la prioridad del usuario (alta > media > baja) y, a igual prioridad, la nota más reciente. El modelo debe además señalar al usuario las inconsistencias que detecte entre ámbitos o contra artefactos existentes.

### 4.1 Presupuestos (`ContextBudget`)

`DEFAULT_CONTEXT_BUDGET` impone topes por scope, total de mensajes de historial, y máximo de caracteres por bullet (con truncación en límite de palabra):

```ts
{
  agentBaseMax: 8,
  globalMax: 10,
  projectMax: 12,
  projectAgentMax: 6,
  artifactMax: 8,
  initialCaptureMax: 6,
  projectArtifactsMax: 15,
  bulletCharCap: 220,
  artifactContentCap: 1800,
  historyMax: 12,
}
```

Cada call site puede pasar `budget: Partial<ContextBudget>` para ajustar topes localmente sin tocar el composer.

### 4.2 Selección por relevancia

`selectRelevantMemory()` (sólo texto) y `selectRelevantMemoryEntries()` comparten el mismo motor de matching **semantic-lite**: folding de acentos, colapso de plurales y un stemmer ligero ES/EN (`stemMatchToken`) que hace coincidir familias de palabras ("integración" ↔ "integraciones" ↔ "integrar", "sistemas" ↔ "sistema", "payments" ↔ "payment"), con coincidencia por prefijo común ≥ 5 caracteres. Determinístico, sin llamadas de IA. Cuando ningún bullet matchea la query, **cae a orden natural** (no descarta la sección).

`selectRelevantMemoryEntries()` es la evolución consciente de metadatos que usa el composer: puntúa `relevancia (0..1) + boost de prioridad (alta +0.40 · media +0.20 · baja +0) + boost de recencia (0..0.20, por ranking de fecha)`. Sin query, ordena por prioridad + recencia. Cada nota seleccionada se renderiza con su anotación compacta `[prioridad … · fecha · autor]` para que el modelo también pondere los metadatos. Esto permite reemplazar la heurística por embeddings semánticos sin modificar call sites.

La generación de artefactos (no sólo el chat) consume el mismo contrato: `buildBasePrompt`/`buildGlobalPrompt` en `utils.ts` ordenan y anotan los contextos vía `formatMemoryTextsForPrompt`, e incluyen además la Captura Inicial y la Memoria del Agente (Proyecto) en modo documento.

### 4.3 Compactación

`compactBullet(value, cap)` trunca al último límite de palabra cercano al cap (≥ 60% del cap) para evitar cortes en mitad de palabra. Cada bullet seleccionado pasa por compactación antes de salir al prompt.

---

## 5. Historial de chat por defecto

El flag `AIConfig.includeChatHistoryByDefault` (default: **`false`**) controla si el historial conversacional se incluye en el system instruction.

- **OFF (default):** El agente inicia con memoria + contexto actual, sin acumular ruido entre conversaciones. Mejor costo, velocidad y privacidad.
- **ON:** Se incluye hasta `budget.historyMax = 12` mensajes recientes (excluyendo markers de compactación) en formato Gemini.

Persistencia: en `Settings.aiConfig` (per-user). UI en `pages/SettingsPage.tsx` → tab "IA".

`prepareChatHistoryForModel({ history, includeChatHistory, budget })` es la función pura que decide qué turnos se reenvían al modelo.

---

## 6. Capacidades agentic

`services/agent/` implementa la capa de orquestación:

```
┌─────────────────────────────┐
│ AssistantPanel              │
│ ProjectCopilotChatModal     │  → useAgentActions()
└──────────────┬──────────────┘
               │
               ▼
   ┌──────────────────────────┐
   │ intentClassifier         │  Heurístico (sync, zero-cost)
   │ + intentClassifierLLM    │  Refinamiento opcional cuando conf < 0.6
   └─────────────┬────────────┘
                 ▼
   ┌──────────────────────────┐
   │ agentPlanner             │  AgentActionPlan + requiere confirmación si destructivo
   └─────────────┬────────────┘
                 ▼ (tras confirmación)
   ┌──────────────────────────┐
   │ agentExecutor            │  Reusa geminiService + AppContext mutators
   └──────────────────────────┘
```

### 6.1 Intents soportados

`AgentIntentType` (en `agentTypes.ts`):

| Intent | Acción | Servicio que reusa |
|---|---|---|
| `artifact.create` | Nuevo artefacto desde solicitud natural. | `geminiService.generateArtifactContent` + `templateMatcher` |
| `artifact.regenerate` | Regenerar artefacto existente. | `geminiService.generateArtifactContent` |
| `artifact.improve` | Aplicar mejoras a artefacto. | `geminiService.applyArtifactImprovements` |
| `artifact.patch` | Cambio puntual via tool `modifyArtifact`. | `requestArtifactPatch` (`services/agent/agentConversation`) |
| `artifact.createVersion` | Nueva versión sin sobrescribir. | `createArtifactVersion` |
| `artifact.applySuggestion` | Aplicar sugerencias previamente cargadas. | `geminiService.applyArtifactImprovements` |
| `artifact.explainOnly` | Asesoría sin ejecución. | (sólo chat) |
| `artifacts.batch` | Acción sobre múltiples artefactos. | iterador sobre `improve`/`patch` |
| `memory.save.global` | Persistir bullets en `Settings.globalContext`. | `extractMemoryBullets` + `updateSettings` |
| `memory.save.project` | Persistir bullets en `Project.projectContext`. | `extractMemoryBullets` + `updateProject` |
| `memory.save.artifact` | Persistir bullets en `Artifact.artifactMemory`. | `extractMemoryBullets` + `updateArtifact` |
| `unknown` | Fallback consultivo. | — |

### 6.2 Garantías de seguridad

- **Acciones destructivas** (sobrescribir contenido del artefacto activo) requieren confirmación explícita y target seleccionable (`current` vs `new_version`).
- **Confianza mínima:** Si `intent.confidence < 0.62` la acción siempre pide confirmación.
- **Rollback:** Cada nueva versión se persiste en el versionado de artefactos; `restoreArtifactVersion` permite revertir.
- **Trazabilidad:** Cada acción genera un `AgentActionRecord` (audit log per project, opcional remoto).

---

## 7. UX/UI del panel

Ubicaciones del Arquitecto Agente:

| Surface | Componente | Comportamiento |
|---|---|---|
| Sidebar persistente desktop | `CopilotSidebar` → `AssistantPanel` | Toggle ⌘/Ctrl+. Auto-colapsa al volver al Hub. |
| Bottom-sheet móvil | `CopilotSidebar` (mobile) | FAB inferior derecho; safe-area-inset-bottom. |
| Modal a pantalla completa | `ProjectCopilotChatModal` | Para conversaciones globales sin artefacto activo. |
| Chat de creación guiada | `ChatInterface` (purpose `guided-creation`) | Asistente de proyectos. |

### 7.1 Composer

El `<textarea>` del AssistantPanel:
- `Enter` envía, `Shift+Enter` nueva línea (con guard de IME composing).
- min-height 44px, max-height 160px, auto-resize implícito.
- aria-labels en input y botón de envío.
- Botón de envío con estado claro: idle / disabled (no input o cargando) / busy (spinner).
- Wrapper con clase `.safe-bottom` para respetar `env(safe-area-inset-bottom)` en iPad/iPhone Safari.
- Sticky en la parte inferior del panel (flex-shrink-0).

### 7.2 z-index ordenado

Capas existentes en el app shell:
- Canvas: default
- Toolbars/menús flotantes del canvas: z 10-50
- Panel del agente (desktop): dentro del flujo normal (no z-index alto)
- FAB móvil: z-100
- Bottom-sheet móvil: z-110
- Modales globales: z-50+ (a través de `Modal.tsx`)
- Toasts: z más alto

---

## 8. Cómo agregar una nueva habilidad agentic

1. **Definir intent type** en `services/agent/agentTypes.ts` (`AgentIntentType` union).
2. **Detección** en `services/agent/intentClassifier.ts` (regla heurística + score).
3. **Planificación** en `services/agent/agentPlanner.ts` (`planAgentAction()` — título, summary, rationale, requiresConfirmation).
4. **Ejecución** en `services/agent/agentExecutor.ts` (nuevo case en el switch, reusando servicios existentes — nunca duplicar AI calls).
5. **Tests** en `services/agent/__tests__/` (un `*.test.ts` por concepto).

El composer NO requiere cambios al agregar habilidades: el system instruction se compone con la jerarquía existente, y el budget puede ajustarse via `budget` opcional.

---

## 9. Tests críticos

| Archivo | Cobertura |
|---|---|
| `services/agent/__tests__/agentContextComposer.test.ts` | Composer puro: base memory, compactación, selección por relevancia, budgets, history toggle. |
| `services/agent/__tests__/intentClassifier.test.ts` | Detección heurística de intents. |
| `services/agent/__tests__/agentPlanner.test.ts` | Planes generados correctamente. |
| `services/agent/__tests__/agentExecutor.test.ts` | Ejecución reutiliza servicios sin duplicar lógica. |
| `services/agent/__tests__/memoryExecutor.test.ts` | Persistencia de bullets en cada scope. |
| `__tests__/aiAgentNaming.test.ts` | `AI_AGENT_DISPLAY_NAME === 'Arquitecto Agente'`. |
| `__tests__/aiConfigDefaults.test.ts` | `includeChatHistoryByDefault` default `false`; `agentMemory` opcional. |

Total: 23 tests específicos del composer + 11 archivos del subsistema agent + tests transversales (CopilotSidebar, MemoryCenter, etc.).

---

## 9-bis. Bucles de calidad y aprendizaje automáticos

Mejoras agénticas activas en cada acción/generación (todas determinísticas y fail-open):

1. **Knowledge Graph por defecto en toda generación** — `geminiService.resolveDefaultArchitectureGraphBlock` resuelve el bloque del Architecture Knowledge Graph cuando el call site no lo pasa explícitamente (Arquitecto Agente, creación guiada, SDD). Un grafo obsoleto o ausente se reconstruye en memoria (extracción determinística, sin IA y sin tocar persistencia — el rebuild persistido sigue siendo el debounce de AppContext).
2. **Gobernanza de prerrequisitos en `artifact.create`** — el executor consulta `validateArtifactReadiness` antes de generar: si faltan prerrequisitos (p. ej. C4-N1 para un C4-N2) advierte al usuario en el resultado y le indica al modelo declarar supuestos explícitos. Nunca bloquea.
3. **Lecciones automáticas del agente** — `services/agent/agentLessonRecorder.ts`: tras cada acción ejecutada se deriva una lección determinística (qué funcionó / qué falló, con calidad y la instrucción usada) y se guarda en la Memoria del Agente (Proyecto) firmada por "Arquitecto Agente", con prioridad baja y tope de `MAX_AGENT_LESSONS` (12) — las notas del usuario nunca se podan.
4. **Paridad de calidad documental en el agente** — `validateArtifactContent` del executor aplica `assessDocumentArtifact` a los documentos producidos por improve/patch/applySuggestion: rechaza truncamientos y reducciones drásticas de contenido (>65% si el original superaba 800 chars) que antes se persistían en silencio.
5. **Notas con metadatos desde la creación del proyecto** — `AppContext.addProject` estampa `projectContextEntries` e `initialCaptureEntries` (fecha/hora, autor, prioridad media) tanto en el flujo manual como en el guiado.

---

## 10. Rutas para futuras evoluciones

| Mejora | Punto de entrada |
|---|---|
| Embeddings semánticos | Reemplazar `scoreBulletForQuery` en `agentContextComposer.ts` sin tocar callers. |
| Caching del prompt compuesto | Wrap `buildAgentSystemInstruction` con memoización por hash de inputs. |
| Soporte multilingüe del default memory | Parametrizar `DEFAULT_AGENT_MEMORY` por `settings.language`. |
| Skills declarativos | Migrar el switch del executor a un `AgentSkillRegistry` con metadata (entradas, validaciones, permisos). |
| Métricas de uso de memoria | Instrumentar `selectRelevantMemory` con telemetría opcional (qué bullets se seleccionaron, score, intent). |
