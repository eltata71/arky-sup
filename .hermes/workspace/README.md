# Arky 10 — Espacio de trabajo de mantenimiento (Hermes)

Bienvenido al espacio de trabajo profesional para el mantenimiento de **Arky 10**
(React + Firebase + Gemini, frontend-only, despliegue Vercel).

## Objetivo

Mantener, evolucionar y proteger la aplicación con un flujo **productivo y
consistente**: misma puerta de calidad que el CI localmente, enrutamiento de
skills por tipo de tarea, y trazabilidad de cada intervención.

## Estructura del workspace

```
.hermes/
├── bin/
│   └── health.sh          # Script de diagnóstico del entorno (make health)
├── workspace/
│   ├── README.md          # Este archivo
│   ├── docs/              # (opcional) notas de mantenimiento por sesión
│   └── reports/           # Baselines y reportes de salud (make baseline)
```

## Herramientas de mantenimiento (`make <target>`)

| Comando | Descripción |
|---|---|
| `make health` | Diagnostica tools, deps, calidad y seguridad en un comando |
| `make baseline` | Guarda el reporte de salud con timestamp en `reports/` |
| `make quality` | typecheck + lint + test-ci (puerta rápida) |
| `make ci-check` | `quality` + build (igual que el CI de GitHub) |
| `make audit` | Revisa vulnerabilidades de dependencias |
| `make status` | Branch + cambios sin commit + últimos commits |
| `make new-feature` | Crea rama `feature/<nombre>` desde main actualizado |
| `make e2e-install` / `make e2e` | Playwright (navegadores + tests) |

## Baseline de calidad actual (2026-08-02)

Establecido al crear este workspace:

| Métrica | Estado |
|---|---|
| `typecheck` (tsc --noEmit) | ✅ 0 errores |
| `lint` (ESLint 9) | ✅ 0 errores, 100 warnings |
| Tests (Vitest) | ✅ 2195/2196 pasan (1 flaky por timeout 5s) |
| Build (Vite) | ✅ OK (warning: chunks >1MB, ver code-splitting) |
| `npm audit` | ⚠️ 15 vulnerabilidades (1 crítica, 9 altas) |

## Dudas/decisiones pendientes

- [ ] Resolver las 15 vulnerabilidades de dependencias (`npm audit fix` + verificar).
- [ ] Optimizar code-splitting (chunks de 2.4–2.6 MB → dynamic import / manualChunks).
- [ ] Investigar el test flaky `customArtifactRecommendation.test.ts` (timeout 5s).

## Reglas de oro del mantenimiento

1. `make ci-check` en verde antes de cualquier PR.
2. Arquitectura frontend-only; acceso a Firestore/Gemini solo vía `services/`.
3. TypeScript strict, sin `any`.
4. Cambios mínimos, trazables y testeables.
5. Documentar cada intervención y cualquier deuda técnica nueva.
