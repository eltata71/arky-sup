# Fase 8 — Decisiones del usuario y alcance operativo

**Fecha:** 2026-09-17
**Rama:** `feature/fase8-corte`
**Referencia:** `docs/fase-8/plan-fase-8.md`

## Decisiones recibidas

| ID | Decisión | Aplicación | Estado |
|---|---|---|---|
| 1 | **1A** — Ejecutar UAT humana ahora | Se coordina una sesión piloto con cuenta autorizada; incluye inferencia real y recorridos por rol | Pendiente de sesión humana |
| 2 | **2A** — Ejecutar diagnóstico autenticado del 429 | Se hará una llamada real con el token de la cuenta piloto y se conservará evidencia de `requestId`, `source`, `provider`, `error` y `retryAfterMs` | Pendiente de sesión humana |
| 3 | **3C** — HIBP diferido mientras sea PoC sin usuarios reales | Se mantiene el aviso de Supabase; activarlo será requisito antes de usuarios reales | Aceptado como riesgo acotado |
| 4 | **4B** — Exclusión formal del mapa Firebase UID → UUID | El PoC no migra usuarios históricos ni documentos históricos de Firebase Storage | Aceptado para el alcance PoC |
| 5 | **5B** — Evidencia local como sustituta temporal de CI | Se acepta para el PoC; no equivale a aprobación productiva ni sustituye PG17/Docker/WebKit en CI | Aceptado como excepción temporal |
| 6 | **6B** — Sin backup remoto en este PoC | Se mantiene porque no hay datos productivos ni objetos Storage; es obligatorio resolverlo antes de datos reales | Aceptado como riesgo acotado |
| 7 | **7B** — SLO/RPO/RTO/presupuesto diferidos | No se declaran compromisos productivos para este PoC | Aceptado como fuera de alcance |
| 8 | **8A** — Actualizar a Node 24 | `.nvmrc`, `package.json`, `package-lock.json` y CI/Vercel se alinean al runtime 24; estáticos, build, bundle y suite completa verificados | Verificado con Node 24.21.0 |
| 9 | **9A** — Mantener URLs como enlaces externos | No se descargan ni se convierten automáticamente en objetos administrados de Storage | Aceptado para el alcance PoC |

## Consecuencias y límites

- Las decisiones 1A y 2A no pueden cerrarse con una prueba automática sin sesión: requieren que una persona inicie sesión con la cuenta piloto autorizada.
- 3C, 4B, 5B, 6B, 7B y 9A no autorizan un corte productivo; solo fijan el alcance del PoC.
- 4B no constituye una migración ni reconciliación histórica. No se modifica Firebase Storage.
- 6B no constituye un plan de recuperación remoto. La base y los objetos Storage deberán respaldarse y restaurarse antes de cualquier dato real.
- 8A requiere verificar compatibilidad con Node 24 antes de aceptar el cambio como completo.

## Secuencia para cerrar 1A y 2A

1. Abrir la aplicación desplegada en Vercel.
2. Iniciar sesión con la cuenta piloto autorizada.
3. Ejecutar los recorridos acordados de UAT: acceso, proyecto, permisos y recorrido de IA.
4. Ejecutar una solicitud de IA con texto de prueba no sensible.
5. Registrar el resultado visible y, si hay error, el cuerpo JSON completo del endpoint.
6. Confirmar que el resultado contiene texto real o registrar el error exacto.
7. No introducir datos personales, PHI, secretos ni documentos históricos.
8. Entregar la evidencia o el resultado de la sesión para cerrar el acta F7.6 y el diagnóstico 429.
