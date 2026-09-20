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
 */

import { readFileSync } from 'node:fs';
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
 */
export const ALLOWED_CYCLES = [
  'components <-> context',
  'components <-> hooks',
  'context <-> hooks',
  'services (raíz) <-> services/ai',
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
 */
export const ALLOWED_SCCS = [
  ['components', 'context', 'hooks'],
  [
    'services (raíz)',
    'services/agent',
    'services/ai',
    'services/architectureKnowledgeGraph',
    'services/architectureOffice',
    'services/architectureProjects',
    'services/artifacts',
    'services/chat',
    'services/publicationPipeline',
  ],
];

/**
 * Imports that point upward through the layers, measured 2026-09-01.
 *
 * The count is per `source -> target` pair. `lib` is documented in CLAUDE.md as
 * the layer with no dependencies and had seven files importing from
 * `services/`; those are the ones this number is here to retire.
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
  'components -> services/agent': 2,
  'components -> services/ai': 3,
  'components -> services/architectureOffice': 44,
  'components -> services/artifacts': 14,
  'components -> services/businessInitiatives': 16,
  'components -> services/chat': 1,
  'components -> services/diagram': 20,
  'components -> services/export': 1,
  'components -> services/presentation': 1,
  'components -> services/quality': 8,
  'components -> services/review': 1,
  'context -> services/agent': 1,
  'context -> services/architectureOffice': 9,
  'context -> services/architectureProjects': 2,
  'context -> services/artifacts': 2,
  'context -> services/chat': 1,
  'hooks -> services/agent': 2,
  'hooks -> services/ai': 2,
  'hooks -> services/artifacts': 4,
  'hooks -> services/diagram': 5,
  'hooks -> services/export': 2,
  'pages -> services/ai': 1,
  'pages -> services/architectureOffice': 9,
  'pages -> services/artifacts': 1,
  'services (raíz) -> services/agent': 1,
  'services (raíz) -> services/ai': 16,
  'services (raíz) -> services/architectureOffice': 3,
  'services (raíz) -> services/artifacts': 4,
  'services (raíz) -> services/diagram': 6,
  'services (raíz) -> services/presentation': 2,
  'services (raíz) -> services/quality': 1,
  /**
   * The boot-path exception, and the only one recorded deliberately.
   *
   * `projectWrites` enters `services/chat` by file path rather than through its
   * barrel, because `AppContext` reaches it during boot and that barrel exports
   * `chatCompactor`, which value-imports the `services/ai` barrel, which reaches
   * `services/geminiService`. Entering through the front door cost **156 KB gz
   * of eager payload** — the entire AI layer and the 5 400-line engine
   * downloaded before the login screen rendered, for one Firestore repository
   * object. `check:bundle-budget` is what tells this case from an ordinary deep
   * import, exactly as CLAUDE.md says: a barrel from lazy code, a file path from
   * boot-path code.
   */
  'services/architectureProjects -> services/chat': 1,
  'services/agent -> services/diagram': 1,
  'services/agent -> services/memory': 3,
  'services/agent -> services/quality': 1,
  'services/ai -> services/businessInitiatives': 1,
  'services/ai -> services/diagram': 1,
  'services/architectureKnowledgeGraph -> services/architectureOffice': 1,
  'services/architectureOffice -> services/ai': 2,
  'services/architectureOffice -> services/diagram': 1,
  'services/architectureOffice -> services/publicationPipeline': 1,
  'services/architectureProjects -> services/architectureOffice': 2,
  'services/architectureProjects -> services/memory': 2,
  'services/architectureProjects -> services/publicationPipeline': 3,
  'services/artifactCompiler -> services/quality': 3,
  'services/artifacts -> services/ai': 1,
  'services/artifacts -> services/diagram': 14,
  'services/artifacts -> services/export': 3,
  'services/artifacts -> services/quality': 5,
  'services/export -> services/diagram': 1,
  'services/export -> services/presentation': 1,
  'services/export -> services/quality': 11,
  'services/portfolioGraph -> services/architectureOffice': 3,
  'services/portfolioGraph -> services/businessInitiatives': 2,
  'services/publicationPipeline -> services/architectureKnowledgeGraph': 5,
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
 */
export const UI_SERVICE_FANOUT_BUDGET = {
  'components/ArtifactCanvas.tsx': 5,
  'components/artifacts/export/ArtifactExportModal.tsx': 4,
  'components/copilot/ProjectCopilotChatModal.tsx': 4,
  'pages/InitiativesPage.tsx': 4,
  'components/architectureOffice/EngagementIntakeWizard.tsx': 3,
  'components/architectureOffice/OfficeCapabilitiesPanel.tsx': 3,
  'components/artifacts/ArtifactInspectorPanel.tsx': 3,
  'components/AssistantPanel.tsx': 3,
  'pages/ProjectsPage.tsx': 3,
  'pages/Workspace.tsx': 3,
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
 * Los diecinueve que tenían dueño ya se han ido. Queda **uno**:
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
export const SERVICES_ROOT_BUDGET = 1;

/* ------------------------------------------------------------ the analysis */

const MODULES = MANIFEST.modules.map((m) => ({ ...m, prefix: `${m.path}/` }));
// Longest path first so `services/diagram` wins over the `services` catch-all.
const BY_SPECIFICITY = [...MODULES].sort((a, b) => b.path.length - a.path.length);
const LAYER_RANK = Object.fromEntries(MANIFEST.layers.map((l, i) => [l, i]));

const SOURCE_ROOTS = ['api', 'components', 'context', 'hooks', 'lib', 'pages', 'services', 'utils'];

export function sourceFiles() {
  const pathspec = SOURCE_ROOTS.map((root) => `"${root}"`).join(' ');
  return execSync(`git ls-files --cached --others --exclude-standard ${pathspec}`)
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.d\.ts$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file) && !file.includes('__tests__/'));
}

export const moduleOf = (file) => BY_SPECIFICITY.find((m) => file.startsWith(m.prefix));

/** A screen: a rendered file under `components/` or `pages/`. */
const isScreen = (file) => /\.tsx$/.test(file) && (file.startsWith('components/') || file.startsWith('pages/'));

const IMPORT_RE = /(?:^|[\s;}])(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

/** Every relative or `@/`-aliased specifier in the file, as repo-relative paths. */
function localImports(file) {
  const source = readFileSync(file, 'utf8');
  const out = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec.startsWith('.')) out.push(normalize(join(dirname(file), spec)));
    else if (spec.startsWith('@/')) out.push(normalize(spec.slice(2)));
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
  const api = mod.api.replace(/\.tsx?$/, '');
  return target === mod.path || target === api;
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
      const to = moduleOf(target.endsWith('/') ? target : `${target}/`)
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
  const { cycles, sccs, deepImports, layerViolations, fanout, examples } = analyse();
  const failures = [];
  const notes = [];

  for (const cycle of cycles) {
    if (!ALLOWED_CYCLES.includes(cycle)) failures.push(`cycle: ${cycle} is new`);
  }
  for (const recorded of ALLOWED_CYCLES) {
    if (!cycles.includes(recorded)) notes.push(`cycle: ${recorded} is broken. Remove it from ALLOWED_CYCLES.`);
  }

  checkStronglyConnected(sccs, failures, notes);

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
    if (!mod.api) continue;
    try {
      readFileSync(resolve(ROOT, mod.api), 'utf8');
    } catch {
      failures.push(`api: ${mod.name} declares ${mod.api} and the file is missing`);
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
