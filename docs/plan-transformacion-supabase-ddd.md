# Plan de transformación ARKY-SUP: monolito modular DDD y Supabase

Estado: propuesta para aprobación. No autoriza cambios productivos ni aprovisionamiento de pago.
Repositorio: https://github.com/eltata71/arky-sup
Workspace de ejecución: /home/tata/workspace/arky-sup
Base inspeccionada: commit 8731fcd. Documento de trabajo para ejecución incremental desde esta plataforma.

## 1. Mandato y alcance

Preservar las capacidades valoradas por la Oficina de Arquitectura Empresarial de una aseguradora de vida y salud con operación en Estados Unidos, Latinoamérica y el Caribe; reducir deuda técnica y coste de cambio; consolidar un monolito modular con alta cohesión, bajo acoplamiento y DDD estratégico y táctico; migrar autenticación, autorización, permisos, persistencia y almacenamiento a Supabase.

No se propone una reescritura total, microservicios, sustitución de los proveedores de IA ni rediseño visual completo. Supabase será la plataforma backend; el hosting de React se decidirá separadamente y podrá mantenerse. Los cambios funcionales se justificarán por defectos, seguridad, usabilidad o necesidades aprobadas.

## 2. Evidencia y límites del diagnóstico

- `modules.json` declara módulos, capas y APIs públicas; `AGENTS.md` establece invariantes de dominio y reglas de gobernanza.
- `services/persistence` ya distingue escritura confirmada de borrador local. Hay repositorios específicos en contextos como iniciativas, proyectos y configuración.
- Los documentos de deuda contienen historia y cierres posteriores: sus cifras antiguas NO son una línea base vigente.
- En esta preparación se ejecutaron `npm run check:module-boundaries` y `npm run check:any-budget`: ambos pasan; el segundo reporta 23 usos de any (16 en geminiService, 6 en ExcalidrawViewer, 1 en lazyWithRetry). El primer control permite deuda presupuestada: pasar no prueba cero ciclos.
- La instalación anterior reportó 3 vulnerabilidades (2 moderadas, 1 alta). Falta una auditoría actual con rutas afectadas y explotabilidad. No aplicar correcciones mayores automáticamente.
- No se ha ejecutado aquí una auditoría integral, la suite completa, inspección de datos productivos ni validación de un proyecto Supabase. No se declara aptitud productiva.

## 3. Arquitectura objetivo

React/presentación → casos de uso del módulo → dominio y puertos → adaptadores Supabase/IA/integraciones. Las dependencias del código apuntan hacia el dominio; la composición conecta los adaptadores.

Un repositorio y un ciclo de release coordinado, con módulos de negocio y backend gobernados como un producto, sin servicios independientes por contexto. Supabase Auth administra identidades y sesiones; PostgreSQL mantiene datos, membresías, roles y permisos; grants y RLS hacen cumplir autorización; Storage mantiene archivos con políticas. Operaciones privilegiadas y comandos sensibles corren en backend confiable mediante Edge Functions y/o RPC transaccionales según ADR. Una función por endpoint no implica crear un microservicio por contexto.

El navegador nunca es autoridad de reglas sensibles. No basta con trasladar SDKs: las transiciones como aprobación ARB, provisión de cuentas y cambios de permisos deben resistir solicitudes directas a la API. No se exponen claves secret/service_role en frontend. No se autoriza con user_metadata editable. Se considera la caducidad de claims y la revocación de sesiones.

Contextos candidatos, a validar con expertos: identidad y acceso; iniciativas y portafolio; proyectos y atenciones; encargos y gobernanza ARB; artefactos y publicación; conocimiento arquitectónico; aprendizaje. IA, diagramación, exportación y observabilidad se clasifican como capacidades de soporte o componentes internos según el modelo, no automáticamente como bounded contexts.

Por módulo: domain, application, infrastructure, presentation cuando aplique y API pública explícita. Tipos de persistencia separados del modelo de dominio; shared kernel mínimo. Propietario de datos por contexto, sin escrituras cruzadas directas. Esquemas PostgreSQL por contexto solo donde ayuden a gobernanza; no sustituyen APIs ni autorización. Lecturas transversales por contratos/proyecciones aprobadas. Eventos internos para desacoplamiento real; outbox e idempotencia cuando haya entrega durable; no imponer event sourcing o CQRS completo.

