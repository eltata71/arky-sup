# Oficina de Arquitectura Empresarial

Contrato técnico del subsistema `services/architectureOffice/`. Lee este
documento antes de tocar el planificador, el ejecutor o la gobernanza del
encargo — lleva el razonamiento que el código no puede llevar.

Última actualización: **2026-08-26**.

---

## 1. Por qué existe

Arky 10 nació como soporte para **un** arquitecto: el usuario elegía una
plantilla del catálogo y generaba un artefacto, uno a uno. La "Oficina de
Arquitectura" existía como diez personas congeladas en TypeScript cuyas
`capabilities` y `domains` no se leían en ninguna rama de código — solo se
concatenaban al prompt. La única orquestación (`executeOfficeOrchestration`)
se disparaba desde el chat con `@Lucía coordina…`, devolvía **texto**, no
creaba artefactos, no persistía nada y moría con la pestaña.

La Oficina ahora es un motor de **encargos**: recibe una necesidad de negocio,
propone un plan de entregables, asigna cada uno a un especialista con un
revisor distinto, ejecuta el DAG con reintentos acotados, evalúa quality gates
con evidencia trazable y presenta el resultado a un comité humano.

---

## 2. Modelo de dominio

Todo en `services/architectureOffice/OfficeTypes.ts`. Datos puros: sin React,
sin Firestore, sin SDK de IA.

```
OfficeEngagement
├── charter: OfficeCharter          objetivos, alcance, restricciones,
│                                   marcos regulatorios, entregables
├── tasks: OfficeTask[]             el DAG ejecutable
├── gateAssessment                  veredicto de los 6 quality gates
├── arbDecisions: OfficeArbDecision[]  espejo del registro inmutable
├── budget                          techo de llamadas de IA
└── auditTrail: OfficeAuditEntry[]  append-only, 16 acciones
```

### Ciclo de vida del encargo

```
intake → planning → awaiting-charter → in-progress → awaiting-arb → delivered
                          │                 │             │
                          │                 └─ blocked ───┤
                          └──────── cancelled ────────────┘
```

### Ciclo de vida de la tarea

```
pending → ready → in-progress → completed
                       │
                       ├─→ awaiting-review → changes-requested → (re-producción)
                       ├─→ failed
                       └─→ cancelled | skipped
```

`OFFICE_TERMINAL_TASK_STATUSES` define qué estados ya no se reprograman. Es lo
que hace que **volver a llamar al ejecutor sea seguro**: una tarea terminal se
salta, y de ahí sale la reanudación tras recarga.

---

## 3. Del brief al DAG

### La puerta de entrada

El entregable es el **tercer** nivel de la jerarquía, y
`EngagementIntakeWizard` se niega a crearlo sin los dos de arriba: exige una
**iniciativa de negocio** y una **atención de arquitectura**, ambas elegidas por
llave y ninguna escrita a mano. Cuando alguna no existe todavía, el diálogo
lleva al usuario a la pantalla que la crea (`/initiatives`, `/projects`) en vez
de fabricar un marcador de posición.

Esto invierte el diseño anterior, en el que la Oficina abría el proyecto a
partir del brief. Abrir trabajo sin razón de negocio declarada es exactamente el
hueco que `services/portfolioGraph` reporta como `orphan-attention`: el intake no
puede ser lo que lo produce. Elegir la atención hereda las iniciativas que ella
ya declara, de modo que los dos niveles no puedan contradecirse por descuido.

`OfficeEngagementPlanner.ts` trabaja en dos capas, en este orden.

**1 · Andamiaje determinista.** Señales del brief → tipo de encargo →
entregables del catálogo real (`ARTIFACT_TEMPLATES`) → asignación vía
`OfficeAgentRouter` → dependencias por fase. Sin ninguna llamada de IA. Un
modelo caído degrada la *calidad* del plan, nunca su *existencia*.

**2 · Refinamiento opcional con IA.** El modelo puede reordenar, ajustar
criterios de aceptación y cambiar dependencias. **No puede**:

| Regla | Dónde se verifica |
|---|---|
| Inventar una plantilla fuera del catálogo | `validateCharter` → `unknown-template` |
| Asignar una persona que no declara ese `ArtifactType` | `validateCharter` → `persona-cannot-produce` |
| Poner el mismo productor y revisor | `validateCharter` → `reviewer-equals-assignee` |
| Depender de un entregable ausente | `validateCharter` → `unknown-dependency` |
| Formar un ciclo | `findTaskCycle` sobre el DAG expandido |

