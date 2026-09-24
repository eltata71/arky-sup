# F6-01, primer corte — ficheros sin consumidor

**Fecha:** 2026-09-25 · **Base:** F6-03 corte 1 (#76).

Seis ficheros de código que nada importaba, ni una prueba:

| Fichero | Qué era |
|---|---|
| `components/ReviewArchitectureModal.tsx` | un marcador **vacío, de 0 líneas**, que `CLAUDE.md` tenía que advertir que no se usara |
| `components/InteractiveGraph.tsx` | un componente que devolvía `null` |
| `components/AddArtifactModal.tsx` | 135 líneas, sustituido por el flujo de creación actual |
| `components/BoardView.tsx` | 114 líneas, sin ruta ni pantalla que lo monte |
| `components/VersionHistoryPanel.tsx` | 89 líneas, sustituido por el historial del lienzo |
| `services/artifacts/tablePresentationCompiler.ts` | una línea: reexportaba `compileTablePresentation` de otro fichero |

Se buscaron por nombre en todo el repositorio antes de borrarlos. La única
mención era el inventario de almacenamiento de `docs/fase-6/evidencias/`, que
es una **foto fechada** (2026-09-19) y se deja como está: regenerarla reescribía
la evidencia de otra fase con cambios que nada tienen que ver con éste.

## Lo que impide que vuelva

`__tests__/architecture/noOrphanModules.test.ts` resuelve los imports de todo el
repositorio, pruebas incluidas, y falla si un fichero de código no lo importa
nadie. Tiene una lista de excepciones con nombre (los arranques de Vitest, los
tipos generados y cinco barriles publicados), y también falla si una excepción
deja de existir o empieza a importarse, así que la lista no acumula restos.

## Lo que queda de F6-01

«Rutas antiguas» es más ancho que ficheros muertos. Quedan por revisar, y cada
uno toca el despliegue o una API, así que va en su propio corte: el proxy
heredado `api/gemini.ts` (`VITE_GEMINI_PROXY_URL`), que convive con el
agnóstico `api/ai.ts`, y los métodos públicos del motor que ya sólo usan las
pruebas (`generateContentWithFallback`, `isOpenRouterConfigured`).