## 4. Plan por fases y tareas

### F0. Línea base y protección del producto
Dependencia: aprobación del inicio del diagnóstico.
- F0.1 Inventariar funcionalidades, recorridos críticos, perfiles y aceptación actual con arquitectos: iniciativas, proyectos, encargos, revisión ARB, generación, diagramas, publicación/exportación y aprendizaje donde aplique.
- F0.2 Reproducir entorno mediante instalación bloqueada, validar runtime soportado, lockfile, configuración, CI y separación de secretos; no dar por adecuada la versión instalada previamente.
- F0.3 Ejecutar quality completo, pruebas de reglas Firebase, E2E y build; registrar fallos existentes y resultados omitidos, sin confundir build con placeholders con integración real.
- F0.4 Auditar dependencias, secretos, rutas privilegiadas, accesos directos al SDK, tamaños, ciclos, complejidad, cobertura de invariantes y rendimiento.
- F0.5 Inventariar datos y archivos reales con acceso autorizado: colecciones, subcolecciones, propietarios, volúmenes, referencias, tipos, proveedores de login y uso offline.
- F0.6 Crear registro de deuda vigente priorizado por riesgo, impacto de negocio, urgencia y esfuerzo; distinguir resuelto, vigente y por confirmar.
Entregables: baseline reproducible, matriz de capacidades, inventario técnico/datos y backlog priorizado.
Salida: evidencia de cada control, fallos conocidos trazados y recorridos a proteger aceptados por la oficina.

### F1. Diseño de dominio y arquitectura de transición
Dependencia: F0; seguridad urgente puede corregirse antes.
- F1.1 Acordar lenguaje ubicuo mediante talleres de procesos/eventos con la oficina; aclarar iniciativa, proyecto, atención, encargo, artefacto y decisión.
- F1.2 Definir bounded contexts, context map, responsables, dependencias permitidas y contratos.
- F1.3 Modelar agregados, entidades, objetos de valor, invariantes, eventos y límites transaccionales; preservar separación productor/revisor y decisión humana ARB.
- F1.4 Diseñar autorización por permiso y alcance: organización/unidad/proyecto y clasificación cuando proceda. Confirmar si se necesita multitenencia; operar en varios países no demuestra que existan varios tenants.
- F1.5 Definir modelo PostgreSQL: claves, referencias, restricciones, versiones, concurrencia, índices, JSONB justificado, retención e historial.
- F1.6 Aprobar ADR de backend confiable, contratos de módulo, exposición Data API, RLS, identidad, migración progresiva, hosting y operación.
- F1.7 Actualizar AGENTS.md y CLAUDE.md al aprobar la arquitectura, retirando la restricción Firebase/frontend-only que este mandato explícito sustituye.
Entregables: context map, diagramas, contratos, modelo de datos, matriz de autorización y ADR.
Salida: arquitectura revisada con oficina y seguridad; alcance y métricas aprobados.

### F2. Plataforma Supabase y controles de entrega
Dependencia: F1; entorno local puede prepararse antes de aprobar aprovisionamiento remoto.
- F2.1 Decidir Supabase administrado o autogestionado (preferencia: administrado, sujeta a seguridad, residencia y presupuesto); región, plan, ambientes y responsables.
- F2.2 Preparar desarrollo, staging y producción separados; CLI versionada, migraciones reproducibles, datos sintéticos y tipos generados.
- F2.3 Definir esquemas privados/expuestos, grants explícitos, RLS deny-by-default, privilegios de funciones y política de secretos.
- F2.4 Incorporar validación SQL, políticas RLS, contratos y pruebas locales al CI; proteger despliegues y detectar drift.
- F2.5 Configurar logs sin datos sensibles, alertas, auditoría de negocio y presupuestos operativos.
- F2.6 Definir y ensayar respaldo/restauración de base de datos Y objetos Storage: el backup de PostgreSQL no respalda los binarios de Storage. Validar opciones de recuperación y costes del plan.
Entregables: plataforma reproducible, pipeline y runbooks iniciales.
Salida: reconstrucción local desde cero y despliegue controlado a staging; accesos no autorizados rechazados.

