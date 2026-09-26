# F6-03 · Corte 4 — Artefactos, y los cuatro agregados con la forma del piloto

**Fecha:** 2026-09-26 · **Rama:** `codex/f6-03-artefactos-dominio`

## La única regla impura era la fábrica

Clasificado por cierre de imports de valor, como en el corte 3. La fábrica del
agregado (`artifactFactory`) llegaba a E/S por un solo import: recompilaba con
`recompileArtifactBeforePersist` y `attachCompilerSummary`, del barril del
compilador, que registran en observabilidad una compilación degradada.

La compilación es pura (`compileArtifact`); lo que no lo es es el registro. El
arreglo separa las dos cosas **sin cambiar el comportamiento de nadie**:

- `services/artifactCompiler/recompileCore.ts`, declarado como puerta:
  `recompileArtifact` hace el mismo recompilado, pero **describe** la
  degradación en el resultado (`degradation: failed-status | threw`) en vez de
  registrarla.
- `recompileArtifactBeforePersist` es ahora el núcleo más el registro, con los
  mismos mensajes y metadatos. Sus llamantes no notan nada.
- La fábrica recibe el compilador como puerto (`ArtifactCompilePort`). Si no
  se lo dan, usa el puro. `artifactWorkflow`, que es quien persiste y pasa
  por él en las cuatro llamadas a la fábrica, le entrega el que registra. **El
  aviso de compilación degradada sigue saliendo exactamente donde salía.**

## El reparto

| Carpeta | Ficheros |
|---|---|
| `domain/` | 21: la fábrica, el contrato de generación, el brief, los compiladores de presentación, los fallbacks deterministas, la detección de fallbacks, el rastro de la generación, los flags |
| `application/` | 7 más, junto a los 4 que ya había: la ejecución de la generación, el refinamiento y la extracción del brief (usan IA), el pipeline, los fallbacks de generación, el controlador de vistas y la exportación (usan librerías de maquetación o de render) |
| `infrastructure/` | 3: el repositorio, los comandos de Supabase, la persistencia |

El barril exporta **con nombre y de forma selectiva**, a propósito (la regla
del barril contra el bundle). Se mantuvieron los mismos nombres, llegando
ahora por la puerta `./domain`. La carga inicial no se movió: **310,9 KB gz**.

## Una regla nueva en la prueba de pureza: la dirección

El cierre de imports de valor no ve los `import type`, y eso está bien para la
E/S, porque un tipo no ejecuta nada. Pero un tipo sí puede **invertir la
dependencia**. `domain/artifactGenerationTrace.ts` importaba
`ArtifactRefinementMode` de `application/artifactRefinementOrchestrator`, y por
ese camino la comprobación de tipos del dominio arrastraba el motor de IA.

La regla nueva dice que un fichero de `domain/` no importa nada de su propia
`application/` ni de su `infrastructure/`, **ni siquiera un tipo**. Encontró
dos casos:

- Artefactos: `ArtifactRefinementMode`, que ahora vive en
  `domain/artifactGenerationTrace.ts`.
- La Oficina, que se escapó en el corte 3: `OfficeWorkstreamResult`, que ahora
  vive en `domain/officeConsolidationReview.ts`, junto a quien lo evalúa.

En los dos casos el orquestador importa y reexporta el tipo desde el dominio.
Se comprobó con un caso negativo: un `import type` de `application/` añadido a
un fichero del dominio hace fallar la prueba y la nombra.

## `strict`

El dominio de Artefactos entra entero. Faltaba un segundo import de tipo por un
barril: `artifactGenerationSupport` tomaba el puerto `ArtifactGenerationSupport`
del barril de `services/ai`. Ahora lo toma de su fichero de declaraciones,
declarado como puerta. Los dominios de Proyectos, Oficina y Artefactos están
completos en `typecheck:strict`.

## Pruebas y coste

- `contextDomainPurity.test.ts` cubre cuatro contextos, con seis
  comprobaciones cada uno.
- Suite: **493 ficheros y 4 802 pruebas**, todas pasando. Carga inicial 310,9
  KB gz.
- Cinco techos de bytes suben entre 12 y 132 bytes por rutas más largas; el
  mayor es el orquestador, por el import del tipo que bajó al dominio. Cada
  uno lleva su razón.

## F6-03, cerrada para los cuatro agregados

| Agregado | Contexto | Corte |
|---|---|---|
| Iniciativa | `businessInitiatives` | piloto (F3-05) |
| Proyecto | `architectureProjects` | 2a y 2b |
| Encargo | `architectureOffice` | 3 |
| Artefacto | `artifacts` | 4 |

Los módulos de apoyo (`learning`, `review`, `publicationPipeline`,
`settings`, `chat`…) quedan en la deuda residual como **R-15**, con la razón:
o no tienen un agregado con reglas propias, o sus reglas ya son funciones
puras en su fichero.
