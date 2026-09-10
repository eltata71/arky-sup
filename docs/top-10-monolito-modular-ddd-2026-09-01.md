# Top 10 — Monolito modular, DDD, deuda técnica e integración continua

> **Fecha de corte:** 1 de septiembre de 2026
> **Estado:** las cuatro olas están **ejecutadas** — los diez hallazgos cerrados
> o reducidos a un presupuesto medido. Ver §3 bis (Ola 1), §3 ter (Ola 2),
> §3 quater (Ola 3) y §3 quinquies (Ola 4).
> **Rama analizada:** `claude/top-10-modular-tech-debt-mvm6w0` (idéntica a `main`, commit `c5a107f`)
> **Método:** análisis estático del árbol completo, grafo de dependencias entre
> módulos calculado sobre los `import` reales, ejecución local de la puerta de
> calidad completa, y lectura de las duraciones reales de GitHub Actions.
> **Alcance:** modularidad (monolito modular), diseño dirigido por el dominio
> (DDD), deuda técnica y rendimiento del pipeline de CI/CD.
>
> Este documento **no repite** el [Top 10 del 30 de agosto](./top-10-consolidacion-tecnica-2026-08-30.md),
> centrado en seguridad, XSS, cobertura y observabilidad. Aquel cerró la
> frontera de confianza; éste ataca el **coste de cambio** y el **tiempo de
> retroalimentación**, que son los dos ejes que el anterior dejó abiertos.

---

## 1. Conclusión ejecutiva

Arky 10 tiene hoy **603 archivos productivos y ~133.600 líneas** organizadas en
17 carpetas bajo `services/`, más `lib/`, `hooks/`, `context/`, `components/` y
`pages/`. La organización *parece* un monolito modular y la nomenclatura del
dominio existe y es buena (`lib/eaTerminology.ts` fija el lenguaje ubicuo de los
cuatro niveles). Pero al medir las dependencias reales aparecen tres brechas
sistémicas:

1. **Las carpetas no son módulos.** Hay **23 ciclos de dependencia entre pares
   de módulos** y **37 ciclos de tres módulos**. Un módulo sólo es un módulo si
   se puede razonar sobre él sin cargar a sus vecinos, y hoy ninguno de los
   grandes cumple esa prueba. Nada en el pipeline lo impide.
2. **El dominio no tiene dueño.** El agregado central del producto — el
   *Proyecto de Arquitectura* — no tiene módulo propio; su invariante más
   importante (una atención siempre pertenece a una iniciativa) se aplica en un
   componente de React, y la persistencia de cinco contextos vive en un único
   archivo de 1.379 líneas junto a otras tres estrategias de persistencia
   incompatibles entre sí.
3. **CI tarda ~14 minutos y el 79 % es un solo paso.** La causa está medida y no
   es la cobertura: es que **272 de los 371 archivos de prueba pagan la
   construcción de un DOM que no usan**. En la ejecución local, montar entornos
   jsdom cuesta **212,9 s acumulados frente a 50,6 s de ejecución real de las
   pruebas** — más de 4× el trabajo útil.

Las tres se refuerzan: sin fronteras no hay módulos que probar por separado, y
sin pruebas por módulo la única puerta posible es ejecutarlo todo, siempre.

### Cómo se priorizó

Escala 1 (bajo) a 5 (alto) en **Impacto (I)**, **Probabilidad (P)** y **Coste de
demora (D)**; prioridad = `I × P × D`. El **Esfuerzo (E)** no baja el riesgo:
sólo dimensiona el incremento.

| # | Hallazgo | Eje | I | P | D | Prio | E | Horizonte |
|---:|---|---|:-:|:-:|:-:|--:|:-:|---|
| 1 | 23 ciclos entre módulos y ninguna regla que los prohíba | Modularidad | 5 | 5 | 5 | **125** | 3 | P0 |
| 2 | El paso de tests es el 79 % de CI: 73 % de las pruebas paga un DOM inútil | CI/CD | 4 | 5 | 5 | **100** | 2 | P0 |
| 3 | El agregado «Proyecto de Arquitectura» no tiene módulo; su invariante vive en la UI | DDD | 5 | 4 | 5 | **100** | 3 | P0 |
| 4 | Un repositorio-dios para cinco contextos y cuatro estrategias de persistencia | DDD | 5 | 4 | 4 | **80** | 4 | P1 |
| 5 | `npm run quality` no es la puerta de CI, y el E2E no prueba lo que se despliega | CI/CD | 4 | 5 | 4 | **80** | 2 | P1 |
| 6 | `types.ts`: núcleo compartido de 76 tipos, con 64 líneas muertas y divergentes | DDD / deuda | 4 | 4 | 4 | **64** | 2 | P1 |
| 7 | La capa de aplicación es la UI: 92 de 183 archivos importan servicios | Modularidad | 4 | 4 | 4 | **64** | 4 | P1 |
| 8 | Cuatro modelos de «calidad» compitiendo, dos con el mismo nombre de archivo | DDD | 4 | 4 | 3 | **48** | 3 | P2 |
| 9 | `strict` cubre 11 de 603 archivos; la puerta más barata es la más vacía | Deuda | 3 | 5 | 3 | **45** | 3 | P2 |
| 10 | La capa canónica de IA filtra el motor legado por su API pública | Modularidad | 3 | 4 | 3 | **36** | 2 | P2 |

---

## 2. Evidencia cuantitativa

Todo lo que sigue está medido en este repositorio, en esta rama, con las
dependencias instaladas desde `package-lock.json`.

### 2.1 Tamaño y forma

| Métrica | Valor |
|---|---|
| Archivos productivos `.ts`/`.tsx` | 603 (+ 6 en la raíz) |
| Líneas productivas | ~133.600 |
| Archivos de prueba | 371 (355 en `__tests__/`, 16 colocados) |
| Pruebas | 3.397 (3.338 pasan, 59 omitidas) |
| Carpetas bajo `services/` | 17 módulos + **19 archivos sueltos en la raíz** |
| Módulos sin barril `index.ts` | 4 (`chat`, `export`, `memory`, `presentation`) |
| Importaciones profundas entre módulos (saltándose el barril) | **76** |

### 2.2 Puerta de calidad, medida localmente (4 vCPU)

| Paso | Duración |
|---|---:|
| `npm run typecheck` | 19 s |
| `npm run typecheck:strict` | **1 s** |
| `npm run lint` | 17 s |
| `npm run test:ci` | 138 s |
| `npm run test:coverage` | 166 s |
| `npm run build` | 58 s |

Desglose interno de Vitest (`test:coverage`, tiempos acumulados entre workers):

```
Duration 164.70s
  transform    14.29 s
  setup        58.09 s   ← @testing-library/react + jest-dom en CADA archivo
  import       64.07 s
  tests        50.59 s   ← el trabajo útil
  environment 212.90 s   ← construcción de jsdom: 4,2× el trabajo útil
```

### 2.3 CI real (GitHub Actions, ejecución #254, exitosa)

| Paso del job «Quality gate» | Duración |
|---|---:|
| Cola antes de arrancar | 2 m 28 s |
| Checkout + Setup Node | 11 s |
| `npm ci` (caché caliente) | 14 s |
| `typecheck` | 24 s |
| `typecheck:strict` | **2 s** |
| `ESLint` | 22 s |
| 3 presupuestos (`any`, orphan, module-size) | < 1 s |
| **`test:coverage`** | **8 m 49 s — 79 % del job** |
| `build` | 1 m 05 s |
| `bundle-secrets` + `bundle-budget` | < 1 s |
| **Total del job** | **11 m 13 s** |

El job `Firestore rules (emulator)` corre en paralelo y tarda 1 m 21 s, así que
no está en la ruta crítica. Los workflows `E2E` (2–4 min) y `Security` (5–7 min)
también son paralelos. **La retroalimentación de un PR es, por tanto,
≈ 14 minutos, y el 79 % de ese tiempo es un único paso.**

### 2.4 Grafo de dependencias entre módulos

Calculado resolviendo cada `import` relativo o con alias `@/` a su módulo.

**Ciclos entre dos módulos (23).** Los que involucran módulos de dominio reales
—no la raíz de `services/`— son:

```
services/export        <->  services/quality
services/artifacts     <->  services/export
services/agent         <->  services/architectureOffice
services/ai            <->  services/diagram
lib                    <->  services/diagram
lib                    <->  services/export
lib                    <->  services/architectureOffice
lib                    <->  services/publicationPipeline
components             <->  context
components             <->  hooks
```

Además, los **19 archivos sueltos en `services/`** (que no pertenecen a ningún
módulo) forman ciclo con **11 de los 17 módulos**.

**Fan-out por módulo** (a cuántos otros módulos depende cada uno):

| Módulo | Depende de |
|---|---:|
| `components` | 17 |
| `services/` (archivos sueltos) | 15 |
| `hooks` | 10 |
| `pages` | 9 |
| `services/architectureOffice` | 7 |
| `services/artifacts` | 6 |
| `lib` | 6 |

---

## 3. Los diez hallazgos

### 1. Las carpetas de `services/` no son módulos: 23 ciclos y ninguna regla que lo impida — P0