### F3. Fundaciones modulares y reducción de deuda bloqueante
Dependencia: F1; puede avanzar en paralelo con F2 mediante contratos estables.
- F3.1 Establecer puertos de identidad, repositorios, archivos, reloj y servicios externos solo donde sean necesarios.
- F3.2 Aislar Firebase y Supabase en adaptadores; mantener fachada compatible y selección controlada por contexto.
- F3.3 Extraer reglas de UI hacia dominio/casos de uso; eliminar ciclos y accesos internos, con presupuestos que solo disminuyen.
- F3.4 Resolver deuda vigente de servicios grandes, tipos compartidos y persistencia duplicada, sin volver a ejecutar refactors ya cerrados.
- F3.5 Ampliar strict progresivamente y eliminar any no justificados; tipar errores y resultados de persistencia.
- F3.6 Mantener kernel canónico de IA, límites de ejecución, guardrails, revisión humana y validación determinista; mover credenciales organizacionales al backend.
Entregables: módulos desacoplados, pruebas de caracterización y adaptadores intercambiables.
Salida: dominio testeable sin React/Firebase/Supabase; sin nuevas violaciones y suite de regresión verde.

### F4. Identidad, autorización y permisos
Dependencia: F2 y puertos de F3; diseño común con F5.
- F4.1 Implementar Supabase Auth: login, logout, recuperación, invitación/provisión administrada y bootstrap auditable; SSO/MFA según política corporativa.
- F4.2 Implementar roles, permisos y membresías en PostgreSQL y controles RLS/RPC/backend; la UI refleja permisos, no los impone.
- F4.3 Portar matriz de permisos existente a pruebas de paridad y pruebas negativas reales: anónimo, usuario deshabilitado, escalamiento, acceso cruzado y autoaprobación.
- F4.4 Ensayar migración de usuarios y correspondencia Firebase UID ↔ identidad destino; preservar autoría y referencias. Validar hashes/proveedores compatibles; no prometer continuidad de contraseña o sesiones sin prueba. Definir recuperación cuando sea necesaria.
- F4.5 Diseñar convivencia temporal solo si aporta reducción de riesgo, verificando emisor/audiencia y mapeo de sujetos no UUID; nunca convertir Firebase UID a UUID por suposición.
- F4.6 Probar expiración, cierre de sesiones, revocación y actualización efectiva de permisos, sin depender exclusivamente de claims viejos.
Entregables: identidad integrada, matriz verificada y guion de migración de usuarios.
Salida: cuentas piloto operan en staging, permisos y separación de funciones se hacen cumplir por API directa.

### F5. Migración de datos y módulos por cortes verticales
Dependencia: F2–F4 suficientes para el corte elegido; no esperar a terminar todo el refactor.
- F5.1 Seleccionar un piloto de baja criticidad, por ejemplo configuración no sensible, tras medir dependencias.
- F5.2 Crear esquema, restricciones, índices, RLS, adaptador y pruebas de contrato para el piloto; integrarlo de UI a base de datos.
- F5.3 Construir ETL versionada e idempotente: exportación consistente, transformación, carga, checkpoints, reintentos, rechazos explícitos y manifiesto.
- F5.4 Reconciliar conteos, claves, relaciones, checksums normalizados y reglas de negocio; preservar fechas, autoría, estados y referencias. Manejar documentos anidados, timestamps y valores ausentes sin pérdida semántica.
- F5.5 Migrar iniciativas → proyectos/atenciones → encargos/ARB → artefactos/publicación → conocimiento/aprendizaje según grafo validado. Si invariantes exigen mover conjuntos juntos, prevalece la consistencia sobre este orden tentativo.
- F5.6 Probar transacciones, concurrencia optimista, paginación, suscripciones necesarias, conflictos y borradores offline; ningún borrador se informa como escritura confirmada.
- F5.7 Definir una sola fuente de escritura por conjunto de datos y ventana de transición. Evitar dual-write ingenuo; si se requiere, usar mecanismo durable, idempotente y reconciliado con diseño aprobado.
Entregables por corte: migración SQL, adaptador, ETL, pruebas y reporte de reconciliación.
Salida por corte: paridad funcional, integridad y autorización verificadas; reversión ensayada antes de expandir.

