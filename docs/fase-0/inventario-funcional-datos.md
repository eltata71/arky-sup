# F0.1 / F0.5 — Inventario funcional y de datos inferido del código

## Estado, alcance y evidencia

**Diagnóstico local documental. F0.1: inventario técnico preparado; aceptación funcional revisada, validada y aprobada (2026-09-12). F0.5: porción inferible del código más inventario productivo revisado y aprobado (2026-09-12).** No certifica uso actual, despliegue de reglas, integridad productiva ni ausencia de datos adicionales: la aprobación la otorgó la organización, no esta inspección.

Se inspeccionaron rutas React, matriz de permisos, reglas Firestore, repositorios y mapeadores, servicios de identidad/aprendizaje/exportación, adjuntos y persistencia local. Las referencias `archivo:línea` son relativas a la raíz del repositorio y corresponden al código disponible durante la inspección, no a una revisión Git verificada. Se leyeron `AGENTS.md` y la skill local `.claude/skills/documentation.md:8-11` (documentar comportamiento leído, no supuestos).

Mandato: `docs/plan-transformacion-supabase-ddd.md:37-46`, especialmente la aceptación **con arquitectos** y el acceso **autorizado a datos reales**. No se leyeron archivos de secretos, credenciales, entornos ni almacenamiento real del navegador; no se accedió a Firebase, Supabase, proveedores IA, hosting ni otros sistemas remotos. No se ejecutaron comandos Git ni se modificó código. Quality, auditoría y E2E corresponden a los agentes paralelos: aquí no se declaran ejecutados.

## 1. Superficie funcional y rutas

`ProtectedRoute` exige sesión y, cuando recibe permiso, consulta `can`; espera la carga del perfil antes de redirigir (`App.tsx:104-125`). La mayoría de rutas no lleva permiso específico en el router: el permiso de operación y el alcance deben verificarse adicionalmente en pantalla, caso de uso y reglas.

| Rutas | Capacidad identificada | Protección en router / evidencia |
|---|---|---|
| `/auth` | Inicio de sesión; correo/contraseña y Google; recuperación y cuenta | Pública; `App.tsx:244`; `services/identity/authService.ts:100-105,133-152` |
| `/` | Dashboard, acceso al portafolio y comandos de asistencia | Sesión; `App.tsx:245`; comandos en `App.tsx:148-166` |
| `/initiatives`, `/initiatives/:initiativeId` | Captura, consulta y detalle de iniciativas de negocio | Sesión; `App.tsx:248-249` |
| `/projects`, `/workspace/:projectId` | Listado de proyectos/atenciones; trabajo con artefactos y contexto | Sesión; `App.tsx:246,255`; wrapper en `App.tsx:80-83` |
| `/sdd-process/:projectId` | Vista de proceso SDD y descarga | Sesión; `App.tsx:256`; descarga en `pages/SDDProcessView.tsx:266` |
| `/office`, `/office/:engagementId` | Oficina, encargos, ejecución de tareas, gates y comité ARB | Sesión; `App.tsx:247,250`; `context/OfficeContext.tsx:293-397` |
| `/agents` | Configuración personal de fichas de especialistas | Sesión; `App.tsx:251`; `services/architectureOffice/officeAgentProfile.ts:186,243`; `firestore.rules:416-417` |
| `/training` | Centro de formación: cursos, notas, contexto y progreso | Sesión; `App.tsx:253`; `services/learning/trainingService.ts:42-45,175-280` |
| `/settings` | Preferencias personales, proveedor/modelo IA | Sesión; `App.tsx:252`; `lib/authz/permissions.ts:182-185` |
| `/users` | Directorio y administración de cuentas | Sesión + `users:read`; `App.tsx:254` |
| `*` | Página de no encontrado | Sesión; `App.tsx:257` |

Ayuda de plataforma y atajos se cargan bajo demanda; observabilidad y aviso de persistencia se montan en la aplicación (`App.tsx:51-65,231,274-280`). No constituyen rutas independientes ni prueban telemetría centralizada.

## 2. Perfiles y matriz de permisos declarada

