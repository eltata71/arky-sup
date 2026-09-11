# F0.4 — Auditoría de arquitectura: monolito modular y DDD (diagnóstico)

Base: `8731fcdd9af7a5ee57eaaf3049b162ef722e55d7`, `/home/tata/workspace/arky-sup`.
Solo diagnóstico: no se modificó código, dependencias, configuración ni git.
Los documentos históricos de deuda se usan como contexto, no como métricas vigentes.

## 1. Dictamen

El repositorio declara su modularidad en `modules.json` y la defiende con gates
mecánicos. El estado medido en esta fase es:

- `npm run check:module-boundaries`: pasa, pero dentro de presupuestos que
  aceptan deuda conocida.
- `npm run check:module-size`: pasa, con techos por archivo que aceptan archivos
  grandes existentes.
- `npm run check:any-budget`: pasa con 23 `any` presupuestados.
- `npm run quality`: exit 0 el 2026-09-11; 432 archivos de test pasados, 1
  omitido; 4222 tests pasados, 59 omitidos; build y controles de bundle OK.
- `npm run test:rules`: 59/59 contra emulador Firestore.
- El agregado Proyecto de Arquitectura ya tiene invariante fuera de la UI y
  repositorios por contexto sobre `services/persistence`, pero la deuda que
  impide DDD completo sigue vigente: `services/geminiService.ts` de 5413 líneas,
  accesos Firebase repartidos por repositorios y UI que entra a servicios por
  rutas internas.

Pasar los gates significa que la deuda no creció respecto al presupuesto, no que
desapareció.

## 2. Evidencia y comandos ejecutados por el coordinador

| Medición | Resultado |
| --- | --- |
| `npm run check:module-boundaries` | OK; 4 ciclos permitidos, 0 violaciones de capa registradas, presupuesto extenso de deep imports y fan-out UI |
| `npm run check:module-size` | OK; techo general 500 líneas / 20000 bytes, con excepciones registradas |
| `npm run check:any-budget` | OK; 23 `any`: 16 `services/geminiService.ts`, 6 `components/ExcalidrawViewer.tsx`, 1 `components/routing/lazyWithRetry.ts` |
| `npm run quality` | Exit 0; evidencias `docs/fase-0/evidencias/quality.log` y `quality.exit` |
| `wc -l services/geminiService.ts` | 5413 líneas |
| Archivos grandes medidos | `ReactFlowCanvas.tsx` 1938, `diagramPrompts.ts` 1121, `pdfExporter.ts` 1118, `ArtifactCanvas.tsx` 1067, `ProjectHub.tsx` 1061, `agentExecutor.ts` 1000, `ProjectsPage.tsx` 923, `mermaidToIR.ts` 850 |
| Búsqueda `from 'firebase'` en TS/TSX | 24 coincidencias archivo por archivo; concentradas en repositorios, identidad, persistencia y una prueba que prohíbe SDK en UI |
| `modules.json` | 32 módulos declarados en capas `ui`, `domain` y `foundation` |
| `tsconfig.strict.json` | Strict progresivo; ya no representa solo 11 archivos, incluye reglas adicionales para módulos enrolados |
| E2E Playwright | Chromium en curso con variables CI; webkit bloqueado por dependencias del host documentadas en `f03-browser-probe.log` |

## 3. Hallazgos vigentes

### ARQ-01 — Los ciclos presupuestados siguen siendo acoplamiento real (alta)
`scripts/checkModuleBoundaries.mjs:41-46` permite:

```text
components <-> context
components <-> hooks
context <-> hooks
services (raíz) <-> services/ai
```

El comentario dice que los pares UI son la forma ordinaria de React y que los
ciclos entre contextos reales se rompieron en una ola anterior. Aun así, un
ciclo permitido sigue impidiendo razonar, probar o mover un lado sin el otro.
Además `SERVICES_ROOT_BUDGET = 1` acepta que quede un archivo suelto en la raíz
de servicios; la medición actual muestra `services/geminiService.ts` como único
sueltto, precisamente el archivo más acoplado del sistema.

Evidencia:

- `scripts/checkModuleBoundaries.mjs:41-46,250`
- `services/geminiService.ts`: 5413 líneas
- `modules.json:61-66`: la raíz de servicios conserva el comentario sobre ciclos
  con once módulos cuando hay archivos sueltos

Implicación para Supabase/DDD: mientras el motor de IA viva fuera de un módulo
y con ese tamaño, no hay un puerto de IA creíble ni un contexto propietario
claro.

### ARQ-02 — Capa UI entra a internals de dominio por presupuesto (alta)
`DEEP_IMPORT_BUDGET` contiene decenas de pares `origen -> destino`, con focos
importantes desde `components` hacia `architectureOffice`, `artifacts`,
`diagram`, `businessInitiatives` y `quality`, además de entradas desde `context`,
`hooks`, `pages` y la raíz de servicios.

