# F1.3 — Agregados, invariantes, eventos y límites transaccionales

Base: `services/architectureProjects/ArchitectureProjectTypes.ts`, `services/architectureOffice/OfficeTypes.ts`, `services/businessInitiatives/BusinessInitiativeTypes.ts`, `services/artifacts/artifactFactory.ts`, `lib/authz/permissions.ts`, `lib/ids.ts`.

## 1. Agregados raíces por contexto

### 1.1 Identidad y Acceso

| Agregado | Identidad | Invariante principal | Raíz de consistencia |
| --- | --- | --- | --- |
| `UserProfile` | `uid` (Firebase UID) | `role ∈ AUTH_ROLES`, `uid` inmutable, `email` verificado para roles ≥ `architect` | `UserProfile` |
| `AuthSession` | `uid` + `sessionId` | Expiración ≤ 1h (access token), revocación por `signOut` o admin, MFA verificado si política lo exige | `AuthSession` |

**Límite transaccional**: escritura de perfil y claim de rol en misma operación atómica (Firestore transaction o Supabase RPC). El `uid` nunca cambia.

### 1.2 Iniciativas y Portafolio

| Agregado | Identidad | Invariante principal | Raíz de consistencia |
| --- | --- | --- | --- |
| `BusinessInitiative` | `id` (UUID) + `code: BusinessInitiativeCode` (`NEG-YYYY-NNN`) | `code` único global, `outcomes` no vacíos si `status ≠ draft`, `linkedProjectIds` ⊆ proyectos existentes | `BusinessInitiative` |

**Límite transaccional**: creación de iniciativa + reserva de código en misma transacción. Consolidación (`initiativeDelivery`) es *eventual* (outbox), no transaccional.

### 1.3 Proyectos y Atenciones

| Agregado | Identidad | Invariante principal | Raíz de consistencia |
| --- | --- | --- | --- |
| `ArchitectureProject` | `id` (UUID) | **Una atención siempre pertenece a una iniciativa** (`initiativeIds ⊆ BusinessInitiative.id`), `ownerId` = `uid` de `architect`/`reviewer`, `artifactIndex` consistente con subcolección `artifacts/{id}` | `ArchitectureProject` |

**Límite transaccional**: `createArchitectureProject` rechaza si `initiativeIds` vacío o contiene IDs inexistentes. Escritura de proyecto + índice de artefactos en misma transacción. Actualización de `artifactCount` y `artifactIndex` atómica con creación/borrado de artefacto.

### 1.4 Encargos y Gobernanza ARB

| Agregado | Identidad | Invariante principal | Raíz de consistencia |
| --- | --- | --- | --- |
| `OfficeEngagement` | `id` (`eng-*`) | `charter.deliverables[]`: cada uno tiene `assigneeId ≠ reviewerId`, `templateName ∈ ARTIFACT_TEMPLATES`, `artifactType` declarado por `assigneeId`. DAG acíclico (`findTaskCycle === []`). `status` sigue ciclo de vida válido. Presupuesto IA: `budget.consumedAiCalls ≤ budget.maxAiCalls`. | `OfficeEngagement` |

**Límite transaccional**: engagement completo (charter + tasks + budget + auditTrail) se persiste como documento único. Transiciones de estado (`runId` stamped) y decisiones ARB en misma escritura. La regla "productor ≠ revisor" se valida en `validateCharter` y `OfficeAgentRouter.assignDeliverable`.

### 1.5 Artefactos y Publicación

| Agregado | Identidad | Invariante principal | Raíz de consistencia |
| --- | --- | --- | --- |
| `Artifact` | `id` (`art-*`) + `versionGroupId` | `versionGroupId` inmutable tras creación; cada versión `versionNumber` estrictamente creciente; `content` válido para `artifactType` (validador determinista); `projectId` existe y usuario tiene `deliverable:write` en ese proyecto. | `Artifact` (por `versionGroupId`) |

**Límite transaccional**: `createArtifact` escribe artefacto + actualiza `artifactIndex` en proyecto + invalida caché (`forgetProject`). `reviseArtifact` crea nueva versión en mismo `versionGroupId` + actualiza índice. Concurrencia optimista vía `expectedUpdatedAt` en `updateProjectArtifacts`.

### 1.6 Conocimiento Arquitectónico

