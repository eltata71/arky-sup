# Plan de migración de Arky 10 · Firebase (Google) → AWS

**Documento de trabajo ejecutable.** Estado: propuesta, sin ejecutar.
Fecha: 2026-09-10 · Rama: `claude/firebase-aws-migration-plan-crzlzw`
Alcance: mover toda la infraestructura de la aplicación (persistencia, autenticación,
autorización, hosting, proxy de IA, CI/CD, observabilidad) desde Firebase + Vercel
hacia AWS, **usando exclusivamente servicios dentro de la capa gratuita**, con una
configuración de nivel producción.

> **Cómo se usa este documento.** Cada tarea tiene un identificador estable
> (`F3.T2`), precondiciones, acciones concretas, entregables y **criterios de
> aceptación verificables**. Está escrito para que un agente (Claude Code) pueda
> ejecutar una tarea por sesión sin releer el resto del plan, y para que una
> persona pueda auditar el resultado sin haber estado presente. Ninguna tarea se
> da por terminada sin que su criterio de aceptación se haya ejecutado y su salida
> real se haya pegado en el registro de la fase.

---

## 0. Resumen ejecutivo

### 0.1 Qué se migra y qué no

| Capacidad | Hoy | Destino AWS | Nota |
|---|---|---|---|
| Base de datos | Firestore | **DynamoDB** (tabla única) | 25 GB y 200 M peticiones/mes siempre gratis |
| Autenticación | Firebase Auth (email/pass + Google) | **Cognito User Pool** | 10 000 MAU gratis; Google sigue siendo IdP social |
| Autorización | `firestore.rules` (433 líneas) | **Lambda authorizer + capa de política en el API** | La matriz de `lib/authz` no cambia |
| Hosting SPA | Vercel | **S3 privado + CloudFront (OAC)** | 1 TB/mes de salida siempre gratis |
| Funciones (`api/ai.ts`, `api/gemini.ts`) | Vercel Functions | **Lambda + API Gateway HTTP API** | 1 M peticiones y 400 000 GB-s/mes siempre gratis |
| Secretos de proveedor | Vercel env vars | **SSM Parameter Store SecureString** | Gratis (Secrets Manager **no** lo es: 0,40 USD/secreto/mes) |
| CI/CD | GitHub Actions + integración Vercel | **GitHub Actions + OIDC → rol IAM** | Sin claves de larga duración en el repo |
| Observabilidad | `services/observability` + consola Vercel | **CloudWatch Logs + Alarms** | Retención corta y explícita |
| Inferencia IA | Gemini / OpenRouter / Anthropic | **Sin cambio** | Bedrock se evalúa aparte: no tiene capa gratuita real |
| Diagramas, LMS, Oficina, compilador | Lógica de aplicación | **Sin cambio** | La migración no toca dominio |

**Lo que explícitamente no se migra en este plan:** la inferencia de IA sigue
saliendo a los proveedores actuales. Cambiar a Bedrock es una decisión de producto
y de coste distinta (Bedrock factura por token desde la primera llamada), y
mezclarla con una migración de infraestructura haría imposible atribuir una
regresión de calidad de respuesta a una de las dos causas. Queda registrada como
`ADR-009` opcional en la Fase 14.

### 0.2 Por qué esta migración es viable con bajo riesgo

El repositorio ya tiene hechas las tres cosas que normalmente hacen imposible una
migración de backend, y es el hallazgo más importante del análisis:

1. **Los SDK están confinados por lint.** `firebase/firestore` sólo aparece en
   **15 ficheros** y `firebase/auth` en **2**, todos ellos adaptadores nombrados
   uno a uno en `eslint.config.js`. Ninguna pantalla, contexto ni hook toca la
   base de datos. La superficie a reescribir es un anillo, no una malla.
2. **La superficie de consulta es diminuta.** Todo el producto se sostiene sobre
   **tres consultas filtradas** (`where userId ==` sobre `projects`,
   `businessInitiatives` y `courses`), **un ordenamiento**
   (`agent_actions orderBy createdAt desc`) y lecturas directas por clave. Eso
   cabe en una tabla DynamoDB con **un solo índice global**.
3. **La degradación ya existe y está probada.** `PersistenceResult`,
   `writeLocalDraft`, `MirroredList` y `persistenceStatus` fueron construidos para
   sobrevivir a un Firestore caído. Ese mismo mecanismo es el que sostiene la
   aplicación durante el corte: **una migración es una indisponibilidad
   planificada, y el producto ya sabe comportarse durante una.**

### 0.3 Los cuatro riesgos reales

Estos no son riesgos genéricos de migración; son propiedades medidas de este
código. Cada uno tiene una tarea asignada.

| # | Riesgo | Evidencia en el repo | Tarea que lo trata |
|---|---|---|---|
| **R1** | **400 KB frente a 1 MiB.** El límite de ítem de DynamoDB es 400 KB; el producto está diseñado alrededor del 1 MiB de Firestore, y ya poda campos para caber. Un artefacto grande que hoy se guarda dejaría de guardarse. | `artifactDocumentMapper.ts:17`, `projectWrites.ts:20`, `collectionPaths.ts:30` | `F5.T4` (descarga del cuerpo a S3) |
| **R2** | **Transacciones con lectura previa.** Firestore permite `transaction.get()` y decidir; `TransactWriteItems` de DynamoDB **no lee y decide**, sólo aplica condiciones. Tres rutas dependen de esto. | `artifactPersistence.ts:82,140,227`, `projectWrites.ts:144` | `F5.T5` (condiciones + contador atómico) |
| **R3** | **Tiempo real.** `onSnapshot` alimenta comentarios y decisiones de revisión. DynamoDB no lo tiene, y AppSync sólo es gratis 12 meses. | `firestoreArtifactReviewRepository.ts:96,119` | `F6.T6` (repesca por foco + intervalo; AppSync diferido) |
| **R4** | **Migración de contraseñas.** Firebase no exporta contraseñas en un formato que Cognito acepte directamente. | `userProvisioningService.ts` | `F9.T4` (importación + restablecimiento obligatorio) |

### 0.4 Presupuesto: cómo se garantiza el coste cero

La cuenta nueva de AWS (posterior a julio de 2025) entra en el **plan Free**: entre
100 y 200 USD en créditos y seis meses de ventana, sobre un conjunto de más de 30
servicios **siempre gratis** con límites mensuales permanentes. La arquitectura de
este plan está elegida para caer **entera dentro de "siempre gratis"**, de modo que
la aplicación siga siendo gratuita cuando los créditos y los seis meses se agoten.

| Servicio | Límite siempre gratis | Consumo estimado de Arky | Margen |
|---|---|---|---|
| DynamoDB | 25 GB, 200 M peticiones/mes | < 1 GB, < 500 K peticiones/mes | ~400× |
| Lambda | 1 M peticiones, 400 000 GB-s/mes | < 200 K peticiones | ~5× |
| CloudFront | 1 TB salida/mes | Bundle ~2 MB × visitas | ~500× |
| Cognito | 10 000 MAU | Decenas | ~300× |
| SSM Parameter Store | Parámetros estándar ilimitados | ~8 parámetros | — |
| CloudWatch Logs | 5 GB ingesta/mes | < 1 GB con retención de 14 días | ~5× |
| S3 | (no siempre gratis tras la ventana) | ~50 MB de bundle | < 0,01 USD/mes |
| API Gateway HTTP API | (no siempre gratis tras la ventana) | < 500 K/mes ≈ 0,50 USD | Ver `F1.T4` |

**Los dos únicos servicios que pueden facturar céntimos** después de la ventana
son S3 y API Gateway. `F1.T4` instala un presupuesto con alarma a 1 USD y
`F14.T3` evalúa si conviene colapsar el API Gateway en **Lambda Function URLs**
(gratis, sin API Gateway delante) una vez el tráfico real esté medido. No se hace
antes porque las Function URLs no dan autorizador JWT gestionado y obligarían a
verificar el token dentro de cada función desde el primer día.

**Prohibiciones de coste, aplicables a toda la ejecución del plan:** ningún NAT
Gateway, ninguna VPC con endpoints de interfaz, ningún RDS, ningún Aurora, ninguna
instancia EC2, ningún Secrets Manager, ningún AppSync, ningún OpenSearch, ninguna
Elastic IP sin asociar, ningún balanceador. Cualquier tarea que parezca necesitar
uno de estos está mal planteada: se detiene y se replantea.

### 0.5 Herramienta de ejecución: CLI, MCP o IaC

El usuario preguntó cuál usar. La respuesta correcta es **las tres, con papeles
distintos y no intercambiables**:

| Herramienta | Papel | Por qué |
|---|---|---|
| **AWS CDK v2 (TypeScript)** — *fuente de la verdad* | **Toda** la infraestructura duradera: Cognito, DynamoDB, Lambda, API Gateway, S3, CloudFront, IAM, alarmas | Es TypeScript, igual que el repositorio, así que el gate de tipos y el lint ya existentes lo cubren. Lo que se crea a mano no se puede revisar en un PR, no se puede recrear tras un borrado y no se puede replicar en un segundo entorno. CloudFormation no cuesta nada. |
| **AWS CLI** — *operación puntual* | Bootstrap, consultas de verificación, importación de usuarios, inspección de logs, ejecución de los criterios de aceptación | Es reproducible en un documento (un comando pegado es un comando auditable) y es lo que un criterio de aceptación puede exigir. **Nunca** para crear infraestructura duradera. |
| **AWS MCP Server** (gestionado, GA mayo 2026) — *conocimiento y descubrimiento* | Consultar documentación al día, disponibilidad regional de un recurso, forma exacta de una API, revisión de la plantilla CDK | Evita que el agente invente nombres de propiedades o cuotas a partir de memoria de entrenamiento — que es exactamente el modo de fallo de un agente haciendo IaC. |

**La regla dura: si un recurso sobrevive al cierre de la sesión, nace en CDK.**
Un recurso creado por MCP o CLI que no esté en la plantilla es deriva, y la deriva
en una cuenta con capa gratuita es como aparece una factura inesperada.

---

## 1. Arquitectura destino

### 1.1 Diagrama lógico

```
                        ┌──────────────────────────────────────────┐
   Navegador            │  CloudFront (OAC, HTTPS, cabeceras CSP)   │
   (SPA React 18)  ────▶│    ├─ /*        → S3 privado (dist/)      │
                        │    └─ /api/*    → API Gateway HTTP API    │
                        └──────────────────────────────────────────┘
                                             │
                     ┌───────────────────────┼────────────────────────┐
                     ▼                       ▼                        ▼
        ┌────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
        │ Lambda  arky-data  │  │ Lambda  arky-ai     │  │ Lambda arky-admin   │
        │ CRUD del portafolio│  │ proxy de proveedores│  │ altas y roles       │
        └─────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘
                  │                        │                        │
                  ▼                        ▼                        ▼
        ┌────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
        │ DynamoDB  arky-main│  │ SSM Parameter Store │  │ Cognito User Pool   │
        │ tabla única + GSI1 │  │ claves de proveedor │  │ + grupos = roles    │
        │ + S3 arky-blobs    │  │ (SecureString/KMS)  │  │ Google como IdP     │
        └────────────────────┘  └─────────────────────┘  └─────────────────────┘

   Autorización: JWT authorizer de Cognito en el HTTP API (¿quién eres?)
               + capa de política dentro de cada Lambda (¿puedes hacerlo?)
```

### 1.2 La decisión estructural: la autorización baja al servidor

Hoy `firestore.rules` es la única frontera real y se ejecuta en la infraestructura
de Google: el cliente habla **directamente** con la base de datos y Firestore
decide. En AWS no existe ese equivalente gratuito y bien tipado, así que la
frontera pasa a ser **un API propio**.