**Evidencia.** El grafo de §2.4. `services/export` importa
de `services/quality` desde siete archivos, mientras
`services/quality/artifactQualityGateService` importa `../export/exportTypes`:
ninguno de los dos puede compilarse, probarse ni razonarse sin el otro.
`services/agent/agentContextComposer` importa `officeAgentPersonas` de
`architectureOffice`, y `architectureOffice/OfficeRunnerAdapters` importa
`agentPlanner` y `agentExecutor` de `agent`. `lib/`, documentado en `CLAUDE.md`
como *«helpers agnósticos del framework»* y por tanto la capa más baja, tiene
**siete archivos que importan de `services/`** (`lib/layoutSelector.ts`,
`lib/diagramTokens.ts`, `lib/runtimeValidation.ts`, `lib/diagramCategoryLabels.ts`,
`lib/lazyWithRetry.ts`), mientras `services/diagram` importa 21 veces de `lib`.

Nada de esto rompe una regla, porque no existe: ESLint sólo restringe tres
destinos de importación (`@google/genai`, `services/geminiService`, y los SDK de
Firebase en la UI). Los barriles `index.ts` existen en 13 de 17 módulos pero son
decorativos: **76 importaciones cruzadas los esquivan** y entran directamente a
archivos internos de otro módulo.

**Por qué importa.** Un ciclo convierte a dos módulos en uno solo, con el doble
de superficie. Es también la razón por la que no se puede probar un módulo
aislado, que a su vez es la razón por la que la única puerta posible es correr
las 3.397 pruebas siempre (hallazgo 2). Los ciclos no se añaden de golpe:
aparecen de a uno, cada uno razonable por separado — exactamente como llegaron
aquí los cuatro monolitos que la consolidación anterior tuvo que descomponer.

**Acción.**
1. Declarar los módulos y sus reglas en un manifiesto (`modules.json`): nombre,
   carpeta, API pública (`index.ts`), y módulos de los que puede depender.
2. Añadir `scripts/checkModuleBoundaries.mjs` al patrón que ya funciona en este
   repositorio (`checkModuleSize`, `countAnyTokens`): falla si aparece un ciclo
   nuevo o una importación profunda nueva. **Presupuesto monotónico**: el número
   de infracciones registrado hoy puede bajar y nunca subir.
3. Romper primero los cuatro ciclos de dominio, en este orden y con la misma
   técnica: extraer los *tipos compartidos* a un módulo hoja sin dependencias.
   - `export ↔ quality`: `ExportFormat` y `markdownTableParser` van a un
     `services/export/contracts` sin dependencias, o el reporte de calidad se
     inyecta en el exportador en vez de importarse.
   - `artifacts ↔ export`: `ArtifactPresentationModel` es del contexto
     `artifacts`; `export` debe recibirlo, no conocer su módulo.
   - `agent ↔ architectureOffice`: `architectureOffice` es el orquestador y
     `agent` el ejecutor; la dependencia debe ir en un solo sentido, con
     `agent` recibiendo las personas como parámetro (puerto), no importándolas.
   - `lib ↔ services/*`: mover a `services/diagram` los siete archivos de `lib`
     que dependen de servicios, o invertir con un registro.
4. Dar barril a los cuatro módulos que no lo tienen y prohibir la importación
   profunda en la regla del punto 2.

**Criterio de cierre.** Cero ciclos entre módulos de dominio; toda importación
entre módulos pasa por un `index.ts`; el gate falla si vuelve a aparecer uno.

---

### 2. El 79 % de CI es un solo paso, y el 73 % de las pruebas paga un DOM que no usa — P0

**Evidencia.** §2.2 y §2.3. En la ejecución local completa, Vitest reporta
`environment 212,90 s` frente a `tests 50,59 s`: **construir entornos jsdom
cuesta 4,2 veces lo que ejecutar las pruebas**. La causa es de configuración:
`vite.config.ts` declara `environment: 'jsdom'` globalmente, para los 371
archivos. De ellos, **272 (73 %) no tocan una sola API del DOM** — ni
`document`, ni `window`, ni `localStorage`, ni `@testing-library`.

El segundo coste tiene la misma forma: `vitest.setup.ts` importa
`@testing-library/jest-dom/vitest` y `@testing-library/react` en **todos** los
archivos, incluidos los 272 que no renderizan nada. Eso es el `setup 58,09 s`.

Y una comprobación importante para no atacar la causa equivocada: **la cobertura
no es el problema.** Localmente `test:ci` tarda 138 s y `test:coverage` 166 s —
la instrumentación v8 añade sólo un 20 %. Lo que multiplica el tiempo en CI es
que el runner estándar de GitHub tiene **2 vCPU**, así que el mismo trabajo se
reparte entre dos workers en vez de cuatro.

**Acción.**
1. **Entorno por archivo.** Declarar `node` como entorno por defecto y `jsdom`
   sólo para lo que renderiza, con `test.projects` o `environmentMatchGlobs`
   (`__tests__/components/**`, `**/*.test.tsx`). 272 archivos dejan de construir
   un DOM.
2. **Setup por entorno.** Partir `vitest.setup.ts` en dos: el actual queda para
   el proyecto jsdom; el proyecto node no carga React ni Testing Library.
3. **Sharding.** Ejecutar el paso en 4 jobs paralelos con
   `vitest run --shard=$i/4 --coverage`, y fusionar los reportes con
   `--merge-reports` antes de aplicar los umbrales. Cada shard corre en su
   propio runner de 2 vCPU, así que la paralelización es real, no repartida.
4. Mantener el umbral de cobertura sobre el reporte **fusionado**; un umbral por
   shard mediría un denominador distinto en cada uno y no significaría nada.

**Estimación.** Los pasos 1 y 2 eliminan la mayor parte de los 271 s de
`environment` + `setup` acumulados; el paso 3 divide el resto entre cuatro. La
proyección razonable es **de 8 m 49 s a 2–3 minutos**, y el PR completo de ~14 a
~6 minutos. Es la única partida del pipeline que justifica atención: todo lo
demás junto (typecheck, lint, tres presupuestos, build, dos comprobaciones de
bundle) suma 1 m 54 s.

**Criterio de cierre.** El paso de pruebas baja de 3 minutos en CI sin reducir
ni una aserción ni bajar un umbral.

---

### 3. El agregado central del producto no tiene módulo, y su invariante vive en un componente — P0

**Evidencia.** El dominio, según `lib/eaTerminology.ts` y `CLAUDE.md`, tiene
cuatro niveles. Tres tienen módulo propio:

| Nivel | Módulo que lo posee |
|---|---|
| Iniciativa de Negocio | `services/businessInitiatives/` |
| **Proyecto de Arquitectura** | **ninguno** |
| Solicitud de Entregable | `services/architectureOffice/` |
| Artefacto | `services/artifacts/`, `services/artifactCompiler/` |

El nivel intermedio —el que da nombre al producto— está repartido entre
`context/AppContext.tsx` (estado y reglas), `services/firestoreService.ts`
(persistencia), `services/portfolioGraph/` (resolución de relaciones),
`services/guidedProjectCreationService.ts` (creación guiada), `constants.ts`
(plantillas) y seis archivos de UI.

La consecuencia es concreta y verificable. `CLAUDE.md` establece que *«los
niveles padres son obligatorios en la creación»* y que una atención sin
iniciativa es el `orphan-attention` que el grafo reporta. Pero en `context/AppContext.tsx:250` la firma de `addProject` es:

```ts
projectData: Pick<Project, 'name' | 'description' | 'projectContext'>
  & Partial<Pick<Project, 'initiativeIds' | 'linkedBusinessProjects'>>
```

`initiativeIds` es **opcional**, y el cuerpo hace `projectData.initiativeIds ?? []`.
La regla obligatoria se aplica en un solo sitio:
`components/attentions/AttentionInitiativeGate.tsx`. Hoy sobrevive porque sólo
existen dos llamadas a `addProject`, ambas en `pages/ProjectsPage.tsx`, y ambas
pasan por la compuerta. La tercera llamada que alguien escriba —desde el agente,
desde una importación masiva, desde una plantilla— creará huérfanos en silencio,
y el sistema los **reportará** (`portfolioResolver.ts:254`) en lugar de haberlos
**impedido**.

**Por qué importa.** En DDD, un invariante que vive fuera del agregado no es un
invariante: es una convención de una pantalla. Y ésta es la convención que
sostiene toda la trazabilidad del portafolio.

**Acción.**
1. Crear `services/architectureProjects/` como contexto delimitado, con:
   `ArchitectureProjectTypes.ts` (el tipo `Project` migrado desde `types.ts`),
   `architectureProjectFactory.ts` y `ArchitectureProjectRepository.ts`.
2. La factoría es la **única** forma de construir un proyecto y **rechaza** la
   creación sin al menos una iniciativa, devolviendo un error de dominio
   tipado — no lanzando una excepción genérica.
3. `AppContext.addProject` pasa a ser lo que debe ser: una envoltura de React
   sobre la factoría, con `initiativeIds` **obligatorio** en su firma.
4. `AttentionInitiativeGate` sigue existiendo — es buena UX — pero deja de ser
   la única defensa.
5. Una prueba que llame a la factoría sin iniciativa y espere el rechazo.

**Criterio de cierre.** Es imposible construir un `Project` válido sin
iniciativa desde ninguna capa; `orphan-attention` sólo puede provenir de datos
heredados, nunca de una escritura nueva.

---

### 4. Un repositorio-dios para cinco contextos, y cuatro estrategias de persistencia incompatibles — P1