Leyenda: **Sí** = permiso declarado; **—** = no concedido por la matriz. No equivale a acceso a cualquier registro ni a una prueba del backend. Fuente completa: `lib/authz/permissions.ts:105-126,152-239`.

| Permiso / grupo exacto | viewer | architect | reviewer | trainer | admin | superadmin |
|---|---|---|---|---|---|---|
| `portfolio:read` | Sí | Sí | Sí | Sí | Sí | Sí |
| `initiative:write`, `project:write` | — | Sí | Sí | — | Sí | Sí |
| `deliverable:write`, `deliverable:run`, `artifact:write` | — | Sí | Sí | — | Sí | Sí |
| `charter:approve`, `arb:decide`, `publication:publish` | — | — | Sí | — | Sí | Sí |
| `training:consume` | Sí | Sí | Sí | Sí | Sí | Sí |
| `training:author` | — | — | — | Sí | Sí | Sí |
| `training:analytics` | — | — | Sí | Sí | Sí | Sí |
| `users:read`, `users:create`, `users:update`, `users:delete` | — | — | — | — | Sí | Sí |
| `users:grant-privileged` | — | — | — | — | — | Sí |
| `settings:manage` | Sí | Sí | Sí | Sí | Sí | Sí |

### Alcances, excepciones y divergencias que no debe ocultar la matriz

- **Propiedad por UID, no membresía organizacional demostrada.** Proyectos e iniciativas guardan `userId`; lectura propia para perfiles con `portfolio:read`, lectura transversal para reviewer/admin/superadmin por `canReadAnyPortfolio`; actualización/eliminación propia con permiso o administración (`firestore.rules:173-203,320-329`). No inferir multitenencia por geografía de operación.
- **Reviewer no es editor universal:** puede leer portafolio ajeno y decidir ARB, pero la edición ordinaria de proyecto/artefacto ajeno sigue requiriendo administración o propiedad (`firestore.rules:201-208,291-294`).
- Alias heredados: `student` → `architect`, `teacher` → `trainer` (`lib/authz/permissions.ts:255-258`). El cliente prioriza claim no vacío y, si es ilegible, falla cerrado; las reglas priorizan la existencia del campo `role` del token (`lib/authz/permissions.ts:297-303`; `firestore.rules:63-74`). Confirmar paridad para claims vacíos/nulos mediante pruebas, no solo tabla de roles.
- Sin perfil/rol legible, `can` no concede permisos (`lib/authz/permissions.ts:327-335`), pero hay reglas basadas solo en identidad/propiedad: settings propios, perfil propio, fichas de agentes y datos LMS propios (`firestore.rules:334-336,374,393,416-429`). No describir esto como denegación global de una cuenta sin rol.
- La concesión de roles privilegiados corresponde solo a superadmin; actualizaciones administrativas no pueden dirigirse al propio usuario y verifican tanto rol anterior como nuevo (`firestore.rules:379-399`; `lib/authz/permissions.ts:361-364`).
- **Revisión de artefactos no es decisión ARB.** Crear comentarios y `reviewDecisions` exige `portfolio:read` y autor igual al llamante, pero esas cláusulas no exigen propiedad/acceso al proyecto (`firestore.rules:215-236`). Señal para auditoría: verificar escrituras cruzadas por API directa con IDs conocidos. No se ensayó explotación.
- **Separación productor/revisor de agentes no prueba anti-autoaprobación humana.** El planificador valida especialistas distintos (`services/architectureOffice/OfficeEngagementPlanner.ts:365`), mientras entregar un encargo exige `arb:decide`, sin desigualdad explícita entre aprobador y propietario en la regla (`firestore.rules:291-302`). Reviewer/admin también tienen permisos de autoría. Además, `allow create` del encargo no restringe el estado inicial a uno no entregado (`firestore.rules:284`). Requiere pruebas negativas y decisión de política.
- Hay permisos de producto sin función backend homónima en la matriz de reglas revisada: ejecutar entregable, aprobar charter y publicar. Las escrituras de publicaciones están autorizadas como escritura de artefactos/propiedad, no por `publication:publish` (`firestore.rules:254-256`). No afirmar paridad de comandos sensibles por pasar una comparación de funciones de permisos.