| Agregado | Identidad | Invariante principal | Raíz de consistencia |
| --- | --- | --- | --- |
| `ArchitectureKnowledgeGraph` | `graphId` (singleton por organización) | Entidades y relaciones versionadas; `freshness` ≤ umbral configurable; consultas de impacto no modifican el grafo. | `ArchitectureKnowledgeGraph` |

**Límite transaccional**: actualización por lotes (batch) de entidades/relaciones; frescura recalculada en job programado, no en ruta crítica.

### 1.7 Aprendizaje

| Agregado | Identidad | Invariante principal | Raíz de consistencia |
| --- | --- | --- | --- |
| `Course` | `id` | `moduleIds` ordenados, cada módulo tiene `lessonIds`; progreso por usuario (`userId` + `courseId`) único. | `Course` |
| `TrainingContext` | `userId` + `courseId` | `completedLessonIds ⊆ course.moduleIds.flatMap(l.lessonIds)`, `currentLessonId ∈ course` o `null`. | `TrainingContext` |

---

## 2. Invariantes críticas (testeables sin UI ni SDK)

| Invariante | Contexto | Dónde se aplica | Prueba |
| --- | --- | --- | --- |
| `initiativeIds` no vacío en `ArchitectureProject` | Proyectos | `createArchitectureProject` (factory) | `__tests__/architectureProjects/architectureProjectFactory.test.ts` |
| `code` único (`NEG-YYYY-NNN`) | Iniciativas | `createBusinessInitiative` + transacción Firestore | `__tests__/businessInitiatives/businessInitiativeFactory.test.ts` |
| `assigneeId ≠ reviewerId` por entregable | Encargos | `OfficeAgentRouter.assignDeliverable`, `validateCharter` | `__tests__/architectureOffice/OfficeAgentRouter.test.ts`, `OfficeEngagementPlanner.test.ts` |
| DAG acíclico | Encargos | `findTaskCycle` en `planCharterDeterministic` y refinamiento IA | `__tests__/architectureOffice/OfficeTypes.test.ts` |
| `versionGroupId` inmutable, `versionNumber` creciente | Artefactos | `artifactFactory.createArtifactVersion`, `reviseArtifact` | `__tests__/artifacts/artifactFactory.test.ts` |
| `role` no auto-asignable para `admin`/`superadmin` | Identidad | `userProvisioningService.provisionUser`, `firestore.rules` | `__tests__/identity/userProvisioningService.test.ts`, rules test |
| `PersistenceResult.success === false` para borrador local | Persistencia | `writeLocalDraft`, `executeRemoteWrite` | `__tests__/persistence/*.test.ts` |

---

## 3. Eventos de dominio (outbox pattern)

| Evento | Payload mínimo | Emisor | Consumidores | Idempotencia |
| --- | --- | --- | --- | --- |
| `InitiativeCreated` | `{ initiativeId, code, title, initiativeIds[] }` | `createBusinessInitiative` | Proyectos (notificación UI), Observabilidad | `eventId = initiativeId:created` |
| `ProjectCreated` | `{ projectId, initiativeIds[], ownerId }` | `createArchitectureProject` | Iniciativas (consolidación diferida), Encargos (intake), Observabilidad | `eventId = projectId:created` |
| `EngagementDelivered` | `{ engagementId, projectId, initiativeIds[], arbDecisionId }` | `OfficeArbService.decideEngagement` (verdict=approved) | Artefactos (publicar), Iniciativas (consolidar), Observabilidad, Exportación | `eventId = arbDecisionId` |
| `ArtifactPublished` | `{ artifactId, versionGroupId, projectId, artifactType, versionNumber }` | `artifactFactory.reviseArtifact` / `createArtifact` (si publicado directo) | Exportación, Publicación Pipeline, Conocimiento (indexar), Observabilidad | `eventId = artifactId:v{versionNumber}` |
| `UserProvisioned` | `{ uid, email, role, provisionedBy }` | `userProvisioningService.provisionUser` | Observabilidad, Auditoría | `eventId = uid:provisioned` |
| `TaskCompleted` | `{ engagementId, taskId, runId, assigneeId, traceIds[] }` | `OfficeEngagementRunner` (task → completed) | Encargos (scheduling), Observabilidad | `eventId = taskId:completed:{runId}` |
| `QualityGateEvaluated` | `{ engagementId, gateId, status, score, blockingValidatorIds[] }` | `officeQualityGates.evaluateAll` | Encargos (bloqueo/continuación), Observabilidad | `eventId = engagementId:gate:{gateId}:{runId}` |