**Evidencia.** `services/firestoreService.ts` tiene **1.379 líneas y 27 métodos
públicos** que atienden a cinco contextos distintos:

| Contexto | Métodos que viven en `firestoreService` |
|---|---|
| Proyectos | `getAllProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject` |
| Artefactos | `createArtifact`, `updateArtifact`, `deleteArtifact`, `updateProjectArtifacts`, `batchUpdateArtifacts`, `restoreArtifactVersion` |
| Ajustes y chat | `getGlobalSettings`, `saveGlobalSettings`, `saveChatHistory`, `getChatHistory` |
| Oficina de Arquitectura | `saveEngagement`, `listEngagements`, `deleteEngagement`, `recordArbDecision` |
| Iniciativas de negocio | `saveBusinessInitiative`, `listBusinessInitiatives`, `deleteBusinessInitiative` |

Los dos módulos que **sí** tienen repositorio —
`architectureOffice/OfficeEngagementRepository.ts` y
`businessInitiatives/BusinessInitiativeRepository.ts` — delegan en él. Es decir:
el código que persiste el agregado de un contexto vive físicamente en el archivo
de otro. Cambiar la forma de un `OfficeEngagement` obliga a editar un archivo
compartido por cinco contextos, con las reglas de Firestore, la caché y la
degradación de todos ellos alrededor.

**Y hay cuatro estrategias, no una.** `CLAUDE.md` afirma que todo el acceso a
Firestore pasa por `firestoreService`, `trainingService` y `userService`. En
realidad:

| Vía | Envoltura `PersistenceResult` | Consecuencia |
|---|---|---|
| `firestoreService` (21 usos) | sí | fallo visible en el banner |
| `userService` (5 usos) | sí | fallo visible |
| `trainingService` | **no** | fallo invisible |
| `review/firestoreArtifactReviewRepository` | **no** | fallo invisible |

Las dos últimas importan el SDK de Firestore directamente. Y `trainingService`
tiene, en cada uno de sus once métodos, esta forma:

```ts
} catch (error) {
    console.warn("TrainingService: Error saving course, falling back to local storage", error);
```

**Esto es un defecto real, no sólo estructural**: una escritura del Centro de
Formación que Firestore rechace (permisos, cuota, offline) cae a `localStorage`
con un `console.warn`, `persistenceStatus` no se entera y `PersistenceStatusBanner`
no muestra nada. Un formador que crea un curso ve la operación como exitosa
mientras el curso sólo existe en su navegador. Lo mismo aplica a los comentarios
y decisiones de revisión.

**Acción.**
1. Extraer de `firestoreService` un `services/persistence/FirestoreGateway.ts`
   con lo genuinamente transversal: `PersistenceResult`, caché, degradación a
   local, guardas de tamaño, clasificación de errores.
2. Cada contexto se lleva su repositorio sobre esa puerta:
   `architectureProjects/`, `artifacts/`, `architectureOffice/`,
   `businessInitiatives/`, `training/`, `review/`. `firestoreService` queda como
   fachada de compatibilidad y adelgaza hasta desaparecer.
3. **Migrar `trainingService` a `PersistenceResult` antes que nada** — eso es
   una corrección de defecto, no una refactorización, y puede ir sola.
   *(Hecho en la Ola 1.)* El repositorio de revisión no entra aquí: ya reporta
   sus fallos por su propio camino, y llevarlo a `PersistenceResult` es
   unificación, no corrección.
4. Una regla de lint que prohíba importar `firebase/firestore` fuera de
   `services/persistence/**` y de los repositorios declarados, igual que ya se
   hace con `@google/genai`.

**Criterio de cierre.** Ninguna escritura del producto puede fallar sin que
`persistenceStatus` lo refleje; ningún contexto edita el archivo de otro para
cambiar su propio esquema.

---

### 5. La puerta local no es la puerta de CI, y el E2E no prueba lo que se despliega — P1

**Evidencia.** `npm run quality` ejecuta: `typecheck`, `typecheck:strict`,
`lint`, `check:any-budget`, `check:no-orphan-scripts`, `check:module-size`,
`test:ci`. El job de CI ejecuta **todo eso menos `test:ci`**, y en su lugar
`test:coverage` (con umbrales), más `build`, `check:bundle-secrets` y
`check:bundle-budget`. Es decir: **`npm run quality` en verde no predice CI en
verde.** Un descenso de cobertura, una clave filtrada al bundle o un exceso de
presupuesto sólo aparecen tras 11 minutos de espera.

Segundo: `playwright.config.ts` levanta el servidor con `command: 'npm run dev'`.
El E2E valida la transformación de desarrollo de Vite, no el `dist/` que el
mismo pipeline acaba de construir y que es lo que Vercel despliega. Las
diferencias entre ambos —chunking manual, `lazyWithRetry`, minificación,
`import.meta.env` resuelto— son exactamente la clase de cosas que el E2E
existiría para detectar. El propio `CLAUDE.md` documenta que el retry de carga
de chunks nació de un fallo real en iPad/Safari **después de un despliegue**:
ese fallo es invisible en modo dev.

Tercero, coste repetido: tres workflows (`CI`, `E2E`, `Security`) hacen cada uno
`checkout` + `setup-node` + `npm ci` en cada PR — cuatro instalaciones contando
los dos jobs de `CI`. El job `codeql` ni siquiera necesita las dependencias de
Node para su análisis.

**Acción.**
1. Alinear `npm run quality` con la composición exacta del job de CI (que use
   `test:coverage`, `build`, `check:bundle-secrets`, `check:bundle-budget`), y
   dejar un `npm run quality:fast` sin build ni cobertura para el bucle de
   desarrollo. La puerta que uno corre localmente debe ser la que decide.
2. Construir una vez: el job `quality` sube `dist/` como artefacto y el job de
   E2E lo descarga y sirve con `vite preview`
   (`PLAYWRIGHT_BASE_URL` + `PLAYWRIGHT_REUSE_SERVER`, que la config ya soporta).
   Se gana un build y se gana la prueba correcta.
3. Unificar los tres workflows en uno con jobs dependientes, o compartir la
   preparación con un composite action, para dejar de pagar `npm ci` cuatro
   veces.

**Criterio de cierre.** `npm run quality` verde ⇒ CI verde; el E2E corre contra
el mismo `dist/` que se despliega.

---

### 6. `types.ts`: un núcleo compartido de 76 tipos, con 64 líneas muertas y divergentes — P1

**Evidencia.** `types.ts` tiene **1.268 líneas, 76 exportaciones y 244 archivos
que lo importan**. No es un núcleo compartido: es el modelo completo de siete
contextos en un archivo — `Settings`, `Artifact` y su ciclo de vida,
`DiagramIR` (300 líneas), el modelo de presentación, `Project`, `ChatMessage`,
`MemoryEntry` y el Centro de Formación. Cualquier cambio en cualquiera de ellos
recompila los 244.

Y contiene código muerto que además **contradice** al código vivo. Las líneas
**1205–1268** declaran `CourseCategory`, `ArchitectRole`, `CourseLevel`,
`LessonTabContent`, `Lesson`, `Module`, `Course`, `SmartNote` y
`ArchitectureConsultingResponse`. Los mismos nombres existen en `types/lms.ts`,
que es el que usan los 21 archivos del LMS — y **no coinciden**:

```ts
// types.ts:1208        (0 importadores)
export type ArchitectRole = 'Empresarial' | 'Soluciones' | 'Aplicaciones' | 'Datos' | 'Infraestructura';

// types/lms.ts:3       (el que se usa)
export type ArchitectRole = 'Arquitecto Empresarial' | 'Arquitecto de Soluciones' | ...
```

Verificado resolviendo cada `import` del árbol: **cero archivos importan esos
tipos desde `types.ts`**. Son 64 líneas que sólo pueden hacer daño — quien las
encuentre primero obtendrá la definición equivocada, y el compilador no dirá
nada porque ambas compilan.

**Acción.**
1. Borrar las líneas 1205–1268 de `types.ts` y bajar su techo en
   `checkModuleSize.mjs` de 1.275 a ~1.210. Es un cambio de diez minutos y sin
   riesgo: nadie las importa.
2. Repartir el resto por contexto, empezando por el bloque más grande y más
   autocontenido: `DiagramIR` y sus 12 tipos satélite pertenecen a
   `services/diagram/`. Después `Project` (hallazgo 3) y el modelo de
   presentación.
3. Dejar en `types.ts` sólo lo que de verdad cruza contextos, y renombrarlo a
   `sharedKernel.ts` para que el nombre diga lo que es.

**Criterio de cierre.** `types.ts` baja de 400 líneas; cambiar el IR de un
diagrama no recompila el LMS.

---

### 7. La capa de aplicación es la UI — P1

**Evidencia.** **92 de los 183 archivos de `components/` y `pages/` importan
servicios directamente.** No existe una capa de casos de uso entre la UI y el
dominio: es la UI la que orquesta.

`components/ArtifactCanvas.tsx` alcanza ocho módulos de servicio (`ai`,
`artifactCompiler`, `artifactValidationService`, `artifacts`, `diagram`,
`diagramQualityService`, `observabilityService`, `quality`).
`pages/ProjectsPage.tsx` alcanza cuatro (`ai`, `architectureOffice`,
`guidedProjectCreationService`, `portfolioGraph`) — y es, como vimos en el
hallazgo 3, donde vive de facto el caso de uso «crear un proyecto de
arquitectura».