## 3. Recorridos críticos a proteger y guion UAT propuesto

**Todos pendientes de ejecución/aceptación con usuarios.** Responsable funcional, arquitectos, revisores y administradores deben ser identificados por la oficina; no se asignan nombres ficticios.

| ID / recorrido | Pasos y resultado que debe aceptarse | Evidencia del comportamiento a caracterizar |
|---|---|---|
| RC-01 Identidad y acceso | Administrador provisiona cuenta; invitado define contraseña; login correo/Google; recuperar contraseña, cerrar sesión; rechazar sesión sin perfil autorizado; conservar sesión del administrador | `services/identity/userProvisioningService.ts:124-147,172-180`; `services/identity/authService.ts:100-152`; `App.tsx:117-122` |
| RC-02 Iniciativa → atención | Capturar necesidad, objetivos, resultados, KPIs, hitos, riesgos y documentos; crear atención vinculada; rechazar atención sin iniciativa; consultar contribuciones y vínculos rotos | `services/businessInitiatives/BusinessInitiativeRepository.ts:95-183,210-220`; `services/architectureProjects/architectureProjectFactory.ts:103-108`; `services/architectureProjects/attentionTracking.ts:159-202`; `AGENTS.md:143-149` |
| RC-03 Trabajo y concurrencia | Abrir portafolio sin cargar todos los cuerpos; hidratar artefactos al entrar al proyecto; editar y versionar; provocar dos ediciones y conflicto; no perder versión confirmada | `services/architectureProjects/ArchitectureProjectRepository.ts:29-56`; `services/architectureProjects/projectWrites.ts:123-179`; `services/persistence/collectionPaths.ts:43-57` |
| RC-04 Encargo y ejecución | Crear charter determinista/asistido; revisar asignaciones distintas; aprobar antes de ejecutar; ejecutar/cancelar DAG; evaluar gates sobre artefactos realmente generados | `context/OfficeContext.tsx:260-356,363-365`; `services/architectureOffice/OfficeEngagementPlanner.ts:365`; `services/architectureOffice/officeOrchestration.ts:140` |
| RC-05 Comité ARB | Reviewer consulta proyecto ajeno; justifica decisión; bloquea aprobación sin rol y autoaprobación según política por acordar; comprobar acuerdo entre estado y auditoría inmutable ante fallo parcial | `context/OfficeContext.tsx:378-397`; `services/architectureOffice/OfficeArbService.ts:60,130`; `firestore.rules:282-305` |
| RC-06 Generación y diagramación | Crear/refinar artefacto con proveedor autorizado; revisar resultado determinista; editar/renderizar documento/diagrama; conservar fuente y versión; ensayar error de proveedor y adjunto | `AGENTS.md:211-238`; `components/ChatInterface.tsx:31-41,170`; `services/export/exportRegistry.ts:15-19,28`; `services/architectureOffice/OfficeRunnerAdapters.ts:384` |
| RC-07 Revisión colaborativa | Comentar/responder, registrar decisión de artefacto, ver actualización remota; repetir sin red, reconectar y comprobar deduplicación e identidad del autor | `services/review/hybridArtifactReviewRepository.ts:43-64,161-203,229-294`; `firestore.rules:215-236` |
| RC-08 Publicación/exportación | Generar paquete gobernado, revisar permiso y contenido; exportar documento, tabla, diagrama y presentación; abrir archivos en herramientas reales y comprobar referencias | `firestore.rules:254-256`; `services/export/exportService.ts:50`; `services/export/exportRegistry.ts:6-25`; `services/export/exportValidation.ts:196,288` |
| RC-09 Conocimiento y memoria | Cargar documento, aceptar solo sugerencias pertinentes, guardar contexto/memoria; revisar grafo y consistencia de vínculos con artefactos | `components/MemoryCenterModal.tsx:279,350-354`; `services/architectureProjects/projectDocumentMapper.ts:40-51`; `services/persistence/collectionPaths.ts:35-40` |
| RC-10 Formación | Consumir curso, notas, progreso/contexto; autor mantiene cursos; recuperar progreso desde otro dispositivo; validar certificado/descarga y accesos cruzados | `services/learning/trainingService.ts:85-107,175-280`; `firestore.rules:345-355,420-429`; `pages/LMS/CourseView.tsx:52` |
| RC-11 Fallos, offline y eliminación | Cortar red antes/durante escritura, recargar, reconectar, cambiar de cuenta; verificar borrador vs confirmado; ensayar eliminación y localizar descendientes sobrantes | `services/persistence/localDraftStore.ts:43-78`; `services/persistence/mirroredList.ts:59-87`; `services/architectureProjects/projectWrites.ts:185-203` |

