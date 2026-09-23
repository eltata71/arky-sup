# F5-01, corte 3 — sugerencias de mejora de artefactos

**Fecha:** 2026-09-23 · **Rama:** `codex/f5-01-corte-3` · **Base:**
`origin/main` en `888a69b`.

`suggestArtifactImprovements` salió de `services/geminiService.ts` a
`services/ai/generation/artifactSuggestions.ts`. El prompt se comparó con el
original y quedó idéntico; se conservaron el modelo `quick`, el esquema JSON,
`maxRetries: 1`, `maxCandidates: 4`, la limpieza del JSON y la validación
posterior en `artifactSuggestionService`. La inferencia usa `aiGateway`, que
delega al mismo transporte compartido. La fachada
`artifactGenerationService` conserva su método público.

| Medida | Antes | Después |
|---|---:|---:|
| Importadores directos de `geminiService` dentro de `services/ai` | 6 | 5 |
| Líneas del motor según el gate | 5081 | 4950 |
| Bytes del motor | 254655 | 247533 |
| `services (raíz) -> services/ai`, imports profundos | 11 | 10 |
| Tipos `any` | 17 | 17 |

## Verificación ejecutada

- `npx vitest run __tests__/artifacts/artifactSuggestionService.test.ts __tests__/services/ai/engineImporters.test.ts`: 11 pruebas en verde.
- `npm run quality`: `typecheck`, `typecheck:strict`, ESLint y todos los gates
  estáticos en verde; el límite de 600 s terminó durante cobertura, por lo que
  sus componentes restantes se ejecutaron por separado.
- `npm run test:coverage`: 470 archivos, 4543 pruebas en verde; 66,32 % de
  statements.
- `npm run build:placeholders`, `npm run check:bundle-secrets` y
  `npm run check:bundle-budget`: en verde; carga inicial 309,3/340 KB gzip.
- `npm run typecheck:strict` tras enrolar el módulo nuevo, y gates de tamaño y
  fronteras tras bajar sus presupuestos: en verde.
- `git diff --check`: en verde.

## Riesgo y deuda

El build sigue emitiendo el aviso ya registrado en
`docs/technical-debt-audit.md` sobre el reexport de
`artifactGenerationService` a través de `services/ai/index.ts` y chunks
circulares. El corte no modifica ese reexport; el build y el presupuesto pasan.
No se añadieron migraciones ni cambió el esquema. F5-01 sigue abierto hasta
extraer las cinco verticales restantes y romper la arista del motor.