`context/AppContext.tsx` es el mismo problema en el estado: **34 miembros
públicos** que cubren proyectos, artefactos, versiones, ajustes, i18n, historial
de chat, acciones del agente, grafo de arquitectura, paquetes de publicación y
estado de persistencia, consumidos por **39 archivos**. El valor está
memoizado, pero con 34 dependencias: cualquier cambio en `projects` invalida el
objeto para los 39 consumidores, incluidos los que sólo leen `settings`.

Un detalle revelador: `AppContext` lleva dentro un diccionario de traducciones
de **18,5 KB** escrito en unas quince líneas de 300+ caracteres. El presupuesto
`check:module-size` cuenta líneas, así que no lo ve. La guarda funciona; el
archivo la esquiva por accidente de formato.

**Acción.**
1. Un servicio de aplicación por contexto (`services/<contexto>/application/`)
   que exponga casos de uso con nombres del dominio: `crearProyectoDeArquitectura`,
   `abrirSolicitudDeEntregable`, `publicarArtefacto`. La UI llama al caso de uso;
   deja de componer servicios.
2. Partir `AppContext` siguiendo los contextos ya existentes:
   `ProjectsContext`, `ArtifactsContext`, `SettingsContext`. Cada uno con su
   propio ciclo de invalidación.
3. Sacar el diccionario i18n a `lib/i18n/` — es contenido, no estado.
4. Extender `check:module-size` para que además del recuento de líneas mida
   **bytes**, y así una línea de 300 caracteres cuente lo que pesa.

**Criterio de cierre.** Ningún componente importa más de dos módulos de
servicio; `AppContext` baja de 300 líneas.

---

### 8. Cuatro modelos de «calidad» compitiendo, dos con el mismo nombre de archivo — P2

**Evidencia.** El lenguaje ubicuo se rompe en la palabra más usada del producto.
Existen simultáneamente:

| Archivo | Función pública | Consumidores |
|---|---|---|
| `services/documentQualityService.ts` (245 líneas) | `assessDocumentArtifact` | `agent/agentExecutor` |
| `services/quality/documentQualityService.ts` | `analyzeDocumentQuality` | las puertas de calidad |
| `services/diagramQualityService.ts` (569 líneas, en la raíz) | evaluación de diagramas | 6 archivos de UI + 3 de `services/diagram` |
| `services/artifactCompiler/scoring/unifiedScore.ts` | puntuación «unificada» | el compilador |

Los dos primeros **tienen el mismo nombre de archivo**, viven a un directorio de
distancia, modelan el mismo concepto («la calidad de un documento») con escalas
y tipos de incidencia distintos, y ninguno conoce al otro. Un desarrollador que
abra «el servicio de calidad de documentos» tiene un 50 % de probabilidad de
abrir el que no es. La puntuación llamada «unificada» es, en realidad, la cuarta.

Añádase que `services/diagramQualityService.ts` sigue en la raíz de `services/`
y es consumido directamente por seis archivos de UI, cuando existe
`services/quality/diagramQualityBridge.ts` precisamente para mediar.

**Acción.**
1. Declarar `services/quality/` como el contexto dueño de la palabra «calidad»:
   una escala, un tipo de incidencia, un reporte.
2. Fusionar los dos `documentQualityService`: `assessDocumentArtifact` (usada por
   el agente para decidir un reintento correctivo) y `analyzeDocumentQuality`
   (usada por las puertas) son dos **preguntas** sobre un mismo modelo, no dos
   modelos.
3. Mover `diagramQualityService.ts` dentro de `services/quality/` o de
   `services/diagram/quality/`, y hacer que la UI entre por el puente.
4. Renombrar `unifiedScore` a lo que realmente calcula, o convertirlo en la
   única puntuación de verdad.

**Criterio de cierre.** Una sola definición de «calidad de un documento» en el
árbol; ningún archivo de UI importa un servicio de calidad desde la raíz de
`services/`.

---

### 9. `strict` cubre 11 de 603 archivos, y `typecheck:strict` tarda 1 segundo — P2

**Evidencia.** `tsconfig.strict.json` incluye nueve entradas que resuelven a
**11 archivos**: `lib/authz/**`, `lib/richText/**`, `lib/errorMessage.ts`,
`lib/ids.ts`, `lib/security.ts`, `lib/speechRecognition.ts`, `lib/traceId.ts` y
`services/ai/aiProxyPolicy.ts`. Es el **1,8 %** de los 603 archivos productivos.
Para el 98,2 % restante `strictNullChecks` sigue apagado, que es la diferencia
entre que el compilador encuentre un `undefined` y que lo encuentre un usuario.

El mecanismo es correcto —una frontera que sólo crece, con
`__tests__/lib/strictBoundary.test.ts` impidiendo retrocesos— pero lleva
estancado desde su creación. Y el dato que lo demuestra está en el propio
pipeline: **`typecheck:strict` tarda 1 segundo localmente y 2 en CI.** La puerta
más barata de todo el sistema es también la más vacía. Ampliarla no cuesta
tiempo de CI: cuesta trabajo de tipado, una sola vez por módulo.

**Acción.**
1. Fijar una cuota explícita: **un módulo por iteración**, y registrarla en este
   documento junto al recuento de archivos cubiertos.
2. Empezar por los módulos que deciden reglas de negocio y hoy están fuera:
   `services/portfolioGraph/` (4 archivos), `services/businessInitiatives/` (4),
   `services/review/` (6), `services/quality/` (10). Son 24 archivos y cubren la
   resolución de relaciones del portafolio y la revisión de artefactos.
3. Todo módulo **nuevo** (los del hallazgo 3 y 4) nace dentro de la frontera. Es
   gratis al escribirlo y caro al añadirlo después.
4. El presupuesto de `any` (38 tokens) puede bajar en el mismo movimiento: 10 de
   los 38 están en `pages/LMS/LMSCatalog.tsx` y `pages/LMS/LessonModal.tsx`.

**Criterio de cierre.** La frontera cubre al menos el 25 % de los archivos
productivos y el 100 % de los módulos creados después de esta revisión.

---

### 10. La capa canónica de IA filtra el motor legado por su propia API pública — P2

**Evidencia.** `services/ai/` existe para que el resto del producto no conozca al
proveedor, y una regla de ESLint impide importar `services/geminiService` desde
fuera. Pero el barril `services/ai/index.ts` hace esto:

```ts
export type { AiErrorSource, GeminiErrorCategory } from '../geminiService';
export type { ArtifactSuggestion } from '../geminiService';
```

Un tipo llamado `GeminiErrorCategory` está en el contrato público de la capa
agnóstica del proveedor. La regla de lint se cumple al pie de la letra y se
incumple en su intención: quien importa desde `services/ai` recibe igualmente
tipos con la forma del motor, y el día que OpenRouter sea el proveedor por
defecto ese nombre será una mentira en la firma de cada función que lo use.

En la dirección contraria, `pages/SettingsPage.tsx:7` importa
`services/ai/providers/openrouter/openRouterModels` — una pantalla entrando al
adaptador de un proveedor concreto, justo lo que el barril existe para evitar.

Y el motor sigue ahí: `services/geminiService.ts` tiene **6.319 líneas** con un
techo de 6.325 en `checkModuleSize.mjs`. **Seis líneas de margen.** El presupuesto
impide que crezca, que era su propósito, pero no hay nada que lo haga encoger.

**Acción.**
1. Definir `AIErrorCategory` y `AIErrorSource` en `services/ai/core` en términos
   neutros; el clasificador de Gemini mapea los suyos a esos. `ArtifactSuggestion`
   pertenece al dominio de artefactos, no al motor.
2. Prohibir en ESLint que `services/ai/index.ts` reexporte desde `../geminiService`
   — la misma regla `no-restricted-imports`, ahora también en el barril.
3. Añadir una fachada `listModelsForProvider(provider)` en `services/ai` y hacer
   que `SettingsPage` la use.
4. Continuar la migración por verticales, como se hizo con el LMS (que salió del
   monolito con un test que lo mantiene fuera): la siguiente vertical natural es
   la generación de artefactos, y cada extracción **baja** el techo del monolito
   en el mismo commit.

**Criterio de cierre.** Ningún nombre con «Gemini» en la API pública de
`services/ai`; ningún archivo de UI importa un adaptador de proveedor.

---

## 3 bis. Estado de ejecución — Ola 1 (completada el 1 sep 2026)

La Ola 1 está implementada y verificada. Lo que sigue es lo que se hizo, lo que
midió y lo que deliberadamente **no** se hizo.

### Lo entregado