**Implementación técnica**:
- Tabla/colección `outbox_events` con `eventId` PK, `eventType`, `payload` (JSON), `createdAt`, `processedAt` (null al inicio), `retryCount`.
- Misma transacción que la escritura del agregado (Firestore transaction / PostgreSQL `INSERT ... RETURNING`).
- Procesador en background (Edge Function / pg_cron / worker) lee `processedAt IS NULL ORDER BY createdAt`, publica a consumidores (Supabase Realtime, webhook, cola), marca `processedAt` en éxito. Reintentos con backoff exponencial; dead-letter tras N fallos.
- Consumidores deduplican por `eventId`.

---

## 4. Comandos y consultas (CQRS ligero)

| Contexto | Comandos (escrituras) | Consultas (lecturas) |
| --- | --- | --- |
| Identidad | `provisionUser`, `signIn*`, `signOut`, `updateDisplayName`, `reauthenticateAndUpdatePassword`, `sendPasswordReset` | `currentUser`, `observeAuthState`, `userService.getProfile`, `readRoleClaim` |
| Iniciativas | `createBusinessInitiative`, `saveInitiative`, `deleteInitiative`, `normalizeInitiative` | `listInitiatives`, `buildInitiative`, `initiativeMetrics`, `initiativeDelivery.consolidateInitiativeDelivery` |
| Proyectos | `createArchitectureProject`, `architectureProjectRepository.saveProject`, `forgetProject`, `appendToArtifactIndex`, `removeFromArtifactIndex` | `architectureProjectRepository.getProject`, `listProjects`, `attentionProgress`, `attentionHealth`, `attentionDaysRemaining` |
| Encargos | `OfficeEngagementRepository.saveEngagement`, `OfficeEngagementRunner.run/resume`, `OfficeArbService.decideEngagement`, `officeQualityGates.evaluateAll` | `OfficeEngagementRepository.getEngagement`, `listEngagements`, `officePortfolio`, `summarizeEngagementProgress`, `selectSchedulableTasks` |
| Artefactos | `createArtifact`, `createArtifactVersion`, `reviseArtifact`, `artifactRepository.saveArtifact`, `performArtifactExport` | `artifactRepository.getArtifact`, `listArtifacts`, `buildArtifactViewModel`, `buildArtifactRenderState`, `buildDeterministicArtifactFallback` |
| Conocimiento | `ArchitectureGraphPersistenceAdapter.upsertEntities`, `ArchitectureGraphPersistenceAdapter.upsertRelations`, `ArchitectureImpactAnalysisService.analyze` | `ArchitectureKnowledgeGraphService.query`, `ArchitectureGraphReport`, `ArchitectureGraphFreshness` |
| Aprendizaje | `TrainingService.saveCourse`, `TrainingService.saveModule`, `TrainingService.saveLesson`, `TrainingService.recordProgress` | `TrainingService.getCourse`, `TrainingService.getTrainingContext`, `TrainingService.listCourses` |

---

## 5. Puertos por agregado (resumen para F3)

| Agregado | Puerto de repositorio | Puerto de identidad | Puerto de archivos | Puerto de IA | Puerto de tiempo |
| --- | --- | --- | --- | --- | --- |
| `UserProfile` | `UserRepository` | — | — | — | `Clock` |
| `BusinessInitiative` | `InitiativeRepository` | `IdentityPort` (autor) | — | — | `Clock` |
| `ArchitectureProject` | `ProjectRepository` | `IdentityPort` (owner) | — | — | `Clock` |
| `OfficeEngagement` | `EngagementRepository` | `IdentityPort` (actor) | `FilePort` (adjuntos charter) | `AIPort` (refinamiento) | `Clock` |
| `Artifact` | `ArtifactRepository` | `IdentityPort` (autor) | `FilePort` (binarios exportados) | `AIPort` (generación) | `Clock` |
| `Course` | `CourseRepository` | `IdentityPort` (trainer) | `FilePort` (recursos) | — | `Clock` |

**Regla**: cada puerto es una *interface* en `domain/`; la implementación concreta (Supabase, Firebase, FS, memoria) vive en `infrastructure/adapters/`. El dominio no importa adaptadores.