# Fase 8 — Cierre: pre-corte verificado, corte productivo **NO** ejecutado

**Fecha de cierre técnico:** 2026-09-18.
**Rama:** `claude/audit-phases-zero-eight-aaehv5`. **Base:** `83485c4`.
**Plan:** `docs/fase-8/plan-fase-8.md`. **Decisiones:** `docs/fase-8/decisiones-usuario.md`.
**Auditoría que sustenta este cierre:** `docs/auditoria-f0-f8-2026-09-18.md`.

F8 del plan (`plan-transformacion-supabase-ddd.md` §4) exige un corte
productivo. Este proyecto es una **prueba de concepto sin datos productivos**
(decisión de usuario, 2026-09-12), así que lo que F8 puede cerrar es el
**pre-corte**: el ensayo de sólo lectura, la preparación documental y el estado
verificado de todo lo anterior. **El corte productivo no se ejecuta y este acta
no lo autoriza.**

## 1. Estado por tarea

| Tarea | Estado | Evidencia |
|---|---|---|
| F8.1 ensayo de corte read-only | Hecha | `evidencias/migration-list.txt`, `advisors-security.json`, `advisors-performance.json`, `smoke-api-ai.txt`; reverificado hoy: 30/30 migraciones remotas, advisors sin hallazgo nuevo, producción responde `200` |
| F8.2 ventana, responsables, rollback | Hecha (documental) | `plan-fase-8.md`; sin ventana fijada porque no hay corte |
| F8.3 congelar escrituras y carga final | No aplica | Sin datos productivos que congelar ni cargar |
| F8.4 smoke por rol y piloto controlado | **Bloqueada** | Requiere sesión humana (decisión 1A). Dueño: organización |
| F8.5 conservación de escrituras al revertir | No aplica | Sin escrituras productivas posteriores a un corte que no existe |
| F8.6 soporte intensivo y acta de aceptación | Hecha con este documento | Este acta |
| Decisión 8A — Node 24 | Hecha | `.nvmrc`=24, `engines.node`=24.x, workflows por `node-version-file`; `evidencias/node24.md` |

## 2. Gates previos al corte: estado real

| Gate | Estado al cerrar F8 | Cambio respecto al plan |
|---|---|---|
| F7.6 UAT humana + inferencia piloto | **Abierto** | Sin cambio: sigue necesitando una persona |
| Diagnóstico 429 atribuido | **Instrumentado**, pendiente de ejecutar | **Cambia**: el defecto que lo hacía indiagnosticable está corregido (§3) |
| HIBP | Diferido (3C) | Sin cambio. Advisor remoto sigue reportándolo, verificado hoy |
| Mapa UID Firebase → UUID | Excluido formalmente (4B) | Sin cambio |
| CI verde / runners | **Abierto y diagnosticado** | **Cambia**: la causa está medida y el procedimiento de desbloqueo escrito (§4) |
| Backup remoto, SLO/RPO/RTO | Diferidos (6B/7B) | Sin cambio |
| Node 20 → 24 | Cerrado (8A) | Sin cambio |
| URLs externas como enlaces | Cerrado (9A) | Sin cambio |

## 3. Lo que F8 corrigió en vez de volver a registrar como pendiente

El gate del 429 llevaba abierto desde el 2026-09-14 y había atravesado tres
actas. La auditoría encontró que no estaba abierto por falta de una sesión
humana: estaba abierto porque **el código no podía atribuirlo aunque alguien lo
reprodujera**.

- `streamAiProxyDetailed` —el camino del Laboratorio de IA, donde se observó el
  incidente— descartaba el cuerpo del error y se quedaba con el estado HTTP.
  `proxy_rate_limited` y `provider_rate_limited` llegaban indistinguibles.
- El evento de observabilidad registraba `reason: 'rate-limited'` y nada del
  origen, así que los dos incidentes quedaban escritos como el mismo hecho.
- El mensaje al usuario aconsejaba esperar unos segundos también cuando la
  cuota del proveedor se había agotado, que es cuando ese consejo no sirve.

Corregido con un lector de envoltorio compartido por los dos caminos,
`serverCode`/`serverSource`/`provider` en el fallo, `rateLimitOrigin()` con
`unknown` explícito cuando no se puede determinar, tres mensajes distintos y la
atribución completa en observabilidad. Nueve pruebas nuevas.

**El gate sigue abierto** —hace falta una petición autenticada real— pero ahora
se cierra leyendo un evento en vez de repitiendo el incidente a ciegas.

## 4. Dos hallazgos de entrega que F8 no puede cerrar por sí sola

Ambos están medidos en `docs/auditoria-f0-f8-2026-09-18.md` §1 y su
procedimiento en `docs/ci-cd-pipeline.md`.

