# F1.2 — Mapa de contextos delimitados (Bounded Contexts) y contratos

Base: `modules.json`, `AGENTS.md`, `lib/eaTerminology.ts`, barriles de `services/`, `docs/oficina-arquitectura.md`.
Decisiones: por confirmar con la oficina (ver §7 del plan). Este documento es la propuesta técnica.

## 1. Contextos de negocio candidatos

| Contexto | Descripción | Agregado raíz | Módulo(s) actuales |
| --- | --- | --- | --- |
| **Identidad y Acceso** | Autenticación, sesiones, perfiles, roles, provisión administrada, invitaciones, SSO/MFA. | `UserProfile`, `AuthSession` | `services/identity` |
| **Iniciativas y Portafolio** | Iniciativas de negocio (`NEG-YYYY-NNN`), objetivos, resultados, KPIs, riesgos, stakeholders, consolidación de lo que proyectos mueven. | `BusinessInitiative` | `services/businessInitiatives` |
| **Proyectos y Atenciones** | Proyectos de arquitectura (`engagementProject`), tracking de progreso/salud/riesgos/hitos, vínculo a iniciativas, repositorio de proyectos. | `ArchitectureProject` | `services/architectureProjects` |
| **Encargos y Gobernanza ARB** | Encargos (`OfficeEngagement`), charter, DAG de tareas, quality gates, decisiones ARB, auditoría, presupuesto IA, personas. | `OfficeEngagement` | `services/architectureOffice` |
| **Artefactos y Publicación** | Artefactos tipados, versiones, compilación, validación, exportación (PDF/PPTX/HTML/…), publicación, pipeline. | `Artifact` | `services/artifacts`, `services/export`, `services/presentation` |
| **Conocimiento Arquitectónico** | Grafo de conocimiento, entidades, relaciones, impacto, frescura, reportes, persistencia. | `ArchitectureKnowledgeGraph` | `services/architectureKnowledgeGraph` |
| **Aprendizaje** | Cursos, módulos, lecciones, notas, progreso, contexto de formación. | `Course`, `TrainingContext` | `services/learning` |

## 2. Capacidades de soporte (no contexts DDD por sí mismas)

| Capacidad | Descripción | Módulo(s) | Uso |
| --- | --- | --- | --- |
| **IA / Generación** | Kernel canónico, adaptadores, guardrails, prompts, trazabilidad, fallback determinista. | `services/ai`, `services/geminiService` (por migrar) | Consumida por contextos vía puertos. |
| **Diagramación** | Mermaid → IR → ReactFlow/Excalidraw/Lucid, layout, calidad visual, validación BPMN, cumplimiento salud. | `services/diagram` | Consumida por Artefactos. |
| **Chat / Agente** | Ejecutor de acciones de agente, memoria, orquestación legacy. | `services/agent`, `services/memory`, `services/chat` | Consumida por Encargos y UI. |
| **Calidad** | Gates de calidad de artefactos, scoring, perfiles, auto-reparación, renderizado. | `services/quality` | Consumida por Encargos/Artefactos. |
| **Observabilidad** | Trazas, métricas, telemetría, logs estructurados. | `services/observability` | Transversal. |
| **Persistencia** | `PersistenceResult`, borradores locales, rutas de colección, listas espejo. | `services/persistence` | Capa técnica, no contexto. |
| **Configuración** | Preferencias, proveedor/modelo IA, flags de refinamiento. | `services/settings` | Consumida por UI y adaptadores. |
| **Publicación Pipeline** | Orquestación de render → validación → exportación → entrega. | `services/publicationPipeline` | Consumida por Artefactos/Exportación. |
| **Portfolio Graph** | Resolución, búsqueda, tipos de grafo de portafolio. | `services/portfolioGraph` | Consumida por Iniciativas/Proyectos. |

## 3. Mapa de relaciones (Context Map)

