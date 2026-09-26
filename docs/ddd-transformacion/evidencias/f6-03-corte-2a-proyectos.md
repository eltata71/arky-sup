# F6-03 · Corte 2a — Proyectos de Arquitectura con la forma del contexto piloto

**Fecha:** 2026-09-26 · **Rama:** `codex/f6-03-proyectos-dominio`

F6-03 pide repetir en el resto de contextos lo que Iniciativas estrenó en
F3-05 (`09-cierre-fase-3.md`, «El patrón, para el siguiente contexto»). La
verificación final lo midió: sólo Iniciativas tenía la forma completa. Este
corte hace la mitad estructural en Proyectos. La otra mitad, las operaciones
con nombre en lugar de `updateProject(parcial)`, es el corte 2b.

## Qué se movió, y por qué cada cosa va donde va

| Carpeta | Ficheros | Criterio |
|---|---|---|
| `domain/` | `ArchitectureProjectTypes`, `architectureProjectFactory`, `attentionTracking`, `projectDocumentMapper`, `projectRuntimeValidation` y la puerta `index.ts` | Reglas y formas: el agregado y su modelo de lectura, la fábrica, la lectura de lo almacenado y el seguimiento. Ninguno hace E/S |
| `infrastructure/` | `SupabaseProjectRepository`, `projectReads`, `projectWrites`, `projectCache`, `ArchitectureProjectRepository`, `graphProjectionPorts` | Todo lo que habla con la base, la caché o el espejo local |
| `application/` | `graphProjectionRecovery` | Orquesta puertos: no hace E/S por sí mismo, pero decide qué se guarda y en qué orden, que no es regla del agregado |

Se movieron doce ficheros y git los reconoce como renombrados, así que la
historia de cada uno se conserva. Otros 23 ficheros cambiaron sólo la ruta de
sus imports, con un script que resuelve cada ruta relativa antes y después
del movimiento. El barril del módulo entra ahora por la puerta del dominio, y
`modules.json` la declara.

**Sin cambio de comportamiento:** la carga inicial sigue en 310,1 KB gz, y
`typecheck`, `lint` y las fronteras están limpios.

## La prueba de pureza, generalizada

`__tests__/architecture/contextDomainPurity.test.ts` sustituye, para todos los
contextos, la idea de la prueba de F3-05. Aquélla miraba los imports
**directos** de `domain/` contra una lista de carpetas. Ésta sigue el **cierre
de imports de valor** con el analizador de TypeScript, y falla si por algún
camino se alcanza persistencia, adaptadores, observabilidad, identidad, React,
una pantalla, la propia `infrastructure/` o un paquete que no sea `uuid`.

La diferencia es deliberada y se midió. El modelo de lectura de un proyecto
contiene el grafo de conocimiento y los paquetes de publicación, así que su
dominio **lee vocabulario de otros contextos**: tipos, y dos funciones puras de
memoria y publicación. Prohibir eso no protegería nada. Lo que se protege es
que ninguna regla pueda hacer E/S.

Tres comprobaciones de la prueba misma:

1. **Un falso positivo, corregido.** `import('…').ArchitectureGraph` en
   posición de tipo parecía un `import()` que se ejecuta. Ahora sólo cuenta la
   llamada real (`CallExpression` con `ImportKeyword`), y el tipo, que el
   compilador borra, no.
2. **Un caso negativo real.** Con un import de `infrastructure/projectCache`
   añadido temporalmente al dominio, la prueba falla y muestra el camino
   exacto (`domain/index.ts → domain/attentionTracking.ts →
   infrastructure/projectCache.ts`).
3. **Una comprobación de que ve a través de ficheros.** Partiendo de la
   infraestructura, el cierre encuentra la persistencia.

`CONTEXTS` sólo crece. Hoy lista Iniciativas y Proyectos; los cortes 3 y 4
añadirán la Oficina y los Artefactos.

## De paso

- **Todo el dominio de Proyectos entra en `typecheck:strict`**
  (`services/architectureProjects/domain/**/*.ts`). Antes estaban tres de sus
  cinco ficheros, y los otros dos ya cumplían.
- **Se quitó de `tsconfig.strict.json` una entrada que no cubría nada**:
  `services/architectureProjects/artifactDocumentMapper.ts`, un fichero que no
  existe.
- **Tres guardas nombraban rutas** (`noRevisionCache`, `noAggregateLiterals` y
  `moduleBoundaries`). Se actualizaron sin relajar lo que vigilan. Se comprobó
  que `noRevisionCache` recorre las subcarpetas, así que sigue viendo el
  repositorio en su nueva ubicación.
