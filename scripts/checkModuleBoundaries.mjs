#!/usr/bin/env node
/**
 * checkModuleBoundaries — the modules stay modules.
 *
 * `modules.json` declares what the modules are and how they may depend on each
 * other. This enforces it, mechanically, on every push. The three rules and the
 * reasoning behind them are in that file; what lives here is the measurement.
 *
 * Every rule carries a recorded budget rather than a clean-desk requirement,
 * because the repository has 23 cycles and 76 deep imports today and a gate
 * that fails on all of them from day one is a gate someone deletes on day two.
 * A budget stops the bleeding immediately and turns the cleanup into ordinary
 * work: the number may fall, and must never rise.
 *
 * Run with `npm run check:module-boundaries`. Pass `--report` to print the
 * current census in the shape this file records it, which is how you update
 * the budget after removing something.
 *
 * **Qué mira, y por qué importa que lo diga** (F3-02, ADR-105). Un verificador
 * de fronteras informa de un grafo, y un grafo incompleto no se ve incompleto:
 * se ve sano. Éste midió durante toda la transformación un árbol sin dos de
 * sus nudos y una sintaxis sin leer, y el resultado fue un gate en verde sobre
 * veintisiete módulos mutuamente alcanzables. Desde F3-02 lee:
 *
 *   - `import`, `export … from`, `import type` **y** `import('…')`, en sus dos
 *     formas —la diferida de ejecución y la de posición de tipo—;
 *   - todo fichero `.ts`/`.tsx` bajo las carpetas declaradas **y** los ficheros
 *     de la raíz que `modules.json` declara uno a uno (`types.ts`,
 *     `constants.ts`, `utils.ts`, `App.tsx`, `index.tsx`).
 *
 * Lo que sigue fuera está fuera a propósito y es comprobable: pruebas,
 * declaraciones `.d.ts`, `e2e/`, `supabase/`, `scripts/` y la configuración de
 * build. Ninguno participa del grafo que la aplicación ejecuta.
 */

import { readFileSync } from 'node:fs';
import { evaluateBudgetTargets, todayIso } from './budgetTargets.mjs';
import { execSync } from 'node:child_process';
import { dirname, join, normalize, resolve } from 'node:path';

const ROOT = process.cwd();
const MANIFEST = JSON.parse(readFileSync('modules.json', 'utf8'));

/* ------------------------------------------------------------- the budgets */

/**
 * Modules that import each other, measured 2026-09-01.
 *
 * Each entry is `a <-> b` with the two names sorted, so a pair has one
 * spelling. Removing one is the work item; adding one fails the build.
 *
 * The four cycles between real domain contexts were broken in the Ola 2 pass
 * (see `docs/top-10-monolito-modular-ddd-2026-09-01.md`). What is left is
 * `services (raíz)` — the loose files that belong to no module — and the two
 * UI pairs, which are a different problem: `components <-> context` is React's
 * ordinary shape, not a modularity defect.
 *
 * **Siete entradas nuevas el 2026-09-21, y ninguna es código nuevo** (F3-02,
 * ADR-105). Seis pasan por `types.ts` y una por `utils.ts`: dos ficheros de la
 * raíz del repositorio que este gate no abrió nunca, porque sólo miraba
 * carpetas. Estaban ahí desde antes de que existiera el gate. Subir un número
 * aquí sigue estando prohibido; lo que cambió es cuánto se ve, y ADR-104 ya
 * sentó el precedente: un gate no puede empezar en rojo, y lo que mide de más
 * se registra el día que aprende a medirlo.
 *
 * Las cuatro que la prueba afirma por nombre —`export ↔ quality`,
 * `artifacts ↔ export`, `agent ↔ architectureOffice`, `ai ↔ diagram`— siguen
 * rotas, y ninguna de las siete nuevas las reintroduce.
 *
 * **Cuatro de las siete duraron un día** (F3-07): `lib`, `services/chat`,
 * `services/presentation` y `services/review` salieron de la lista al dejar
 * `types.ts` de reexportar lo que ya no leía nadie. Las 19 declaraciones de
 * diagrama que reexportaba **no tenían un solo consumidor**, y de las otras
 * tres familias los únicos consumidores eran los propios módulos dueños,
 * importando sus tipos por la raíz del repositorio en vez de por su fichero.
 *
 * Quedan dos, y son el mismo hecho: `Project` contiene artefactos y el
 * contexto de artefactos necesita el proyecto. Deshacerlo no es repuntar
 * imports —eso sólo cambiaría un ciclo contra `types.ts` por uno entre dos
 * contextos de dominio reales—, sino decidir si `Artefacto` es raíz de
 * agregado. Es D-4, y la decide F4-02 con los datos de F4-01.
 */
export const ALLOWED_CYCLES = [
  'components <-> context',
  'components <-> hooks',
  'context <-> hooks',
  // `services (raíz) <-> services/ai` salió el 2026-09-24 (F5-01, corte 14):
  // el motor entró en `services/ai/generation/artifacts/` después de que la
  // persona (corte 13) y el soporte de artefactos (corte 14) le llegaran por
  // puertos. Lo que queda son los tres de React, que no son objetivo de nadie.
];