```
┌─────────────────┐        ┌──────────────────┐        ┌────────────────────┐
│  Identidad y    │◄──────►│  Iniciativas y   │◄──────►│  Proyectos y       │
│  Acceso         │ ACL    │  Portafolio      │ ACL    │  Atenciones        │
└─────────────────┘        └──────────────────┘        └────────────────────┘
        │                            │                            │
        │                            │                            ▼
        │                            │                   ┌────────────────────┐
        │                            └──────────────────►│  Encargos y        │
        │                                                 │  Gobernanza ARB    │
        │                                                 └────────────────────┘
        │                                                       │
        │                            ┌────────────────────┐    │
        └───────────────────────────►│  Artefactos y      │◄───┘
                                     │  Publicación       │
                                     └────────────────────┘
                                              │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
            ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
            │ Conocimiento  │        │   Aprendizaje │        │   Diagramación │
            │ Arquitectónico│        │               │        │               │
            └───────────────┘        └───────────────┘        └───────────────┘
                    │                        │                        │
                    └────────────────────────┴────────────────────────┘
                                             │
                                    ┌─────────────────┐
                                    │      IA /       │
                                    │  Generación     │
                                    └─────────────────┘
```

**Relaciones:**

- **Identidad → Iniciativas/Proyectos/Encargos/Artefactos**: *Anti-Corruption Layer* (ACL). Los contextos consumen `AuthProfile`/`AuthRole`/`uid` vía puerto `IdentityPort`; no conocen Firebase Auth.
- **Iniciativas → Proyectos**: *Shared Kernel* mínimo: `BusinessInitiativeCode` (`NEG-YYYY-NNN`) y `initiativeIds` en `ArchitectureProject`. La iniciativa no conoce el módulo de proyectos; el proyecto declara qué iniciativas sirve.
- **Proyectos → Encargos**: *Conformist*. El encargo requiere `projectId`; el proyecto no conoce encargos. Un proyecto puede tener varios encargos.
- **Encargos → Artefactos**: *Customer-Supplier*. El encargo produce `OfficeCharterDeliverable[]` que nombran plantillas y tipos; Artefactos expone `createArtifact`/`artifactRepository` como *Published Language* (contrato `ArtifactFactoryOptions`, `ArtifactRepository`).
- **Artefactos → Diagramación/Exportación/IA/Calidad/Publicación**: *Customer-Supplier* cada una. Artefactos es el cliente; las capacidades son proveedores con contratos explícitos.
- **Iniciativas/Proyectos → Conocimiento/Portfolio Graph**: *Customer-Supplier*. Consumen consultas y reportes; no escriben el grafo.
- **Aprendizaje**: Aislado; solo identidad compartida.

## 4. Contratos públicos por contexto (puertos)

### 4.1 Identidad y Acceso (`services/identity/index.ts`)

```typescript
// Puerto de consumo (lo que otros contextos importan)
interface IdentityPort {
  // Sesión
  observeAuthState: (callback: (user: AuthUser | null) => void) => () => void;
  currentUser: () => AuthUser | null;
  signInWithEmail: (email: string, password: string) => Promise<AuthUser>;
  signInWithGooglePopup: () => Promise<AuthUser>;
  signOutCurrentUser: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  reauthenticateAndUpdatePassword: (current: string, next: string) => Promise<void>;

  // Perfil y rol (lectura)
  userService: {
    getProfile: (uid: string) => Promise<UserProfile | null>;
    updateDisplayName: (uid: string, name: string) => Promise<void>;
    // ... can(profile, permission) se resuelve en lib/authz
  };

  // Administración (solo admin/superadmin)
  provisionUser: (input: ProvisionInput) => Promise<ProvisionResult>;
  resendInvitation: (uid: string) => Promise<void>;
}
```

### 4.2 Iniciativas y Portafolio (`services/businessInitiatives/index.ts`)

```typescript
interface InitiativePort {
  createBusinessInitiative: (input: CreateInitiativeInput) => Promise<CreateBusinessInitiativeResult>;
  buildInitiative: (raw: unknown) => BusinessInitiative | null;
  normalizeInitiative: (raw: unknown) => BusinessInitiative | null;
  listInitiatives: (filter?: InitiativeFilter) => Promise<BusinessInitiative[]>;
  saveInitiative: (initiative: BusinessInitiative) => Promise<PersistenceResult>;
  deleteInitiative: (id: string) => Promise<PersistenceResult>;
  // Métricas y consolidación
  initiativeMetrics: { ... };
  initiativeDelivery: { consolidateInitiativeDelivery: ... };
}
```

### 4.3 Proyectos y Atenciones (`services/architectureProjects/index.ts`)