Esto confirma el hallazgo histórico de aplicación alojada en UI, aunque ya con
presupuesto decreciente. Cada entrada profunda acopla una pantalla a una
decisión interna no publicada. Para la migración, cada corte vertical debe mover
la pantalla desde el internal hacia el `index.ts` del módulo o hacia un caso de
uso.

Evidencia:

- `scripts/checkModuleBoundaries.mjs:114-...`
- `modules.json:36-59`: APIs públicas declaradas por módulo de dominio

### ARQ-03 — `geminiService` concentra motor, dominio y dependencias (alta)
5413 líneas en la raíz de servicios, 16 de los 23 `any`, y motor real de IA
fuera del barril canónico `services/ai`. Las reglas del proyecto ya prohíben que
el barril reexporte lo que la capa esconde, pero el monolito sigue siendo la
dependencia directa de una parte del sistema.

No se propone dividirlo en esta fase. Es el principal bloqueante para strict
completo, pruebas finas, puertos de IA y sustitución segura de proveedores.

Evidencia:

- `services/geminiService.ts`
- `docs/fase-0/evidencias/quality.log`: distribución de `any`
- `AGENTS.md`: reglas 4, 11 y 13 sobre strict, barriles y kernel de IA

### ARQ-04 — Firebase está aislado por convención, no por puerto único (alta)
La búsqueda de imports Firebase muestra alrededor de 24 puntos de contacto en
repositorios e identidad, más `firebase.ts` central. Hay una prueba que prohíbe
el SDK en capas UI (`__tests__/authz/noSdkInUiLayers.test.ts`), pero cada
repositorio conoce directamente el SDK. Por tanto, migrar a Supabase tocando
cada repositorio repetiría el mismo acoplamiento con otro proveedor.

La tarea F3.1/F3.2 del plan —puertos de persistencia/identidad/archivos y
adaptadores intercambiables— sigue pendiente y es previa al primer corte de
datos.

### ARQ-05 — Strict es progresivo, no completo (media)
`tsconfig.json` más `tsconfig.strict.json` ya aplican strict amplio y controles
adicionales a módulos enrolados. Queda deuda en el monolito de IA y en
persistencia Firestore. El presupuesto de `any` baja solo si alguien lo reduce
explícitamente.

Esto es compatible con calidad actual, pero no permite declarar tipado
completo como objetivo cumplido.

### ARQ-06 — Tamaños grandes bajo techo individual (media)
El gate de tamaño acepta archivos de ~800 a 1938 líneas mediante techos
individuales. El riesgo no es solo el número: pantallas y servicios grandes
concentran orquestación, estado y render, lo que dificulta cortes verticales
limpios.

Casos medidos en §2: `ReactFlowCanvas`, `ArtifactCanvas`, `ProjectHub`,
`agentExecutor`, `ProjectsPage`, `mermaidToIR`, exportadores y tipos de
publicación.

### ARQ-07 — Persistencia por contexto con fachada común, pero sin puertos propietarios (media)
`services/persistence/index.ts` ya ofrece resultado común, borradores locales y
rutas de colección. Hay repositorios específicos para iniciativas, proyectos,
encargos, artefactos, chat, revisión y configuración.

Queda por verificar que cada agregado tenga un único repositorio propietario,
límites transaccionales explícitos y que ningún contexto escriba datos de otro.
Esa verificación pertenece a F1/F5, no a este diagnóstico estático.

### ARQ-08 — Tandem UI `components/context/hooks` (baja-media)
Los tres ciclos UI permitidos son deuda arquitectónica aceptada, no un defecto
funcional inmediato. Se mantienen fuera de la ruta crítica de Supabase, pero no
deben copiarse como patrón para nuevos módulos.

## 4. Límites

- No se reejecutó el análisis histórico completo de 23/37 ciclos: el gate actual
  demuestra ausencia de nuevas violaciones, no el censo original.
- No se inspeccionaron datos productivos, sesiones reales ni despliegue.
- No se midió complejidad ciclomática con herramientas externas ni se instaló
  software global.
- La auditoría de seguridad paralela (`auditoria-seguridad.md`) y el inventario
  funcional (`inventario-funcional-datos.md`) son documentos separados; aquí no
  se repiten sus hallazgos.
- El resultado E2E se consolida en `pruebas-integracion.md`; esta auditoría no
  declara su resultado.

## 5. Entradas directas al backlog F0.6

1. Extraer el motor de IA del archivo suelto hacia `services/ai` con puertos y
   casos de uso, sin cambiar comportamiento.
2. Convertir deep imports de pantallas en consumo de API pública o casos de
   aplicación, empezando por `architectureOffice`, `artifacts` y `diagram`.
3. Introducir puertos de repositorio/identidad/archivos antes del piloto
   Supabase.
4. Reducir `any` con justificación explícita y ampliar strict por módulo.
5. Romper o encapsular el ciclo `services (raíz) <-> services/ai` al mover el
   monolito.
6. Revisar techos individuales de tamaño cuando un archivo se toque.
7. Definir propietarios transaccionales por agregado en F1.
