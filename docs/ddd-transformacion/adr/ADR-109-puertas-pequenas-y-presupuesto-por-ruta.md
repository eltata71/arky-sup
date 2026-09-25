# ADR-109 — Una ruta diferida entra por una puerta pequeña cuando el barril carga lo que no usa, y cada ruta tiene techo de descarga

**Fecha** 2026-09-25 · **Estado** aceptada · **Tareas** F6-05 (y el incidente
de F6-04) · **Evidencia** `evidencias/f6-05-rendimiento-concurrencia.md`,
`evidencias/f6-04-flujos-criticos.md`

## Problema

La regla vigente decía «un barril desde código diferido, una ruta de fichero
desde código de arranque», y el presupuesto de bundle sólo medía el arranque.
Las dos cosas eran correctas para lo que miraban, y ciegas a lo demás.

Medido el 2026-09-25, **el Dashboard —la página donde aterriza todo el mundo
tras iniciar sesión— descargaba 617,6 KB gz además de la carga inicial.** Su
hook entraba en `services/architectureOffice` por el barril. El barril
reexporta la orquestación de la Oficina, cuyos módulos construyen singletons
al cargarse y que el tree-shaking, por tanto, no puede quitar, y por ella llegaban el ejecutor del agente, ELK
y el SDK de Gemini, en un único chunk de 517 KB gz. Agentes (610,6) y
Configuración (569,3) pagaban lo mismo sin llamar nunca a un modelo.

El mismo día, F6-04 encontró la otra mitad del problema. El chunk del
Workspace se descargaba con un 200 y **fallaba al evaluarse**, y producción
estuvo caída en esa ruta. Ningún presupuesto de tamaño mira eso.

## Decisión

1. **Una ruta que necesita la parte ligera de un módulo cuyo barril carga la
   pesada entra por una puerta pequeña declarada en `modules.json`.** Es el
   patrón de F3-06. Hoy son tres:
   - `services/architectureOffice/portfolio.ts`;
   - `services/architectureOffice/agents.ts`;
   - `services/ai/generation/providerModelDirectory.ts`.
   Cada una dice en su cabecera qué no puede alcanzar.
2. **Cada ruta tiene techo de descarga** (`ROUTE_BUDGETS_GZIP_KB` en
   `check:bundle-budget`). Se mide como el cierre de imports estáticos de sus
   chunks, menos la carga inicial. Una ruta ausente del build falla; nunca
   cuenta como cero.
3. **Cada chunk del build se evalúa en un navegador** (`e2e/chunks.spec.ts`).
   Una descarga que funciona y una evaluación que lanza son fallos distintos,
   y sólo el segundo tumbó producción.

## Alternativas descartadas

- **Aligerar el barril de la Oficina.** Los consumidores legítimos de la
  orquestación (el asistente, el runner) la necesitan por esa puerta. Partir
  el barril en dos cambiaría los 18 imports de valor que la UI hace hoy de
  él para arreglar tres rutas.
- **`sideEffects: false` en `package.json`.** El núcleo de IA construye sus
  singletons al cargarse (`new AIProviderFactory()`, `new AIRequestExecutor()`,
  `new ArtifactGenerationEngine()`), y por eso Rollup no puede darlos por
  libres de efectos. Declarar lo contrario es apostar a que ningún módulo del
  repositorio depende de lo que ocurre al cargarse. El incidente de F6-04 fue
  exactamente eso: el singleton del servicio de revisión construido durante la
  carga del barril.
- **Presupuestar sólo el total.** La suma de rutas no dice cuál empeoró.

## Consecuencias

- Dashboard 617,6 → 48,9, Agentes 610,6 → 42,1 y Configuración 569,3 → 20,5
  KB gz.
- **Ocho rutas siguen en ~600 KB gz** porque sí llaman a un modelo: la captura
  asistida y el asistente. Bajarlas exige cargar la IA en el primer uso, un
  cambio de diseño registrado en F6-08. Sus techos fijan la cifra de hoy.
- Qué hacer cuando una ruta no carga en producción:
  `docs/operacion/runbook-ruta-no-carga.md`.