## 4. Inventario lógico de datos y repositorios

**Volumen, bytes, cardinalidad, distribución por propietario, residencia y retención: desconocidos para todas las filas.** Las rutas son contratos locales, no un listado de colecciones existentes obtenido de Firebase. Un campo opcional del modelo no prueba que el dato esté ausente en documentos históricos.

| Ruta lógica | Datos / referencias / propietario | Repositorio o acceso y evidencia |
|---|---|---|
| Firebase Auth (fuera de Firestore) | Identidad UID, correo, nombre, proveedores y sesiones; separar de documento de perfil | `services/identity/authService.ts:24-39,95-105`; provisión `services/identity/userProvisioningService.ts:130-147` |
| `users/{uid}` | Perfil, rol, UID, correo/nombre; relación con Auth por UID | `services/identity/userProvisioningService.ts:133-143`; `services/identity/userService.ts:46-54`; reglas `firestore.rules:373-403` |
| `users/{uid}/agentProfiles/{agentId}` | Overrides personales de agentes: conocimiento, memoria, modelo/configuración; catálogo de agentes en código | `services/architectureOffice/OfficeAgentProfileRepository.ts:123`; `services/persistence/collectionPaths.ts:79-90`; `firestore.rules:416-417` |
| `businessInitiatives/{initiativeId}` | Necesidad, objetivos, resultados/KPIs, riesgos, stakeholders, hitos y documentos inline; `userId` | `services/businessInitiatives/BusinessInitiativeRepository.ts:95-183,197-220,323`; `firestore.rules:320-329` |
| `projects/{projectId}` | Atención/proyecto, `initiativeIds`, `linkedBusinessProjects`, seguimiento `attention`, contexto y memorias, autor `userId`, fechas, recuento y marcadores de layout | `services/architectureProjects/ArchitectureProjectRepository.ts:29-56`; `services/architectureProjects/projectDocumentMapper.ts:36-64` |
| `projects/{projectId}/artifacts/{artifactId}` | Cuerpos/representaciones de artefactos y su estado; propietario heredado del proyecto. Inspeccionar documentos originales para inventariar todas las variantes/versiones sin podarlas | `services/artifacts/artifactPersistence.ts:265`; `services/architectureProjects/projectWrites.ts:105-109`; `firestore.rules:205-208` |
| `.../artifacts/{artifactId}/comments/{commentId}` | Comentarios con autor, fechas y estado de conversación | `services/review/firestoreArtifactReviewRepository.ts:83`; `services/review/hybridArtifactReviewRepository.ts:43-52`; reglas `firestore.rules:215-226` |
| `.../artifacts/{artifactId}/reviewDecisions/{decisionId}` | Decisiones de revisión de artefacto; autor y fecha; actualización denegada, eliminación administrativa | `services/review/firestoreArtifactReviewRepository.ts:85`; `services/review/hybridArtifactReviewRepository.ts:55-64`; `firestore.rules:231-236` |
| `projects/{projectId}/aggregates/architectureGraph` | Grafo arquitectónico separado del documento proyecto; referencias derivadas que hay que reconciliar | `services/persistence/collectionPaths.ts:35-40`; `services/architectureProjects/projectDocumentMapper.ts:25-33`; `firestore.rules:245-247` |
| `projects/{projectId}/aggregates/artifactIndex` | Índice compacto de identidad/resumen de artefactos; conciliación con `artifactCount` | `services/persistence/collectionPaths.ts:43-57`; `services/architectureProjects/projectWrites.ts:97-100` |
| `projects/{projectId}/publications/{packageId}` | Paquetes de publicación y auditoría; agregado separado, no bucket de binarios | `services/persistence/collectionPaths.ts:35-37,58`; `services/architectureProjects/projectWrites.ts:101-104`; `firestore.rules:250-256` |
| `projects/{projectId}/history/chat` | Historial de chat por proyecto; comprobar retención/compactación antes de migrar | `services/persistence/collectionPaths.ts:63-64`; `services/architectureProjects/projectWrites.ts:53,190,196-201` |
| `projects/{projectId}/agent_actions/{traceId}` | Trazas de acciones del agente; creación permitida, actualizaciones denegadas, borrado admin | `services/agent/AgentActionRepository.ts:65`; `firestore.rules:264-270`; espejo acotable `services/persistence/mirroredList.ts:72-80` |
| `projects/{projectId}/engagements/{engagementId}` | Charter, tareas, estado, referencias a iniciativas/proyectos de negocio, auditoría y espejo de decisión; hereda alcance del proyecto | `services/architectureOffice/OfficeEngagementRepository.ts:279-327`; `context/OfficeContext.tsx:270-282`; `firestore.rules:282-295` |
| `.../engagements/{engagementId}/arbDecisions/{decisionId}` | Decisión humana ARB, actor, evidencia; actualización denegada, borrado admin | `services/architectureOffice/OfficeEngagementRepository.ts:348-364`; `firestore.rules:299-304` |
| `settings/user_{uid}`, `settings/global` | Preferencias por usuario y ruta global compatible; separar configuración de referencias a credenciales | `services/settings/SettingsRepository.ts:37-39,52-76`; `firestore.rules:334-336` |
| `courses/{courseId}` | Cursos personalizados por `userId`; autores de formación tienen alcance transversal | `services/learning/trainingService.ts:42,85-107`; `firestore.rules:345-355` |
| `users/{uid}/lms_notes/{noteId}` | Notas inteligentes personales | `services/learning/trainingService.ts:175-218`; `firestore.rules:420-421` |
| `users/{uid}/lms_progress/main` | Progreso agregado del usuario, referencias de aprendizaje | `services/learning/trainingService.ts:226-251`; `firestore.rules:424-425` |
| `users/{uid}/lms_context/main` | Contexto del estudiante | `services/learning/trainingService.ts:259-280`; `firestore.rules:428-429` |

