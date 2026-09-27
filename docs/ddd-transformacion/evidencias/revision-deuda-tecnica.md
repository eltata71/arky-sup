# Revisión de deuda técnica antes del cierre

**Fecha:** 2026-09-26/27 · **Rama:** `codex/deuda-tecnica` · Pedida por el
propietario antes de F6-09.

## Cómo se buscó

No se partió de las listas, sino de mediciones sobre el código actual.
`docs/technical-debt-audit.md` y `13-deuda-residual.md` se usaron como pista y
se contrastaron con lo que había:

| Búsqueda | Comando o método | Resultado |
|---|---|---|
| Marcadores de deuda | `grep` de `TODO`, `FIXME`, `HACK`, `XXX` | 16, **ninguno real**: son la lógica que detecta marcadores en los documentos generados |
| Código muerto | `tsc --noEmit --noUnusedLocals --noUnusedParameters` sobre todo el repositorio | **65**: 7 en producción y 58 en pruebas |
| Dependencias | `npm audit` y búsqueda de imports por dependencia | 0 vulnerabilidades; **una dependencia sin uso**: `react-zoom-pan-pinch` |
| Imports profundos | clasificados por el analizador de TypeScript | **165**, de ellos **51 sólo de tipos** |
| Barriles que publican infraestructura (H04) | consumidores externos de cada implementación publicada | 9 nombres publicados y **sin ningún consumidor fuera** de su módulo |
| Ficheros grandes | techos de `check:module-size` | 58 por encima del tamaño por defecto, cada uno con techo propio que sólo baja |
| Deuda residual abierta | `13-deuda-residual.md` | R-08 (URLs firmadas sin prueba) y R-14 (migraciones sin reversión) se pueden cerrar sin decisiones |

Dos puntos vivos de `technical-debt-audit.md` ya no lo estaban: la «revisión
guiada» pendiente (M-7) no existe en el código, y el nombre del paquete (L-1)
es `arkypro`.

## Qué se corrigió

1. **Dependencia muerta.** `react-zoom-pan-pinch` salió de `package.json` y
   del lockfile, con 16 líneas y nada más. El primer `npm uninstall` podó además
   `lightningcss` y sus binarios de plataforma, 302 líneas que nada tenían que
   ver con esto. Se restauró el lockfile y se quitó sólo la entrada; `npm ci`
   confirma que es coherente.
2. **Código muerto a cero, y regla para que siga así.**
   - En el motor había cuatro métodos privados que nadie llamaba, con sus
     imports.
   - Tres parámetros exigidos por una firma pasan a `_`.
   - En las pruebas, 56 imports sin usar se quitaron con el árbol sintáctico,
     especificador a especificador, y dos variables se corrigieron a mano.
   - **`noUnusedLocals` y `noUnusedParameters` están ahora en `tsconfig.json`**:
     el código muerto vuelve a fallar `typecheck` en todo el repositorio, no
     sólo en la zona estricta.
3. **Imports profundos: 173 → 127** (−46) y 16 presupuestos bajados en
   `DEEP_IMPORT_BUDGET`.
   - Los imports sólo de tipos entran ahora por la puerta del módulo; se
     borran al compilar, así que no cuestan nada en el bundle.
   - Once tipos que otros módulos ya usaban por ruta se publican en su barril
     con `export type`.
   - Los dominios se dejaron fuera a propósito: allí un tipo por un barril
     pesado arrastra el módulo entero a `strict` (cortes 3 y 4 de F6-03).
4. **H04, barriles con infraestructura (R-10).** `settings`, `learning`, la
   Oficina y `review` dejan de publicar sus implementaciones de Supabase y
   repositorios concretos. Las pruebas de esas implementaciones las importan
   ahora de su fichero, como corresponde. Queda una a propósito
   (`createSupabaseKnowledgeGraphRepository`, que usa la infraestructura de
   Proyectos), anotada en R-10.
5. **T-01, URLs firmadas (R-08).** La convención pasa a ser una prueba
   (`noPersistedSignedUrl.test.ts`):
   - sólo dos ficheros piden una URL firmada;
   - el que la pide la usa para abrir el archivo y no la guarda;
   - el documento guarda la ruta, no una URL;
   - ninguna migración tiene una columna de URL firmada.

   El invariante pasa a ✅ (37 de 43).
6. **R-14, reversión de migraciones.** Un anexo en `runbook-migraciones.md`
   con, para cada una de las 8 migraciones que no la traían:
   - qué hizo;
   - su reversión como migración nueva;
   - **qué reabriría**: cinco cierran hallazgos de seguridad o consistencia.

   Las migraciones de origen citadas se comprobaron una a una, y tres estaban
   mal en el primer borrador.

## Una corrección sobre cifras anteriores

La carga inicial de esta rama es **311,2 KB gz**, igual que `main` medido por
el CI. Las cifras de 310,1 a 310,9 de los cortes de F6-03 se midieron sobre un
`node_modules` local desviado del lockfile (`vendor-react` 58,4 frente a 58,7).
Las **diferencias** que se reportaron siguen siendo válidas, porque se midieron
en el mismo entorno; las **cifras absolutas** estaban 0,3 KB por debajo. Desde
ahora, un número de bundle se mide tras `npm ci`.

## Lo que no se tocó, y por qué

| Deuda | Por qué no aquí |
|---|---|
| R-13: eliminar `api.record_arb_decision` (ya revocada) | Es una migración: necesita la aprobación del propietario |
| E-01: que el servidor exija iniciativa en un encargo | Migración: aprobación |
| R-02, R-03: `charter:approve` y el historial de chat | Decisiones de producto pendientes del propietario |
| R-09: la IA se descarga al abrir ocho rutas | Es un cambio de diseño (carga en el primer uso) con riesgo en la captura asistida y el asistente. Tiene techo por ruta que impide que empeore |
| R-12: la función de ~900 líneas del motor | Descomposición con riesgo de regresión en la generación. Tiene techo de tamaño; se hará al añadir el próximo tipo de artefacto |
| Los 58 ficheros sobre el tamaño por defecto | Cada uno tiene techo propio que sólo baja; partirlos sin una razón funcional sería movimiento sin separación |

## Verificación

- `quality:static` limpio, con fronteras, tamaños, `any` en 7 y `strict`.
- Suite: **494 ficheros y 4 806 pruebas**, todas pasando.
- Build y presupuestos en verde: carga inicial 311,2 KB gz de 340, y todas las
  rutas bajo su techo.