### F6. Almacenamiento y documentos
Dependencia: F2, F4 y contratos de artefactos F5; puede avanzar en paralelo con otros cortes.
- F6.1 Inventariar archivos, URLs, incrustaciones y proveedores reales; no asumir que todos viven en Firebase Storage.
- F6.2 Diseñar buckets privados, rutas, metadatos, tamaños/tipos permitidos, cuarentena/escaneo cuando corresponda, retención y eliminación.
- F6.3 Implementar políticas de lectura/escritura/reemplazo y descargas temporales autorizadas; probar acceso cruzado y expiración.
- F6.4 Migrar binarios con checksums, manifiesto origen/destino y actualización segura de referencias; conservar versiones requeridas.
- F6.5 Verificar carga, descarga, vistas previas y exportaciones; resolver fallos entre metadata y blob mediante estados y reconciliación.
Entregables: Storage protegido, migrador y restauración de archivos ensayada.
Salida: inventario reconciliado sin referencias rotas ni exposición no autorizada.

### F7. Calidad integral, resiliencia y experiencia
Dependencia: empieza en F0 y culmina tras F5/F6.
- F7.1 Ejecutar pruebas unitarias, contratos, integración PostgreSQL/Auth/Storage, RLS, E2E y regresión visual de recorridos críticos.
- F7.2 Verificar seguridad de API, funciones privilegiadas, vistas, políticas, dependencias, secretos, auditoría y abuso de IA.
- F7.3 Medir rendimiento bajo carga representativa: latencia p95, consultas/índices, concurrencia, bundle, consumo y costes de IA y plataforma.
- F7.4 Probar cortes de red, expiración de sesión, reintentos, conflictos y fallos de proveedor sin corrupción ni falsa confirmación.
- F7.5 Corregir fricciones de UX, accesibilidad y consistencia ES/EN; proponer WCAG 2.2 AA para recorridos acordados.
- F7.6 Ejecutar UAT con arquitectos, revisores y administradores usando escenarios realistas sanitizados.
Entregables: informe de calidad, seguridad, carga y aceptación funcional.
Salida: sin defectos bloqueantes; objetivos medibles satisfechos y riesgos residuales aceptados por responsables.

### F8. Corte productivo y estabilización
Dependencia: F7 y ensayos de migración/recuperación aprobados.
- F8.1 Ensayar corte completo en staging con volumen representativo; medir duración, reconciliación y recuperación.
- F8.2 Aprobar ventana, comunicaciones, responsables, respaldo verificable, disparadores de rollback y punto de no retorno.
- F8.3 Congelar escrituras o capturar deltas con mecanismo probado, ejecutar carga final, reconciliar usuarios/datos/archivos y cambiar rutas de acceso.
- F8.4 Hacer smoke tests por rol y piloto controlado; observar errores, integridad, rendimiento y experiencia antes de ampliar.
- F8.5 Definir cómo conservar escrituras nuevas tras el cambio si hay que revertir: restaurar código o un backup antiguo por sí solo perdería datos. Ensayar replay/reconciliación o restringir reversión al periodo anterior a nuevas escrituras.
- F8.6 Mantener soporte intensivo y emitir acta de aceptación.
Entregables: release verificado, evidencias del corte y registro de incidentes.
Salida: operación estable durante ventana acordada, con aprobación de oficina y operaciones.

### F9. Retiro de legado y mejora continua
Dependencia: aceptación de F8 y vencimiento de ventana de reversión/retención acordada.
- F9.1 Retirar Firebase SDK, adaptadores, reglas, secretos, flags, pipelines y documentación obsoletos, verificando ausencia de tráfico y consumidores.
- F9.2 Archivar/eliminar recursos y datos solo con autorización y política de retención; cancelar costes tras validar dependencias.
- F9.3 Cerrar deuda objetivo: ciclos y accesos prohibidos cero; strict productivo y any no justificados cero; excepciones externas encapsuladas y revisadas.
- F9.4 Completar runbooks, onboarding técnico, catálogo de módulos, recuperación y mantenimiento de permisos.
- F9.5 Mantener backlog y revisión periódica de calidad, satisfacción, seguridad, dependencia y coste.
Entregables: aplicación sin dependencia operativa de Firebase y paquete de operación/mantenimiento.
Salida: verificación técnica y de negocio del objetivo completo, no únicamente de la migración.

## 5. Métricas y aceptación

