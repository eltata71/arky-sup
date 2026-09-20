# ADR-104 — El gate de fronteras mide alcanzabilidad, no sólo pares

**Fecha** 2026-09-20 · **Estado** aceptada · **Contexto** herramienta de build

## Problema

`scripts/checkModuleBoundaries.mjs` declara un ciclo sólo si dos módulos se
importan mutuamente. Con esa definición el repositorio tiene «0 ciclos entre
contextos de dominio» y el gate está verde, mientras **nueve contextos de
dominio son mutuamente alcanzables** por 22 aristas.

Un gate que mide una propiedad más débil que la que su documentación afirma es
peor que no tener gate: produce confianza sin cobertura.

## Decisión

1. `analyse()` calcula los **componentes fuertemente conexos** (Tarjan) del
   mismo grafo de aristas que ya construye.
2. `ALLOWED_SCCS` registra los componentes de hoy con su **tamaño exacto**. Un
   componente nuevo, o uno registrado que crece, falla el gate. Que encoja, no.
3. `ALLOWED_CYCLES` se conserva: un ciclo de dos es un caso particular, y su
   presupuesto por pares es más fino que el del componente.
4. `--report` imprime ambos, para que actualizar un presupuesto sea copiar una
   salida y no editar a mano.

## Por qué el gate no empieza en rojo

Un gate que entra fallando se desactiva. Los dos componentes actuales se
registran tal cual y la única regla nueva es **monótona**: no pueden crecer. La
fase 5 los reduce; el presupuesto va bajando con ella.

## Consecuencia

La afirmación de `CLAUDE.md` sobre ciclos deja de ser cierta con la definición
nueva y se corrige en el mismo cambio.