| Punto | Cambio | Verificación |
|---|---|---|
| **2.1 · Entorno por archivo** | `vite.config.ts` define dos proyectos de Vitest: `dom` (jsdom + Testing Library, para `*.test.tsx`) y `node` (sin setup, para `*.test.ts`). 26 archivos `.test.ts` que sí necesitan un DOM lo declaran con `// @vitest-environment jsdom` en su propia cabecera. | Las 3.397 pruebas de la línea base pasan, **archivo por archivo idénticas** (comparación de conteos con el informe JSON antes y después: 0 archivos distintos, 0 pruebas perdidas). |
| **2.2 · Setup por entorno** | `vitest.setup.ts` → `vitest.setup.dom.ts`. El nuevo `vitest.setup.node.ts` carga los matchers de jest-dom **sólo si existe un `document`**, lo que cubre a los 26 archivos que optan por jsdom sin que los ~280 restantes carguen React. | `setup` acumulado: **58,1 s → 16,6 s**. |
| **2.3 · Sharding en CI** | `ci.yml` pasa de un job a cuatro: `quality` (estáticas + build), `tests` (matriz de 4 shards con `--reporter=blob`), `coverage` (fusión y umbrales) y `rules`. | Flujo completo probado localmente con 2 shards: la fusión reconstruye las 3.397 pruebas y la cobertura fusionada (62,95 / 54,70 / 55,12 / 64,73) coincide con la del run único (62,99 / 54,72 / 55,17 / 64,78). |
| **2.4 · Umbrales sobre el total** | `VITEST_SKIP_THRESHOLDS=1` desactiva los umbrales dentro de cada shard; el job `coverage` los exige sobre el informe fusionado. | Un shard aislado fallaba los umbrales por denominador parcial, como estaba previsto; la fusión pasa. |
| **6.1 · Bloque LMS muerto** | Borradas las 64 líneas de `types.ts` (1205–1268) y bajado su techo de 1.275 a 1.215. En su lugar queda una nota que explica por qué no debe volver. | `typecheck` limpio; 0 importadores, verificado resolviendo todos los `import` del árbol. |
| **4.3 · `trainingService`** | Sus siete escrituras devuelven `PersistenceResult` vía `executeRemoteWrite`. La copia local se sigue guardando —perder el trabajo sería peor— pero el resultado dice `target: 'local-draft'` y conserva el `status` remoto. | 10 pruebas nuevas en `__tests__/services/trainingPersistence.test.ts`. |
| **4.3 · Que el fallo llegue** | `LMSContext` enruta sus 16 escrituras por `useTrainingSync().trackWrite`, y `TrainingCenterPage` renderiza `syncError` con un banner equivalente al `PersistenceStatusBanner` del resto de la app. | 4 pruebas nuevas en `__tests__/context/lmsSyncError.test.tsx`. |

### Lo medido

Puerta de calidad completa, misma máquina (4 vCPU), antes y después:

| Métrica | Antes | Después |
|---|---:|---:|
| `npm run test:coverage` | 166 s | **118 s** (−29 %) |
| Vitest · `environment` (acumulado) | 212,9 s | **65,7 s** (−69 %) |
| Vitest · `setup` (acumulado) | 58,1 s | **16,6 s** (−71 %) |
| Pruebas ejecutadas | 3.397 | **3.411** (+14, ninguna perdida) |
| Cobertura de sentencias | 62,99 % | **63,39 %** |
| `types.ts` | 1.268 líneas | **1.211** |
| `context/LMSContext.tsx` | 537 líneas | **523** (techo bajado de 543 a 530) |

El resto de la puerta sin cambios y en verde: `typecheck`, `typecheck:strict`,
`lint` (0 errores, 0 avisos), los tres presupuestos, `build`,
`check:bundle-secrets` y `check:bundle-budget` (658,2 KB gz de 675,0 de
presupuesto). `npm run test:rules` se ejecutó contra el emulador real: **59
pruebas, en verde**, y ahora en entorno `node` tarda 15,7 s con `environment 0ms`.

La proyección sobre CI —de 8 m 49 s a 2–3 minutos— sólo puede confirmarse con
una ejecución real del workflow; los dos factores que la sostienen sí están
medidos por separado.

### Lo que no se hizo, y por qué

**El repositorio de revisión no se migró.** Al ir a implementarlo, la
verificación desmintió el hallazgo: `hybridArtifactReviewRepository` ya lleva su
propio `ReviewSyncState`, marca `sync-error` con el último error, y
`ReviewSyncBadge` —montado en `ReviewPanel` y `CommentThread`— lo muestra en
rojo. No es una vía de fallo silencioso; es un diseño *offline-first* que
funciona. Forzarle `PersistenceResult` habría sido reescribir código correcto
para cumplir una viñeta. Queda como lo que realmente es —un cuarto mecanismo
para una misma preocupación— y se unifica en la Ola 3, junto con los demás
repositorios. La corrección está anotada en el hallazgo 4.

**El techo de `LMSContext` no se subió.** El presupuesto de tamaño rechazó el
provider en 551 líneas. La respuesta fue la que pide el propio gate: extraer
`useTrainingSync` a `hooks/`, con lo que el archivo quedó en 523 —menos que
antes de empezar— y su techo bajó a 530.

---

## 3 ter. Estado de ejecución — Ola 2 (completada el 1 sep 2026)

La Ola 2 ataca las fronteras: declararlas, defenderlas y romper los ciclos que
las volvían ficción.

### Lo entregado

| Punto | Cambio | Verificación |
|---|---|---|
| **1.1 · Manifiesto** | `modules.json` declara 23 módulos con su carpeta, su capa (`ui` / `domain` / `foundation`) y su API pública. | El gate lo lee; `__tests__/scripts/moduleBoundaries.test.ts` comprueba que la resolución de fichero a módulo es correcta (el catch-all de `services/` pierde contra un módulo real). |
| **1.2 · Gate** | `scripts/checkModuleBoundaries.mjs` con tres reglas —capas, ciclos y API pública—, cada una con presupuesto monotónico. Añadido a `npm run quality` y al job `quality` de CI. `--report` imprime el censo en la forma en que el script lo registra. | 15 pruebas. El gate rechazó mi propio cambio dos veces durante esta ola (una importación profunda nueva y un techo de tamaño superado), que es exactamente para lo que existe. |
| **1.3 · Ciclos de dominio** | Los cuatro rotos: `export ↔ quality`, `artifacts ↔ export`, `agent ↔ architectureOffice`, `ai ↔ diagram`. | Asertados por nombre, incluyendo que no se puedan volver a añadir a `ALLOWED_CYCLES` en silencio. |
| **1.3 · La capa `lib`** | De siete archivos que importaban de `services/`, quedan tres. Movidos: `semanticRoleResolver` y `semanticLayoutPolicy` bajan a `lib` (son puros y la familia de diagramas ya vivía ahí); `runtimeValidation` sube a `services` (un validador que sabe qué es un paquete de publicación es un servicio); `lazyWithRetry` va a `components/routing/` (importa React, y `lib` está documentada como sin React). | `lib → services` pasa de 6 pares a 2. |
| **1.4 · Barriles** | `services/chat`, `services/export`, `services/memory` y `services/presentation` tienen `index.ts`. | El gate falla si un módulo declara una API que no existe. |
| **5.1 · La puerta** | `npm run quality` compone ahora exactamente lo que compone el job de CI: estáticas + cobertura con umbrales + build + las dos comprobaciones de bundle. `quality:fast` y `quality:static` quedan para el bucle de desarrollo. | Verde de punta a punta. |
| **5.2 · El E2E** | `playwright.config.ts` levanta `vite preview` sobre `dist/` en vez de `npm run dev`; el workflow construye antes de correrlo. `PLAYWRIGHT_DEV_SERVER=1` conserva el comportamiento anterior. | Comprobado que `preview` sirve el bundle con hash (`/assets/index-*.js`, no `/index.tsx`) y que la reescritura SPA responde 200 en `/office`. |

### Lo medido

| Métrica de frontera | Antes | Después |
|---|---:|---:|
| Ciclos entre módulos | 24 | **17** |
| Ciclos entre contextos de dominio | 4 | **0** |
| Pares que importan hacia arriba por las capas | 7 | **3** |
| Pares con importación profunda | 65 | **56** |
| Módulos sin API pública | 4 | **0** |

Los 17 ciclos restantes son de dos clases, ninguna corregible en esta ola: once
involucran los **19 archivos sueltos en la raíz de `services/`**, que no
pertenecen a ningún módulo —su reubicación es la Ola 3—, y tres son pares de la
UI (`components ↔ context`, `components ↔ hooks`, `context ↔ hooks`), que es la
forma ordinaria de React y no un defecto de modularidad.

### Cómo se rompió cada ciclo

Dos patrones, y son los que conviene repetir:

- **Un contrato sin comportamiento baja a una hoja.** `ExportFormat`,
  `ArtifactView`, `ArtifactPresentationModel`, `ArtifactKind`, el parser de
  tablas Markdown y el vocabulario de sugerencias eran declaraciones puras
  dentro de un contexto que otros tres necesitaban. Ahora viven en
  `lib/artifacts/` y `lib/markdownTables.ts`.
- **Una dependencia que debe ir en un solo sentido se convierte en un puerto.**
  `services/agent` ya no sabe que existe una Oficina de Arquitectura: declara
  `AgentPersonaBriefing` —lo que necesita de una persona especialista— y
  `buildOfficePersonaBriefing`, en `services/architectureOffice`, lo suministra.
  La oficina conduce al agente; el agente no busca a la oficina.

### Un hallazgo del propio trabajo: el barril contra el bundle

Al enrutar `services/runtimeValidation.ts` por los barriles de
`publicationPipeline` y `architectureOffice` —lo correcto desde la frontera—,
`check:bundle-budget` falló: la carga eager pasó de **658 KB gz a 1.126 KB**,
porque `firestoreService` importa ese archivo de forma temprana y entrar por un
`index.ts` arrastra el módulo entero al chunk de entrada.