/**
 * Módulos mutuamente alcanzables, medidos 2026-09-20.
 *
 * `ALLOWED_CYCLES` responde «¿se importan estos dos entre sí?». Ésta responde
 * la pregunta que de verdad decide si un módulo se puede leer solo: **¿se puede
 * volver a él siguiendo imports?** Un ciclo `A → B → C → A` no aparece en el
 * presupuesto de pares, y durante toda la ola anterior el gate estuvo verde
 * declarando «0 ciclos entre contextos de dominio» mientras nueve contextos
 * eran mutuamente alcanzables por 22 aristas.
 *
 * Cada entrada es un componente fuertemente conexo: la lista **exacta** de sus
 * módulos. Reducirlo es el trabajo; que crezca, que aparezca uno nuevo, o que
 * cambie de miembros, falla el build. Se registra la lista entera y no sólo el
 * tamaño porque un componente que pierde un módulo y gana otro es un hecho
 * nuevo, no el mismo con el mismo número.
 *
 * El componente de UI no es un defecto de modularidad: `components ↔ context ↔
 * hooks` es la forma ordinaria de React. El de dominio sí lo es, y la arista
 * que lo cierra es `services/ai -> services (raíz)` — los 12 imports de
 * `services/geminiService` desde dentro de la capa que debería ocultarlo.
 * Ver `docs/ddd-transformacion/adr/ADR-104-gate-transitivo.md`.
 *
 * **De nueve módulos a veintisiete el 2026-09-21, sin que se escribiera una
 * línea** (F3-02, ADR-105). La lección de ADR-104, repetida un nivel más
 * arriba: allí el gate estaba verde porque medía ciclos de longitud 2; aquí
 * estaba verde porque medía carpetas, y `types.ts` no es una carpeta. Lo
 * importan 25 de los 34 módulos y él importa seis, así que cerraba el grafo
 * entero — incluidos `lib` y `utils`, que la capa de fundación no debería
 * poder alcanzar de vuelta.
 *
 * El núcleo de nueve sigue dentro y sigue siendo el objetivo de la fase 5. Lo
 * que el componente de veintisiete añade es un segundo objetivo, más barato y
 * anterior: **el que sale al encoger `types.ts`**. Un reexportador es un nudo
 * que se deshace moviendo declaraciones a sus contextos, no reescribiendo
 * motores.
 *
 * **De veintisiete a catorce el 2026-09-22 (F3-07, tras ADR-106).** Salieron
 * `types.ts`, `lib`, `utils`, `utils.ts`, `constants.ts` y ocho contextos de
 * dominio. Lo que lo hizo fue bajar el Artefacto a `lib/artifacts` —es núcleo
 * compartido: lo lee la fundación y quince contextos— y que `types.ts` dejara
 * de importar nada. Los tres ciclos directos que eso destapaba
 * (`architectureProjects` con la Oficina, el grafo y la publicación) se
 * cerraron con puertos, no con presupuesto. Lo que queda es el núcleo de
 * dominio que cierra `services/ai -> services (raíz)`: la fase 5.
 *
 * **De catorce a trece el 2026-09-24 (F5-01, corte 14).** Salió la raíz de
 * `services/`, porque ya no queda nada en ella. El componente **no se
 * disuelve**, y conviene decir por qué, porque la frase anterior prometía que
 * sí: `services/ai -> services (raíz)` era una arista que lo cerraba, no la
 * única. `services/ai -> services/architectureProjects -> services/chat ->
 * services/ai` lo cierra por su cuenta —la IA lee el proyecto, el proyecto
 * guarda el historial de chat, y el chat compacta con un modelo—, y hay más
 * caminos así. Deshacerlos es F5-03, que es donde `budgetTargets.mjs` pone el
 * objetivo de cero.
 */
export const ALLOWED_SCCS = [
  [
    'components',
    'context',
    'hooks',
  ],
  [
    'services/agent',
    'services/ai',
    'services/architectureKnowledgeGraph',
    'services/architectureOffice',
    'services/architectureProjects',
    'services/artifactCompiler',
    'services/artifacts',
    'services/chat',
    'services/contextGraph',
    'services/diagram',
    'services/export',
    'services/publicationPipeline',
    'services/quality',
  ],
];