Un refinamiento que rompe cualquiera de estas se **descarta entero** y queda el
charter determinista. No se "arregla" en silencio: un plan parcheado a
escondidas es peor que un plan más simple que sí se puede defender.

### Expansión a tareas

`buildTasksFromCharter` produce, por cada entregable, una tarea de producción y
una de revisión, y cierra con una consolidación que depende de **todas** las
revisiones.

Detalle que importa: un entregable depende de la **revisión** de su predecesor,
no de su producción. Sin eso, el trabajo aguas abajo se construye sobre un
borrador que aún nadie validó.

---

## 4. El ejecutor

`OfficeEngagementRunner.ts`. Cuatro restricciones dieron forma al archivo:

- **Sin React, sin Firestore, sin SDK de IA.** Todo entra por puertos
  inyectados (`OfficeRunnerPorts`), así que el planificador es testeable con
  stubs planos.
- **Persistir en cada transición.** La Oficina corre en la pestaña del
  navegador; una recarga debe reanudar desde la última tarea completada.
- **Todo acotado.** Concurrencia (global y por persona vía
  `maxConcurrentTasks`), pases de revisión (`maxAttempts`) y llamadas de IA
  (`budget.maxAiCalls`).
- **Un fallo no aborta a sus hermanos.** Solo una dependencia incumplida
  detiene el trabajo aguas abajo.

### Contrato de puertos

```ts
interface OfficeRunnerPorts {
  produceArtifact(task, engagement): Promise<OfficeProduceOutcome>;
  reviewArtifact(task, engagement): Promise<OfficeTaskReview>;
  consolidate(task, engagement): Promise<OfficeConsolidateOutcome>;
  persist(engagement): Promise<void>;
  onProgress?(engagement): void;
}
```

`OfficeRunnerAdapters.ts` es el **único** sitio donde estos puertos tocan la
aplicación real.

### Principio rector: la Oficina orquesta, no reimplementa

`produceArtifact` construye un `AgentActionPlan` con `planAgentAction` y llama a
`executeAgentAction` — la misma ruta del Arquitecto Agente. Un artefacto de la
Oficina hereda gratis el pre-flight de gobernanza, el quality gate previo a
persistir, la reparación semántica de IR de diagramas y el `AgentActionRecord`.
**No dupliques generación de artefactos aquí.**

### El bucle de reflexión

```
producir → evidencia determinista → crítica de la persona revisora
              │
              ├─ approved            → continúa
              └─ changes-requested   → si attempts < maxAttempts:
                                        re-encola producción con los hallazgos
                                       si no:
                                        la tarea falla con los motivos del revisor
```

La evidencia determinista (`validateOfficeArtifact` + `compileArtifact`) manda
sobre la opinión del modelo: un validador bloqueante es `changes-requested`
diga lo que diga la IA. **El modelo no puede aprobar un contrato roto.**

---

## 5. Gobernanza

### Quality gates

Seis gates en `officeQualityGates.ts` (`spec-freeze`, `diagram-review`,
`security-review`, `compliance-check`, `cost-review`,
`performance-baseline`), cada uno `pass | conditional | blocked` con
`blockers`, `conditions` y `evidenceArtifactIds`.

`compliance-check` puntúa **cobertura por dimensión** (cifrado, auditoría,
clasificación de datos sensibles, control de acceso, retención) y registra qué
artefacto evidencia cada una. La versión anterior exigía las seis subcadenas
simultáneamente, así que era `conditional` casi siempre — un gate permanentemente
ámbar no lleva señal.

### Comité de Arquitectura (ARB)

`OfficeArbService.ts` es una máquina de estados **con guardas**, modelada sobre
`PublicationApprovalService`. Cuando se escribió, `services/review/` tenía cinco
estados y cero guardas; desde entonces se le añadió su propia tabla de
transiciones (`services/review/reviewTransitions.ts`), aplicada en
`artifactReviewService.recordDecision`.

- No se puede aprobar por encima de un gate `blocked`.
- Un gate `conditional` **sí** es aprobable: ese es exactamente el juicio para
  el que existe el comité. La decisión guarda el veredicto sobre el que se tomó.
- Pedir cambios o rechazar exige un motivo escrito.
- Aprobar con entregables fallidos exige justificarlo.
- El encargo de entrada nunca se muta.

### Separación de funciones

La decisión del comité exige claim `admin`/`superadmin`, verificada en cliente
**y** en `firestore.rules`:

```
match /engagements/{engagementId} {
  allow update: if (isAdmin() || isOwner(projectOwner(projectId)))
    && (request.resource.data.status != 'delivered' || isAdmin());

  match /arbDecisions/{decisionId} {
    allow create: if isAdmin() && request.resource.data.actor.id == request.auth.uid;
    allow update: if false;      // inmutable
    allow delete: if isAdmin();
  }
}
```

