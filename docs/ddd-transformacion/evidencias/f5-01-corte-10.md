# F5-01, corte 10 — crítica y refinamiento previo a persistir

**Fecha:** 2026-09-23 · **Base:** `main` en `1195ffc` (#66 fusionada).

`critiqueArtifactContent` y `refineArtifactContent` salen de
`services/geminiService.ts` a
`services/ai/generation/artifactQualityRefinement.ts`. La fachada
`artifactGenerationService` conserva las firmas. Los prompts, temperaturas,
reintentos y límites de candidatos se mantienen; la llamada pasa por
`aiGateway`. El orquestador de artefactos conserva el control de cuándo pedir
la crítica, qué candidato aceptar y cómo fallar sin bloquear la generación.

El motor baja de 2 431 a 2 330 líneas (contador del gate). Su techo se baja a
2 330 líneas / 121 681 bytes. `artifactGenerationService` aún lo
importa para contenido, revisión y mejoras posteriores, así que la arista
`services/ai -> services (raíz)` permanece. El próximo corte debe seguir
reduciendo esas rutas antes de retirar el último importador.

La extracción dejó visibles dos `any` que el escáner léxico ocultaba por los
backticks de un prompt. Las firmas de configuración del transporte y el objeto
de configuración del modelo se tiparon con `unknown`; el presupuesto baja de
13 a 11. El motor queda sin tipos `any`.

## Verificación

- `npx vitest run __tests__/services/ai/artifactQualityRefinement.test.ts __tests__/artifactRefinementOrchestrator.test.ts` — 31 pruebas en verde. Los tests del orquestador ahora espían la fachada, la puerta que realmente llama el dominio.
- `npm run quality` — en verde: 475 ficheros y 4 635 pruebas; cobertura
  66,88 % sentencias / 57,74 % ramas / 59,93 % funciones / 68,76 % líneas;
  carga inicial 309,4 KB gz de 340 permitidos. Tipos, strict, lint,
  presupuestos, fronteras y escáner de secretos en verde.

## Riesgo y deuda

Mover la generación principal exige cortar dependencias ascendentes con
Oficina, grafos y calidad; este corte no altera esa ruta. Las pruebas del
orquestador cubren la aceptación segura del candidato y la degradación cuando
la llamada de IA falla.
