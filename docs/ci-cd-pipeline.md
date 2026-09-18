# Pipeline de integración y despliegue continuo

**Fecha:** 2026-09-18. **Repositorio:** `eltata71/arky-sup` (privado).
**Hosting:** Vercel, proyecto `arkypro-1-0` (ADR-006).

Este documento describe el pipeline tal como queda tras la auditoría F0–F8, qué
lo bloquea hoy, y el procedimiento exacto para desbloquearlo. Lo que aquí se
declara verificado está verificado; lo que depende de la organización está
marcado como tal y con dueño.

---

## 1. El flujo, de commit a producción

```
  rama de trabajo
       │  push
       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Pull request contra main                                    │
  │   ci.yml        quality · tests×4 · coverage · rules        │
  │   e2e.yml       Playwright (chromium + iPad Safari)         │
  │   security.yml  CodeQL + npm audit + SBOM                   │
  │   supabase.yml  pgTAP local (solo si cambia supabase/**)    │
  └─────────────────────────────────────────────────────────────┘
       │  merge (squash)
       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ push a main → ci.yml                                        │
  │   quality · tests×4 · coverage · rules                      │
  │        └──► deploy  (needs: quality, coverage, rules)       │
  │               vercel pull → build → check:bundle-secrets    │
  │               → deploy --prebuilt --prod → smoke            │
  └─────────────────────────────────────────────────────────────┘
       │
       ▼
  https://arkypro-1-0.vercel.app
```

### Por qué el despliegue vive en GitHub Actions y no en la integración Git de Vercel

La integración Git de Vercel despliega **al recibir el push**, sin leer el
resultado de ningún gate. Eso no es una preferencia de estilo: es la causa
directa del hallazgo más serio de esta auditoría. El proyecto de Vercel está
enlazado al repositorio **`arkypro-1.0`**, no a `arky-sup`, así que ningún merge
a `main` de este repositorio ha desplegado nunca nada. Lo que hay en producción
se subió con `vercel --force` desde una estación de trabajo, y los commits que
sirve —`275bb88`, `9346076`, `b9fc7dd`, `3df94a4`— **no existen en el
repositorio**: `git cat-file` no los encuentra y `git ls-remote` tampoco.

Un artefacto que no se puede reconstruir desde `main` no es un despliegue. El
trabajo `deploy` de `ci.yml` cierra las dos mitades del problema: despliega solo
desde `main`, y solo después de que `quality`, `coverage` y `rules` hayan pasado
sobre ese mismo commit.

### Qué comprueba cada paso del despliegue

| Paso | Qué demuestra |
|---|---|
| `vercel pull --environment=production` | El artefacto se construye con las variables que el proyecto declara, no con placeholders |
| `vercel build --prod` | El build de producción compila con esas variables reales |
| `checkBundleSecrets.mjs .vercel/output/static` | Ninguna clave de proveedor entró en el bundle. Es la **primera** vez en el pipeline que esto se comprueba sobre el build real: el job `quality` construye con placeholders, así que una clave mal puesta como `VITE_*` en el dashboard de Vercel solo aparece aquí |
| `vercel deploy --prebuilt --prod` | Se publica exactamente el binario que se acaba de validar |
| `scripts/deploy/productionSmoke.mjs` | La SPA sirve HTML y `/api/ai` + `/api/gemini` contestan `401 unauthenticated` en vez del HTML del SPA. Ese fallo de rewrite ya ocurrió una vez (F5) y costó una sesión entera de diagnóstico |

---

## 2. Estado real de la ejecución: **bloqueado por la cuenta, no por el repositorio**

Los workflows no se ejecutan desde el **2026-09-13**. Evidencia medida sobre la
API de GitHub, no inferida:

| Hecho | Medición |
|---|---|
| Última ejecución correcta de `CI` | run **#23**, commit `58ea544`, 2026-09-13 20:22 UTC, `run_duration_ms: 179 000` |
| Desde la #24 | **todas** fallan en 2–3 s |
| Trabajos de la ejecución #39 (`main`, `83485c4`) | 7 trabajos, `duration_ms: 0` **cada uno**, `run_duration_ms: 3 000` |
| Logs de esos trabajos | HTTP 404 — no existen |
| Alcance | Las 4 familias de workflow, en `main`, en PR de rama y en PR de Dependabot |