Es una tensión real y conviene tenerla escrita: **un barril es bueno para la
frontera y malo para el árbol de dependencias cuando el módulo es grande.** La
resolución fue nombrar el archivo en esos tres imports y registrarlos como lo
que son. No es inflar el presupuesto: los mismos tres imports ya existían antes,
contados como `lib → …`; al mover el archivo cambiaron de origen, no de número.
La frontera que importaba —que la capa `foundation` no dependa del dominio— sí
quedó corregida. Una frontera es una propiedad interna; la ruta crítica la paga
el usuario.

### Lo que no se hizo, y por qué

**Los tres workflows siguen sin unificarse.** El punto 5.3 proponía fusionarlos
para dejar de pagar `npm ci` cuatro veces. No se hizo porque mover el job de
Playwright dentro de `ci.yml` **renombra el check obligatorio**
(`E2E (Playwright) / Playwright smoke`), y si la rama `main` lo tiene como
requisito en su protección, los PR dejan de poder fusionarse hasta que alguien
con permisos de administrador actualice esa configuración. El ahorro real es
pequeño —con la caché de `setup-node`, cada `npm ci` cuesta unos 15 s y los jobs
corren en paralelo, así que no está en el tiempo de espera— y el riesgo es
externo al repositorio. Queda propuesto, no ejecutado.

**Tres archivos de `lib` siguen importando de `services`.**
`lib/artifacts/contracts.ts` y `lib/validation/artifactValidation.ts` dependen de
`services/artifactGenerationPipeline` y `services/artifactValidationService`,
que son dos de los 19 archivos sueltos de la raíz. Están bloqueados por la misma
causa que los once ciclos restantes y se resuelven con ellos en la Ola 3.
Intenté además apuntar `contracts.ts` a la hoja nueva y lo revertí: arrastraba
`ExportTrace` → `ArtifactValidationResult` → `ArtifactClassification`, una
cadena que no se puede cortar sin mover primero esa raíz.

---

## 3 quater. Estado de ejecución — Ola 3 (completada el 2 sep 2026)

La Ola 3 es la del dominio: darle módulo al agregado que no lo tenía, poner el
invariante donde puede sostenerse, y sacar de `types.ts` el modelo de cada
contexto.

### Lo entregado

| Punto | Cambio | Verificación |
|---|---|---|
| **3.1 · El módulo** | `services/architectureProjects/` con el tipo `Project` migrado desde `types.ts`, la factoría y el repositorio. El nivel intermedio de la jerarquía deja de ser el único sin contexto delimitado. | El gate de fronteras lo reconoce como módulo con API pública. |
| **3.2 · El invariante** | `createArchitectureProject` es el único constructor y **rechaza** una atención sin iniciativa con un rechazo tipado (`initiative-required`). `initiativeIds` es obligatorio y no admite `?? []`. | 12 pruebas, tres de ellas leyendo el código fuente para asegurar que no reaparece un segundo sitio de construcción. |
| **3.3 · La envoltura** | `AppContext.addProject` devuelve el veredicto de la factoría, no un `Project`. El compilador obligó a los dos llamantes a atender el rechazo. | `typecheck` falló hasta que ambos lo trataron: ésa es la prueba. |
| **3.4 · La UI** | `hooks/useCreateAttention.ts` — un embudo para cualquier superficie de creación, presente y futura. `AttentionInitiativeGate` sigue: pedir la iniciativa antes es mejor UX que rechazar después. | — |
| **4.1 · La puerta** | `services/persistence/` con `PersistenceResult`, la clasificación de errores, `createFailureResult` y `writeLocalDraft` — la única forma correcta de degradar, que devuelve `success: false` porque un borrador local no es un documento guardado. | 8 pruebas nuevas. Eran dos métodos privados de `firestoreService`, fuera del alcance de cualquier repositorio. |
| **4.2 · Repositorios** | `architectureProjects`, `artifacts`, `chat` y `agent` tienen el suyo, junto a los de `architectureOffice` y `businessInitiatives` que ya existían. `AppContext` pasó de 18 llamadas directas a `firestoreService` a 3 (ajustes, que no pertenecen a ningún contexto). | — |
| **4.4 · La regla de lint** | `firebase/firestore` y `firebase/auth` sólo en `services/persistence/**`, los cuatro servicios declarados, el repositorio de revisión, `authService` y `firebase.ts`. | ESLint la aplicó en la primera pasada: `authService` no estaba en la lista y falló. |
| **6.2 · `types.ts`** | De **1.268 a 533 líneas**. `DiagramIR` y su vocabulario (400 líneas) a `lib/diagram/`; el modelo de presentación a `services/presentation/`; el de revisión a `services/review/`; el chat a `services/chat/`; el agregado `Project` a su módulo. 168 archivos repuntados a los módulos. | `typecheck` y 3.446 pruebas. |

### Lo medido

| Métrica | Antes de la Ola 3 | Después |
|---|---:|---:|
| `types.ts` | 1.088 líneas | **533** |
| `types.ts` frente al original | 1.268 | **533** (−58 %) |
| Ciclos entre módulos | 17 | **14** |
| Módulos de dominio declarados | 19 | **22** |
| Llamadas directas a `firestoreService` desde `AppContext` | 18 | **3** |
| Pruebas | 3.411 | **3.446** |

`npm run quality` completo en verde, incluidos los cinco presupuestos, la
cobertura sobre todos los umbrales y el bundle eager en 659,3 KB gz de 675,0.

### Dónde se colocó cada modelo, y por qué

La regla que ordenó las decisiones: **si la capa `foundation` lo necesita, es
núcleo compartido; si sólo lo necesita un contexto, es de ese contexto.**

- `DiagramIR` fue a `lib/diagram/` y no a `services/diagram/`, porque
  `lib/diagramTokens.ts`, `lib/layoutEngine.ts` y `lib/semanticRoleResolver.ts`
  operan sobre él y `foundation` no puede importar `domain`.
- `ChatMessage` fue a `services/chat/` y arrastró consigo a
  `utils/chatHistory.ts`: ese archivo agrupaba sesiones de chat desde la capa
  hoja, y cuando el modelo se movió, el gate lo señaló. Un agrupador de
  sesiones es dominio de chat viva donde viva la carpeta.
- La traza de generación de artefactos **se queda** en el núcleo compartido:
  `lib/artifacts/contracts.ts` y `utils/artifactExploration.ts` la leen, y
  moverla a `services/artifacts` reintroduciría las violaciones de capa que la
  Ola 2 acaba de quitar.

### El barril contra el bundle, otra vez

Ocurrió de nuevo y merece quedar escrito como patrón, no como anécdota. Al
hacer que `AppContext` entrara por los barriles de `agent`, `artifacts`, `chat`
y `architectureProjects`, la carga eager pasó de **659 KB gz a 1.125 KB**:
`AppContext` está en el árbol de proveedores temprano y un `index.ts` arrastra
el módulo entero. Los cuatro imports nombran el archivo y están registrados.

**La regla, ya con dos casos:** un barril es la puerta correcta desde código
perezoso; desde código del arranque, nombra el archivo. `check:bundle-budget`
es lo que distingue un caso del otro, y por eso conviene que siga estando en la
misma puerta que el gate de fronteras.

### Lo que no se hizo

**`types.ts` no bajó de 400 líneas**, que era el criterio que yo mismo escribí.
Quedó en 533, de las cuales unas 30 son el docblock que explica qué es el
archivo ahora. El bloque siguiente en tamaño —la traza de generación— no puede
moverse sin romper las capas, por la razón de arriba. Bajar de 400 exige
resolver antes `utils/artifactExploration.ts` y `lib/artifacts/contracts.ts`,
que dependen de los archivos sueltos de la raíz de `services/`.

**`types.ts` no se renombró a `sharedKernel.ts`.** Tocaría 244 archivos para
cambiar un nombre sin cambiar comportamiento; en su lugar el archivo abre con
un docblock que dice exactamente qué es y qué no debe volver a entrar.

**Quedan 14 ciclos y 22 archivos sueltos en la raíz de `services/`.** Salieron
`persistence` y `observability` como módulos —y con ellos tres ciclos—, aunque
la cuenta bruta subió porque `runtimeValidation` llegó desde `lib` y los
repositorios nuevos aún delegan en `firestoreService`. El resto —`geminiService`,
`firestoreService`, `artifactGenerationPipeline` y compañía— son los módulos
grandes que la migración por verticales sigue llevándose.

---

## 3 quinquies. Estado de ejecución — Ola 4 (completada el 2 sep 2026)

La Ola 4 cierra los cuatro hallazgos que quedaban: la API pública de la capa de
IA (10), un solo modelo de calidad (8), la frontera `strict` (9) y la capa de
aplicación que era la UI (7).

### Lo entregado