Objetivos propuestos para aprobación en F1; no son resultados actuales ni promesas de SLA:
- Funcionalidad: todos los recorridos críticos inventariados pasan UAT/E2E; cero defectos bloqueantes.
- Modularidad: cero ciclos intercontexto y cero accesos prohibidos al final; presupuesto decreciente por incremento. Afinar métrica a contextos reales, no carpetas técnicas.
- Dominio: invariantes críticas probadas sin SDK ni UI y reforzadas en límite confiable cuando son sensibles.
- Tipado: strict en código productivo y cero any no justificados al cierre.
- Seguridad: matriz completa de permisos acordada con pruebas positivas y negativas, incluyendo API directa; ninguna vulnerabilidad crítica/alta sin remediación o excepción formal temporal.
- Migración: todos los registros/archivos del alcance reconciliados; cero huérfanos o discrepancias sin resolución/aceptación explícita.
- Rendimiento: acordar p95 por recorrido y volumen, separando CRUD, exportación e IA; no regresión frente a baseline hasta definir umbrales.
- Operación: definir SLO, RPO, RTO, soporte y presupuesto según criticidad y plan contratado; recuperación de datos y blobs demostrada.
- Experiencia: accesibilidad y satisfacción comparadas con baseline validado por usuarios.

## 6. Ejecución desde esta plataforma

Este documento es la referencia inicial. Cada tarea mantiene ID, estado (pendiente/lista/en curso/bloqueada/en revisión/verificada), dependencias, responsable, alcance, criterios de aceptación, comandos y evidencia, PR/commit si existe, riesgos y reversión.

Ciclo: seleccionar una tarea lista → inspeccionar código vigente → acordar alcance → rama pequeña → pruebas primero cuando se cambia comportamiento → implementación → quality más controles específicos → revisión → evidencia → aprobación/merge según permisos. Una sesión se cierra con trabajo verificado y pendientes explícitos; nunca con estado simulado. No se publican commits/PR ni se modifica producción por el solo hecho de aprobar este plan.

Responsabilidades: Hermes prepara código, pruebas, documentación y evidencia; responsable de producto/oficina prioriza y acepta procesos; seguridad/datos aprueba permisos, clasificación, residencia y riesgos; operaciones aprueba ambientes, respaldo y despliegue. Estas personas deben identificarse en F0; no se inventan nombres.

Hitos: H0 baseline; H1 diseño aprobado; H2 plataforma y corte piloto; H3 módulos/datos/archivos migrados en staging; H4 aceptación integral; H5 producción estabilizada; H6 Firebase retirado y cierre de calidad.

No fijar fecha de entrega sin tamaño de datos, capacidad del equipo, permisos, restricciones y baseline. Tras F0/F1, estimar tareas y ruta crítica; reestimar después del piloto con velocidad y riesgo observados. F2/F3 y partes de F5/F6 pueden paralelizarse solo con contratos estables. Seguridad y regresión son transversales.

## 7. Decisiones pendientes que no bloquean la inspección local

1. Responsable funcional, técnico, seguridad y operaciones.
2. Acceso autorizado a Firebase, proyecto Supabase y CI/hosting; no solicitar secretos por chat.
3. Entornos productivos actuales, población usuaria, volumen y ventana tolerable de indisponibilidad.
4. Modelo de organización/tenencia, SSO/MFA y matriz de permisos deseada.
5. Clasificación real de información, residencia por jurisdicción, retención y requisitos contractuales; no asumir que la app procesa PHI ni afirmar cumplimiento HIPAA por elegir Supabase. Validar aplicabilidad, acuerdos como BAA cuando correspondan y controles necesarios con especialistas.
6. Presupuesto, SLO/RPO/RTO y capacidad del equipo para calendarizar.

## 8. Fuentes

Locales: AGENTS.md; modules.json; services/persistence/index.ts; docs/technical-debt-audit.md y docs/top-10-monolito-modular-ddd-2026-09-01.md (historia, no métricas actuales); comandos de gates indicados en §2.

Supabase: https://supabase.com/docs/guides/api/securing-your-api ; https://supabase.com/docs/guides/platform/migrating-to-supabase/firebase-auth ; https://supabase.com/docs/guides/auth/third-party/firebase-auth ; https://supabase.com/changelog.md . Revalidar documentación y versiones antes de cada implementación.