El dueño del proyecto ejecuta el encargo; solo un administrador lo lleva a
`delivered`. **El autor no aprueba su propio trabajo.**

### Puente con publicación

`officePublicationBridge.ts` traduce los gates de la Oficina a
`PublicationPreflightFinding`. El mapeo es deliberadamente unidireccional: los
gates alimentan el preflight de publicación, nunca al revés. Publicación
conserva su propio preflight, más estricto.

---

## 6. Persistencia

Subcolección `projects/{projectId}/engagements/{engagementId}`, fuera del
documento del proyecto porque el ejecutor escribe en cada transición y
reescribir el proyecto entero (artefactos incluidos) en cada una sería lento y
un riesgo de actualización perdida.

`OfficeEngagementRepository.ts`:
- **normaliza en lectura** — un documento legado o editado a mano no puede
  tumbar al ejecutor; un enum desconocido cae al valor más seguro
  (`pending` / `intake`) en vez de descartarse;
- **nunca lanza** — devuelve `PersistenceResult`;
- **degrada** al espejo local, igual que artefactos y `agent_actions`.

---

## 7. Personas

Trece en `officeAgentPersonas.ts`. Lo que las hace ejecutables:

```ts
producesArtifactTypes: ArtifactType[];   // el router solo asigna lo declarado
reviewsArtifactTypes: ArtifactType[];    // respalda la separación de funciones
standardIds: string[];                   // enlaza a officeArchitectureKnowledge
maxConcurrentTasks: number;              // techo por persona en el ejecutor
```

Diez de tecnología (Arky, Alejandro, Felipe, Natalia, Mauricio, Ricardo,
Gabriel, Elena, Lucía, Tomás) y tres de dominio asegurador:

| Alias | Rol | Cubre |
|---|---|---|
| **Sofía** | Core Insurance | pólizas, siniestros, suscripción, cobranza, reaseguro, ACORD |
| **Daniel** | Datos y Analítica | modelo actuarial, linaje, reservas, tarificación, PII/PHI |
| **Carmen** | Riesgo y Cumplimiento | Solvencia II, NAIC, HIPAA, DORA, ISO 27001 |

**Para añadir una persona:** una entrada en el registro y una en
`DOMAIN_SIGNALS` de `OfficeAgentRouter.ts`. Nada más.

### 7.1 La ficha configurable — `officeAgentProfile.ts`

El registro es lo que la persona **es** y viene con el producto. La ficha es lo
que esta organización le **añade**, y es lo único que se guarda
(`users/{uid}/agentProfiles/{agentId}`, un documento por agente).

| Configurable | No configurable — esto es gobierno |
|---|---|
| alias, avatar (sólo emoji), rol, instrucción | `orchestrationRole` |
| habilidades, conocimiento y memoria — **se suman**, no sustituyen | `producesArtifactTypes` / `reviewsArtifactTypes` |
| **nivel** de modelo (nunca un id de modelo), tareas simultáneas, disponibilidad | los estándares que sostiene |

Tres propiedades que conviene no perder:

1. **La ficha guarda sólo lo que cambió.** Guardar los valores por defecto los
   congelaría: la próxima versión que mejore la instrucción de Elena no llegaría
   a quien abrió su ficha una vez.
2. **Las listas son aditivas.** Enseñarle a Sofía el canal de corredores de esta
   compañía no puede hacerle olvidar ACORD.
3. **La ficha llega a todos los sitios donde el agente habla.** `AssistantDock`
   pasa `customizedAgentBriefings` y `disabledAgentIds` a `coordinateRequest`, y
   la captura asistida lee la ficha de Arky. Una ficha que cambiara cómo se *ve*
   un agente y no lo que *dice* sería decoración.

Un agente desactivado no se convoca y **no se borra**: los encargos que ya lo
nombran seguirían siendo ilegibles sin él. `planOfficeWorkstreams` garantiza que
el filtro nunca deje el equipo vacío.

Pantalla: `/agents` (`pages/AgentsPage.tsx`).

### El router

Sustituye las siete regex del routing anterior por puntuación determinista:
coincidencia de tipo de artefacto (peso 5) + señal de dominio (peso 3, o el
peso propio de la señal) + preferencia por quien ya participa (2) + sesgo de
especialista (1).

Las señales admiten `notWhen` para suprimir falsos positivos. El caso que lo
motivó: la señal `cloud` de Felipe se activaba con "Health Cloud" y "Financial
Services Cloud" — productos de Salesforce — y mandaba entregables de Salesforce
al arquitecto AWS.