/**
 * Imports that point upward through the layers, measured 2026-09-01,
 * re-medidos con el alcance completo el 2026-09-21.
 *
 * The count is per `source -> target` pair. `lib` is documented in CLAUDE.md as
 * the layer with no dependencies and had seven files importing from
 * `services/`; those are the ones this number is here to retire.
 *
 * **`lib/` y `utils/` siguen en cero, y eso se conserva**: las siete entradas
 * de hoy salen de dos ficheros de la raíz que el gate no abría (F3-02,
 * ADR-105). Son fundación por lo que hay debajo de ellos —`lib` los importa,
 * así que están por debajo de `lib`— y suben a cinco contextos de dominio:
 *
 *   - `types.ts` es el núcleo compartido y reexporta agregados desde el
 *     contexto de cada uno. La regla que lo arregla ya está escrita en
 *     CLAUDE.md y se aplicó tres veces en la Ola 2: un contrato sin
 *     comportamiento baja a una hoja. Aquí sobra con que cada consumidor
 *     importe del contexto dueño en vez de del reexportador.
 *   - `utils.ts` no es un fichero de utilidades: `buildGlobalPrompt`,
 *     `buildBasePrompt` y `buildArtifactsContext` son composición de prompts,
 *     es decir capa de IA escrita en la raíz del repositorio. Por eso importa
 *     `services/ai` y `services/memory`.
 *
 * De los siete originales quedan cuatro: F3-07 retiró los tres que salían de
 * reexportaciones que nadie consumía. Los dos de `types.ts` que siguen son el
 * agregado Proyecto–Artefacto y esperan a D-4; los dos de `utils.ts` son F3-08.
 *
 * **Cero desde el 2026-09-22.** F3-08 retiró los de `utils.ts`; F3-07 —con
 * D-4 resuelta por ADR-106— los de `types.ts`, que ya no importa nada. La capa
 * de fundación entera, carpetas y ficheros de la raíz, no alcanza el dominio.
 * El presupuesto queda vacío y no vuelve a tener entradas.
 */
export const LAYER_VIOLATION_BUDGET = {
};

/**
 * Imports that reach past a module's `index.ts` into its internals, measured
 * 2026-09-01, counted per `source -> target` pair.
 *
 * A module with a barrel and forty imports around it has a public API in name
 * only. Lower an entry when you route a caller through the barrel; a pair not
 * listed here is refused outright, which is what keeps new code honest.
 *
 * Nueve pares nuevos y seis subidas el 2026-09-21, todos por alcance y ninguno
 * por código (F3-02, ADR-105). Tres los escondía la sintaxis —`import()` no lo
 * leía el verificador, y `context -> services/ai` es justo el import diferido
 * con el que `OfficeContext` mantiene el motor fuera del arranque—; seis los
 * escondía la raíz del repositorio, que no es carpeta de nadie.
 */
/*
 * Two entries rose on 2026-09-02 and the reason is recorded here because the
 * rule is "may fall, never rise": `services/artifacts -> services/diagram`
 * (9 → 10) and `services (raíz) -> services/artifacts` (4 → 5). Both are the
 * *same* imports as before, relocated: 520 lines of deterministic fallbacks
 * moved out of `services/geminiService.ts` — a loose file at the root that
 * belongs to no module — into `services/artifacts`, so the import that used to
 * count as `services (raíz) -> services/diagram` now counts from the module,
 * and the engine's call sites now cross into that module.
 *
 * Both name a file rather than the module's `index.ts` on purpose: these are on
 * the eager path, and entering through either barrel took the entry chunk from
 * 660 KB gz to 1.098 and 1.126 respectively. `check:bundle-budget` refused it
 * twice. See CLAUDE.md → *The barrel against the bundle*.
 */
/*
 * Ola 2 (2026-09-02): cuatro pares nuevos que no son acoplamiento nuevo.
 *
 * `services/firestoreService.ts` guardaba siete contextos y era un fichero
 * suelto de la raíz, así que sus imports contaban como `services (raíz) -> X`.
 * Al repartirlo, los mismos imports los hace ahora el contexto dueño de cada
 * dato — `services/architectureProjects` para el mapeo del documento de
 * proyecto— y cuentan desde ahí. Las entradas de `services (raíz)` bajan en la
 * misma cantidad en la que suben éstas; el total no crece.
 *
 * Siguen siendo rutas profundas y no barriles a propósito, y esto ya está
 * medido: entrar por el barril de `publicationPipeline` o el de
 * `architectureOffice` desde un módulo del arranque llevó el chunk inicial de
 * 658 a 1 126 KB gz. Ver CLAUDE.md → *The barrel against the bundle*.
 */
/*
 * Ola 3 (2026-09-02): dos entradas suben en uno, y es el intercambio que la ola
 * busca. `context -> services/architectureOffice` (8 → 9) y
 * `context -> services/artifacts` (1 → 2) son las fábricas de agregado:
 * `OfficeContext` ya no construye un `OfficeEngagement` con un literal ni
 * comprueba a mano si el charter está aprobado, y `useArtifactsState` ya no
 * decide la numeración de versiones — ahora *llaman* a
 * `officeEngagementFactory`, `officeEngagementTransitions` y `artifactFactory`.
 *
 * Es decir: dos imports profundos más a cambio de que ningún agregado se
 * construya dentro de un componente de React, que es lo que
 * `__tests__/services/aggregates/noAggregateLiterals.test.ts` ahora impide.
 *
 * Siguen siendo rutas profundas y no barriles porque los dos contextos están en
 * el árbol de proveedores del arranque, y entrar por el barril de
 * `architectureOffice` o el de `artifacts` desde ahí ya ha costado dos builds
 * medidas. Ver CLAUDE.md → *The barrel against the bundle*.
 */