Un trabajo que termina en dos segundos, sin logs y con cero milisegundos de
cómputo **nunca fue asignado a un runner**. No llegó a hacer `checkout`. Ningún
cambio en un fichero `.yml` puede producir eso, y los ficheros no habían
cambiado entre la #23 y la #24.

**Causa compatible con toda la evidencia:** el derecho de ejecución de Actions de
la cuenta está agotado o suspendido — minutos incluidos consumidos en un
repositorio **privado**, o límite de gasto en cero, o un fallo de cobro. Los
cuatro workflows de este repositorio consumen del orden de 60–80 minutos de
runner por cada PR más su merge, lo que agota la asignación mensual de un plan
gratuito en pocos días de trabajo intenso; el 13 de septiembre concentra
exactamente ese patrón.

### Cómo desbloquearlo (dueño: titular de la cuenta)

Una de estas tres, por orden de menor a mayor coste:

1. **Hacer público el repositorio.** Actions es gratis e ilimitado en
   repositorios públicos. Revisar antes que no haya secretos en el historial;
   `check:bundle-secrets` cubre el artefacto, no el historial de Git.
2. **Subir el límite de gasto de Actions.** GitHub → *Settings* → *Billing and
   plans* → *Spending limits* → *Actions*. Comprobar de paso que no hay un pago
   rechazado en *Payment information*.
3. **Runner autoalojado.** Sin coste por minuto, a cambio de mantener la máquina.

Hasta entonces, la evidencia sustitutiva es la ejecución local completa, que es
la excepción que la decisión **5B** de F8 ya aceptó **para el PoC** y que no
equivale a una aprobación productiva.

### Reducción de consumo aplicada en este cambio

Para que el pipeline vuelva a caber en una asignación gratuita cuando se
desbloquee:

| Cambio | Ahorro por merge |
|---|---|
| `e2e.yml` deja de dispararse en `push` a `main` | ~15–25 min de runner |
| `security.yml` (CodeQL) deja de dispararse en `push` a `main` | ~20 min de runner |
| `mirror-source.yml` retirado | elimina un workflow completo |

En los dos casos el push a `main` analizaba **el mismo árbol** que la PR acababa
de analizar. El gate previo al despliegue sigue siendo `ci.yml`, que sí corre en
push porque de él cuelga `deploy`. El sharding de la suite **no** se toca: es
una decisión registrada en `CLAUDE.md` y su motivo (tiempo de espera de quien
revisa) sigue siendo válido.

---

## 3. Secretos que requiere el despliegue

En GitHub → *Settings* → *Secrets and variables* → *Actions* → *New repository
secret*:

| Secreto | Dónde se obtiene | Valor para este proyecto |
|---|---|---|
| `VERCEL_TOKEN` | Vercel → *Account Settings* → *Tokens* → *Create* | — (no se transcribe aquí) |
| `VERCEL_ORG_ID` | Vercel → *Team Settings* → *General*, o `.vercel/project.json` tras `vercel link` | `team_HGSWQHORpMV8wQUQf3mAdWEl` |
| `VERCEL_PROJECT_ID` | Vercel → *Project Settings* → *General* | `prj_9etNKwZkFORmbRAbaAFwNpQxJfcP` |

Y uno opcional:

| Secreto | Para qué |
|---|---|
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Que el smoke de producción vea la aplicación y no el muro de inicio de sesión. Vercel → *Project Settings* → *Deployment Protection* → *Protection Bypass for Automation* |

Es opcional porque su ausencia no es un fallo de la aplicación: el smoke lo dice
en voz alta y no tumba un despliegue ya publicado.

**El proyecto tiene *Vercel Authentication* activada** (`ssoProtection:
all_except_custom_domains`) y **no tiene dominio propio** (`domains: []`). La
consecuencia práctica es que hoy `https://arkypro-1-0.vercel.app` solo la abre
quien pertenece al equipo de Vercel: un usuario piloto que no sea miembro recibe
el muro de inicio de sesión de Vercel, no la pantalla de acceso de Arky. Si la
UAT de F7.6 va a ejecutarla alguien de fuera del equipo, hay que resolver esto
antes — añadiendo un dominio propio, o ajustando la protección — y es una
decisión del titular, no del repositorio.

El trabajo `deploy` **falla con un error explícito** si falta alguno de los tres
obligatorios, y nombra cuál. Es deliberado: un trabajo de despliegue en verde que no ha desplegado
nada informa de un despliegue que no ocurrió, que es peor que un rojo con
instrucciones.