### Relaciones y semántica que debe preservar la futura extracción

- Firebase UID y los IDs prefijados son cadenas; no convertirlos a UUID por suposición. Ejemplos de fábricas de IDs: `services/businessInitiatives/BusinessInitiativeRepository.ts:48-54`, `services/architectureOffice/OfficeEngagementRepository.ts:46-49`.
- `initiativeIds` es relación canónica del proyecto; `linkedBusinessProjects` es otra relación, no la misma (`services/architectureProjects/projectDocumentMapper.ts:41-44`). Validar referencias existentes y distinguir alias/códigos legados en taller.
- Fechas del mapeo de proyecto se preservan como campos `createdAt`/`updatedAt`; los normalizadores aceptan/descartan y sustituyen datos. El de iniciativas puede crear IDs faltantes, usar fecha actual y eliminar filas sin nombre/contenido (`services/businessInitiatives/BusinessInitiativeRepository.ts:95-105,150-169,197-215`). **No reutilizar normalizadores UI como ETL sin registrar rechazos y conservar originales.**
- El layout actual separa artefactos y agregados mediante `artifactStorage: 'subcollection-v1'` y `aggregateStorage: 'split-v1'` (`services/architectureProjects/projectDocumentMapper.ts:61-64`). Inventariar documentos históricos inline y subcolecciones antes de asumir una única forma.
- La creación de proyecto agrupa proyecto, índice, agregados y artefactos en batch (`services/architectureProjects/projectWrites.ts:89-112`). En cambio, actualización de proyecto y agregados son transacción y batch sucesivo: puede persistirse el primero y fallar el segundo (`services/architectureProjects/projectWrites.ts:143-173`). Es una ventana de inconsistencia real del código, no un fallo productivo observado.
- El borrado de proyecto inspeccionado elimina artefactos directos, `history/chat` y documento raíz; no recorre comentarios/decisiones de artefactos ni encargos, ARB, publicaciones, agregados o acciones (`services/architectureProjects/projectWrites.ts:185-192`). El borrado de encargo elimina solo su documento (`services/architectureOffice/OfficeEngagementRepository.ts:334-338`). Exigir búsqueda autorizada de huérfanos y política de retención/cascada.
- Decidir ARB guarda el encargo y después el registro independiente sin transacción conjunta (`context/OfficeContext.tsx:389-397`). El resultado del segundo guardado no se utiliza para decidir el `ok` retornado. Conciliar espejo, estado y subcolección; no equiparar estado entregado con auditoría completa.
- `userService.deleteUser` elimina el documento Firestore, no una identidad Auth en ese método (`services/identity/userService.ts:46-48`). Provisión crea Auth, luego perfil y correo secuencialmente; el catch no deshace los pasos previos (`services/identity/userProvisioningService.ts:130-170`). Buscar identidades sin perfil/perfiles sin identidad y definir revocación real.