| Punto | Cambio | Verificación |
|---|---|---|
| **10.1 · La taxonomía** | `AIErrorSource` es neutral y vive en `services/ai/core`. `geminiService` la reexporta desde ahí en vez de declararla: el motor deja de ser la fuente del vocabulario de errores. | `typecheck` + las pruebas de clasificación. |
| **10.2 · Los adaptadores** | `services/ai/index.ts` deja de exportar `GeminiProvider`/`OpenRouterProvider`: quien necesita un proveedor lo pide a `AIProviderFactory`. | Ningún nombre de proveedor concreto en la API pública. |
| **10.3 · El catálogo** | `listModelsForProvider` — `pages/SettingsPage.tsx` importaba `providers/openrouter/openRouterModels` directamente. Una pantalla dentro del adaptador de un proveedor es exactamente el acoplamiento que la capa existe para impedir; ESLint ahora lo prohíbe (`services/ai/providers/**` restringido en la UI). | Regla de lint + la pantalla pasando por la fachada. |
| **8.1 · Un dueño por modelo** | `documentQualityService` → `services/quality/documentAcceptability.ts`; `diagramQualityService` → `services/diagram/quality/`. Dos archivos con el mismo nombre en dos módulos dejaron de existir. | El gate de fronteras: mover la calidad de diagramas a `services/quality` **creó** el ciclo `diagram ↔ quality` (14 → 15) y el gate lo rechazó. Ésa fue la señal de dónde iba. |
| **9.1 · La frontera `strict`** | De 11 a **18 entradas**: `lib/diagram`, `services/observability`, `services/memory`, `chatHistory`, el modelo de iniciativas y sus métricas, las reglas de revisión y la factoría de `architectureProjects`. Tres errores reales corregidos en el camino (`visualHierarchyPolicy`, `exportTypes`, y `types/dagre.d.ts` para una dependencia sin tipos). | `npm run typecheck:strict` limpio. |
| **9.2 · El presupuesto de `any`** | De **38 a 23**. Los tres generadores del LMS devolvían `Promise<any>` teniendo la forma impresa en su propio prompt: ahora hay `GeneratedCourse`/`GeneratedTopic`, dos coerciones y dos guardas en `services/ai/generation/learning/learningTypes.ts`. | Tiparlos destapó **dos defectos vivos**: `LMSAILab` escribía el texto libre del modelo directamente en `CourseCategory` y `CourseLevel`. |
| **7.1 · El i18n** | El diccionario `en`/`es` (20 KB, más de la mitad del archivo por peso) sale a `lib/i18n/`, junto con `translate`, que estaba en `utils.ts` bajo un comentario que decía «(from AppContext)» y tenía un solo llamante. | Prueba nueva de paridad: ambos idiomas, 168 claves, mismos marcadores de sustitución. Una clave que falte en `es` no rompe nada — se renderiza la clave, en medio de un toast. |
| **7.2 · `AppContext`** | De **917 a 147 líneas**: composición de siete hooks en `context/app/`. La superficie sigue siendo **un** contexto a propósito; lo que se partió es el *provider*, que a un consumidor no le cuesta nada. | 4 pruebas de forma: sin `useState`, sin `useEffect`, sin `useCallback`, sin importar `services/`, y un solo dueño del array `projects`. |
| **7.3 · La regla que faltaba** | Cuarta regla en el gate de fronteras: **una pantalla no importa más de dos módulos de servicio**. | 12 pantallas por encima del umbral, cada una con su número registrado. |

### Lo medido

| Métrica | Antes de la Ola 4 | Después |
|---|---:|---:|
| `context/AppContext.tsx` | 917 líneas | **147** (−84 %) |
| Tipos `any` en el repositorio | 38 | **23** (−39 %) |
| Entradas en `tsconfig.strict.json` | 11 | **18** |
| Reglas en el gate de fronteras | 3 | **4** |
| Ciclos entre módulos | 14 | **14** |
| Pruebas | 3.446 | **3.469** |
| Bundle eager | 659,5 KB gz | **660,4 KB gz** (presupuesto 675,0) |

### El hallazgo que produjo el propio trabajo: `any` no es una molestia de estilo

Los tres generadores del LMS devolvían `Promise<any>` y las pantallas
reconstruían la forma en línea (`(c: any) => ({ title: c.title })`). Al
declararla, `tsc` señaló dos sitios donde el texto libre del modelo entraba sin
comprobar en una unión cerrada: `category: data.category || 'Architecture'` y
`level: m.level || 'Intermedio'`. Ninguno fallaba nunca de forma visible —
producían un curso con un nivel que ningún filtro empareja, que desaparece del
catálogo sin error.

De ahí la distinción que quedó documentada: **lo que el modelo propone no es lo
que el dominio registra**. `GeneratedCourse` no tiene ids y su `level` es la
cadena que llegó; `Course` es un registro. Las dos coerciones
(`asCourseCategory`, `asCourseLevel`) son el puente, y hacen explícito el
respaldo que las pantallas ya pretendían tener.

### Por qué `AppContext` se partió en hooks y no en cuatro contextos

El plan original decía «`ProjectsContext` / `ArtifactsContext` /
`SettingsContext`». No se hizo, y la razón vale más que el plan: **partir el
contexto obliga a cada una de las cuarenta pantallas que lo consumen a decidir a
cuál de cuatro se suscribe**, y a re-renderizar por los cuatro mientras se
equivoca. Partir el *provider* no le cuesta nada a ningún consumidor: la
interfaz publicada es idéntica, el `useMemo` es el mismo, y `useAppContext()` no
cambió en ningún archivo.

Lo que sí se respetó de la idea es la parte que importaba: **un dueño por
estado**. `projects` lo declara `useProjectsState` y nadie más; los hooks que
escriben artefactos o el grafo lo hacen a través del `setProjects` y el
`updateProject` que reciben. Dos arrays de los mismos artefactos es exactamente
cómo un lienzo y una barra lateral empiezan a discrepar sobre lo que el usuario
acaba de editar, y hay una prueba que falla si aparece el segundo.

`useAppBootstrap` no importa el repositorio de proyectos: recibe `loadProjects`
del hook que posee el array. No es ceremonia — el gate de fronteras lo exigió
(la importación profunda subía de 2 a 3), y la forma resultante es la correcta:
quien es dueño de los datos sabe de dónde vienen.

### La cuarta regla del gate: una pantalla no es la capa de aplicación

El hallazgo 7 decía «la capa de aplicación es la UI» y no traía forma de
medirlo. Ahora la trae. Un componente que importa un servicio está usando una
capacidad; uno que importa ocho **es** la orquestación de esa pantalla, escrita
en un archivo cuyo trabajo es renderizar. El censo:

| Pantalla | Módulos de servicio |
|---|---:|
| `components/ArtifactCanvas.tsx` | 8 |
| `components/copilot/ProjectCopilotChatModal.tsx` | 5 |
| `components/AssistantPanel.tsx`, `ArtifactInspectorPanel`, `ArtifactExportModal`, `pages/InitiativesPage`, `pages/ProjectsPage`, `pages/Workspace` | 4 |
| `EngagementIntakeWizard`, `OfficeCapabilitiesPanel`, `ChatInterface`, `pages/DashboardPage` | 3 |

El umbral para código nuevo es **dos**, y cualquier pantalla no listada se
rechaza en el tercero. Como los otros tres presupuestos del repositorio, el
número puede bajar y no puede subir.

### Lo que no se hizo, y por qué

**Las doce pantallas siguen por encima del umbral.** El criterio que yo mismo
escribí decía «ningún componente importa más de dos módulos de servicio», y eso
no se cumplió: lo que hay es la medición y el presupuesto. Bajar
`ArtifactCanvas` de ocho a dos es extraer cinco servicios de aplicación
(compilación, validación, calidad, revisión, exportación) de un archivo de 1.128
líneas — una ola entera, no el cierre de ésta. Lo honesto es decir que el
sangrado está detenido y numerado, no que el problema esté resuelto.

**`services/chat/chatCompactor.ts` no entró en `strict`.** Importa el barril
`services/ai`, y un barril es el módulo entero: arrastra `geminiService` (8
errores) y `firestoreService` (57). Entra cuando la capa de IA deje de alcanzar
al monolito, que es trabajo del strangler, no de una lista de `tsconfig`.

**Los repositorios de Firestore siguen fuera de `strict`** por la misma razón a
un paso: `tsc` comprueba todo lo alcanzable y todos delegan hoy en
`firestoreService`. Entran las reglas —donde vive el riesgo—, no sus
repositorios.

**Quedan 16 `any` en `geminiService`, 6 en `ExcalidrawViewer` y 1 en
`lazyWithRetry`.** Los primeros se van con el monolito; los segundos son la
superficie de Excalidraw, genuinamente sin tipos en el punto donde se carga; el
último es `ComponentType<any>`, que es cómo React declara su propio `lazy`.

**Los tres workflows de GitHub Actions siguen separados.** Unificarlos depende de
si la protección de rama de `main` exige el check `E2E (Playwright)` por nombre,
que es una decisión de configuración del repositorio, no de código.

---

## 3 sexies. Doble chequeo de las cuatro olas (2 sep 2026)

Repaso mecánico de los 65 entregables declarados en §3 bis a §3 quinquies,
comprobados contra el árbol y no contra el informe. **63 se confirmaron.
Dos guardas propuestas en §4 no estaban implementadas**, y ésta es su
ejecución.

### Hallazgo 1 del repaso — el barril de IA seguía reexportando el motor

El hallazgo 10 se dio por cerrado porque ningún módulo fuera de `services/ai`
importa `geminiService`. La mitad que sobrevivió es la que la guarda de §4
nombraba: **`services/ai/index.ts` reexportaba desde el monolito**
`AIServiceError`, `classifyAIError`, `C4SelfHealingError`, cuatro fallbacks
deterministas y un tipo. Siete pantallas capturan `AIServiceError`: todas
alcanzaban el motor a través de la puerta construida para esconderlo.