export const DEEP_IMPORT_BUDGET = {
  'api -> services/ai': 1,
  'components -> services/agent': 1, // F5-02: el copiloto entra por `useCopilotTurns`
  'components -> services/ai': 2,
  'components -> services/architectureOffice': 37, // F5-02: capacidades y copiloto, por la puerta
  'components -> services/artifacts': 11,
  'components -> services/chat': 1,
  'components -> services/diagram': 16,
  'components -> services/export': 1,
  'components -> services/presentation': 1,
  'components -> services/quality': 3,
  'components -> services/review': 1,
  'context -> services/agent': 1,
  // F5-01 corte 8: 10 → 11, y `context -> services/ai` desaparece a cambio.
  // `OfficeContext` carga el chat de proyecto de la Oficina en diferido por su
  // fichero, no por el barril: el provider está en el arranque, y entrar por el
  // barril subía la carga inicial de 309,6 a 310,7 KB gz (arrastraba
  // `agentDefinition` al chunk de entrada). Es la regla del barril contra el
  // bundle, medida por `check:bundle-budget`.
  'context -> services/architectureOffice': 11,
  'context -> services/architectureProjects': 2,
  'context -> services/chat': 1,
  'hooks -> services/agent': 2,
  'hooks -> services/ai': 2,
  'hooks -> services/artifacts': 3,
  'hooks -> services/diagram': 5,
  'hooks -> services/export': 2,
  'pages -> services/architectureOffice': 7, // F5-02: `InitiativesPage` y `ProjectsPage` salen por hooks
  'pages -> services/artifacts': 1,
  // `services (raíz) -> …` — cinco pares, 16 imports profundos — se fueron con
  // el motor el 2026-09-24 (F5-01, corte 14). Dentro de `services/ai` entra por
  // los barriles de cada contexto: es código perezoso, y la regla del barril
  // contra el bundle lo permite.
  'services/agent -> services/diagram': 1,
  'services/agent -> services/memory': 3,
  'services/agent -> services/quality': 1,
  'services/ai -> services/diagram': 1,
  'services/architectureKnowledgeGraph -> services/architectureOffice': 1,
  'services/architectureOffice -> services/ai': 2,
  'services/architectureOffice -> services/diagram': 1,
  'services/architectureOffice -> services/publicationPipeline': 1,
  'services/architectureProjects -> services/architectureKnowledgeGraph': 1,
  'services/architectureProjects -> services/chat': 1,
  'services/architectureProjects -> services/memory': 2,
  'services/architectureProjects -> services/publicationPipeline': 4,
  'services/artifactCompiler -> services/quality': 3,
  // F4-05: el lienzo y el Workspace dejaron de importar la capa de IA; la
  // clasificación del fallo y el vocabulario de sugerencias bajaron a
  // `services/artifacts/application`. Es el intercambio que la regla de
  // fan-out busca: `components -> services/ai` bajó a la vez.
  'services/artifacts -> services/ai': 2,
  // F4-05: la auto-mejora determinista del diagrama y los tipos de medida del
  // lienzo salieron de cuatro pantallas; `components -> services/diagram`
  // bajó de 20 a 16 en el mismo cambio.
  'services/artifacts -> services/diagram': 17,
  'services/artifacts -> services/export': 3,
  'services/artifacts -> services/quality': 3,
  'services/export -> services/diagram': 1,
  'services/export -> services/presentation': 1,
  'services/export -> services/quality': 11,
  'services/portfolioGraph -> services/architectureOffice': 3,
  'services/publicationPipeline -> services/architectureKnowledgeGraph': 7,
  'services/publicationPipeline -> services/artifactCompiler': 1,
  'services/publicationPipeline -> services/export': 7,
  'services/quality -> services/diagram': 1,
};

/**
 * How many service modules a single screen reaches into, measured 2026-09-02.
 *
 * A component that imports one service is using a capability. One that imports
 * eight is *the* application layer for that screen, written in a file whose job
 * is rendering — which is how `ArtifactCanvas` came to decide compilation,
 * validation, quality, review and export policy between two JSX branches.
 *
 * Two is the rule for new code, so anything not listed is refused at three. The
 * files here are the census as it stands, not a target: each one falls when its
 * orchestration moves into an application service the screen calls once. Lower
 * an entry when that happens; raising one needs a reason in the commit message.
 *
 * `pages/DashboardPage.tsx` **left this table** and that is what it is for. El
 * tablero componía el grafo del portafolio, el retrato de la Oficina y el
 * resumen de iniciativas dentro del propio fichero de la pantalla; ahora lo
 * hace `hooks/usePortfolioCommandCenter`, con la regla de salud en
 * `services/architectureOffice/application/portfolioCommandCenter`, y la
 * pantalla alcanza un solo módulo de servicio — por debajo del defecto.
 *
 * **La tabla está vacía desde el 2026-09-24 (F5-02).** Las seis que quedaban
 * salieron por el mismo camino: lo que decidían pasó a su contexto dueño
 * —`routeCopilotTurn` y `describeOfficeCapabilities` a la Oficina,
 * `interpretArtifactModification` al agente, `resolveAttentionInitiativeLinks`
 * al grafo del portafolio— y un hook junta los módulos que una pantalla
 * necesitaba a la vez (`useCopilotTurns`, `useAssistantTurns`,
 * `useInitiativeBoard`, `useInitiativeAssistant`, `useAttentionPortfolio`,
 * `useAttentionInitiativeLinks`). Los tipos del estado que da un contexto los
 * da el contexto (`BusinessInitiative`, `OfficeEngagement`, `ChatMessage`),
 * como ya hacía `AppContext` con `Project`. Una pantalla nueva que alcance un
 * tercer módulo falla: ya no hay presupuesto que la absorba.
 */