---

### 7.2 Límites de la coordinación y corrección acotada

La orquestación lleva topes **declarados**, no emergentes:

| Límite | Dónde | Valor |
|---|---|---|
| Especialistas por operación | `planOfficeWorkstreams` | 4 |
| Especialistas en paralelo | `executeOfficeOrchestration` | 3 |
| Correcciones del consolidador | `executeOfficeOrchestration` | 1 |

La última es un ciclo **evaluador-optimizador** acotado.
`officeConsolidationReview.ts` evalúa la recomendación *sin llamar a ningún
modelo* —los cuatro criterios son mecánicos: un veredicto explícito, cada
especialista citado, una respuesta parcial que se declara parcial y cuerpo
suficiente— y sólo un fallo gasta la llamada extra. Si la corrección falla, se
conserva la respuesta original: una recomendación imperfecta vale más que un
error donde debería estar la respuesta. La corrección emite su propio evento,
porque dos «recomendación firmada» seguidas no se distinguen.

Detalle y correspondencia con la guía de Anthropic:
`docs/agentes-anthropic-alineacion.md`.

---

## 8. Telemetría

`officeTelemetry.ts` deriva, sin I/O propia: tasa de retrabajo, cambios
solicitados por persona, puntuación media del compilador por persona, minutos
por tarea y consumo de presupuesto. Son los números que dicen **qué prompt de
qué persona arreglar**, en vez de adivinar. `trackEngagementCompleted` los emite
a `observabilityService` y nunca lanza.

---

## 9. Límites conocidos

- **No avanza con la pestaña cerrada.** El estado se persiste por transición y
  reanuda al volver, pero el ejecutor corre en el cliente. Cambiar esto exige un
  ejecutor de servidor, que `CLAUDE.md` hoy excluye (`api/` es solo proxy).
- **Cinco validadores siguen siendo heurísticos de palabra clave**
  (`threat-model`, `cost-model`, `software-design`, `manifest`, `erd`). Los de
  contrato — OpenAPI, AsyncAPI, ADR, C4 y diagrama renderizable — ya validan
  estructura real (`yamlStructure.ts`, encabezados markdown, extracción Mermaid).
  `yamlStructure.ts` **no** es un parser YAML completo: no desciende a estilo
  flow anidado, ni anclas, ni alias. Lo que no puede leer degrada a "no
  declarado", nunca a un falso aprobado.
- **Los paquetes de publicación no tienen reglas Firestore propias**: viven
  dentro del documento del proyecto, así que la máquina de estados de aprobación
  de publicación sigue siendo solo de cliente. El ARB de la Oficina **sí** está
  respaldado por reglas. Migrarlos a subcolección es un cambio propio, con
  migración de datos: ver `docs/technical-debt-audit.md`.
- El presupuesto cuenta **llamadas**, no tokens ni coste.

---

## 10. Qué NO hacer

- No generes artefactos directamente en un puerto del ejecutor: pasa por
  `executeAgentAction`.
- No dejes que el refinamiento de IA salte `validateCharter`.
- No permitas que el mismo `OfficeAgentId` produzca y revise un entregable.
- No hagas que el ejecutor importe React o Firestore.
- No confíes en el veredicto del modelo por encima de la evidencia determinista.
- No muevas un encargo a `delivered` sin pasar por `decideEngagement`.
- No hagas configurable desde una pantalla qué produce, qué revisa o qué papel
  orquestal tiene un agente. Esa mitad de la ficha es gobierno.
- No enrutes la ayuda de un campo de formulario por el equipo completo: es
  tarea de un solo agente (`services/ai/generation/capture/`).
- No quites el tope de correcciones del consolidador. Un bucle sin límite es la
  forma cara de no converger.

---

## Referencias

| Tema | Archivo |
|---|---|
| Máquina de estados de referencia | `services/publicationPipeline/PublicationApprovalService.ts` |
| Transiciones de revisión de artefactos | `services/review/reviewTransitions.ts` |
| Ruta real de producción de artefactos | `services/agent/agentExecutor.ts` |
| Compilación y puntuación | `services/artifactCompiler/`, `docs/artifact-compiler.md` |
| Grafo de conocimiento | `docs/architecture-knowledge-graph.md` |
| Publicación | `docs/publication-pipeline.md`, `docs/publication-governance.md` |
| Patrones de agentes, topes y guardarraíles | `docs/agentes-anthropic-alineacion.md` |
| Seguridad y claims | `docs/security-hardening.md` |