### Evitar el despliegue doble

Si en algún momento se enlaza el proyecto de Vercel a `arky-sup` desde el
dashboard, hay que elegir **una** ruta de despliegue:

- **Recomendada:** dejar el enlace Git solo para *previews* de PR y desactivar
  el despliegue automático de producción (Vercel → *Project Settings* → *Git* →
  *Ignored Build Step*, o *Production Branch* apuntando a una rama que no se
  usa). Producción la publica `ci.yml`.
- **Alternativa:** desplegar con la integración Git y eliminar el trabajo
  `deploy`. Se pierde la garantía de que producción pasó los gates, que es
  justo el problema que esta auditoría encontró.

---

### Cola de Dependabot acumulada

Hay **5 PR de npm abiertas** (#8, #9, #10, #12, #20) y varias de
`github-actions`, todas con los checks en rojo por H-2 y ninguna fusionable con
criterio. Una de ellas, #12, propone saltos mayores del *toolchain* —ESLint 10,
TypeScript 7, Vite 8, Vitest 5— que este repositorio no puede evaluar sin CI.

Recomendación al desbloquear Actions: revisarlas **por grupos y en este orden**
—primero `minor-and-patch`, después `github-actions`, y `build-toolchain` la
última y sola—, cerrando las que hayan quedado obsoletas en lugar de
refrescarlas todas a la vez. `npm audit --audit-level=high` reporta hoy **0
vulnerabilidades**, así que ninguna de esas PR es urgente por seguridad.

## 4. Protección de rama (dueño: titular de la cuenta)

`main` no tiene hoy ninguna regla de protección: acepta push directo y no exige
ningún check. El pipeline descrito arriba solo es un contrato si la rama lo
hace cumplir. En GitHub → *Settings* → *Branches* → *Add branch ruleset* sobre
`main`:

- **Require a pull request before merging** (1 aprobación).
- **Require status checks to pass**, seleccionando:
  `Static gates (typecheck + lint + budgets + build)`,
  `Merged coverage (thresholds)`,
  `Firestore rules (emulator)`,
  `Playwright smoke (desktop + iPad)`,
  `CodeQL (JavaScript/TypeScript)`,
  `Dependency audit`.
- **Require branches to be up to date before merging**.
- **Block force pushes** y **Restrict deletions**.

No se activan desde aquí: cambian quién puede escribir en el repositorio y esa
es una decisión del titular. Actívelas **después** de desbloquear Actions — si
se activan antes, con los checks sin poder ejecutarse, ninguna PR podrá
fusionarse nunca.

---

## 5. Lo que el pipeline verifica hoy, medido localmente

Ejecutado sobre `83485c4` con Node 22.22.2 en este entorno (la versión
declarada es 24; la diferencia se anota, no se esconde):

| Control | Resultado |
|---|---|
| `npm ci` | exit 0 |
| `npm run quality:static` | exit 0 — typecheck, strict, lint, `any` 23/23, orphan-scripts, module-size, module-boundaries |
| `npm run quality` (la cadena completa, con cobertura) | exit 0 — **es la que hay que ejecutar como evidencia sustitutiva de CI**: `quality:static` + `test:ci` no calculan cobertura y por eso no vieron el umbral roto de `byokConsent.ts` (H-4 de la auditoría) |
| `npm run test:ci` | exit 0 — **455 ficheros pasados + 1 omitido; 4 347 pruebas pasadas + 59 omitidas** |
| `npm run build:placeholders` | exit 0 |
| `npm run check:bundle-secrets` | exit 0 |
| `npm run check:bundle-budget` | exit 0 — eager **438.8 KB gz** de 450.0 |
| `npm audit --audit-level=high` | **0 vulnerabilidades** |

No ejecutados aquí y por qué: `test:rules` y `e2e` necesitan los emuladores de
Firebase (JDK 21) y navegadores de Playwright con dependencias de sistema;
`supabase.yml` necesita Docker. Los tres corren en CI cuando CI pueda correr.

---

## 6. Referencias

- `.github/workflows/ci.yml` — gates + despliegue.
- `scripts/deploy/productionSmoke.mjs` — smoke del despliegue.
- `__tests__/config/ciPipeline.test.ts` — el pipeline como contrato comprobable.
- `docs/auditoria-f0-f8-2026-09-18.md` — auditoría completa de las nueve fases.
- `docs/fase-1/adrs.md` ADR-006 — decisión de hosting.