export const UI_SERVICE_FANOUT_BUDGET = {
};

/** The rule new screens live under: at most this many service modules. */
export const UI_SERVICE_FANOUT_DEFAULT = 2;

/**
 * Ficheros sueltos en la raíz de `services/`, medidos 2026-09-02.
 *
 * La raíz de `services/` no es un módulo: es donde acaba lo que no pertenece a
 * ningún sitio. `modules.json` los agrupa bajo `services (raíz)` sólo para
 * poder medirlos, y durante meses fueron el mayor «módulo» del repositorio —
 * 20 ficheros, 9 923 líneas— y la causa de nueve de los catorce ciclos, de los
 * tres imports ascendentes y de sesenta imports profundos.
 *
 * Los diecinueve que tenían dueño se fueron primero. El vigésimo, el motor,
 * se fue el 2026-09-24 (F5-01, corte 14), y el presupuesto es **cero**. Lo que
 * sigue es cómo era, porque explica por qué costó trece cortes:
 *
 *   - `geminiService.ts` — el motor de Gemini, 5 498 líneas y 16 de los 23
 *     `any` del repositorio. La Ola 5 intentó moverlo a `services/ai` y el gate
 *     lo rechazó con razón: el motor alcanza hacia arriba a ocho contextos de
 *     dominio para componer sus prompts, y cuatro de ellos importan
 *     `services/ai` de vuelta, así que el movimiento cambia **un** ciclo contra
 *     este pseudo-módulo por **cuatro entre contextos de dominio reales**.
 *     Sacarlo no es una reubicación: es la migración por estrangulamiento
 *     continuando vertical a vertical, cortando cada dependencia ascendente
 *     antes. `services/ai/generation/learning` es la vertical ya hecha.
 *
 * Este número sólo puede bajar. Subirlo es volver a tener un cajón de sastre,
 * que es exactamente de lo que se ha tardado cuatro olas en salir.
 */
export const SERVICES_ROOT_BUDGET = 0;

/* ------------------------------------------------------------ the analysis */

const MODULES = MANIFEST.modules.map((m) => ({ ...m, prefix: m.path ? `${m.path}/` : null }));
// Longest path first so `services/diagram` wins over the `services` catch-all.
const BY_SPECIFICITY = [...MODULES]
  .filter((m) => m.prefix)
  .sort((a, b) => b.path.length - a.path.length);
const LAYER_RANK = Object.fromEntries(MANIFEST.layers.map((l, i) => [l, i]));

/**
 * Módulos declarados por fichero, no por carpeta.
 *
 * `types.ts`, `constants.ts`, `utils.ts` y el par `App.tsx`/`index.tsx` viven
 * en la raíz del repositorio, así que no hay prefijo que los capture y durante
 * toda la vida del gate **no se abrieron**. `types.ts` lo importan 25 de los 34
 * módulos, y él importa seis: era el nudo más grande del grafo, medido por un
 * verificador que no lo miraba. Ver ADR-105.
 *
 * Se indexan con y sin extensión porque un import los nombra sin ella
 * (`from '../types'`) y `git ls-files` con ella.
 */
const FILE_MODULES = new Map();
for (const mod of MODULES) {
  for (const file of mod.files ?? []) {
    FILE_MODULES.set(file, mod);
    FILE_MODULES.set(file.replace(/\.tsx?$/, ''), mod);
  }
}

const SOURCE_ROOTS = ['api', 'components', 'context', 'hooks', 'lib', 'pages', 'services', 'types', 'utils'];

export function sourceFiles() {
  const declaredFiles = MODULES.flatMap((m) => m.files ?? []);
  const pathspec = [...SOURCE_ROOTS, ...declaredFiles].map((entry) => `"${entry}"`).join(' ');
  return execSync(`git ls-files --cached --others --exclude-standard ${pathspec}`)
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.d\.ts$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file) && !file.includes('__tests__/'));
}

export const moduleOf = (file) =>
  FILE_MODULES.get(file) ?? BY_SPECIFICITY.find((m) => file.startsWith(m.prefix));

/** A screen: a rendered file under `components/` or `pages/`. */
const isScreen = (file) => /\.tsx$/.test(file) && (file.startsWith('components/') || file.startsWith('pages/'));

