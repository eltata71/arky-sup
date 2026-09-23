# F5-01, corte 9 — nombres iniciales de artefactos

**Fecha:** 2026-09-23 · **Base:** `origin/main` tras fusionar #65.

`getInitialArtifactsForTemplate` ya no vive en `geminiService`: su prompt, el
esquema de respuesta y la lista de respaldo pasan a
`services/ai/generation/artifactTemplateSuggestions.ts`. La fachada
`artifactGenerationService` conserva la misma firma pública. La generación
usa `aiGateway`, con el transporte compartido, en vez de llamar al motor.

La respuesta del proveedor se comprueba antes de devolverla como `string[]`.
Si el proveedor falla o devuelve JSON con otra forma, se usan los dos nombres
deterministas. Este corte no retira todavía el último importador del motor:
los caminos de contenido, revisión y refinamiento siguen pendientes.

## Verificación

- `npx vitest run __tests__/services/ai/artifactTemplateSuggestions.test.ts` — 2 pruebas en verde.
- `npm run typecheck` — en verde.
- `npm run quality` — en verde: 474 archivos y 4 630 pruebas; cobertura
  66,85 % sentencias / 57,71 % ramas / 59,88 % funciones / 68,73 % líneas;
  carga inicial 309,4 KB gz de 340 permitidos. Tipos, strict, lint,
  presupuestos, fronteras y escáner de secretos en verde.
- `git diff --check` — en verde. El motor baja a 2 431 líneas.

## Riesgo y deuda

El motor todavía contiene el grueso de la generación de artefactos y su
dependencia ascendente sobre la Oficina y otros contextos. La siguiente
extracción deberá recibir esos datos por puertos antes de mover el código.