```typescript
interface ProjectPort {
  createArchitectureProject: (input: CreateArchitectureProjectInput) => Promise<CreateArchitectureProjectResult>;
  architectureProjectRepository: {
    getProject: (id: string) => Promise<Project | null>;
    saveProject: (project: Project) => Promise<PersistenceResult>;
    listProjects: (filter: ProjectFilter) => Promise<Project[]>;
    forgetProject: (id: string) => void;
  };
  // Tracking
  attentionProgress: (project: Project) => AttentionProgress;
  attentionHealth: (project: Project) => AttentionHealth;
  attentionDaysRemaining: (project: Project) => number | null;
  // Costura con artefactos (estrecha, deliberada)
  appendToArtifactIndex: (projectId: string, artifact: ArtifactIndexEntry) => Promise<PersistenceResult>;
  removeFromArtifactIndex: (projectId: string, artifactId: string) => Promise<PersistenceResult>;
}
```

### 4.4 Encargos y Gobernanza (`services/architectureOffice/index.ts`)

```typescript
interface EngagementPort {
  // Repositorio
  OfficeEngagementRepository: {
    saveEngagement: (eng: OfficeEngagement) => Promise<PersistenceResult>;
    getEngagement: (id: string) => Promise<OfficeEngagement | null>;
    listEngagements: (filter: EngagementFilter) => Promise<OfficeEngagement[]>;
  };
  // Planificación
  planCharterDeterministic: (input: PlanEngagementInput) => OfficeCharter;
  planCharterWithAI: (input: PlanEngagementInput) => Promise<OfficeCharter>;
  validateCharter: (charter: OfficeCharter) => ValidationResult;
  // Ejecución
  OfficeEngagementRunner: {
    run: (engagementId: string, adapters: RunnerAdapters) => Promise<RunResult>;
    resume: (engagementId: string) => Promise<RunResult>;
  };
  // Gobernanza
  OfficeArbService: { decideEngagement: ... };
  officeQualityGates: { evaluateAll: ... };
  // Personas y enrutamiento (lo leen Encargos y UI)
  OFFICE_AGENT_PERSONAS, OfficeAgentRouter, agentRegistry;
}
```

### 4.5 Artefactos (`services/artifacts/index.ts`)

```typescript
interface ArtifactPort {
  // Fábrica (reglas de identidad/versionado/compilation)
  createArtifact: (input: ArtifactFactoryInput) => Promise<ArtifactFactoryResult>;
  createArtifactVersion: (input: VersionInput) => Promise<VersionResult>;
  reviseArtifact: (input: RevisionInput) => Promise<RevisionResult>;
  // Repositorio
  artifactRepository: {
    getArtifact: (id: string) => Promise<Artifact | null>;
    saveArtifact: (artifact: Artifact) => Promise<PersistenceResult>;
    listArtifacts: (filter: ArtifactFilter) => Promise<Artifact[]>;
  };
  // Vista y render
  buildArtifactViewModel: (input: ViewInput) => ArtifactViewModel;
  buildArtifactRenderState: (input: RenderInput) => RenderState;
  // Exportación
  performArtifactExport: (input: ExportInput) => Promise<ExportResult>;
  // Fallbacks deterministas
  buildDeterministicArtifactFallback: (type: ArtifactType) => ArtifactContent;
}
```

### 4.6 Capacidades de soporte (puertos técnicos)

| Capacidad | Contrato principal | Consumidores |
| --- | --- | --- |
| IA | `AIProviderCapabilities`, `routeRequest`, `AIContentPart`, `AIToolDefinition` | Encargos, Artefactos, Chat, Diagramación |
| Diagramación | `mermaidToIR`, `irToReactFlow`, `layoutQualityService`, `visualGateGuard` | Artefactos, Encargos |
| Exportación | `ExportService`, `ExportRegistry`, adapters (PDF, PPTX, HTML, ...) | Artefactos, Publicación |
| Calidad | `ArtifactQualityGateService`, `DiagramQualityService`, `qualityProfiles` | Encargos, Artefactos |
| Observabilidad | `globalObservabilityService`, `telemetry` | Transversal |
| Persistencia | `executeRemoteWrite`, `writeLocalDraft`, `PersistenceResult`, `localDraftStore` | Todos los repositorios |

## 5. Propiedad de datos y escrituras