## 5. Archivos, representaciones y proveedores

| Origen / destino | Evidencia local | Implicación para F0.5/F6 |
|---|---|---|
| Documentos soporte de iniciativa | URL y/o texto inline; sin ambos se descarta la fila (`services/businessInitiatives/BusinessInitiativeRepository.ts:150-169`); comentario de reglas `firestore.rules:318-319` | No asumir Firebase Storage. Obtener dominios reales, disponibilidad, permisos, versiones, clasificación y titular de cada enlace con acceso autorizado |
| Adjuntos del chat | `FileReader` a base64 y objeto `{name,type,base64Data}`; colección en estado React; creación guiada excluye archivos (`components/ChatInterface.tsx:31-41,57,170`) | Inventariar transmisión a modelos y retención de mensajes/adjuntos; el estado local no prueba conservación de originales en servidor |
| Importación a memoria | Lee base64; admite TXT/Markdown/PDF/DOC/DOCX/GDOC; llama extracción y permite aceptar sugerencias (`components/MemoryCenterModal.tsx:58-70,279,350-354`) | Diferenciar archivo original, texto extraído y memoria aceptada. Verificar necesidad de conservar originales y tratamiento de archivos rechazados |
| Artefactos y diagramas | Representaciones exportables: Mermaid, JSON de diagrama, PNG/SVG y vistas Excalidraw/Lucidchart (`services/export/exportRegistry.ts:15-19,28`) | Inventariar código/IR/representación y referencias embebidas, no solo extensión de descarga |
| Descargas generadas | MD, HTML, TXT, PDF, DOCX, CSV, XLSX, JSON, PNG, SVG, Mermaid, diagram-json y PPTX declarados implementados (`services/export/exportRegistry.ts:6-25`); Blob URL (`services/export/downloadService.ts:13-16`) | Son salidas en navegador; no prueban existencia de objetos en un bucket ni archivos históricos recuperables. Abrir formatos en UAT y validar tamaños/checksums de binarios migrables |
| Lucid | Integración con API de Lucid, enlaces de edición/importación y exportación a Blob URL (`services/lucid/lucidService.ts:23-26,215`) | Proveedor externo distinto a Firebase; confirmar documentos, permisos de compartición, propietarios y portabilidad. Credencial referenciada en almacenamiento local (`services/lucid/lucidService.ts:64-90`), sin leer su valor |
| Firebase Storage | Solo se observó parámetro `storageBucket` en configuración (`firebase.ts:11`); búsqueda de `firebase/storage`, `getStorage`, `uploadBytes` en TS/TSX no encontró integración | **Ausencia de integración hallada no equivale a bucket vacío o inexistente.** Falta inventario autorizado del servicio y de consumidores fuera de este repo |
| Firebase Auth / Firestore | Correo/contraseña, Google popup, anonimato para bypass de desarrollo (`services/identity/authService.ts:100-117`); Firestore mediante `getFirestore` (`firebase.ts:49`) | Proveedores habilitados reales, MFA/SSO, claims, identidades, índices y configuración desplegada pendientes; no afirmar disponibilidad productiva del bypass |
| IA Gemini, Anthropic, OpenRouter y proxy | Gemini referencia BYOK local (`services/geminiService.ts:873`); adaptadores `services/ai/providers/anthropic/AnthropicProvider.ts:53`, `services/ai/providers/openrouter/OpenRouterProvider.ts:33`; cliente proxy `services/ai/aiProxyClient.ts:119-121` | Inventariar proveedor/ruta efectivamente usada, modelos, costes, residencia/retención de solicitudes y consentimiento. No se inspeccionaron valores de claves ni se realizaron peticiones |

