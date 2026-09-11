# Fase 0 — Cierre: línea base verificada, con dos pendientes externos

Base: `8731fcdd9af7a5ee57eaaf3049b162ef722e55d7`.
Fecha de cierre técnico: 2026-09-11. Rama de trabajo: main (documentación sin
commit en este acto; ver §4).

## 1. Estado por tarea

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| F0.1 inventario funcional | Hecha (código); pendiente aceptación con la oficina | `inventario-funcional-datos.md` |
| F0.2 entorno reproducible | Hecha; `npm ci` con y sin scripts exit 0 | `entorno-y-entrega.md`, `evidencias/entorno.json`, `npm-ci*.log` |
| F0.3 quality + reglas + E2E | Hecha | `quality.log` (exit 0), `f03-rules*.log`, `pruebas-integracion.md` |
| F0.4 arquitectura | Hecha | `auditoria-arquitectura.md` |
| F0.4 seguridad | Hecha (diagnóstico local) | `auditoria-seguridad.md`, `f04-*` |
| F0.5 inventario datos | Hecha (código); pendiente inventario productivo autorizado | `inventario-funcional-datos.md` |
| F0.6 backlog | Hecho (20 ítems D-01…D-20) | `backlog-deuda.md` |

## 2. Resultados verificados

- `npm run quality`: exit 0. Typecheck + strict + lint OK; `any` 23/23
  presupuestados; 432 archivos / 4222 tests pasados (1 archivo y 59 tests
  omitidos); build 2m16s; `bundle-secrets` OK; eager 432.8/450 KB.
- Reglas Firestore en emulador: 59/59.
- E2E con emuladores + seed: Chromium 8 pasados / 0 fallados; webkit bloqueado
  por librerías del sandbox (§3).
- Dependencias prod (`--omit=dev`): 0 avisos; dev: 1 high (js-yaml) + 1
  moderate compartido (vitest/mocker). Sin `npm audit fix` aplicado.
- Sin secretos operativos confirmados en el árbol versionado (15 candidatos =
  fixtures/placeholders, sin valores impresos).

## 3. Pendientes que exigen a la organización (no bloquean F1 documental)

1. **P-01 Aceptación funcional** (F0.1): taller con la oficina para fijar
   recorridos críticos y satisfacción por capacidad.
2. **P-02 Inventario productivo** (F0.5): acceso autorizado a colecciones,
   volúmenes, archivos, identidades y offline real.
3. **P-03 CI/hosting**: lectura de ejecuciones, protección de ramas y
   configuração de secretos por mecanismos seguros.
4. **P-04 E2E webkit**: corre en CI; en este sandbox falta `sudo`
   (`pruebas-integracion.md` §3).
5. **P-05 Decisiones F1**: responsables, tenencia, SSO/MFA, residencia y
   presupuesto (plan §7).

## 4. Cambios en el árbol (solo documentación + evidencias)

- `docs/plan-transformacion-supabase-ddd.md` (plan aprobado como referencia).
- `docs/fase-0/` (7 documentos + `evidencias/` con ~25 artefactos).
- `dist/` regenerado por builds locales (ignorado por git).
- `test-results/`, `playwright-report` (artefactos E2E, ignorados).
- Sin cambios de código, dependencias, reglas ni configuración.

## 5. Riesgos principales para F1

Node 20 EOL, workflow espejo destructivo, reglas con ramas sin negativo,
proxy que autoriza identidad sin membresía, y `geminiService` monolítico:
detallados como D-01…D-07 en `backlog-deuda.md`.