const IMPORT_RE = /(?:^|[\s;}])(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

/**
 * `import('x')`, en sus dos formas, que la expresión de arriba no ve.
 *
 * Son dependencias en los dos casos y por razones distintas. `await import()`
 * es una dependencia de ejecución que además decide en qué chunk acaba el
 * código — y este repositorio la usa a propósito: `OfficeContext` carga así la
 * capa de IA para mantenerla fuera del arranque. `import('x').T` en posición de
 * tipo no existe en ejecución, pero acopla igual que un `import type`, que el
 * gate ya cuenta desde el primer día. Medir uno y no el otro sería decidir que
 * la misma dependencia cuenta según cómo se escribió.
 *
 * No se distinguen aquí a propósito: la regla que aplican —ciclo, capa, API
 * pública— es la misma para las dos, y una excepción por sintaxis es la puerta
 * por la que se cuela la siguiente.
 */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Every relative or `@/`-aliased specifier in the file, as repo-relative paths. */
function localImports(file) {
  const source = readFileSync(file, 'utf8');
  const out = [];
  for (const pattern of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec.startsWith('.')) out.push(normalize(join(dirname(file), spec)));
      else if (spec.startsWith('@/')) out.push(normalize(spec.slice(2)));
    }
  }
  return out;
}

/**
 * Does this import enter the target module through its declared API?
 *
 * Both `services/quality` (the directory, which resolves to its `index.ts`)
 * and `services/quality/index` count; anything deeper does not.
 */
function entersThroughApi(target, mod) {
  if (!mod.api) return true;
  if (mod.files) return true;
  if (target === mod.path) return true;
  // F3-06: un módulo puede publicar más de una puerta —la principal y una
  // entrada pequeña, compatible con carga diferida, que no arrastra su
  // infraestructura—. Cada puerta declarada cuenta como entrada, por su fichero
  // o por su carpeta (`domain` resuelve a `domain/index.ts`).
  return publicEntries(mod).some((api) => {
    const file = api.replace(/\.tsx?$/, '');
    return target === file || target === file.replace(/\/index$/, '');
  });
}

/**
 * F3-03 — Las dependencias declaradas entre módulos.
 *
 * `modules.json` → `allowedDependencies` dice, módulo a módulo, de quién puede
 * depender. Tres cosas se comprueban: que todo módulo declare su lista (un
 * módulo sin lista es uno que puede depender de cualquiera), que ninguna arista
 * del grafo falte en ella, y —como nota, para que la lista encoja— que ninguna
 * declarada haya dejado de existir.
 */
export const ALLOWED_DEPENDENCIES = Object.fromEntries(
  Object.entries(MANIFEST.allowedDependencies ?? {}).filter(([name]) => name !== '$comment'),
);

export function checkDeclaredDependencies(edges, failures, notes, declared = ALLOWED_DEPENDENCIES) {
  for (const mod of MODULES) {
    if (!(mod.name in declared)) {
      failures.push(`dependency: ${mod.name} no declara sus dependencias en modules.json`);
    }
  }
  for (const edge of edges.keys()) {
    const [from, to] = edge.split(' -> ');
    if (from === to) continue;
    if (!(declared[from] ?? []).includes(to)) {
      failures.push(`dependency: ${edge} no está declarada en modules.json → allowedDependencies`);
    }
  }
  for (const [from, targets] of Object.entries(declared)) {
    for (const to of targets) {
      if (!edges.has(`${from} -> ${to}`)) {
        notes.push(`dependency: ${from} -> ${to} ya no existe. Quítala de allowedDependencies.`);
      }
    }
  }
}

/** Las puertas públicas de un módulo, se declaren como una o como varias. */
export function publicEntries(mod) {
  if (!mod.api) return [];
  return Array.isArray(mod.api) ? mod.api : [mod.api];
}

/**
 * Componentes fuertemente conexos (Tarjan), iterativo.
 *
 * Iterativo y no recursivo a propósito: la recursión natural tiene profundidad
 * igual al número de módulos, y el día que el manifiesto declare unos cientos
 * un gate que revienta por pila es un gate que se desactiva.
 *
 * Devuelve sólo los componentes de más de un módulo, cada uno con sus miembros
 * ordenados, y la lista entera ordenada — para que dos ejecuciones sobre el
 * mismo árbol produzcan el mismo texto y `--report` sea copiable.
 */
export function stronglyConnectedComponents(edges) {
  const adjacency = new Map();
  const nodes = new Set();
  for (const edge of edges.keys()) {
    const [from, to] = edge.split(' -> ');
    nodes.add(from);
    nodes.add(to);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }

  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    // Cada marco lleva su propio cursor sobre los vecinos, que es lo que
    // sustituye al retorno de la llamada recursiva.
    const frames = [{ node: root, next: 0 }];
    index.set(root, counter);
    lowlink.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbours = adjacency.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next];
        frame.next += 1;
        if (!index.has(neighbour)) {
          index.set(neighbour, counter);
          lowlink.set(neighbour, counter);
          counter += 1;
          stack.push(neighbour);
          onStack.add(neighbour);
          frames.push({ node: neighbour, next: 0 });
        } else if (onStack.has(neighbour)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node), index.get(neighbour)));
        }
        continue;
      }

      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].node;
        lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(frame.node)));
      }
      if (lowlink.get(frame.node) === index.get(frame.node)) {
        const component = [];
        let popped;
        do {
          popped = stack.pop();
          onStack.delete(popped);
          component.push(popped);
        } while (popped !== frame.node);
        if (component.length > 1) components.push(component.sort());
      }
    }
  }

  return components.sort((a, b) => a[0].localeCompare(b[0]));
}