| Colección / Tabla | Contexto propietario | Escritores permitidos | Lectores (contrato) |
| --- | --- | --- | --- |
| `users/{uid}` | Identidad | `userProvisioningService` (admin), `userService` (dueño: campos no privilegiados) | Identidad, Proyectos (perfil), Encargos (actor), Artefactos (autor) |
| `businessInitiatives/{id}` | Iniciativas | `BusinessInitiativeRepository` | Iniciativas, Proyectos (linkedProjects), Encargos (initiativeIds) |
| `projects/{id}` | Proyectos | `ArchitectureProjectRepository` | Proyectos, Iniciativas (consolidación), Encargos (projectId), Artefactos (índice) |
| `engagements/{id}` | Encargos | `OfficeEngagementRepository` (runner), `OfficeArbService` (decideEngagement) | Encargos, Artefactos (deliverable → artifact) |
| `artifacts/{id}` | Artefactos | `ArtifactRepository` (factory), `artifactPersistence` | Artefactos, Proyectos (índice), Encargos (deliverable), Exportación |
| `agent_actions/{traceId}` | IA/Chat | `executeAgentAction` | Encargos (traceIds), Observabilidad |
| `courses/`, `training/*` | Aprendizaje | `TrainingService` | Aprendizaje |
| `architectureKnowledge/*` | Conocimiento | `ArchitectureKnowledgeGraphService` | Conocimiento, Portfolio Graph |

**Regla**: un contexto no escribe en la colección de otro. Lecturas transversales solo por contrato/proyección aprobada (p. ej. `initiativeDelivery`, `projectDocumentMapper`).

## 6. Eventos internos (para desacoplamiento real)

| Evento | Emisor | Consumidores | Propósito |
| --- | --- | --- | --- |
| `InitiativeCreated` | Iniciativas | Proyectos (opcional: notificación) | Trigger de UI, no lógica de negocio |
| `ProjectCreated` | Proyectos | Iniciativas (consolidación diferida), Encargos (disponible para intake) | |
| `EngagementDelivered` | Encargos | Artefactos (publicar), Iniciativas (consolidar), Observabilidad | |
| `ArtifactPublished` | Artefactos | Exportación, Publicación Pipeline, Conocimiento (indexar) | |
| `UserProvisioned` | Identidad | Observabilidad, Auditoría | |

**Implementación**: *outbox pattern* en la misma transacción que la escritura del agregado; idempotencia por `eventId`; reintentos con backoff; dead-letter para fallos permanentes. No CQRS completo ni event sourcing.

## 7. Decisiones de diseño (resueltas 2026-09-12)

1. **Multitenencia — RESUELTA: una sola organización (opción simple).** No se añade `organizationId`/`tenantId`. RLS por usuario, rol y alcance de proyecto. El modelo sigue siendo *single-tenant*; la dimensión de organización no se prepara en esta PoC.
2. **SSO/MFA — RESUELTA: simple.** Email/contraseña + Google, como hoy. Sin MFA y sin SSO corporativo (SAML/OIDC) en la PoC.
3. **Residencia de datos — RESUELTA: Estados Unidos.** Proyecto Supabase **`ArkyDB-US` (`btbhkmckrazoayaoorys`) en `us-east-1`**, creado el 2026-09-12. El proyecto anterior en `ca-central-1` se conserva intacto hasta verificar el nuevo y ya no es destino de trabajo.
4. **Clasificación de información — RESUELTA: opción B**, PII de terceros (personas nombradas por la aseguradora), **sin datos de salud**. No exige HIPAA/BAA, pero sí régimen de protección de datos: acceso mínimo, retención definida, control de exportaciones y logs sin contenido sensible. La PoC sigue sin datos reales durante las pruebas.
5. **Contratos de integración**: pendiente (§7.1).

### 7.1 Pendientes todavía

- **Integraciones**: ¿qué sistemas externos consumen/producen datos (ERP, CRM, core de seguros)? Define *Open Host Service* o *Anti-Corruption Layer* adicionales. **Es la única decisión de diseño de F1 que sigue abierta.**

## 8. Métricas de acoplamiento (para seguimiento en F3/F5)

- Cero importaciones `firebase/*` fuera de `services/identity` y adaptadores de persistencia.
- Cero importaciones de internals de un contexto en otro (solo `index.ts` del barril).
- Fan-out UI → servicios ≤ 2 módulos por pantalla (gate actual).
- Número de deep imports en `DEEP_IMPORT_BUDGET` solo disminuye.
- Tiempo de build y test por contexto (target: < 2 min por contexto en shard).