Esto **contradice una regla explícita de `CLAUDE.md`** ("Do not add a custom domain
backend or REST API. `api/` is limited to stateless key-hiding proxies") y por eso
se registra como ADR y no como detalle de implementación. La regla existía porque
un backend de dominio duplicaría la lógica de negocio en dos lenguajes. La
mitigación que hace la contradicción aceptable:

- El API **no contiene dominio**. Es CRUD por clave más autorización. Los
  agregados, las transiciones, las invariantes y las fábricas siguen viviendo en
  `services/*` y ejecutándose en el navegador, exactamente como hoy.
- El API **reimplementa la matriz de permisos, y se comprueba celda a celda**,
  igual que hoy `__tests__/authz/rulesMatrix.test.ts` compara
  `lib/authz/permissions.ts` con `firestore.rules`. La prueba se reapunta al nuevo
  módulo de política; la duplicación sigue siendo la misma que ya existe y sigue
  estando vigilada.
- El API es **una superficie declarada en `modules.json`** con su propia frontera,
  para que el gate de módulos siga significando algo.

`ADR-007` (tarea `F0.T3`) recoge esta decisión con su alternativa descartada
(AppSync con reglas de autorización, que es más parecido a Firestore y deja de ser
gratuito a los 12 meses).

### 1.3 Diseño de tabla única en DynamoDB

Una sola tabla, `arky-main`, en modo **bajo demanda** (el modo provisionado obliga
a dimensionar y el gratis de 25 RCU/WCU se reparte entre todas las tablas de la
cuenta; bajo demanda entra en el gratis de 200 M peticiones/mes y no se puede
desbordar por un pico).

**Claves:** `PK` (partición), `SK` (ordenación). Un GSI: `GSI1` con `GSI1PK` /
`GSI1SK`, proyección `KEYS_ONLY` salvo los atributos de listado (proyección
`INCLUDE`, para que un listado de portafolio no obligue a una lectura por ítem).

| Entidad (ruta Firestore hoy) | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| `projects/{id}` | `PROJECT#{id}` | `META` | `USER#{userId}` | `PROJECT#{updatedAt}#{id}` |
| `projects/{id}/artifacts/{aid}` | `PROJECT#{id}` | `ARTIFACT#{aid}` | — | — |
| `projects/{id}/aggregates/architectureGraph` | `PROJECT#{id}` | `AGG#architectureGraph` | — | — |
| `projects/{id}/aggregates/artifactIndex` | `PROJECT#{id}` | `AGG#artifactIndex` | — | — |
| `projects/{id}/publications/{pid}` | `PROJECT#{id}` | `PUB#{pid}` | — | — |
| `projects/{id}/history/chat` | `PROJECT#{id}` | `HISTORY#chat` | — | — |
| `projects/{id}/agent_actions/{traceId}` | `PROJECT#{id}` | `ACTION#{createdAt}#{traceId}` | — | — |
| `projects/{id}/engagements/{eid}` | `PROJECT#{id}` | `ENGAGEMENT#{eid}` | — | — |
| `…/engagements/{eid}/arbDecisions/{did}` | `PROJECT#{id}` | `ENGAGEMENT#{eid}#ARB#{did}` | — | — |
| `…/artifacts/{aid}/comments/{cid}` | `ARTIFACT#{pid}#{aid}` | `COMMENT#{cid}` | — | — |
| `…/artifacts/{aid}/reviewDecisions/{did}` | `ARTIFACT#{pid}#{aid}` | `DECISION#{did}` | — | — |
| `businessInitiatives/{id}` | `INITIATIVE#{id}` | `META` | `USER#{userId}` | `INITIATIVE#{updatedAt}#{id}` |
| `settings/user_{uid}` | `USER#{uid}` | `SETTINGS` | — | — |
| `settings/global` | `GLOBAL` | `SETTINGS` | — | — |
| `users/{uid}` | `USER#{uid}` | `PROFILE` | `ROLE#{role}` | `USER#{email}` |
| `users/{uid}/agentProfiles/{aid}` | `USER#{uid}` | `AGENTPROFILE#{aid}` | — | — |
| `users/{uid}/lms_progress/main` | `USER#{uid}` | `LMS#progress` | — | — |
| `users/{uid}/lms_context/main` | `USER#{uid}` | `LMS#context` | — | — |
| `users/{uid}/lms_notes/{nid}` | `USER#{uid}` | `LMS#note#{nid}` | — | — |
| `courses/{id}` | `COURSE#{id}` | `META` | `USER#{userId}` | `COURSE#{updatedAt}#{id}` |

**Las cinco propiedades que hace falta ver en esta tabla:**

- **Un proyecto y todo lo suyo comparten partición.** Cargar un proyecto con sus
  artefactos es **un `Query` por `PK`**, no las cuatro lecturas de colección que
  hace hoy. Es una mejora de rendimiento que sale gratis del diseño.
- **`agent_actions` ya está ordenada.** El `orderBy('createdAt','desc')` de
  `AgentActionRepository.ts:66` se convierte en `ScanIndexForward: false` sobre el
  `SK`, sin índice adicional.
- **Las tres consultas por propietario comparten `GSI1`.** `USER#{uid}` como
  `GSI1PK` sirve a proyectos, iniciativas y cursos a la vez; el prefijo del
  `GSI1SK` los separa. Un índice, tres consultas.
- **Los comentarios cuelgan del artefacto, no del proyecto.** Un proyecto muy
  revisado tendría miles de comentarios compartiendo partición con sus artefactos
  y desequilibraría la lectura del proyecto. Es la única desnormalización que se
  aparta de "todo lo de un proyecto junto", y es deliberada.
- **`ROLE#{role}` en `GSI1` sirve a la pantalla de administración de usuarios** sin
  un `Scan`. Un `Scan` sobre la tabla de usuarios es la consulta que crece con la
  organización y nadie vuelve a mirar.

### 1.4 Mapa de módulos: qué se toca y qué no

| Módulo | Acción | Coste |
|---|---|---|
| `firebase.ts` | **Reemplazar** por `aws.ts` (config de Cognito + cliente del API) | Bajo |
| `services/identity/authService.ts` | **Reescribir** contra Cognito (misma superficie exportada) | Medio |
| `services/identity/userProvisioningService.ts` | **Reescribir**: la app secundaria de Firebase desaparece; el alta pasa a `arky-admin` Lambda | Medio |
| `services/identity/userService.ts` | Reescribir sobre el cliente del API | Bajo |
| `services/persistence/*` | **Conservar íntegro.** `PersistenceResult`, `writeLocalDraft`, `MirroredList` no dependen de Firestore; sólo cambia `classifyPersistenceError` | Bajo |
| `services/persistence/collectionPaths.ts` | **Conservar el fichero, cambiar el contenido**: pasa a declarar las claves `PK`/`SK`. Sigue siendo "la ruta, dicha una sola vez" | Bajo |
| Los 12 repositorios de contexto | **Reescribir el cuerpo, conservar la firma.** Son adaptadores; sus consumidores no se enteran | **Alto (el grueso)** |
| `api/ai.ts`, `api/gemini.ts`, `api/_shared/*` | **Portar** a handler de Lambda. `verifyIdToken.ts` cambia **dos constantes**: la URL del JWKS y el `issuer` | Bajo |
| `firestore.rules` | **Sustituir** por `services/api/policy/` + su prueba de matriz | Medio |
| `context/*`, `pages/*`, `components/*`, `hooks/*` | **Sin cambios** | Cero |
| `services/ai`, `services/diagram`, `services/artifacts`, Oficina, LMS, grafo | **Sin cambios** | Cero |

Que las cuatro últimas filas sean cero es el resultado de las olas de modularización
anteriores, y es lo que hace que esta migración sea un trabajo de dos semanas y no
de dos meses.

---

## 2. Convenciones de ejecución

**Nomenclatura.** Todo recurso lleva el prefijo `arky-{env}-`, con `env` ∈
`{dev, prod}`. Sin excepciones: un recurso sin entorno en el nombre es el que
alguien borra creyendo que es el de pruebas.

**Etiquetas obligatorias en todo recurso** (aplicadas por `Tags.of(app)` en CDK):
`Project=arky`, `Environment={env}`, `ManagedBy=cdk`, `CostCenter=free-tier`.
Sin ellas el desglose de coste por servicio no distingue lo de este proyecto de lo
que se pruebe en la cuenta.

**Regiones.** Todo en `us-east-1`. Razón: los certificados de ACM para CloudFront
**deben** estar en `us-east-1`, y tener un único despliegue regional evita el
segundo stack cruzado que es la primera fuente de fallos de CDK en principiantes.

**Registro de ejecución.** Cada fase se cierra escribiendo su resultado real en
`docs/aws-migration-log.md` (creado en `F0.T4`): comando ejecutado, salida
relevante, fecha, y cualquier desviación respecto al plan. Un plan sin registro de
ejecución no es auditable, y a mitad de un corte de producción nadie recuerda si
la tarea 5 se hizo.

**Definición de terminado (DoD) para toda tarea de código:**
1. `npm run quality:static` en verde (typecheck, strict, lint, los cuatro budgets).
2. Pruebas nuevas escritas y `npm run test:ci` en verde.
3. `npm run check:module-boundaries` sin ciclos ni importaciones nuevas no
   registradas.
4. El criterio de aceptación de la tarea ejecutado, con su salida pegada en el log.
5. Commit atómico con el identificador de la tarea en el asunto (`F5.T3: …`).

**Regla de reversibilidad.** Ninguna tarea anterior a `F13` toca el Firebase de
producción. Hasta el corte, Firebase es el sistema vivo y AWS es un entorno
paralelo. Esto se comprueba solo: si una tarea necesita escribir en Firestore para
avanzar, está mal ordenada.

---

# FASE 0 · Decisiones, líneas base y preparación

**Objetivo.** Dejar por escrito lo que se va a hacer y medir lo que hay, para poder
demostrar después que no se rompió nada.
**Duración estimada:** 1 día. **Coste AWS:** 0.
**Precondición:** ninguna. Esta fase no toca AWS.

### F0.T1 · Inventario y línea base medida

**Acciones**
1. Ejecutar y **guardar la salida completa** de: `npm run quality`,
   `npm run test:ci`, `npm run check:bundle-budget`, `npm run check:module-boundaries --report`.
2. Registrar en el log: número de ficheros de prueba, número de pruebas, los cuatro
   porcentajes de cobertura, el peso eager y de entrada del bundle, el censo de
   ciclos y de importaciones profundas.
3. Exportar el inventario de datos vivos de Firestore: número de documentos por
   colección y tamaño del mayor documento de cada una.

**Entregable** `docs/aws-migration-log.md` §"Línea base 2026-09-XX".

**Criterio de aceptación** Los seis números de la tabla de calidad de `CLAUDE.md`
están reproducidos con la salida real, no copiados del documento. Si alguno no
coincide, la desviación se anota antes de empezar: una migración que arranca sobre
una suite roja no puede demostrar después que la rotura es suya.

> **Por qué primero.** El único argumento defendible al final de la migración es
> "estos números eran estos y siguen siendo estos". Sin la medida previa, cualquier
> regresión se discute en lugar de detectarse.

### F0.T2 · Inventario de datos y clasificación de información personal

**Acciones**
1. Listar qué datos personales se almacenan hoy: correo, nombre visible, rol,
   progreso de formación, notas. Localizarlos en el mapa de `§1.3`.
2. Decidir y anotar la región de residencia de datos (`us-east-1` implica
   almacenamiento en Estados Unidos; si el usuario requiere residencia en la UE,
   **esta es la única decisión que hay que tomar antes de la Fase 1**, porque
   cambia la región de toda la cuenta).
3. Anotar el período de retención de logs (propuesta: 14 días) y de copias de
   seguridad (propuesta: PITR de 35 días, incluido en el gratis de DynamoDB).

**Criterio de aceptación** Una tabla en el log con: dato, dónde vivirá, quién puede
leerlo, cuánto se conserva.

### F0.T3 · ADR-007: el API de datos propio

**Acciones** Escribir `specs/02-architecture/ADR/ADR-007-aws-data-api.md` siguiendo
el formato de los ADR existentes (`ADR-002`…`ADR-006`): contexto, decisión,
alternativas descartadas con su razón, consecuencias aceptadas.

Debe contener explícitamente:
- Por qué `firestore.rules` no tiene equivalente gratuito y por eso la autorización
  sube a un API.
- Por qué se descarta **AppSync** (más parecido a Firestore, con suscripciones en
  tiempo real, pero su capa gratuita es de 12 meses y no permanente).
- Por qué se descarta **Amplify Gen 2** (genera la infraestructura, pero impone su
  propio modelo de datos y su propio ciclo de despliegue sobre una aplicación que
  ya tiene doce repositorios escritos y un gate de fronteras de módulo).
- Por qué el API **no** contendrá dominio, y cómo se comprueba que no lo contiene
  (el gate de tamaño de módulo y la ausencia de importaciones de `services/*`
  de dominio en `services/api/`).

**Criterio de aceptación** El ADR contradice de forma explícita y razonada la regla
de `CLAUDE.md`, y `CLAUDE.md` se actualiza en el mismo commit con la excepción y su
enlace. Una regla que se incumple en silencio deja de ser una regla para las
siguientes cincuenta decisiones.

### F0.T4 · ADR-008 y esqueleto documental

**Acciones**
1. `specs/02-architecture/ADR/ADR-008-dynamodb-single-table.md`: el diseño de
   `§1.3`, con las alternativas descartadas (una tabla por colección: multiplica
   por trece los recursos y no aporta nada porque no hay consultas cruzadas;
   DocumentDB o RDS: no están en la capa gratuita permanente).
2. Crear `docs/aws-migration-log.md` con las secciones de las 15 fases vacías.
3. Crear `docs/aws-runbook.md` vacío, que se irá llenando en cada fase con el
   procedimiento operativo (cómo desplegar, cómo revertir, cómo rotar una clave,
   qué hacer si salta la alarma de presupuesto).

**Criterio de aceptación** Los tres ficheros existen y están enlazados desde la
tabla "Documentation Map" de `CLAUDE.md`.

---

# FASE 1 · Fundación de la cuenta AWS: seguridad y control de coste

**Objetivo.** Dejar la cuenta en un estado donde sea difícil hacerse daño y
**imposible gastar sin enterarse**, antes de crear un solo recurso.
**Duración:** medio día. **Coste:** 0.
**Precondición:** cuenta AWS creada; acceso al usuario root y a un usuario
administrador (lo que el usuario ya tiene).
**Ejecución:** consola AWS (tareas de root) + AWS CLI. Nada de esto es CDK porque
precede al CDK.

> **Esta fase la hace una persona, no el agente.** Las credenciales root y la MFA
> no se delegan. El agente puede redactar los comandos y verificar el resultado,
> pero quien pulsa es el propietario de la cuenta.

### F1.T1 · Blindaje de la cuenta root

**Acciones**
1. Activar **MFA en el usuario root** (llave física o app TOTP).
2. Verificar que el root **no tiene claves de acceso**; si las tiene, eliminarlas.
3. Fijar contacto alternativo de facturación y de seguridad.
4. Guardar las credenciales root fuera de línea y **no volver a usarlas** salvo
   para las cuatro operaciones que sólo el root puede hacer (cerrar la cuenta,
   cambiar el plan de soporte, cambiar el correo raíz, restaurar acceso IAM).

**Criterio de aceptación**
```
aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled'   # → 1
aws iam list-access-keys --user-name root 2>&1                        # → error o vacío
```

### F1.T2 · Identidad humana: IAM Identity Center, no usuarios IAM

**Acciones**
1. Habilitar **IAM Identity Center** (gratis) en `us-east-1`.
2. Crear el usuario humano del propietario, con MFA obligatoria.
3. Crear dos conjuntos de permisos: `ArkyAdmin` (`AdministratorAccess`, sesión de
   1 hora) y `ArkyReadOnly` (`ReadOnlyAccess` + `AWSBillingReadOnlyAccess`).
4. Configurar el perfil local: `aws configure sso --profile arky-admin`.

**Criterio de aceptación**
```
aws sts get-caller-identity --profile arky-admin      # devuelve un rol AssumedRole, no un IAM user
```

> **Por qué no un usuario IAM con clave de acceso.** Una clave de acceso de larga
> duración en el portátil de alguien es el vector con el que se vacían las cuentas
> gratuitas para minar criptomoneda, y ocurre en horas, no en semanas. Identity
> Center emite credenciales temporales y no hay nada que filtrar. Es gratis.

### F1.T3 · Registro de auditoría y detección

**Acciones**
1. **CloudTrail**: el registro de eventos de gestión de los últimos 90 días está
   activo por defecto y es gratis; verificar que lo está y **no** crear un trail
   adicional hacia S3 (ese sí factura almacenamiento).
2. **AWS Health** y las notificaciones por correo, activas.
3. *(Opcional, evaluar)* **GuardDuty**: tiene 30 días de prueba y después factura.
   **No activar** durante el plan; anotarlo en `F14` como decisión de coste
   consciente.

**Criterio de aceptación**
```
aws cloudtrail describe-trails --query 'trailList[].Name'
aws cloudtrail lookup-events --max-results 1   # devuelve un evento
```

### F1.T4 · Barandillas de coste (la tarea que hace este plan cumplir su premisa)

**Acciones**
1. Habilitar en Billing: *Free Tier usage alerts* y *Receive Billing Alerts*.
2. Crear **AWS Budgets** (dos presupuestos gratis por cuenta):
   - `arky-cost-guard`: 1,00 USD/mes, alertas al 50 %, 80 %, 100 % y **previsión**
     al 100 %.
   - `arky-free-tier-guard`: presupuesto de tipo *uso de capa gratuita*, alerta al
     80 % de cualquier límite.
3. Crear una alarma **CloudWatch** sobre `EstimatedCharges` > 1 USD con notificación
   a un tema SNS con el correo del propietario.
4. Confirmar la suscripción al SNS desde el correo.

**Criterio de aceptación**
```
aws budgets describe-budgets --account-id <ID> --query 'Budgets[].BudgetName'
aws sns list-subscriptions --query "Subscriptions[?Protocol=='email'].SubscriptionArn"
# El ARN NO debe ser "PendingConfirmation"
```
Y una prueba real: bajar temporalmente el umbral a 0,01 USD y comprobar que llega
el correo. **Una alarma que nunca ha disparado no es una alarma, es una intención.**

### F1.T5 · Rol de despliegue para CI (OIDC, sin claves)

**Acciones**
1. Crear el proveedor de identidad OIDC de GitHub
   (`token.actions.githubusercontent.com`, audiencia `sts.amazonaws.com`).
2. Crear el rol `arky-github-deploy` con política de confianza **acotada al
   repositorio y a la rama**:
   `repo:eltata71/arkypro-1.0:ref:refs/heads/main` para producción y
   `repo:eltata71/arkypro-1.0:pull_request` para el `cdk diff` de los PR.
3. Permisos: **no** `AdministratorAccess`. Una política gestionada por el cliente,
   `ArkyDeployPolicy`, acotada a: CloudFormation, S3 del bucket de despliegue y del
   sitio, CloudFront (invalidación), Lambda, API Gateway, DynamoDB, Cognito, SSM,
   IAM `PassRole` **sólo** sobre roles con prefijo `arky-`, y CloudWatch Logs.

**Criterio de aceptación** La política de confianza contiene la condición
`StringLike` sobre `token.actions.githubusercontent.com:sub` con el repositorio
exacto. Un rol OIDC sin esa condición **lo puede asumir cualquier repositorio de
GitHub del mundo**: es el error de configuración más frecuente de este patrón y
convierte una mejora de seguridad en una puerta abierta.

### F1.T6 · Runbook de la cuenta

**Acciones** Escribir en `docs/aws-runbook.md`: identificador de cuenta, región,
cómo iniciar sesión con SSO, qué hacer si salta el presupuesto (los tres primeros
comandos de diagnóstico), a quién avisar, y el procedimiento de cierre de
emergencia (qué recurso apagar primero si algo empieza a facturar).

---

# FASE 2 · Herramientas locales e infraestructura como código

**Objetivo.** Que el agente pueda desplegar de forma reproducible y que exista un
entorno `dev` completo antes de tocar una línea de la aplicación.
**Duración:** 1 día. **Coste:** 0 (CloudFormation no factura).
**Precondición:** F1 completa.

### F2.T1 · Herramientas y verificación de acceso

**Acciones**
1. Instalar/verificar: AWS CLI v2, Node 20 (ya está en `.nvmrc`), `aws-cdk` v2
   como **devDependency del repositorio** (no global: la versión de CDK es parte
   de la reproducibilidad del despliegue).
2. Configurar el **AWS MCP Server gestionado** en `.claude/settings.json` para que
   el agente consulte documentación al día en lugar de recordar cuotas.
3. Verificar acceso: `aws sts get-caller-identity --profile arky-admin`.

**Criterio de aceptación** `npx cdk --version` desde el repositorio devuelve una
versión fijada en `package.json`, y el MCP responde a una consulta de documentación.

### F2.T2 · Estructura del proyecto de infraestructura

**Acciones** Crear `infra/` en la raíz con su propio `tsconfig.json`, y declararlo
en `modules.json` como módulo de capa `infrastructure` que **nadie puede importar**
desde la aplicación y que **no puede importar** de la aplicación. Estructura:

```
infra/
├── bin/arky.ts               # la app CDK: dos entornos, dev y prod
├── lib/
│   ├── identity-stack.ts     # Cognito: user pool, clientes, dominio, grupos
│   ├── data-stack.ts         # DynamoDB arky-main + S3 arky-blobs
│   ├── api-stack.ts          # HTTP API + las tres Lambda + authorizer
│   ├── hosting-stack.ts      # S3 del sitio + CloudFront + OAC + cabeceras
│   ├── observability-stack.ts# alarmas, log groups con retención
│   └── config.ts             # parámetros por entorno, sin secretos
├── test/                     # pruebas de aserción sobre la plantilla sintetizada
└── cdk.json
```

**Criterio de aceptación** `npm run check:module-boundaries` sigue en verde con
`infra/` declarado, y `npm run typecheck` cubre `infra/`.

> **Por qué stacks separados y no uno.** El stack de hosting se despliega en cada
> commit; el de identidad casi nunca. Un stack único hace que un cambio de CSS
> ponga en la ruta de actualización el pool de usuarios, y un `cdk deploy` fallido
> a mitad deja la autenticación en estado `UPDATE_ROLLBACK_IN_PROGRESS`. La
> frecuencia de cambio es el criterio correcto para trazar un límite de stack.

### F2.T3 · Bootstrap y entorno dev vacío

**Acciones**
1. `npx cdk bootstrap aws://<ID>/us-east-1 --profile arky-admin`.
2. Desplegar los cinco stacks **vacíos** (sin recursos, sólo las clases) para
   validar la cadena completa de despliegue.
3. Añadir `npm run infra:diff`, `infra:deploy:dev`, `infra:deploy:prod`,
   `infra:test` a `package.json`.

**Criterio de aceptación** `npm run infra:deploy:dev` crea cinco stacks en
`CREATE_COMPLETE` y `aws cloudformation describe-stacks` los lista. Un
`cdk destroy` los borra sin residuos.

### F2.T4 · Pruebas de infraestructura

**Acciones** Escribir en `infra/test/` aserciones sobre la plantilla sintetizada
(`Template.fromStack`) que comprueben las **propiedades de seguridad**, no la forma:
el bucket del sitio no es público, la tabla tiene cifrado y PITR, el API tiene
autorizador, los grupos de log tienen retención finita, ninguna Lambda tiene
`AdministratorAccess`.

**Criterio de aceptación** `npm run infra:test` falla si se elimina cualquiera de
esas propiedades. Se verifica rompiendo una a propósito y viendo el fallo. Una
prueba de infraestructura que nunca se ha visto fallar suele estar afirmando algo
distinto de lo que dice su nombre.

---

# FASE 3 · Identidad: Cognito reemplaza a Firebase Auth

**Objetivo.** Un pool de usuarios funcionalmente equivalente al Firebase Auth
actual: correo/contraseña, Google, restablecimiento de contraseña, roles como
reclamación verificable, alta por administrador, y **ninguna auto-registro**.
**Duración:** 2 días. **Coste:** 0 (< 10 000 MAU).
**Precondición:** F2 completa.

### F3.T1 · User Pool en CDK

**Acciones** En `identity-stack.ts`:
1. `UserPool` con: `selfSignUpEnabled: **false**` (el producto no tiene registro:
   `/auth` es sólo inicio de sesión y recuperación), `signInAliases: { email: true }`,
   `autoVerify: { email: true }`, `accountRecovery: EMAIL_ONLY`.
2. Política de contraseñas: mínimo 12 caracteres, mayúscula, minúscula, dígito y
   símbolo. **Más estricta que el mínimo de Cognito**, y compatible con el secreto
   de un solo uso que ya genera `userProvisioningService.singleUseSecret()`.
3. `advancedSecurityMode`: dejar en el nivel del **tier Lite/Essentials incluido en
   el gratis**; el tier `Plus` (protección contra amenazas) **no tiene capa
   gratuita** — anotarlo en el log como decisión de coste.
4. `removalPolicy: RETAIN` en producción. Un `cdk destroy` accidental que borre el
   pool borra a todos los usuarios y **no hay recuperación**.

**Criterio de aceptación** `aws cognito-idp describe-user-pool` muestra
`AllowAdminCreateUserOnly: true` y la política de contraseñas exacta.

### F3.T2 · Cliente de aplicación y dominio gestionado

**Acciones**
1. `UserPoolClient` **público, sin secreto de cliente** (es una SPA: un secreto en
   el navegador no es un secreto). Flujos: `authorizationCodeGrant` con **PKCE**;
   `implicit` deshabilitado.
2. Validez de tokens: acceso e ID 60 minutos, refresco 30 días. `enableTokenRevocation: true`.
3. `UserPoolDomain` gestionado (`arky-{env}.auth.us-east-1.amazoncognito.com`).
   Un dominio propio requeriría certificado ACM y `Route 53`; se difiere a `F13`.
4. URLs de retorno: `https://localhost:3000/auth/callback` (dev) y la de CloudFront
   (prod), añadida cuando exista.

**Criterio de aceptación** El flujo de autorización con PKCE devuelve un código en
el navegador. `implicit` rechazado. Un cliente público con `implicit` habilitado
deja el token en el historial del navegador y en los logs de cualquier proxy.

### F3.T3 · Google como proveedor de identidad

**Acciones**
1. En Google Cloud Console: **reutilizar el cliente OAuth existente** del proyecto
   Firebase y añadir el URI de redirección de Cognito
   (`https://<dominio>/oauth2/idpresponse`). Se reutiliza para que las cuentas de
   Google de los usuarios actuales sigan siendo las mismas identidades.
2. `UserPoolIdentityProviderGoogle` con `scopes: ['openid','email','profile']` y el
   mapeo de atributos `email → email`, `name → name`.
3. Guardar el `clientSecret` de Google en **SSM SecureString**, nunca en el código
   CDK ni en una variable de entorno del repositorio.

**Criterio de aceptación** Iniciar sesión con Google crea un usuario en el pool con
el correo correcto. La entrada de Google es un **IdP social**, no federación
SAML/OIDC: la primera está incluida en los 10 000 MAU gratuitos y la segunda tiene
una capa gratuita de sólo 50 MAU. Confundirlas es la forma de que este plan deje de
ser gratuito sin que nadie cambie nada.

### F3.T4 · Los seis roles como grupos, y el rol como reclamación

**Acciones**
1. Crear seis `UserPoolGroup`: `viewer`, `architect`, `reviewer`, `trainer`,
   `admin`, `superadmin`, con `precedence` decreciente en ese orden.
2. Añadir un disparador Lambda **Pre Token Generation** que escriba
   `custom:role` en el token a partir de la pertenencia al grupo de mayor
   precedencia.
3. Migrar `student → architect` y `teacher → trainer` **en la importación**
   (`F9.T4`), no en el disparador: `parseAuthRole` ya migra en lectura y una
   segunda migración en el token duplicaría la regla.

**Criterio de aceptación** Un `id_token` decodificado de un usuario del grupo
`reviewer` contiene `custom:role: "reviewer"`. Y una prueba negativa: un usuario sin
grupo **no** trae la reclamación, y `resolveEffectiveRole` lo resuelve a *sin rol*
— que es exactamente lo que `firestore.rules` hace hoy con una identidad sin
documento de perfil: *una identidad que nadie aprovisionó no es un usuario de bajo
privilegio, es un desconocido*.

> **Esto arregla, de paso, la asimetría documentada en `CLAUDE.md`.** Hoy la
> reclamación `role` existe en `resolveEffectiveRole` y en `callerRole()` de las
> reglas, pero *nada la establece nunca*: el producto vive del documento de usuario.
> En Cognito la reclamación es la fuente natural y el disparador la establece de
> verdad, así que el camino documentado y el camino real coinciden por primera vez.

### F3.T5 · Reescritura de `services/identity/authService.ts`

**Acciones** Reescribir el cuerpo **conservando exactamente la superficie
exportada** (`isAuthAvailable`, `currentUser`, `observeAuthState`, `readRoleClaim`,
`signInWithEmail`, `signInWithGooglePopup`, `signInAnonymouslyForDevBypass`,
`signOutCurrentUser`, `sendPasswordReset`, `reauthenticateAndUpdatePassword`,
`updateDisplayName`, `AuthUser`, `AuthUnavailableError`), sobre
`@aws-sdk/client-cognito-identity-provider` + `amazon-cognito-identity-js` o el
flujo OIDC con PKCE.

Puntos concretos:
- `observeAuthState` no existe en Cognito: se implementa con un almacén de sesión
  propio que emite al restaurar el token del almacenamiento y al refrescarlo.
- `signInAnonymouslyForDevBypass`: Cognito no tiene sesión anónima en user pools.
  El bypass de desarrollo pasa a ser **estado de React puro sin token**, que es lo
  que `CLAUDE.md` ya dice que es ("its `superadmin` role exists only in React
  state"). El endurecimiento es real: hoy hay una identidad anónima de verdad.
- `AuthUnavailableError` se conserva íntegra: es el contrato de degradación del que
  cuelga toda la interfaz.

**Criterio de aceptación** `__tests__` de identidad en verde con el nuevo backend;
`context/AuthContext.tsx` **sin una sola línea cambiada**. Si `AuthContext` tiene
que cambiar, la superficie no se conservó y la tarea no está terminada.

### F3.T6 · Alta de usuarios sin la app secundaria

**Acciones** Reescribir `userProvisioningService.ts`: el alta pasa a ser una
llamada al endpoint `POST /admin/users` (Lambda `arky-admin`, creada en `F6`) que
ejecuta `AdminCreateUser` con `MessageAction: SUPPRESS` y dispara el correo de
restablecimiento.

**Lo que se conserva porque era la decisión correcta y sigue siéndolo:** el
administrador **nunca elige la primera contraseña**. Lo que desaparece es el
andamiaje que hacía falta para lograrlo en el navegador — la segunda app de
Firebase con su propia sesión. En el servidor el problema no existe, así que
**esta tarea borra código en vez de traducirlo**.

**Criterio de aceptación** Un administrador crea una cuenta; el destinatario recibe
el correo, fija su contraseña y entra. La sesión del administrador **no se altera**
en ningún momento — la prueba de regresión del defecto original.

---

# FASE 4 · El puerto de persistencia: desacoplar antes de sustituir

**Objetivo.** Que los doce repositorios dejen de hablar el dialecto de Firestore
**antes** de que exista DynamoDB, para que la sustitución del backend sea un cambio
de una implementación y no de doce ficheros a la vez.
**Duración:** 2 días. **Coste:** 0 (esta fase no toca AWS).
**Precondición:** F0 completa. Puede ejecutarse **en paralelo** con F1–F3.

> **Por qué esta fase existe y por qué va antes.** La tentación es abrir los doce
> repositorios y cambiar `getDoc` por `GetItem`. Eso produce doce cambios grandes,
> simultáneos, imposibles de revisar por separado y sin ningún punto intermedio
> donde la aplicación funcione. Definir primero el puerto permite lo contrario:
> **la aplicación sigue corriendo sobre Firestore mientras el puerto ya existe**, y
> cada repositorio se migra y se prueba solo. Es la misma técnica que el
> repositorio ya usó para `services/agent` y la Oficina — *una dependencia que debe
> apuntar en un sentido se convierte en un puerto*.

### F4.T1 · Declarar el puerto

**Acciones** Crear `services/persistence/documentStore.ts` con la interfaz mínima
que las 15 llamadas reales necesitan — ni una operación más:

```ts
export interface DocumentStore {
  get<T>(key: DocumentKey): Promise<T | null>;
  put<T>(key: DocumentKey, value: T, options?: { ifUnchangedSince?: string }): Promise<void>;
  delete(key: DocumentKey): Promise<void>;
  listByParent<T>(parent: PartitionKey, prefix: string, options?: ListOptions): Promise<T[]>;
  listByOwner<T>(ownerId: string, prefix: string, options?: ListOptions): Promise<T[]>;
  transact(operations: readonly StoreOperation[]): Promise<void>;
}
```

**Criterio de aceptación** Toda llamada a Firestore existente en los 15 ficheros se
puede expresar con estas seis operaciones. Si alguna no cabe, **la interfaz crece
con una razón escrita**, no con una operación genérica de escape. Un `query(...)`
libre en el puerto reintroduce el dialecto que esta fase existe para eliminar.

### F4.T2 · Implementación Firestore del puerto

**Acciones** `services/persistence/firestoreDocumentStore.ts` implementa
`DocumentStore` sobre el SDK actual. Es un adaptador temporal: vive hasta `F13` y
se borra en `F14`.

**Criterio de aceptación** Existe y está probado, pero **nadie lo usa todavía**.

### F4.T3 · Migrar los repositorios al puerto, uno por commit

**Acciones** Doce commits, uno por repositorio, en este orden (de menor a mayor
riesgo, para que los primeros enseñen y los últimos ya no sorprendan):

1. `SettingsRepository` — un documento, sin transacciones. El caso más simple.
2. `userService`
3. `ChatHistoryRepository`
4. `AgentActionRepository` — introduce el listado ordenado
5. `BusinessInitiativeRepository` — introduce `listByOwner`
6. `trainingService` (LMS: cursos, progreso, contexto, notas)
7. `OfficeAgentProfileRepository`
8. `OfficeEngagementRepository` — subcolección de decisiones ARB
9. `firestoreArtifactReviewRepository` — **aquí aparece el tiempo real (R3)**
10. `projectReads`
11. `projectWrites` — **aquí aparecen los lotes y la transacción (R2)**
12. `artifactPersistence` — **aquí aparecen las tres transacciones y el límite de
    tamaño (R1 y R2)**

**Criterio de aceptación por commit** La suite completa en verde, la aplicación
funcionando contra Firestore a través del puerto, y `check:module-boundaries` sin
entradas nuevas. **La aplicación debe seguir siendo desplegable después de cada uno
de los doce commits.**

### F4.T4 · Aislar `classifyPersistenceError`

**Acciones** Los códigos de error de Firestore (`permission-denied`,
`unavailable`, `aborted`, `not-found`, `already-exists`) están hoy leídos
directamente. Extraer la traducción a una tabla por backend, de modo que
`PersistenceResult` — que es contrato de dominio y **no cambia** — se alimente de
un clasificador intercambiable.

Correspondencia que usará la implementación DynamoDB:

| `PersistenceResult` | Firestore | DynamoDB / API |
|---|---|---|
| `permission-denied` | `permission-denied` | HTTP 403 |
| `offline` | `unavailable`, sin red | error de red, HTTP 503 |
| `conflict` | `aborted` | `ConditionalCheckFailedException`, HTTP 409 |
| `validation-error` | error de validación local | HTTP 400, `ValidationException` |
| `failed` | resto | resto |

**Criterio de aceptación** `__tests__/services/persistence/` cubre las dos tablas y
comprueba que producen el **mismo** `PersistenceResult` para situaciones
equivalentes. Es la prueba de que el banner de persistencia dirá lo mismo antes y
después del corte.

---

# FASE 5 · Datos: DynamoDB y los tres riesgos estructurales

**Objetivo.** La implementación DynamoDB del puerto, con solución explícita a R1
(400 KB), R2 (transacciones) y al modelo de claves.
**Duración:** 3 días. **Coste:** 0.
**Precondición:** F2 y F4 completas.

### F5.T1 · La tabla en CDK

**Acciones** En `data-stack.ts`:
- `Table` `arky-{env}-main`: `PK` (S) hash, `SK` (S) range, `BillingMode.PAY_PER_REQUEST`.
- `GSI1` con `GSI1PK`/`GSI1SK`, proyección `INCLUDE` de los atributos que un
  listado de portafolio necesita (`name`, `updatedAt`, `status`, `artifactCount`,
  `initiativeIds`) — no `ALL`, que duplicaría el almacenamiento contra los 25 GB.
- `pointInTimeRecovery: true` (incluido en el gratis, y es la única red bajo un
  borrado accidental).
- `encryption: AWS_MANAGED` (KMS gestionado por AWS: gratis; una clave propia
  factura 1 USD/mes).
- `removalPolicy: RETAIN` en producción.
- `timeToLiveAttribute: 'expiresAt'` — se usará para caducar acciones de agente
  antiguas y mantener el volumen plano. Borrar por TTL no consume capacidad de
  escritura.

**Criterio de aceptación** `aws dynamodb describe-table` muestra PITR activo,
cifrado y modo bajo demanda. `infra/test` afirma las tres.

### F5.T2 · Las claves, dichas una sola vez

**Acciones** Reescribir `services/persistence/collectionPaths.ts` para que declare
las claves de `§1.3` en lugar de los segmentos de Firestore. **El fichero se
conserva con su papel**: es el único sitio donde se escribe una ruta, y su
comentario de cabecera se actualiza para decir que su espejo ya no es
`firestore.rules` sino `services/api/policy/`.

**Criterio de aceptación** Ningún fichero fuera de `collectionPaths.ts` contiene el
literal `'PROJECT#'`, `'USER#'`, `'ARTIFACT#'` ni ningún otro prefijo. Una prueba
de escaneo lo comprueba, igual que `agentRegistrySingleDoor.test.ts` comprueba su
regla equivalente.

### F5.T3 · La implementación del puerto

**Acciones** `services/persistence/dynamoDocumentStore.ts` — pero **no accede a
DynamoDB directamente desde el navegador**. Habla con el API de la Fase 6 mediante
`fetch` autenticado con el token de Cognito.

> **Por qué no el SDK de DynamoDB en el navegador.** Existe la vía "Cognito
> Identity Pool + credenciales temporales + permisos IAM con
> `dynamodb:LeadingKeys`" y parece más cercana al modelo Firestore. Se descarta:
> las condiciones IAM sólo saben razonar sobre la clave de partición, y la matriz
> de este producto tiene seis roles cruzados con nueve tipos de recurso, con reglas
> como *las decisiones de revisión no se pueden actualizar jamás* y *un `admin` no
> puede otorgar `admin`*. Expresar eso en política IAM es posible en el papel e
> ilegible en la práctica, y sobre todo **no se puede comparar celda a celda con
> `lib/authz`**, que es la prueba que hoy impide que las dos mitades se separen.

**Criterio de aceptación** Las mismas pruebas de contrato de `F4.T2` pasan contra
esta implementación, ejecutadas contra **DynamoDB Local** en Docker (gratis, sin
tocar la nube).

### F5.T4 · R1 — El límite de 400 KB

**El problema, medido.** Los artefactos se preparan hoy para caber en **1 MiB** y
`prepareArtifactForFirestore` ya poda campos derivados cuando no caben. DynamoDB
corta en **400 KB**, 2,6 veces menos. Un artefacto con un diagrama grande, su plan
de disposición y su modelo de presentación **hoy se guarda y mañana no**.

**Acciones**
1. **Medir antes de decidir**: script que recorre los artefactos reales y produce
   el histograma de tamaños. Si el percentil 99 está por debajo de 350 KB, basta con
   bajar el umbral de poda. Si no, se aplica el punto 2. *Esta medición decide la
   tarea; no se implementa la solución grande sin ella.*
2. **Descarga del cuerpo a S3**: el ítem de DynamoDB conserva identidad, metadatos y
   los campos que se consultan; el cuerpo (`content`, `layoutPlan`,
   `presentationModel`) va a `arky-{env}-blobs/artifacts/{projectId}/{artifactId}.json`
   y el ítem guarda su clave y su `ETag`. La lectura del cuerpo pasa por el API, que
   devuelve una URL prefirmada de corta duración; el bucket permanece privado.
3. **Umbral explícito**: por debajo de 300 KB el cuerpo va en línea; por encima, a
   S3. Un solo umbral, declarado en `collectionPaths.ts`, y **el ítem dice cuál de
   las dos formas tiene**. Un lector que tenga que adivinarlo es el que rompe.

**Criterio de aceptación** Una prueba con un artefacto sintético de 900 KB: se
guarda, se recupera **idéntico** byte a byte, y `PersistenceResult` es `success` y
no `validation-error`. Y la prueba inversa: uno de 10 KB **no** toca S3 (una
lectura de artefacto pequeño no puede pagar dos viajes).

### F5.T5 · R2 — Transacciones sin lectura previa

**El problema.** `runTransaction` de Firestore lee dentro de la transacción y
**decide en JavaScript**. `TransactWriteItems` de DynamoDB no ejecuta código: aplica
escrituras con condiciones. Las cuatro rutas afectadas y su traducción:

| Ruta | Hoy en Firestore | En DynamoDB |
|---|---|---|
| `createArtifact` | lee proyecto, lee artefacto (¿existe?), lee índice, escribe tres | `TransactWriteItems`: `Put` con `attribute_not_exists(PK)`; `Update` del proyecto con `ADD artifactCount :one`; `Update` del índice con `list_append`. **Cero lecturas.** |
| `updateArtifact` | lee artefacto, compara `updatedAt`, escribe | `Update` con `ConditionExpression: attribute_exists(PK) AND updatedAt <= :expected`. El `expectedUpdatedAt` **ya existe** en la firma actual |
| `deleteArtifact` | lee, decrementa contador | `TransactWriteItems`: `Delete` condicionado + `ADD artifactCount :minusOne` |
| `saveProject` (lote) | `writeBatch` | `TransactWriteItems` (≤ 100 ítems, ≤ 4 MB) o `BatchWriteItem` cuando no hace falta atomicidad. **El lote de proyecto con muchos artefactos puede exceder 100: se parte, y la partición se documenta como pérdida de atomicidad consciente** |

**Los tres hallazgos que hacen esto más fácil de lo que parece:**
- El contador `artifactCount` deja de necesitar una lectura: `ADD` es atómico en
  DynamoDB y **elimina** la condición de carrera que hoy se mitiga con la
  transacción.
- La concurrencia optimista por `expectedUpdatedAt` **ya está implementada** en la
  firma de `updateArtifact`; se traduce a `ConditionExpression` sin cambiar el
  llamante.
- El reintento por carrera de `ARTIFACT_NOT_FOUND_RETRY_DELAYS_MS`
  (`artifactPersistence.ts:70`) **se conserva tal cual**: la carrera
  crear-y-actualizar-inmediatamente sigue existiendo, y la ventana de consistencia
  de DynamoDB es más corta, no inexistente.

**Criterio de aceptación** Una prueba de concurrencia: dos `updateArtifact`
simultáneos con el mismo `expectedUpdatedAt` producen **exactamente un** `success`
y **exactamente un** `conflict`. Es la prueba que demuestra que la protección
sobrevivió a la traducción.

### F5.T6 · Índice de artefactos y agregados

**Acciones** `artifactIndex` y `architectureGraph` se conservan como ítems propios
(`AGG#…`) por la misma razón por la que hoy son documentos aparte: el grafo crece
con el número de artefactos y el presupuesto de un ítem es **más estrecho** en
DynamoDB, no más ancho. La regla de confianza del índice (fiarse sólo cuando su
recuento coincide con `artifactCount`) se conserva íntegra.

**Criterio de aceptación** El comportamiento documentado se mantiene: un índice
desfasado cuesta una lectura lenta, nunca un número equivocado en pantalla.

---

# FASE 6 · El API de datos y la autorización

**Objetivo.** Sustituir `firestore.rules` por una frontera de servidor que
implemente la **misma** matriz de permisos, comprobada celda a celda.
**Duración:** 3 días. **Coste:** 0.
**Precondición:** F3 y F5 completas.

### F6.T1 · HTTP API y autorizador JWT

**Acciones** En `api-stack.ts`: `HttpApi` con `HttpJwtAuthorizer` apuntando al
emisor de Cognito y a la audiencia del cliente de aplicación. CORS restringido al
origen de CloudFront (**no** `*`). Throttling por ruta: 20 req/s, ráfaga 40 — una
barandilla de coste tanto como de seguridad.

**Criterio de aceptación** Una petición sin `Authorization` devuelve **401 sin
llegar a la Lambda**. Se comprueba en los logs: cero invocaciones. El autorizador
gestionado es gratis; una Lambda que rechaza peticiones no autenticadas se paga.

### F6.T2 · La capa de política

**Acciones** Crear `services/api/policy/` — **el espejo servidor de
`lib/authz/permissions.ts`**, con una función por permiso y el marcador
`// @permission x` en cada una, exactamente como hoy en `firestore.rules`.

Debe reproducir, una a una, las reglas que hoy sólo existen en las reglas de
Firestore:
- Propietario o administrador para leer y escribir un proyecto o una iniciativa.
- Comentario de revisión atado a su autor.
- **Decisiones de revisión y decisiones del ARB inmutables**
  (`allow update: if false`): condición `attribute_not_exists(PK)` en el `Put`, sin
  ninguna ruta de actualización expuesta.
- Creación de decisiones ARB sólo por administrador.
- **Un `admin` no puede otorgar un rol privilegiado ni degradar a un `superadmin`.**
- `student`/`teacher` aceptados en lectura, **rechazados en escritura**.
- Una identidad sin perfil aprovisionado **no tiene rol**.

**Criterio de aceptación** `__tests__/authz/rulesMatrix.test.ts` se **reapunta** de
`firestore.rules` a este módulo y sigue comparando celda a celda con
`lib/authz/permissions.ts`. `__tests__/authz/noRoleStrings.test.ts` sigue en verde:
ninguna comparación de cadena de rol fuera del catálogo.

> **La prueba se reapunta, no se reescribe.** Es la garantía de que la migración no
> perdió la única defensa que existe contra la deriva entre lo que la interfaz
> muestra y lo que el servidor permite — que es exactamente el defecto D-4 que este
> repositorio ya sufrió una vez.

### F6.T3 · La Lambda de datos

**Acciones** `arky-{env}-data`: **una** función, Node 20, ARM64 (Graviton: 20 %
más barato y cuenta igual contra los 400 000 GB-s), 512 MB, timeout 10 s.
Rutas: `GET|PUT|DELETE /v1/doc/{...}`, `GET /v1/list/{...}`, `POST /v1/transact`.

**Orden de ejecución dentro del handler, y el orden importa:**
1. Extraer la identidad del contexto del autorizador (`sub`, `custom:role`).
2. Resolver el rol con la **misma** regla que `resolveEffectiveRole` (reclamación si
   existe; perfil si no; sin rol si ninguna).
3. Aplicar la política. **Antes** de tocar DynamoDB.
4. Ejecutar.
5. Traducir el error a la tabla de `F4.T4`.

**Criterio de aceptación** Un rechazo de política deja el contador de llamadas a
DynamoDB **en cero**. Es la misma propiedad que el repositorio ya exige a sus
guardarraíles de IA — *un bloqueo deja el contador del proveedor en cero* — y por la
misma razón: una defensa que se aplica después del gasto no es una defensa.

### F6.T4 · Permisos IAM mínimos

**Acciones** El rol de `arky-data` recibe **exclusivamente**
`dynamodb:GetItem|PutItem|UpdateItem|DeleteItem|Query|TransactWriteItems` sobre el
ARN de `arky-main` y su índice, más `s3:GetObject|PutObject` sobre el prefijo
`artifacts/` de `arky-blobs`. Sin `dynamodb:Scan`, sin `dynamodb:*`, sin `s3:*`,
sin acceso a otras tablas.

**Criterio de aceptación** `infra/test` afirma que la política no contiene comodines
en la acción ni en el recurso. La ausencia de `Scan` es deliberada: **si algún día
una funcionalidad necesita un `Scan`, el fallo de permiso obliga a diseñar el
índice en vez de barrer la tabla en silencio.**

### F6.T5 · La Lambda de administración

**Acciones** `arky-{env}-admin`, separada: `POST /v1/admin/users` (alta),
`PATCH /v1/admin/users/{id}/role`, `DELETE /v1/admin/users/{id}`. Es la única con
permisos `cognito-idp:AdminCreateUser|AdminAddUserToGroup|AdminDeleteUser`.

**Criterio de aceptación** Separada por una razón concreta: es la única función con
permisos sobre identidades, y fundirla con la de datos daría a **todas** las
peticiones de lectura de proyecto la capacidad latente de crear administradores.
`infra/test` afirma que `arky-data` **no** tiene ningún permiso `cognito-idp:*`.

### F6.T6 · R3 — El tiempo real

**El hallazgo.** `watchComments` y `watchDecisions` sólo se consumen desde
`hybridArtifactReviewRepository`; **ninguna pantalla se suscribe directamente**. El
alcance del problema es un panel de revisión, no el producto.

**Acciones**
1. Sustituir la suscripción por **repesca condicionada**: al recuperar el foco de la
   ventana, al abrir el panel de revisión, y con un intervalo de 30 s **sólo
   mientras el panel está visible**. `hybridArtifactReviewRepository` ya tiene su
   propio `subscribe` local, así que el cambio queda **dentro** de ese fichero.
2. La repesca usa la marca `updatedAt` del ítem padre para no traer la lista entera
   cuando nada cambió: un `GetItem` de 100 bytes contra un `Query` completo.
3. Anotar en `docs/technical-debt-audit.md`: si la revisión colaborativa
   simultánea llega a ser un requisito real, la opción es AppSync (deja de ser
   gratis a los 12 meses) o API Gateway WebSocket (750 000 minutos de conexión en el
   gratis de 12 meses). **No se hace ahora**: el producto lo usan equipos pequeños y
   una latencia de 30 segundos en un comentario de revisión no cuesta nada.

**Criterio de aceptación** Un comentario escrito en una pestaña aparece en otra en
≤ 30 s, y con el panel cerrado **no hay ninguna petición**. La segunda mitad es la
que protege el presupuesto: un `setInterval` que corre con la pestaña de fondo es
cómo un producto gratuito consume un millón de peticiones sin que nadie lo use.

---

# FASE 7 · El proxy de IA en AWS

**Objetivo.** Portar `api/ai.ts` y `api/gemini.ts` a Lambda conservando **íntegro**
su contrato, sus guardarraíles y su postura de fallo.
**Duración:** 1 día. **Coste:** 0.
**Precondición:** F3 y F6 completas.

> **Esta es la fase más barata del plan y conviene ver por qué.** El proxy ya está
> escrito contra `IncomingMessage` de Node, no contra el objeto de petición de
> Vercel, y su verificación de token ya usa **JWKS público con `node:crypto`** en
> lugar del SDK de administración de Firebase — una decisión que se tomó para no
> provisionar un secreto de servidor y que resulta ser exactamente lo que hace que
> el fichero funcione contra Cognito cambiando **dos constantes**.

### F7.T1 · `verifyIdToken` contra Cognito

**Acciones** En `api/_shared/verifyIdToken.ts`:
- `JWKS_URL` → `https://cognito-idp.us-east-1.amazonaws.com/{userPoolId}/.well-known/jwks.json`
- emisor esperado → `https://cognito-idp.us-east-1.amazonaws.com/{userPoolId}`
- audiencia → el identificador del cliente de aplicación
- verificación añadida: `token_use === 'id'`. Cognito emite **dos** tokens firmados
  por la misma clave, y un token de acceso presentado donde se espera uno de
  identidad pasaría la verificación de firma sin llevar las reclamaciones que el
  llamante cree estar leyendo.

Se conservan sin tocar: la caché de JWKS con TTL de una hora, la tolerancia de
desfase de reloj, y las comprobaciones de `exp`/`iat`/`sub`.

**Criterio de aceptación** Las pruebas existentes de `verifyIdToken`, adaptadas al
nuevo emisor, en verde — **incluidas las negativas**: firma inválida, expirado,
audiencia equivocada, y la nueva de `token_use`.

### F7.T2 · Adaptador de Lambda

**Acciones** `api/_shared/lambdaAdapter.ts` traduce `APIGatewayProxyEventV2` a lo
que `proxyRuntime.ts` ya espera. **`ai.ts` y `gemini.ts` no cambian de lógica**: se
les cambia la envoltura.

Dos puntos concretos:
- **SSE**: API Gateway HTTP API **no** hace streaming de respuesta. La ruta de
  streaming usa una **Lambda Function URL** con `InvokeMode: RESPONSE_STREAM`
  (gratis, sin API Gateway delante), y las peticiones sin streaming siguen por el
  API. `aiProxyClient` ya distingue las dos.
- **Límite de tamaño**: el tope de 2 MB del cuerpo que `proxyRuntime` ya aplica
  queda **por debajo** del límite de carga de API Gateway (10 MB) y de Lambda
  (6 MB síncrono). No hay que cambiarlo, pero se anota en el runbook.

**Criterio de aceptación** El contrato documentado en `docs/ai-proxy.md` se cumple
byte a byte: mismo `{ requestId, text, provider, model }`, mismo sobre de error
`{ requestId, error, source, retryAfterMs? }`.

### F7.T3 · Claves de proveedor en Parameter Store

**Acciones** `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` y el
secreto de cliente de Google en **SSM Parameter Store SecureString**
(`/arky/{env}/ai/gemini-api-key`, …), con la clave KMS gestionada por AWS.
La Lambda las lee **una vez en el arranque en frío** y las cachea en memoria
durante la vida del contenedor.

**Criterio de aceptación**
- `npm run check:bundle-secrets` sigue en verde: ninguna clave en el bundle.
- La política de la Lambda concede `ssm:GetParameter` **sólo** sobre el prefijo
  `/arky/{env}/ai/*`.
- **Se usa Parameter Store y no Secrets Manager**, y la razón es de coste, no de
  gusto: Secrets Manager cuesta 0,40 USD por secreto y mes, cuatro secretos son
  1,60 USD/mes, y este plan tiene un presupuesto de cero. Parameter Store estándar
  es gratuito y ofrece cifrado con KMS y control de acceso IAM por prefijo, que es
  todo lo que este caso necesita. Lo que se pierde es la rotación automática, que
  para claves de proveedor de IA **no existe de todas formas**.

### F7.T4 · Límite de gasto por usuario

**Acciones** El límite actual (60 peticiones/60 s, en memoria del proceso) no
sobrevive a un entorno serverless: cada contenedor tiene su propio contador y el
límite real es *60 × número de contenedores*. Sustituirlo por un contador en
DynamoDB con TTL: ítem `PK=RATE#{uid}`, `SK=WINDOW#{ventana}`, `ADD count :one`
condicionado a `count < :max`, `expiresAt` a la ventana siguiente.

**Criterio de aceptación** 61 peticiones en 60 segundos desde una misma identidad
producen exactamente un 429, **también con concurrencia en varios contenedores**.
El coste es una escritura por llamada de IA, muy dentro de los 200 M/mes.

> **Esta tarea repara un defecto real, no traduce uno.** El límite en memoria ya
> era ineficaz en Vercel por la misma razón. Anotarlo en
> `docs/technical-debt-audit.md` como deuda **cerrada** por la migración.

---

# FASE 8 · Hosting: S3 privado detrás de CloudFront

**Objetivo.** Servir la SPA con HTTPS, cabeceras de seguridad reales y la reescritura
de ruta única que necesita React Router, sin exponer el bucket.
**Duración:** 1 día. **Coste:** 0 hasta 1 TB/mes de salida.
**Precondición:** F2 completa. Puede ejecutarse **en paralelo** con F4–F7.

### F8.T1 · Bucket y distribución

**Acciones** En `hosting-stack.ts`:
- Bucket `arky-{env}-site`: **acceso público bloqueado en los cuatro ajustes**,
  cifrado S3, versionado activo (permite revertir un despliegue malo copiando la
  versión anterior).
- `Distribution` con **Origin Access Control (OAC)**, no la Origin Access Identity
  antigua. La política del bucket concede lectura **sólo** al ARN de la
  distribución.
- `defaultRootObject: 'index.html'`; `minimumProtocolVersion: TLS_V1_2_2021`.
- Compresión activa (Brotli/gzip): el bundle *eager* de 431 KB gz ya está medido
  comprimido, y servirlo sin comprimir multiplicaría por tres la salida facturable.

**Criterio de aceptación** `curl` directo a la URL del bucket → **403**. `curl` a la
URL de CloudFront → la aplicación. Un bucket de sitio estático con acceso público
es la configuración por defecto de la mayoría de los tutoriales y es la que expone
el contenido a la enumeración directa, saltándose todas las cabeceras.

### F8.T2 · La reescritura SPA, sin enmascarar los errores reales

**Acciones** El `rewrites` de `vercel.json` manda **todo** a `/`. En CloudFront eso
se hace con una **CloudFront Function** (gratis hasta 2 millones de invocaciones/mes;
Lambda@Edge **no** tiene capa gratuita y **no se usa**) que reescribe a
`/index.html` **sólo** cuando la ruta no tiene extensión y no empieza por `/api/`.

**Criterio de aceptación** `/workspace/abc` devuelve la aplicación; `/assets/x.js`
inexistente devuelve **404 de verdad**, no `index.html` con estado 200. Un
`custom_error_response` que convierte todo 404 en `index.html` con 200 hace que un
*chunk* que falta se sirva como HTML — que es precisamente el fallo de despliegue
en iPad/Safari contra el que `lib/lazyWithRetry.ts` fue escrito, sólo que
indetectable porque el estado sería 200.

### F8.T3 · Cabeceras de seguridad y CSP

**Acciones** Un `ResponseHeadersPolicy` con las cinco cabeceras que hoy pone
`vercel.json`, **más el paso pendiente**: la CSP actual es
`Content-Security-Policy-Report-Only`. Al migrar cambia el `connect-src` entero —
los destinos de Google desaparecen y entran los de AWS:

```
connect-src 'self'
  https://cognito-idp.us-east-1.amazonaws.com
  https://{dominio-cognito}.auth.us-east-1.amazoncognito.com
  https://{id-api}.execute-api.us-east-1.amazonaws.com
  https://{id-fn}.lambda-url.us-east-1.on.aws
  https://openrouter.ai https://api.lucid.co;
```

**Criterio de aceptación** La aplicación funciona **entera** con la CSP en modo
`Report-Only` y el registro de violaciones vacío durante una sesión completa de
pruebas; **sólo entonces** se pasa a modo obligatorio, en `F12.T4`. Ese orden no es
prudencia: una CSP obligatoria mal ajustada rompe el inicio de sesión, y el inicio
de sesión es lo único que no se puede depurar desde dentro de la aplicación.

### F8.T4 · Estrategia de caché e invalidación

**Acciones**
- `/assets/*` (con *hash* en el nombre): `max-age=31536000, immutable`.
- `/index.html`: `no-cache`, obligando a revalidar. Es lo que permite que un
  despliegue llegue al usuario sin esperar a que caduque nada.
- Invalidación en el despliegue: **sólo `/index.html`**. Invalidar `/*` en cada
  despliegue consume las 1 000 rutas gratuitas al mes en unos pocos despliegues y
  después factura.

**Criterio de aceptación** Un despliegue nuevo es visible al recargar sin borrar la
caché del navegador, y el recuento de rutas invalidadas por despliegue es 1.

---

# FASE 9 · Migración de datos y de usuarios

**Objetivo.** Trasladar el contenido real, con verificación de integridad y con la
posibilidad de repetir la operación tantas veces como haga falta.
**Duración:** 2 días (más el ensayo). **Coste:** 0.
**Precondición:** F3, F5 y F6 completas y probadas.

### F9.T1 · Extracción desde Firestore

**Acciones** `scripts/migration/export-firestore.mjs`: con `firebase-admin` y una
cuenta de servicio **de sólo lectura**, exporta cada colección a NDJSON en
`.migration/export/{coleccion}.ndjson`, incluyendo subcolecciones, y produce un
manifiesto con recuento y suma de verificación por colección.

**Criterio de aceptación** El recuento por colección coincide con el inventario de
`F0.T1`. `.migration/` en `.gitignore`: **son datos personales y no entran en el
repositorio bajo ninguna circunstancia.**

### F9.T2 · Transformación

**Acciones** `scripts/migration/transform.mjs`: aplica el mapa de `§1.3`, y en el
mismo paso:
- migra `student → architect` y `teacher → trainer`;
- resuelve los códigos `NEG-YYYY-NNN` a identificadores donde el espejo derivado sea
  la única referencia — **la migración perezosa en lectura que hoy hace
  `portfolioResolver` se materializa aquí, de una vez**;
- separa los cuerpos de artefacto que superen el umbral de `F5.T4` a ficheros
  destinados a S3;
- **informa** de toda referencia rota en `.migration/issues.json` en lugar de
  descartarla — la misma regla que el producto ya aplica a `LinkIssue`.

**Criterio de aceptación** El transformador es **idempotente**: ejecutarlo dos veces
sobre la misma extracción produce ficheros idénticos. Y no inventa: cada ítem de
salida se puede trazar hasta su documento de origen.

### F9.T3 · Carga y verificación

**Acciones** `scripts/migration/load-dynamo.mjs`: `BatchWriteItem` de 25 en 25, con
reintento exponencial de los ítems no procesados. Después,
`scripts/migration/verify.mjs`: recorre el origen y el destino y compara recuento,
identificadores y una muestra de campos por entidad.

**Criterio de aceptación** `verify.mjs` termina con cero diferencias, y su salida se
pega en el log. **Ensayo obligatorio en `dev` con una copia completa antes de tocar
producción**; el ensayo también sirve para medir cuánto tarda, que es el número que
decide la duración de la ventana de corte.

### F9.T4 · R4 — Migración de usuarios

**El problema.** Firebase almacena las contraseñas con su propia variante de scrypt
y no las exporta en un formato que Cognito acepte. No hay traslado directo.

**Dos opciones, y la recomendación:**

| Opción | Cómo | Coste para el usuario | Recomendación |
|---|---|---|---|
| **A. Importación + restablecimiento** | `cognito-idp create-user-import-job` con un CSV (correo, nombre, `email_verified=true`). Los usuarios quedan en `RESET_REQUIRED` y reciben un correo | Fijar la contraseña una vez | **Elegida** |
| **B. Disparador de migración perezosa** | Lambda `UserMigration` que, en el primer inicio de sesión, valida la contraseña contra Firebase y crea el usuario | Ninguno | Descartada |

**Por qué A.** La opción B es más elegante y **mantiene viva una dependencia de
Firebase dentro del camino de autenticación de AWS** — exactamente lo que esta
migración existe para terminar — además de obligar a conservar una clave de API de
Firebase con capacidad de verificar credenciales durante meses. El producto tiene
decenas de usuarios, **no** tiene auto-registro, y ya está construido alrededor del
correo de restablecimiento: `userProvisioningService` **nunca** ha permitido que un
administrador elija una contraseña. Pedir un restablecimiento no es una degradación
del flujo; es el flujo que este producto ya tiene.

**Acciones**
1. Exportar los usuarios de Firebase Auth (`firebase auth:export`).
2. Generar el CSV en el esquema exacto que pide el trabajo de importación de Cognito.
3. Ejecutar el trabajo de importación y revisar su registro en CloudWatch.
4. Asignar cada usuario a su grupo de rol según el documento `users/{uid}` migrado.
5. **Los usuarios de Google no se importan**: entran por federación con el mismo
   correo la primera vez y Cognito enlaza la identidad.
6. Redactar y enviar el correo de aviso antes del corte, no después.

**Criterio de aceptación**
- Cada usuario de Firebase tiene su usuario en Cognito con el mismo correo y el
  grupo correcto.
- **Ningún usuario queda sin grupo.** Un usuario sin grupo no tiene rol, y sin rol
  no ve nada: la comprobación es explícita, con recuento, no por muestreo.
- Un usuario de prueba completa el ciclo: recibe el correo, fija la contraseña,
  entra, y ve **su** portafolio.

### F9.T5 · Reconciliación de identificadores

**El problema, y es el que hunde este tipo de migraciones.** El `uid` de Cognito
(`sub`) **no** es el `uid` de Firebase. Y `userId` aparece como propietario en
proyectos, iniciativas, cursos y ajustes, y como clave de partición en perfiles,
fichas de agente, progreso y notas.

**Acciones**
1. El trabajo de importación produce el `sub` nuevo de cada usuario: construir el
   mapa `uidFirebase → subCognito`.
2. **Aplicar el mapa en `F9.T2`, no después.** La transformación se ejecuta *después*
   de la importación de usuarios y consume el mapa. Ese es el orden correcto de las
   dos tareas y contradice el orden en que están numeradas: **`F9.T4` se ejecuta
   antes que `F9.T2`.**
3. Un identificador sin correspondencia **detiene la migración**. No se inventa, no
   se omite: un proyecto cuyo propietario no se resolvió es un proyecto que su dueño
   no volverá a ver, y descubrirlo en producción es descubrirlo tarde.

**Criterio de aceptación** `verify.mjs` comprueba que **todo** `GSI1PK` de tipo
`USER#` corresponde a un `sub` que existe en Cognito. Cero excepciones.

---

# FASE 10 · CI/CD

**Objetivo.** Que un `merge` a `main` despliegue solo, con las mismas puertas de
calidad que hoy y sin ninguna credencial de larga duración.
**Duración:** 1 día. **Coste:** 0.
**Precondición:** F1.T5, F2, F8 completas.

### F10.T1 · Adaptar los flujos existentes

**Acciones**
- `ci.yml`: **no se toca**, salvo el trabajo `rules`. Los cuatro trabajos
  (`quality`, `tests` en cuatro fragmentos, `coverage`, `rules`) siguen igual; las
  variables `VITE_FIREBASE_*` de marcador de posición se sustituyen por las de
  Cognito y del API.
- El trabajo `rules` **cambia de objeto, no desaparece**: deja de arrancar el
  emulador de Firestore y pasa a ejecutar las pruebas de política de `F6.T2` contra
  **DynamoDB Local** en un contenedor de servicio. Con ello el trabajo deja de
  necesitar JDK 21 y se vuelve más rápido.
- Nuevo trabajo `infra`: `npm run infra:test` y `cdk diff` en cada PR, publicando el
  diferencial como comentario.

**Criterio de aceptación** Un PR muestra el `cdk diff` en su conversación. Un cambio
de infraestructura que sólo se ve al desplegar es un cambio que nadie revisó.

### F10.T2 · Flujo de despliegue

**Acciones** `.github/workflows/deploy.yml`, disparado por `push` a `main`, con
`permissions: { id-token: write, contents: read }`:
1. Asume `arky-github-deploy` por OIDC (sin secretos almacenados).
2. `npm ci` → `npm run quality:static` → `npm run test:ci` → `npm run build`.
3. `npm run check:bundle-secrets` y `check:bundle-budget` **antes** de subir nada.
4. `cdk deploy` de los stacks de datos, identidad, API y observabilidad.
5. `aws s3 sync dist/ s3://arky-prod-site --delete` con las cabeceras de caché
   correctas por tipo de fichero.
6. Invalidación de `/index.html`.
7. **Prueba de humo posterior al despliegue**: la carga la aplicación, hace un
   inicio de sesión de un usuario de prueba y una lectura del API. Si falla,
   revierte el `s3 sync` a la versión anterior del bucket.

**Criterio de aceptación** El paso 7 existe y se ha visto revertir. Un despliegue
que sólo comprueba que el `sync` terminó comprueba que se copiaron ficheros, no que
la aplicación funciona.

### F10.T3 · Entornos y protección

**Acciones** Entorno `production` en GitHub con **revisión obligatoria** antes del
despliegue. `dev` se despliega solo desde cualquier rama.

**Criterio de aceptación** Un `push` a `main` se detiene esperando aprobación. Es la
única barandilla que impide que un agente autónomo despliegue a producción sin que
una persona lo mire, y en un plan pensado para ejecutarse con IA es la barandilla
más importante del documento.

### F10.T4 · Playwright contra el despliegue real

**Acciones** `e2e.yml` sigue corriendo contra `dist/` servido por `vite preview` en
los PR, **y** se añade una ejecución contra la URL de CloudFront de `dev` tras cada
despliegue. Se conservan los dos proyectos, Chromium de escritorio y Safari de iPad.

**Criterio de aceptación** La prueba de humo pasa en los dos navegadores contra el
despliegue de `dev`. Safari de iPad se mantiene porque el fallo de carga de *chunk*
que motivó `lazyWithRetry` era suyo, y CloudFront cambia precisamente la forma en
que llegan los *chunks*.

---

# FASE 11 · Observabilidad, copias de seguridad y recuperación

**Objetivo.** Ver lo que pasa y poder volver atrás, sin salir de la capa gratuita.
**Duración:** 1 día. **Coste:** 0 con retención acotada.
**Precondición:** F6, F7, F8 completas.

### F11.T1 · Logs con retención finita

**Acciones** Todo grupo de logs se crea **en CDK** con `retention: TWO_WEEKS`.
Ningún grupo con retención infinita.

**Criterio de aceptación**
```
aws logs describe-log-groups --query 'logGroups[?!retentionInDays].logGroupName'
# → lista vacía
```
Un grupo de logs sin retención crece para siempre y es, con diferencia, **la forma
más común de que una cuenta de capa gratuita empiece a facturar**: nadie lo mira
porque los logs no parecen almacenamiento.

### F11.T2 · Métricas y alarmas

**Acciones** Diez alarmas o menos (el gratis permite diez):
1. Errores 5xx del API > 5 en 5 min.
2. Errores de Lambda > 5 en 5 min (una por función, tres).
3. Estrangulamiento de Lambda > 0.
4. `UserErrors` de DynamoDB > 10 en 5 min (indica un fallo de condición sistemático).
5. Tasa de error 5xx de CloudFront > 1 %.
6. `EstimatedCharges` > 1 USD (de `F1.T4`).
7. Fallos de autenticación de Cognito, umbral por definir tras una semana de medida.

**Criterio de aceptación** Cada alarma tiene destino SNS confirmado, y **al menos
una se ha disparado en una prueba deliberada**.

### F11.T3 · Enlazar la observabilidad de la aplicación

**Acciones** `services/observability` ya captura errores de ejecución y sesión de
arranque. Añadir un envío por lotes a un endpoint `POST /v1/telemetry` que escriba
en CloudWatch Logs, **con muestreo** y con el mismo vallado de contenido no
confiable que ya aplica el producto.

**Criterio de aceptación** Un error de renderizado en el navegador aparece en
CloudWatch en menos de un minuto. El muestreo evita que una pantalla en bucle de
error consuma los 5 GB de ingesta gratuitos en una tarde.

### F11.T4 · Copias de seguridad y ensayo de restauración

**Acciones**
- DynamoDB PITR activo (35 días, incluido).
- Exportación semanal a S3 mediante una regla de EventBridge (las exportaciones
  facturan por GB exportado; con menos de 1 GB es despreciable, y se anota).
- **Ensayo de restauración**: restaurar a una tabla nueva, apuntar `dev` a ella,
  comprobar que la aplicación arranca, y borrarla.

**Criterio de aceptación** El ensayo de restauración está hecho y su tiempo está
medido en el runbook. **Una copia de seguridad que nunca se ha restaurado es una
hipótesis.**

---

# FASE 12 · Verificación y endurecimiento

**Objetivo.** Demostrar, con pruebas ejecutadas, que el sistema en AWS hace lo
mismo que el de Firebase y que la frontera de autorización aguanta.
**Duración:** 2 días. **Coste:** 0.
**Precondición:** F3–F11 completas.

### F12.T1 · Paridad funcional

**Acciones** Recorrer, en el despliegue `dev`, el guion completo del producto:
crear una iniciativa → abrir una atención desde ella → planificar un entregable →
generar un artefacto → revisarlo y decidir → publicarlo; más el Centro de
Formación, la Oficina con su panel de coordinación, la captura asistida en las seis
formas, la guía de plataforma, las fichas de agente y la administración de usuarios.

**Criterio de aceptación** Una lista de verificación firmada, con captura o salida
por cada paso. Los flujos que dependen de reglas —aprobar un acta, decidir en el
ARB, publicar— se prueban **con cada uno de los seis roles**, incluida la
comprobación negativa: un `viewer` que intenta escribir recibe un 403 y la interfaz
lo dice.

### F12.T2 · La matriz de autorización, atacada

**Acciones** Suite de pruebas de integración contra el API desplegado en `dev`, con
un usuario real por rol, que intenta **todas** las operaciones prohibidas:
- un `viewer` escribiendo un proyecto;
- un `architect` aprobando un acta;
- un usuario leyendo el proyecto **de otro**;
- una actualización de una decisión de revisión (debe ser imposible siempre);
- un `admin` otorgando `superadmin`;
- un `admin` degradando a un `superadmin`;
- una escritura con el rol `student` en el cuerpo;
- una petición con un token de acceso donde se espera uno de identidad;
- una petición con un token **de otro pool de Cognito**.

**Criterio de aceptación** Las nueve rechazadas, con el código correcto y **sin
lectura de DynamoDB** en las que la política rechaza antes. Las dos últimas son las
que fallan cuando la verificación de token se hizo a la ligera.

### F12.T3 · Presupuestos de calidad, sin regresión

**Acciones** Reejecutar la línea base de `F0.T1` y comparar los ocho números.

**Criterio de aceptación**
- Cobertura: no baja de los suelos de `vite.config.ts`.
- `check:module-boundaries`: cero ciclos entre contextos de dominio, cero
  importaciones ascendentes. La nueva entrada `services/api` está declarada y
  acotada.
- `check:bundle-budget`: **el SDK de Firebase sale y entra el de AWS.** Se espera
  una **reducción**: `firebase` completo pesa considerablemente más que
  `@aws-sdk/client-cognito-identity-provider` con *tree-shaking*, y el SDK de
  DynamoDB **no entra en el navegador** porque el acceso pasa por el API. Si el
  presupuesto sube, la tarea no está terminada: se revisa qué se importó por
  barril en lugar de por ruta de fichero — la regla que a este repositorio le ha
  costado un presupuesto de bundle seis veces.
- `check:module-size`, `check:any-budget`: sin subir.

### F12.T4 · Endurecimiento final

**Acciones**
1. CSP a modo **obligatorio** (deja de ser `Report-Only`), tras la sesión limpia de
   `F8.T3`.
2. Revisar cada política IAM: ningún comodín en acción ni en recurso.
3. Confirmar que ningún bucket es público y que ninguna Lambda tiene una URL de
   función abierta salvo la de *streaming*, que valida el token.
4. `npm audit --audit-level=high` y CodeQL en verde (el flujo `security.yml` ya
   existe).
5. Revisar `.env.example` y borrar toda variable `VITE_FIREBASE_*`; añadir las de
   AWS con su comentario, en el mismo estilo del fichero.

**Criterio de aceptación** Los cinco puntos verificados con su comando pegado en el
log.

---

# FASE 13 · Corte a producción

**Objetivo.** Pasar los usuarios reales a AWS con una ventana corta, anunciada y
reversible.
**Duración:** una ventana de 2–4 horas. **Coste:** 0.
**Precondición:** F12 completa **sin excepciones abiertas**.

> **La regla de esta fase.** Hasta aquí, nada de lo hecho ha tocado el Firebase de
> producción, así que abandonar el plan en cualquier punto anterior costaba cero.
> A partir de `F13.T3` eso deja de ser cierto. Por eso la fase empieza por escribir
> el criterio de vuelta atrás **antes** de dar el primer paso.

### F13.T1 · Preparativos

**Acciones**
1. Congelar los cambios funcionales: sólo correcciones del corte.
2. Avisar a los usuarios con 72 horas: fecha, duración, **y que tendrán que fijar
   una contraseña nueva**.
3. Desplegar la infraestructura de producción completa con `cdk deploy`, vacía de
   datos.
4. Ejecutar el ensayo completo de migración contra producción **en modo lectura**:
   extraer, transformar, verificar, **sin cargar**. Sirve para medir la duración
   real y encontrar los datos raros antes de que importen.

**Criterio de aceptación** El ensayo termina sin incidencias y su duración medida
cabe holgadamente en la ventana anunciada.

### F13.T2 · Dominio y certificado

**Acciones** Certificado ACM en `us-east-1` (gratis) para el dominio de producción,
validado por DNS; asociado a la distribución de CloudFront. El dominio se añade
también a las URL de retorno de Cognito.

**Criterio de aceptación** HTTPS válido en el dominio de producción, con la
aplicación aún apuntando a Firebase. Este paso es reversible y se hace **antes** del
corte para que la ventana no incluya nunca una espera de propagación de DNS.

### F13.T3 · La ventana

Secuencia, en este orden exacto:

| # | Paso | Reversible |
|---|---|---|
| 1 | Activar el modo mantenimiento en Vercel (página estática con el aviso) | Sí |
| 2 | Poner `firestore.rules` en **sólo lectura** (`allow write: if false`) | Sí |
| 3 | Exportar Firestore y Firebase Auth (extracción final) | Sí |
| 4 | Importar usuarios a Cognito y **construir el mapa de identificadores** (`F9.T4`) | Sí |
| 5 | Transformar con el mapa y cargar en DynamoDB (`F9.T2`, `F9.T3`) | Sí |
| 6 | Ejecutar `verify.mjs`. **Si falla, se aborta aquí** | Sí |
| 7 | Prueba de humo en producción con dos cuentas reales de dos roles | Sí |
| 8 | Cambiar el DNS al CloudFront de producción | **Punto de no retorno práctico** |
| 9 | Quitar el modo mantenimiento | — |
| 10 | Vigilar 60 minutos: alarmas, logs, coste | — |

**Criterio de vuelta atrás, escrito antes de empezar:** se revierte si `verify.mjs`
reporta cualquier diferencia, si la prueba de humo falla con cualquier rol, o si en
los primeros 60 minutos aparece un error 5xx sostenido. La vuelta atrás es
**devolver el DNS a Vercel y restaurar `firestore.rules`**; Firestore conserva los
datos porque el paso 2 lo dejó en sólo lectura y **nunca se borró nada**.

### F13.T4 · Guardia posterior

**Acciones** 72 horas de vigilancia: revisión diaria de alarmas, coste y logs de
error. Canal directo para incidencias de usuarios. Firebase **se queda encendido y
en sólo lectura** durante todo este período.

**Criterio de aceptación** 72 horas sin incidencia de gravedad y con el coste diario
en 0,00 USD.

---

# FASE 14 · Post-corte: desmantelamiento y cierre

**Objetivo.** Eliminar lo que sobra, dejar la documentación fiel y cerrar las
decisiones diferidas.
**Duración:** 1 día, tras 30 días de estabilidad. **Coste:** 0.

### F14.T1 · Desmantelar Firebase

**Acciones** Sólo tras **30 días** de estabilidad:
1. Exportación final de Firestore y Auth, archivada fuera de línea.
2. Borrar `firebase.ts`, `firestore.rules`, `firebase.json`, `.firebaserc`,
   `services/persistence/firestoreDocumentStore.ts` y `__tests__/rules/`.
3. `npm uninstall firebase @firebase/rules-unit-testing`.
4. Retirar de `eslint.config.js` las restricciones de importación de los SDK de
   Firebase y sustituirlas por las equivalentes para el SDK de AWS: **el cerco no
   se levanta, cambia de objeto.** Es la regla que ha mantenido esta migración
   barata y desmontarla sería gastarse el beneficio.
5. Deshabilitar el proyecto de Firebase (no borrarlo aún).
6. Retirar el proyecto de Vercel.

**Criterio de aceptación** `grep -r "firebase" --include=*.ts --include=*.tsx .`
devuelve **sólo** menciones históricas en documentación. El bundle baja y
`check:bundle-budget` se **actualiza a la baja** — la regla del repositorio es que
un presupuesto puede bajar y nunca subir.

### F14.T2 · Actualizar la documentación

**Acciones** Esta es la tarea que se salta todo el mundo, y en este repositorio
tiene una regla escrita que la exige: *si una pantalla se mueve o se renombra,
`lib/platformGuide/platformGuideTopics.ts` cambia en el mismo commit.*

1. `CLAUDE.md`: la tabla de tecnologías, la capa de datos, las rutas de colección,
   la sección de autenticación, las de despliegue y variables de entorno, y la lista
   de "What NOT to Do" — donde entran las prohibiciones nuevas: nada de `Scan`, nada
   de Secrets Manager, nada de comodines IAM, nada de `Lambda@Edge`.
2. `AGENTS.md`: el espejo, en el mismo commit.
3. `lib/platformGuide/platformGuideTopics.ts`: si alguna respuesta menciona Google
   o el correo de restablecimiento, se actualiza.
4. `docs/security-hardening.md` y `docs/persistence-hardening.md`: reescritos sobre
   el modelo nuevo.
5. Borrar `docs/primer-administrador.md` y reescribirlo para Cognito — **la guía
   paso a paso para la persona no técnica que instala el producto**, que es
   exactamente quien más sufre un documento desactualizado.

**Criterio de aceptación** Ejecutar `/refresh-claude-md` y que no encuentre
discrepancias.

### F14.T3 · Optimización de coste con datos reales

**Acciones** Con 30 días de uso medido:
1. Revisar Cost Explorer por servicio y confirmar 0,00 USD.
2. Decidir sobre API Gateway: si el tráfico es bajo y estable, evaluar el paso a
   **Lambda Function URLs** con verificación de token en la función (elimina el
   único componente que factura fuera del gratis permanente). **Decidir con el dato,
   no antes.**
3. Ajustar la retención de logs y el TTL de las acciones de agente al volumen real.

### F14.T4 · Decisiones diferidas, cerradas por escrito

Cada una queda como ADR o como entrada en `docs/technical-debt-audit.md`, con su
razón y su condición de reapertura:

| Decisión | Estado | Se reabre cuando |
|---|---|---|
| **ADR-009 · Bedrock como proveedor** | Diferida | El coste por token de Bedrock resulte competitivo *y* la calidad se valide contra los guardarraíles actuales. Hoy no hay capa gratuita |
| **Tiempo real (AppSync / WebSocket)** | Diferida | La revisión colaborativa simultánea sea un requisito, no una comodidad |
| **GuardDuty** | Diferida | Haya presupuesto: es la mejor detección disponible y **no** es gratuita |
| **Cognito tier Plus** | Diferida | Se necesite protección contra credenciales filtradas. Fuera del gratis |
| **WAF delante de CloudFront** | Diferida | Aparezca abuso real. Factura por regla y por petición |
| **Multi-región** | Descartada | No procede para este producto |

---

## 3. Registro de riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación | Detección |
|---|---|---|---|---|---|
| R1 | Artefactos > 400 KB dejan de guardarse | Media | Alto | `F5.T4`: medir, después descargar a S3 con umbral declarado | Prueba con artefacto sintético de 900 KB |
| R2 | Transacción mal traducida corrompe un contador | Media | Alto | `F5.T5`: `ADD` atómico + condiciones; prueba de concurrencia | Dos escrituras simultáneas → 1 `success`, 1 `conflict` |
| R3 | Pérdida del tiempo real en revisión | Alta | Bajo | `F6.T6`: repesca por foco; sólo afecta a un panel | Prueba de dos pestañas |
| R4 | Usuarios sin poder entrar tras el corte | Media | **Crítico** | `F9.T4`: aviso a 72 h, correo de restablecimiento, guardia | Recuento: usuarios sin grupo = 0 |
| R5 | **`sub` de Cognito ≠ `uid` de Firebase → datos huérfanos** | **Alta** | **Crítico** | `F9.T5`: mapa aplicado en la transformación; sin correspondencia se aborta | `verify.mjs` comprueba todo `GSI1PK` contra Cognito |
| R6 | Coste inesperado | Baja | Medio | `F1.T4` presupuestos + alarma probada; prohibiciones de `§0.4` | Alarma a 1 USD, disparo verificado |
| R7 | Deriva entre `lib/authz` y la política del servidor | Media | Alto | `F6.T2`: la prueba de matriz se reapunta, no se retira | `rulesMatrix.test.ts` en CI |
| R8 | Rol OIDC asumible por cualquier repositorio | Media | **Crítico** | `F1.T5`: condición `sub` con repositorio y rama exactos | Revisión de la política de confianza en `F12.T4` |
| R9 | CSP obligatoria rompe el inicio de sesión | Media | Alto | `F8.T3`: `Report-Only` hasta una sesión limpia | Registro de violaciones vacío antes de `F12.T4` |
| R10 | Regresión de calidad silenciosa | Media | Medio | `F0.T1` mide, `F12.T3` compara los ocho números | Comparación con la línea base |
| R11 | Deriva de infraestructura (recurso creado a mano) | Media | Medio | Regla de `§0.5`: lo duradero nace en CDK | `cdk diff` en cada PR |
| R12 | Grupo de logs sin retención crece sin límite | **Alta** | Medio | `F11.T1`: retención en CDK, consulta que lista los infractores | Consulta con salida vacía |

## 4. Ruta crítica y paralelización

```
F0 ─┬─▶ F1 ──▶ F2 ─┬─▶ F3 (identidad) ──┐
    │              ├─▶ F5 (datos) ──────┼─▶ F6 (API) ─┬─▶ F7 (IA)
    │              └─▶ F8 (hosting) ────┘             ├─▶ F9 (migración)
    └─▶ F4 (puerto, en paralelo) ────────────────────▶┘   │
                                                           ▼
                                          F10 ─▶ F11 ─▶ F12 ─▶ F13 ─▶ F14
```

- **F4 es la fase que se puede adelantar**, y conviene: no toca AWS, y desbloquea F5
  entera. Si sólo hay tiempo para empezar por un sitio, es por ahí.
- **F8 no depende de nada más que de F2** y puede hacerse mientras se trabaja en
  identidad y datos.
- **F13 no empieza con ninguna excepción de F12 abierta.** No hay atajo defendible.

**Duración total estimada:** 18–22 días de trabajo, o 12–14 con F4 y F8 en paralelo.

## 5. Cómo ejecutar este plan con Claude Code

**Una tarea por sesión.** Cada tarea tiene identificador, precondiciones y criterio
de aceptación precisamente para que quepa en una sesión sin arrastrar contexto.

Instrucción de arranque recomendada:

```
Ejecuta la tarea F5.T3 de docs/aws-migration-plan.md.
Lee la tarea y sus precondiciones, verifica que las fases previas están
registradas como completas en docs/aws-migration-log.md, implementa,
ejecuta el criterio de aceptación, escribe el resultado real en el log
y haz un commit atómico titulado "F5.T3: …".
No avances a la tarea siguiente.
```

**Cinco reglas para el agente que ejecute:**
1. **No inventar cuotas ni nombres de API.** Consultar el AWS MCP Server o la
   documentación. Una cuota recordada de memoria de entrenamiento es la forma en que
   un plan de coste cero deja de serlo.
2. **Nada duradero fuera de CDK.**
3. **El criterio de aceptación se ejecuta y su salida real se pega.** «Debería
   funcionar» no cierra una tarea.
4. **Ante una precondición no cumplida, detenerse y decirlo.** No improvisar el
   camino.
5. **Ninguna tarea anterior a F13 escribe en el Firebase de producción.** Si parece
   necesario, la tarea está mal planteada.

## 6. Lo que este plan asume y conviene confirmar

Cinco supuestos que cambian el plan si son falsos, y que conviene confirmar antes de
`F1`:

1. **Volumen de datos pequeño** (decenas de proyectos, cientos de artefactos). Si
   fueran cientos de miles, F9 pasa de un script a un trabajo por lotes.
2. **Usuarios en el orden de decenas.** Con más de 10 000 MAU, Cognito deja de ser
   gratis.
3. **Residencia de datos en Estados Unidos aceptable.** Si se requiere la UE, cambia
   la región en `F0.T2` — y es lo único que hay que decidir antes de empezar.
4. **Sin requisito de tiempo real estricto** en la revisión colaborativa.
5. **Las cuotas de capa gratuita citadas son las vigentes a 2026-09.** `F1.T4` las
   verifica contra la página de precios en el momento de ejecutar, y las barandillas
   de presupuesto existen precisamente porque un plan no puede depender de que una
   cuota no cambie.