| Símbolo | Casa nueva | Por qué ahí |
|---|---|---|
| `AIServiceError`, `C4SelfHealingError`, `classifyAIError`, `isTransientGeminiError` | `services/ai/errors/aiServiceError.ts` | Es la superficie de error de la capa, junto al clasificador por proveedor que llegó después. La dependencia se invierte: el motor importa sus errores de la capa. |
| `buildDeterministicArtifactFallback`, `buildDeterministicDiagramSkeleton`, `isSkeletonFallbackContent`, `markMermaidAsSkeletonFallback` y sus constructores híbridos | `services/artifacts/deterministic*.ts` | **520 líneas que no llaman a ningún modelo.** Son funciones puras de un proyecto y una plantilla a Mermaid o Markdown, y su único consumidor estaba en esa misma carpeta. |
| `ArtifactSuggestion` (el delgado) | `lib/artifacts` como `ArtifactTemplateSuggestion` | Había **dos tipos distintos con el mismo nombre**: éste dentro del motor y publicado por el barril, y el rico en `lib/artifacts`. Ninguna llamada estaba mal — por suerte, no por diseño. |

La guarda quedó instalada como se proponía (`no-restricted-imports` sobre
`services/ai/index.ts`) y comprobada disparando: un `export … from
'../geminiService'` añadido a mano falla el lint. `publicApiSurface.test.ts`
asegura además que mover los símbolos no los borró: siguen exportados y
`classifyAIError` clasifica un 429 igual que antes.

`geminiService` pasó de **6.012 a 5.499 líneas** y su techo bajó con él.

### Hallazgo 2 del repaso — `check:module-size` sólo contaba saltos de línea

La guarda propuesta decía «medido en **bytes** además de líneas». No estaba.
Y el caso que la justifica lo produjo esta misma ola: el diccionario `en`/`es`
que sacamos de `AppContext` era **17 líneas y 20 KB** — más de la mitad del
archivo por peso, invisible para todo presupuesto de líneas del repositorio.

El gate ahora lleva un segundo censo, con la misma regla monotónica: 59 pesos
registrados y **20.000 bytes** por defecto — 500 líneas a los 40 bytes por línea
que el repositorio realmente promedia, de modo que los dos presupuestos aprietan
en el mismo sitio para código ordinario y divergen exactamente cuando un archivo
empieza a cargar datos.

Comprobado devolviendo el diccionario a `AppContext.tsx`: **166 líneas, muy por
debajo del techo, y el gate lo rechaza por peso.**

### Un intento descartado, y por qué

La primera versión derivaba el techo de bytes del de líneas
(`líneas × 80 B`). Es más barata de mantener —una sola tabla— y **no habría
detectado el defecto que la motiva**: con 500 líneas de techo, el presupuesto
salía a 40 KB y el diccionario de 20 KB pasaba. Un censo absoluto cuesta una
tabla más y sí muerde.

### El barril contra el bundle, tercera y cuarta vez

Las dos importaciones nuevas entraban por el `index.ts` de su módulo, que es lo
correcto en general y aquí costó el build dos veces seguidas:

| Entrada por barril | Carga eager |
|---|---:|
| `geminiService` → `services/artifacts` | 660 → **1.126 KB gz** |
| `deterministicArtifactFallbacks` → `services/diagram` | 660 → **1.098 KB gz** |

`check:bundle-budget` rechazó ambas. Las dos nombran el archivo, con el motivo
escrito al lado. La regla ya tiene cuatro casos y está promovida a sección
propia en `CLAUDE.md`.

Dos entradas del presupuesto de importaciones profundas suben en consecuencia
(`services/artifacts → services/diagram` 9 → 10 y `services (raíz) →
services/artifacts` 4 → 5). Son **las mismas importaciones de antes,
reubicadas**: 520 líneas salieron de un archivo suelto de la raíz —que no
pertenece a ningún módulo— y entraron en uno que sí. El motivo queda escrito en
el propio presupuesto, que es lo que la regla monotónica exige.

### Lo medido

| Métrica | Antes del repaso | Después |
|---|---:|---:|
| Reexportaciones del motor en la API pública de IA | 8 | **0** |
| `services/geminiService.ts` | 6.012 líneas | **5.499** |
| Presupuestos mecánicos | 5 | **6** (peso de módulo) |
| Guardas de §4 implementadas | 3 de 5 | **5 de 5** |
| Pruebas | 3.469 | **3.482** |

---

## 4. Secuencia recomendada

El orden importa: los hallazgos 1 y 2 son habilitadores. Sin fronteras no hay
módulos que probar por separado; sin un CI rápido, cada paso posterior cuesta 14
minutos de espera.

| Ola | Contenido | Por qué en este orden |
|---|---|---|
| **Ola 1 — habilitadores** | **2** (entorno de pruebas + sharding), **6.1** (borrar el bloque LMS muerto), **4.3** (`PersistenceResult` en `trainingService` y revisión) | Cambios pequeños, sin riesgo estructural y con efecto inmediato: el ciclo de retroalimentación baja a ~6 min y se cierra un defecto visible para el usuario. |
| **2 — fronteras** *(completada)* | **1** (manifiesto de módulos + gate + romper los cuatro ciclos de dominio), **5** (alinear la puerta, E2E contra `dist/`) | Con CI rápido, romper ciclos es barato de verificar. El gate impide que vuelvan. |
| **Ola 3 — el dominio** | **3** (módulo `architectureProjects` + factoría con invariante), **4** (repositorios por contexto), **6.2** (repartir `types.ts`) | Es el trabajo grande, y necesita las fronteras de la Ola 2 para no crear módulos nuevos ya acoplados. |
| **Ola 4 — consolidación** | **7** (capa de aplicación, partir `AppContext`), **8** (un solo modelo de calidad), **9** (ampliar `strict`), **10** (limpiar la API de IA) | Cada uno es incremental y cabe en el ritmo normal de trabajo una vez que existen los módulos. |

### Guardas anti-regresión — todas implementadas (2 sep 2026)

Este repositorio ya demostró que la guarda mecánica funciona mejor que la
convención (`check:module-size` existe porque `CLAUDE.md` pedía no crecer los
monolitos y nadie lo verificaba). Se añaden en el mismo estilo, con presupuesto
monotónico:

| Guarda | Impide |
|---|---|
| `check:module-boundaries` | ciclos nuevos e importaciones profundas nuevas |
| `check:module-size` medido en **bytes** además de líneas | esquivar el techo con líneas de 300 caracteres — o meter 20 KB de datos en 17 líneas, que es lo que pasó |
| `no-restricted-imports` en `services/ai/index.ts` | que el barril reexporte el motor |
| `no-restricted-imports` para `firebase/firestore` | una quinta estrategia de persistencia |
| Prueba de la frontera `strict` (ya existe) | que un módulo salga de la frontera |

---

## 5. Lo que está bien y no debe tocarse

Un informe que sólo enumera defectos describe mal el sistema. Estas decisiones
son correctas y varias de ellas son la razón por la que el resto es abordable:

- **`lib/eaTerminology.ts`.** El lenguaje ubicuo está escrito, con dos registros
  por nivel y una regla clara de cuándo usar cada uno. Es la base sobre la que
  se apoya el hallazgo 3: el vocabulario ya existe, sólo falta que los módulos
  se llamen como él.
- **`lib/authz/permissions.ts` + `firestore.rules` comparados celda a celda** por
  `__tests__/authz/rulesMatrix.test.ts`, con el emulador en CI. Es el mejor
  trabajo del repositorio.
- **Los presupuestos mecánicos** (`module-size`, `any`, `bundle-secrets`,
  `bundle-budget`, `no-orphan-scripts`) y su regla monotónica. Cuestan menos de
  un segundo en CI entre los cinco.
- **El pipeline determinista de diagramas** y sus 106 archivos de prueba: el LLM
  produce contenido, nunca disposición.
- **La migración perezosa en lectura** de los registros heredados, y el criterio
  de *reportar* referencias rotas en vez de descartarlas.
- **La extracción del LMS del monolito** con un test que lo mantiene fuera. Es el
  patrón que el hallazgo 10 pide repetir.
- **La documentación de decisiones dentro del código**, con el motivo y no sólo
  el qué. Media docena de hallazgos de este informe se localizaron leyendo esos
  comentarios.

---

## 6. Trazabilidad de las mediciones

Para que cualquiera pueda reproducir o refutar lo anterior:

| Afirmación | Cómo se obtuvo |
|---|---|
| 603 archivos / ~133.600 líneas | `find components pages context hooks lib services utils api -name '*.ts*' \| grep -v __tests__ \| xargs wc -l` |
| 23 ciclos de 2 módulos, 37 de 3 | Grafo construido resolviendo cada `import` relativo y `@/` a su módulo |
| 76 importaciones profundas | `grep` de importaciones cruzadas que no terminan en el barril |
| Desglose de Vitest | Salida de `npm run test:coverage` (línea `Duration`) |
| 272 de 371 archivos sin DOM | Archivos `.test.ts` sin `@testing-library`, `document.`, `window.`, `localStorage`, `navigator.` |
| Duraciones de CI | GitHub Actions, ejecución #254 (`33359327296`), pasos del job `Quality gate` |
| 0 importadores del bloque LMS de `types.ts` | Resolución de todos los `import { ... } from '.../types'` del árbol |
| `initiativeIds` opcional en `addProject` | `context/AppContext.tsx`, firma de `addProject` |
| 4 estrategias de persistencia | Recuento de `PersistenceResult`/`executeRemoteWrite` por archivo de servicio |
