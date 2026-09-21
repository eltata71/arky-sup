# Contrato operativo de producción

**Fuente de verdad legible por CI:** `docs/operacion/despliegue.json`.
Este documento explica el contrato para personas; el JSON evita que el proyecto,
identificador o alias se dupliquen entre el guard y sus pruebas.

| Campo | Valor canónico |
|---|---|
| Repositorio que entrega | `eltata71/arky-sup` |
| Rama de producción | `main` |
| Proyecto Vercel | `arky-sup` |
| Identificador Vercel | `prj_Sr0cq7A21ZX8MfEmyLBbEkpO0Bfk` |
| Equipo Vercel | `team_HGSWQHORpMV8wQUQf3mAdWEl` |
| Alias estable de producción | `https://arky-sup.vercel.app` |
| Publicador único | trabajo `deploy` de `.github/workflows/ci.yml` |

## Regla de entrega

`PR → checks requeridos → merge a main → CI (quality + cobertura) → deploy → smoke`.

La integración Git de Vercel queda desactivada **sólo para `main`** en
`vercel.json`; mantiene previews de las PR. No se publica producción desde una
estación de trabajo ni desde un proyecto Vercel distinto.

El job `deploy` ejecuta `vercel pull` con los secretos ya configurados y, antes
de construir o publicar, `scripts/deploy/assertDeploymentTarget.mjs` compara el
proyecto resuelto con este contrato. Una discrepancia termina el job antes del
despliegue: el cambio de secreto, proyecto o alias requiere actualizar este
contrato, `CLAUDE.md`, `AGENTS.md`, las pruebas y una PR revisable.

## Sincronización obligatoria

Al cambiar arquitectura, automatización, destino Vercel, alias o procedimiento de
merge/despliegue, la misma PR actualiza:

1. este contrato;
2. `docs/ci-cd-pipeline.md` y el runbook aplicable;
3. `CLAUDE.md`;
4. `AGENTS.md`.

`__tests__/config/deploymentTargetContract.test.ts` impide que CI acepte una
configuración que separe esas fuentes. El estado de cada publicación concreta
(SHA, fecha, URL y resultado) se registra de forma autoritativa en GitHub
**Environments → production** y en el resumen del job `Deploy to Vercel
(production)`; no se replica manualmente en esta guía.

## Estado confirmado

La Fase 2 se fusionó y fue publicada por el workflow CI. El despliegue debe
consumirse mediante el alias estable `https://arky-sup.vercel.app`; las URLs
largas de Vercel son inmutables por deployment y sirven sólo como evidencia del
artefacto puntual.