El registro de formatos declara capacidades, **no** demuestra que los binarios generados actualmente sean válidos en todas las plataformas. No se presume PHI, cumplimiento HIPAA, BAA, residencia por región ni clasificación de información sin validación de seguridad/datos.

## 6. Uso offline y almacenamiento del navegador

1. **Contrato común:** `writeLocalDraft` escribe `arky.offlineDraft.<clave>` con `{value,status:'pending-sync',at}` y devuelve `status:'offline', success:false, target:'local-draft'`. `readLocal` prioriza ese envoltorio y luego la clave histórica sin prefijo (`services/persistence/localDraftStore.ts:19-21,43-78`). Esto conserva borradores; por sí solo no implementa cola durable con reintentos.
2. **Espejos y cachés:** `MirroredList` guarda lecturas confirmadas en memoria, fallback desde localStorage; upsert escribe espejo incluso tras confirmación remota; `remember` no escribe un espejo persistente (`services/persistence/mirroredList.ts:54-80`). Por ello, ni toda lectura queda disponible tras recargar offline ni todo registro `pending-sync` demuestra escritura pendiente real. El futuro inventario offline necesita estado remoto conciliado, no contar claves por prefijo.
3. **Proyectos:** borrador de creación `project.<id>` y parche `project.<id>.update` ante offline; el parche no incluye artefactos ni agregados, eliminados del payload del proyecto (`services/architectureProjects/projectWrites.ts:117-118,123-140,178-179`). Ensayar recuperación del conjunto completo, no solo del nombre del proyecto.
4. **Encargos:** espejo `engagements_<projectId>` (`services/architectureOffice/OfficeEngagementRepository.ts:292`). Su eliminación actualiza espejo después del intento remoto sin comprobar confirmación en ese método (`services/architectureOffice/OfficeEngagementRepository.ts:334-339`). Caracterizar fallo de borrado para evitar falsa desaparición local.
5. **Revisión:** enfoque local-first con suscripciones remotas, unión por IDs/fechas y estados `local-only`, `offline`, `syncing`, `synced`, `sync-error`; migración de registros locales descrita por el repositorio (`services/review/hybridArtifactReviewRepository.ts:5-13,43-64,119-128,161-203,229-294`). No asumir que reconexión, borrados y conflictos tienen entrega exactamente una vez: requiere pruebas.
6. **Aprendizaje:** cursos y notas usan claves de colección; progreso/contexto agregan UID a la clave; las lecturas filtran por usuario en las rutas correspondientes (`services/learning/trainingService.ts:90-116,180-204,231-280`). Validar aislamiento en equipos compartidos, limpieza de sesión y conservación por usuario antes de retirar Firebase.
7. **Settings/credenciales/telemetría:** settings usa claves personales/globales de borrador (`services/settings/SettingsRepository.ts:37-39,67-76`); proveedores y Lucid referencian secretos BYOK en localStorage, cuyos valores no se leyeron; observabilidad conserva eventos en sessionStorage y marcadores en ambos almacenamientos (`services/observability/observabilityService.ts:105-134,213-239`). No migrar secretos mezclados con datos funcionales ni exportar almacenamiento completo sin filtrado y autorización.
8. La búsqueda de `persistentLocalCache` y `enableIndexedDbPersistence` en TS/TSX no encontró habilitación explícita; el arranque hallado usa `getFirestore` (`firebase.ts:2,49`). No afirmar cobertura offline por IndexedDB ni PWA a partir del SDK instalado.