export function analyse() {
  const edges = new Map(); // "a -> b" → count
  const deepImports = new Map(); // "a -> b" → count
  const examples = new Map(); // "a -> b" → first offending file
  const uiFanout = new Map(); // screen file → set of service modules it reaches

  for (const file of sourceFiles()) {
    const from = moduleOf(file);
    if (!from) continue;

    for (const target of localImports(file)) {
      const to = FILE_MODULES.get(target)
        ?? BY_SPECIFICITY.find((m) => `${target}/`.startsWith(m.prefix))
        ?? BY_SPECIFICITY.find((m) => target === m.path);
      if (!to || to.name === from.name) continue;

      const edge = `${from.name} -> ${to.name}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
      if (!examples.has(edge)) examples.set(edge, `${file} → ${target}`);

      if (isScreen(file) && to.name.startsWith('services')) {
        if (!uiFanout.has(file)) uiFanout.set(file, new Set());
        uiFanout.get(file).add(to.name);
      }

      if (!entersThroughApi(target, to)) {
        deepImports.set(edge, (deepImports.get(edge) ?? 0) + 1);
        const key = `deep:${edge}`;
        if (!examples.has(key)) examples.set(key, `${file} → ${target}`);
      }
    }
  }

  const has = (a, b) => edges.has(`${a} -> ${b}`);
  const cycles = new Set();
  for (const edge of edges.keys()) {
    const [a, b] = edge.split(' -> ');
    if (has(b, a)) cycles.add([a, b].sort().join(' <-> '));
  }

  const sccs = stronglyConnectedComponents(edges);

  const layerViolations = new Map();
  for (const [edge, count] of edges) {
    const [a, b] = edge.split(' -> ');
    const from = MODULES.find((m) => m.name === a);
    const to = MODULES.find((m) => m.name === b);
    if (LAYER_RANK[from.layer] > LAYER_RANK[to.layer]) layerViolations.set(edge, count);
  }

  const fanout = new Map();
  for (const [file, mods] of uiFanout) {
    if (mods.size <= UI_SERVICE_FANOUT_DEFAULT) continue;
    fanout.set(file, mods.size);
    if (!examples.has(`fanout:${file}`)) {
      examples.set(`fanout:${file}`, `${file} → ${[...mods].sort().join(', ')}`);
    }
  }

  return { edges, cycles: [...cycles].sort(), sccs, deepImports, layerViolations, fanout, examples };
}

/* --------------------------------------------------------------- the gate */

function checkBudget(kind, actual, budget, failures, notes, unit = 'import') {
  for (const [key, count] of actual) {
    const allowed = budget[key] ?? 0;
    if (count > allowed) {
      failures.push(
        allowed === 0
          ? `${kind}: ${key} is not allowed (${count} ${unit}${count === 1 ? '' : 's'})`
          : `${kind}: ${key} has ${count} ${unit}s, recorded budget ${allowed}`,
      );
    } else if (count < allowed) {
      notes.push(`${kind}: ${key} is down to ${count} (recorded ${allowed}). Lower it to lock the gain in.`);
    }
  }
  for (const key of Object.keys(budget)) {
    if (!actual.has(key)) notes.push(`${kind}: ${key} is gone. Remove it from the budget.`);
  }
}

/**
 * Un componente fuertemente conexo sólo puede encoger.
 *
 * El emparejamiento es por **solapamiento**, no por igualdad: si dos
 * componentes registrados se funden en uno, o uno registrado gana un módulo, lo
 * que hay que decir no es «apareció un componente nuevo» sino qué módulos
 * entraron. Comparar conjuntos exactos daría un mensaje que no nombra la causa.
 */
export function checkStronglyConnected(sccs, failures, notes, recordedBudget = ALLOWED_SCCS) {
  const key = (members) => members.join(' <-> ');
  const recorded = recordedBudget.map((members) => [...members].sort());
  const matched = new Set();

  for (const component of sccs) {
    const members = new Set(component);
    const budget = recorded.find((entry) => entry.some((name) => members.has(name)));
    if (!budget) {
      failures.push(
        `scc: ${component.length} módulos mutuamente alcanzables sin presupuesto — ${key(component)}`,
      );
      continue;
    }
    matched.add(budget);
    const added = component.filter((name) => !budget.includes(name));
    if (added.length > 0) {
      failures.push(
        `scc: ${key(budget)} creció con ${added.join(', ')} `
        + `(${budget.length} → ${component.length} módulos)`,
      );
    } else if (component.length < budget.length) {
      const gone = budget.filter((name) => !members.has(name));
      notes.push(
        `scc: ${key(budget)} bajó a ${component.length} módulos (salieron ${gone.join(', ')}). `
        + 'Actualiza ALLOWED_SCCS para fijar la mejora.',
      );
    }
  }

  for (const budget of recorded) {
    if (!matched.has(budget)) {
      notes.push(`scc: ${key(budget)} está roto. Quítalo de ALLOWED_SCCS.`);
    }
  }
}

export function scan() {
  const { edges, cycles, sccs, deepImports, layerViolations, fanout, examples } = analyse();
  const failures = [];
  const notes = [];

  for (const cycle of cycles) {
    if (!ALLOWED_CYCLES.includes(cycle)) failures.push(`cycle: ${cycle} is new`);
  }
  for (const recorded of ALLOWED_CYCLES) {
    if (!cycles.includes(recorded)) notes.push(`cycle: ${recorded} is broken. Remove it from ALLOWED_CYCLES.`);
  }

  checkStronglyConnected(sccs, failures, notes);
  checkDeclaredDependencies(edges, failures, notes);

  // F3-04: los números de este gate que tienen objetivo y fecha.
  const domainComponent = sccs.find((component) => component.includes('services/ai')) ?? [];
  const targets = evaluateBudgetTargets({
    'domain-scc-modules': domainComponent.length,
    cycles: cycles.length,
    'loose-root-files': sourceFiles().filter((f) => /^services\/[^/]+\.tsx?$/.test(f)).length,
    'ui-fanout-screens': fanout.size,
    'deep-import-pairs': deepImports.size,
  }, todayIso());
  failures.push(...targets.failures);
  notes.push(...targets.notes);

  const looseRootFiles = sourceFiles().filter((f) => /^services\/[^/]+\.tsx?$/.test(f));
  if (looseRootFiles.length > SERVICES_ROOT_BUDGET) {
    failures.push(
      `services root: ${looseRootFiles.length} ficheros sueltos, presupuesto ${SERVICES_ROOT_BUDGET} `
      + `(${looseRootFiles.map((f) => f.replace('services/', '')).join(', ')})`,
    );
  } else if (looseRootFiles.length < SERVICES_ROOT_BUDGET) {
    notes.push(`services root: quedan ${looseRootFiles.length} ficheros sueltos. Baja SERVICES_ROOT_BUDGET.`);
  }

  checkBudget('layer', layerViolations, LAYER_VIOLATION_BUDGET, failures, notes);
  checkBudget('deep import', deepImports, DEEP_IMPORT_BUDGET, failures, notes);
  checkBudget('ui fan-out', fanout, UI_SERVICE_FANOUT_BUDGET, failures, notes, 'service module');

  // A module that claims a public API has to have one.
  for (const mod of MODULES) {
    for (const api of publicEntries(mod)) {
      try {
        readFileSync(resolve(ROOT, api), 'utf8');
      } catch {
        failures.push(`api: ${mod.name} declares ${api} and the file is missing`);
      }
    }
  }

  return { failures, notes, cycles, sccs, deepImports, layerViolations, examples };
}

function report() {
  const { cycles, sccs, deepImports, layerViolations, fanout, examples } = analyse();
  const quote = (s) => `  '${s}',`;
  console.log('export const ALLOWED_CYCLES = [');
  cycles.forEach((c) => console.log(quote(c)));
  console.log('];\n');
  console.log('export const ALLOWED_SCCS = [');
  sccs.forEach((component) => {
    console.log('  [');
    component.forEach((name) => console.log(`    '${name}',`));
    console.log('  ],');
  });
  console.log('];\n');
  console.log('export const LAYER_VIOLATION_BUDGET = {');
  [...layerViolations].sort().forEach(([k, v]) => console.log(`  '${k}': ${v},`));
  console.log('};\n');
  console.log('export const DEEP_IMPORT_BUDGET = {');
  [...deepImports].sort().forEach(([k, v]) => console.log(`  '${k}': ${v},`));
  console.log('};\n');
  console.log('export const UI_SERVICE_FANOUT_BUDGET = {');
  [...fanout].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([k, v]) => console.log(`  '${k}': ${v},`));
  console.log('};\n');
  console.log(`// ${cycles.length} cycles, ${sccs.length} strongly connected components (${sccs.map((c) => c.length).join(' + ')} modules), ${layerViolations.size} upward pairs, ${deepImports.size} deep-import pairs, ${fanout.size} screens over the fan-out default`);
  for (const [k, v] of [...examples].slice(0, 0)) console.log(k, v);
}

function main() {
  if (process.argv.includes('--report')) return report();

  const { failures, notes, examples } = scan();

  for (const note of notes) console.log(`[check:module-boundaries] ${note}`);

  if (failures.length === 0) {
    console.log('[check:module-boundaries] OK — no new cycle, no larger strongly connected component, no new upward import, no new deep import, no new UI fan-out.');
    return;
  }

  console.error('\n[check:module-boundaries] FAILED\n');
  for (const failure of failures) {
    console.error(`  ${failure}`);
    const edge = failure.split(': ')[1]?.split(' is ')[0]?.split(' has ')[0];
    const example = examples.get(`deep:${edge}`) ?? examples.get(`fanout:${edge}`) ?? examples.get(edge);
    if (example) console.error(`      e.g. ${example}`);
  }
  console.error(`
A module is entered through its \`index.ts\`, does not import a module that
imports it back, and does not join a group that can reach itself through others. Fix the import rather than the budget: raising a number here
is how the folders stopped being modules the first time. \`modules.json\` says
which module is which, and \`--report\` prints the census in the shape this
file records it.
`);
  process.exitCode = 1;
}

main();