- **H-1.** El proyecto de Vercel `arkypro-1-0` está enlazado a
  `eltata71/arkypro-1.0`, no a este repositorio. Ningún merge a `main` ha
  desplegado nunca, y los commits que sirve producción (`275bb88` y anteriores)
  **no existen en el repositorio**. Se añade el trabajo `deploy` a `ci.yml`
  colgando de los gates; falta que el titular configure los tres secretos.
- **H-2.** GitHub Actions no asigna runner desde el 2026-09-13: 7 trabajos con
  `duration_ms: 0` y sin logs en la última ejecución sobre `main`. Es un bloqueo
  de la cuenta. Se reduce el consumo del pipeline y se documenta el desbloqueo;
  la acción es del titular.

- **H-3.** El proyecto de Vercel tiene *Vercel Authentication* activada
  (`ssoProtection: all_except_custom_domains`) y ningún dominio propio, así que
  `https://arkypro-1-0.vercel.app` solo la abre quien pertenece al equipo de
  Vercel. **Afecta directamente al gate de F7.6**: un usuario piloto que no sea
  miembro del equipo recibe el muro de inicio de sesión de Vercel y nunca llega
  a la pantalla de acceso de Arky. Decisión del titular: dominio propio o ajuste
  de la protección.

- **H-4.** `npm run quality` —la cadena que el trabajo `coverage` de CI
  ejecuta— terminaba en **exit 1** sobre `83485c4`: `services/ai/byokConsent.ts`
  por debajo de su suelo de cobertura desde que F7 le añadió el hueco de clave
  de Anthropic sin prueba. No lo vio nadie porque ese umbral solo se evalúa en
  el informe fusionado —el trabajo de CI que no corre desde el 13 de
  septiembre— y porque la evidencia local de F7 y F8 fue `quality:static` +
  `test:ci`, que **no calculan cobertura**. Es el modo de fallo exacto de la
  decisión 5B, y conviene registrarlo como tal: la evidencia local sustituye a
  CI solo si ejecuta lo mismo que CI. Corregido con dos pruebas; el fichero pasa
  de 76.92/75 a 92.3/87.5/100/100.

Mientras H-2 siga abierto, la evidencia del pipeline es la ejecución local, que
es la excepción que la decisión **5B** aceptó **para el PoC** y que no equivale
a una aprobación productiva. **Y la lección de H-4 es que esa evidencia tiene
que ser `npm run quality` completo**, no `quality:static` + `test:ci`.

## 5. Verificación ejecutada para este cierre

| Comprobación | Resultado |
|---|---|
| `npm ci` | exit 0 |
| `npm run quality:static` | exit 0 |
| `npm run quality` (cadena completa, con cobertura) | exit 1 antes de la corrección de H-4; **exit 0** después |
| `npm run test:ci` | exit 0 — 455 ficheros pasados + 1 omitido; 4 347 pruebas pasadas + 59 omitidas |
| `npm run test:rules` (emulador Firestore real, JDK 21) | **59/59** |
| `npm run build:placeholders` + `check:bundle-secrets` + `check:bundle-budget` | exit 0 — eager 438.8 / 450.0 KB gz |
| `npm audit --audit-level=high` | 0 vulnerabilidades |
| Supabase remoto `list_migrations` | 30/30, sin drift frente a `supabase/migrations/` |
| Supabase remoto `get_advisors security` | 14 INFO (deny-by-default por diseño) + 1 WARN HIBP |
| Producción `GET /` | `200 text/html`, cabeceras de seguridad presentes |

## 6. Criterio de salida

**F8-PoC cerrada.** Plan, evidencias y acta existen; el pre-corte está
verificado; los diferidos tienen dueño nombrado.

**Corte productivo: NO.** Queda bloqueado por F7.6 (UAT humana), por la
atribución del 429 ejecutada contra producción, y por los dos hallazgos de
entrega H-1 y H-2. Ninguno de los tres se puede cerrar desde el repositorio.

## 7. Siguiente paso recomendado

En este orden, porque cada uno desbloquea al siguiente:

1. Desbloquear Actions (H-2) y configurar los secretos de despliegue (H-1).
2. Fusionar y comprobar que el merge despliega y que el smoke pasa.
3. Resolver el acceso a producción para la UAT (H-3).
4. Ejecutar la sesión piloto: UAT por rol e inferencia autenticada con texto,
   leyendo `rateLimitOrigin` en el centro de observabilidad si vuelve el 429.
5. Activar la protección de rama sobre `main`.
6. Solo entonces, decidir si F9 (retiro del legado Firebase) tiene sentido para
   el alcance de la prueba de concepto.