## 7. Brechas y evidencia requerida para cerrar F0

| Brecha / prioridad propuesta | Evidencia necesaria y responsable por identificar | Criterio de cierre |
|---|---|---|
| B-01 Aceptación funcional — bloquea cierre F0.1 | Taller/UAT con oficina: uso y criticidad de RC-01…RC-11, variantes, roles reales y expectativas | Matriz priorizada aceptada por responsables, sin convertir este documento en acta de aprobación |
| B-02 Población y proveedores Auth — bloquea migración de identidad | Exportación autorizada de metadatos Auth/perfiles, claims, proveedores, deshabilitados y vínculos; seguridad/identidad | Conteos y correspondencia UID conciliados; estrategia de contraseña/SSO/MFA/sesiones validada sin prometer compatibilidad |
| B-03 Datos reales y esquemas históricos — bloquea F0.5 | Inventario consistente de colecciones/subcolecciones, campos/tipos, bytes, fechas, propietarios, índices y referencias; datos/operaciones | Manifiesto del alcance, distribución de volúmenes y rechazos, huérfanos y layouts antiguos trazados |
| B-04 Archivos/URLs externas — bloquea F0.5/F6 | Enumeración autorizada de buckets y proveedores, originales, enlaces y embebidos, MIME, tamaño, hash, versión, propietario y ACL | Manifiesto origen/destino reproducible; distinguir enlazado, incrustado, generado y almacenado |
| B-05 Alcance y gobernanza — alta | Auditoría/emulador/API negativa para comentarios cruzados, creación `delivered`, autoaprobación, publicación y cuenta sin rol; seguridad/oficina | Política acordada y pruebas positivas/negativas; no equiparar matriz UI con límites confiables |
| B-06 Atomicidad y eliminación — alta | Ensayos de fallo entre proyecto/agregados y encargo/decisión; inventario autorizado de descendientes/identidades huérfanas | Invariantes y reconciliación documentadas; política de borrado/retención aprobada |
| B-07 Offline real — alta | Sesiones UAT con navegadores/dispositivos representativos y datos sanitizados; corte/red, recarga, concurrencia, cambio de usuario, cuotas | Ningún borrador confundido con confirmación; manifestar pendientes válidos y política de recuperación/conflictos |
| B-08 Operación y cumplimiento — decisión pendiente | Responsables, entornos, residencia, clasificación, retención, volumen, backups de datos y binarios, RPO/RTO/SLO, presupuesto | Decisiones aprobadas por oficina/seguridad/operaciones; sin asumir PHI ni múltiples tenants |

### Método de verificación de este entregable

- Herramientas locales utilizadas: `read_file` sobre documentación y fuentes seleccionadas, `search_files` con nombres y patrones, y `execute_code` para agrupar lecturas/búsquedas y validar referencias del documento. No se instalaron dependencias ni se lanzaron builds/servicios.
- Patrones relevantes: rutas `<Route>`, funciones `can`/reglas `allow`, `collection(`, constantes de colección, `doc(`, `localStorage`, `sessionStorage`, `FileReader`, `readAsDataURL`, `createObjectURL`, `firebase/storage`, `getStorage`, `uploadBytes`, `persistentLocalCache`, `enableIndexedDbPersistence`.
- Búsquedas negativas se informan como **no encontrado en el código inspeccionado**, nunca como ausencia de recursos productivos. Búsquedas amplias truncadas se complementaron con lectura de los archivos concretos citados y búsquedas focalizadas.
- Este trabajo crea únicamente `docs/fase-0/inventario-funcional-datos.md`. No modifica el plan, reglas, aplicaciones, datos, Git ni documentación de otros agentes.
