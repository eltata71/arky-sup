# Pipeline de integración y despliegue continuo

**Fecha:** 2026-09-18. **Repositorio:** `eltata71/arky-sup` (privado).
**Hosting:** Vercel, proyecto `arky-sup` (ADR-006).
**Revisado:** 2026-09-18, tras separar el despliegue en un proyecto propio.

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
  │   ci.yml        quality · tests×4 · cobertura                 │
  │   e2e.yml       Playwright (chromium + iPad Safari)           │
  │   security.yml  CodeQL + npm audit + SBOM                     │
  │   supabase.yml  pgTAP local (solo si cambia supabase/**)      │
  └─────────────────────────────────────────────────────────────┘
       │  merge (squash)
       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ push a main → ci.yml                                        │
  │   quality · tests×4 · cobertura                               │
  │        └──► deploy  (needs: quality, coverage)               │
  │               vercel pull → verifica destino → build          │
  │               → check:bundle-secrets → deploy --prebuilt      │
  │               → smoke                                         │
  └─────────────────────────────────────────────────────────────┘
       │
       ▼
  https://arky-sup.vercel.app
```

### Por qué el despliegue vive en GitHub Actions y no en la integración Git de Vercel

La integración Git de Vercel despliega **al recibir el push**, sin leer el
resultado de ningún gate. Eso no es una preferencia de estilo: es la causa
directa del hallazgo más serio de esta auditoría, y el problema ha tenido dos
formas seguidas.

**La primera fue no desplegar.** El proyecto `arkypro-1-0` estaba enlazado al
repositorio `arkypro-1.0`, no a éste, así que ningún merge a `main` de este
repositorio desplegó nunca nada. Lo que servía producción se había subido con
`vercel --force` desde una estación de trabajo, y los commits que servía
—`275bb88`, `9346076`, `b9fc7dd`, `3df94a4`— **no existen en el repositorio**.

**La segunda fue desplegar sin mirar.** El 2026-09-18 se creó `arky-sup`
(`prj_Sr0cq7A21ZX8MfEmyLBbEkpO0Bfk`) enlazado a este repositorio. Producción
pasó a servir `85c5bed`, que sí está en `main` —eso cierra la mitad grave del
hallazgo—, pero lo publicó la integración Git. Sin gate delante: el primer
despliegue **falló en el build, en producción, sobre un commit ya fusionado**,
porque el gate de configuración rechazó una clave de proveedor con prefijo
`VITE_`. Ese fallo pertenecía a una PR, no a producción.

Un artefacto que no se puede reconstruir desde `main` no es un despliegue, y uno
que nadie ha comprobado tampoco. El trabajo `deploy` de `ci.yml` cierra las dos
mitades: despliega solo desde `main`, y solo después de que `quality` y
`coverage` hayan pasado sobre ese mismo commit. Para que sea el
**único** que publica, `vercel.json` apaga el disparador automático en `main`
—ver *Un solo camino publica producción*, más abajo—.

El contrato versionado del destino canónico vive en
`docs/operacion/despliegue.json` y se explica en
`docs/operacion/contrato-despliegue.md`: `eltata71/arky-sup` publica mediante el
proyecto y equipo Vercel `arky-sup` (`prj_Sr0cq7A21ZX8MfEmyLBbEkpO0Bfk`,
`team_HGSWQHORpMV8wQUQf3mAdWEl`) y el alias
estable es `https://arky-sup.vercel.app`. Después de `vercel pull`, CI verifica
ese destino antes de construir o desplegar; una credencial que resuelva otro
proyecto falla cerrada.

### Qué comprueba cada paso del despliegue

| Paso | Qué demuestra |
|---|---|
| `vercel pull --environment=production` | El artefacto se construye con las variables que el proyecto declara, no con placeholders |
| `vercel build --prod` | El build de producción compila con esas variables reales |
| `checkBundleSecrets.mjs .vercel/output/static` | Ninguna clave de proveedor entró en el bundle. Es la **primera** vez en el pipeline que esto se comprueba sobre el build real: el job `quality` construye con placeholders, así que una clave mal puesta como `VITE_*` en el dashboard de Vercel solo aparece aquí |
| `vercel deploy --prebuilt --prod` | Se publica exactamente el binario que se acaba de validar |
| `scripts/deploy/productionSmoke.mjs` | La SPA sirve HTML y `/api/ai` + `/api/gemini` contestan `401 unauthenticated` en vez del HTML del SPA. Ese fallo de rewrite ya ocurrió una vez (F5) y costó una sesión entera de diagnóstico |

---

## 2. La ejecución estuvo bloqueada por la cuenta, y se desbloqueó

**Resuelto.** Se deja escrito porque el diagnóstico costó tiempo y el modo de
fallo no se parece a su causa: un workflow que no corre parece un workflow roto.

Entre el **2026-09-13** y el **2026-09-18** ninguna ejecución llegó a un runner.
La evidencia fue toda la misma y toda medida sobre la API, no inferida:

| Hecho | Medición |
|---|---|
| Última ejecución correcta de `CI` | run **#23**, commit `58ea544`, 2026-09-13 20:22 UTC, `run_duration_ms: 179 000` |
| Desde la #24 | **todas** fallaban en 2–3 s |
| Trabajos de la ejecución #39 (`main`, `83485c4`) | 7 trabajos, `duration_ms: 0` **cada uno**, `run_duration_ms: 3 000` |
| Logs de esos trabajos | HTTP 404 — no existían |
| Alcance | Las 4 familias de workflow, en `main`, en PR de rama y en PR de Dependabot |

Un trabajo que termina en dos segundos, sin logs y con cero milisegundos de
cómputo **nunca fue asignado a un runner**: no llegó a hacer `checkout`. Ningún
cambio en un `.yml` produce eso, y los ficheros no habían cambiado entre la #23 y
la #24. La causa compatible con todo era el derecho de ejecución de Actions de la
cuenta —minutos agotados en un repositorio privado, límite de gasto en cero o un
cobro fallido—, no el repositorio.

**Lo que lo resolvió:** el repositorio se hizo **público**, y en un repositorio
público Actions es gratis e ilimitado. Verificado el 2026-09-20: `visibility:
public`, y las ejecuciones de la PR de F9 duran lo que deben —`Static gates`
1 m 28 s, los cuatro shards de Vitest entre 43 s y 56 s, `database` 3 m 13 s,
`Playwright smoke` 4 m 47 s— con logs completos.

La regla que deja: **hacer público un repositorio es una decisión de seguridad
antes que de facturación.** `check:bundle-secrets` cubre el artefacto que se
publica, no el historial de Git; antes de abrir uno hay que revisar el historial,
y después hay que asumir que cualquier secreto que estuviera en él ya está fuera.

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

**El límite de este recorte, dicho en voz alta.** Con *squash merge* el commit
que aparece en `main` es nuevo: tiene el mismo árbol que la PR pero otro SHA. De
modo que E2E y CodeQL quedan validados sobre el contenido que se publica, no
sobre el identificador exacto. Es el compromiso estándar, y es aceptable aquí
porque el gate pesado —`quality` y la suite completa con sus umbrales— **sí**
vuelve a correr sobre el commit de `main`, y es de él de quien cuelga `deploy`. Si en algún momento los minutos dejan de ser el
factor limitante, la corrección es devolver `e2e.yml` al disparador `push` y
añadirlo a `needs` del trabajo `deploy`, en ese orden.

---

## 3. Secretos que requiere el despliegue

En GitHub → *Settings* → *Secrets and variables* → *Actions* → *New repository
secret*:

| Secreto | Dónde se obtiene | Valor para este proyecto |
|---|---|---|
| `VERCEL_TOKEN` | Vercel → *Account Settings* → *Tokens* → *Create* | — (no se transcribe aquí) |
| `VERCEL_ORG_ID` | Vercel → *Team Settings* → *General*, o `.vercel/project.json` tras `vercel link` | `team_HGSWQHORpMV8wQUQf3mAdWEl` |
| `VERCEL_PROJECT_ID` | Vercel → *Project Settings* → *General* | `prj_Sr0cq7A21ZX8MfEmyLBbEkpO0Bfk` |

**Cuidado: `prj_9etNKwZkFORmbRAbaAFwNpQxJfcP` es el proyecto viejo `arkypro-1-0`.** Fue
el valor correcto hasta el 2026-09-18 y aparece en actas anteriores. Un
`VERCEL_PROJECT_ID` con ese valor no falla: publica el código nuevo sobre el
proyecto equivocado, que es el modo de fallo más caro de los dos.

Y uno opcional:

| Secreto | Para qué |
|---|---|
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Que el smoke de producción vea la aplicación y no el muro de inicio de sesión. Vercel → *Project Settings* → *Deployment Protection* → *Protection Bypass for Automation* |

Es opcional porque su ausencia no es un fallo de la aplicación: el smoke lo dice
en voz alta y no tumba un despliegue ya publicado.

**`arky-sup` tiene *Vercel Authentication* activada, y lo demostró el propio
despliegue.** La ejecución #46 del 2026-09-18 publicó correctamente y el smoke
recibió, en lugar de la aplicación, el muro de inicio de sesión de Vercel:
`{"error":{"code":"401","message":"Protected deployment"}}` en `/api/ai`, y una
página con `_vercel_sso_nonce` en la raíz. La consecuencia práctica es que hoy
`https://arky-sup.vercel.app` sólo la abre quien pertenece al equipo de Vercel:
un piloto externo recibe ese muro, no la pantalla de acceso de Arky.

Dos cosas distintas que resolver, y conviene no confundirlas:

- **Para que el smoke pueda comprobar el despliegue**, añadir el secreto
  `VERCEL_AUTOMATION_BYPASS_SECRET` (Vercel → *Project Settings* → *Deployment
  Protection* → *Protection Bypass for Automation*). Sin él el smoke no falla
  —dice «SIN VERIFICAR» y sale con 0—, pero tampoco comprueba nada.
- **Para que la UAT la pueda ejecutar alguien de fuera**, añadir un dominio
  propio (Vercel → *Settings* → *Domains*), que mantiene la protección donde
  sirve, o bajar `ssoProtection`. Es decisión del titular, no del repositorio.

El muro contesta **200 con HTML** en la página y **401 con JSON** en una
función. Esa asimetría rompía la detección del smoke, que exigía un 401 o un
403: saludaba el muro de la página como si fuera la aplicación y después
acusaba al proxy de devolver un envoltorio mal formado, dejando un despliegue
correcto en rojo y señalando al componente equivocado.
`scripts/deploy/protectionWall.mjs` lo decide ahora por las marcas del cuerpo y
no por el estado, y `__tests__/scripts/deployProtectionWall.test.ts` lo fija con
los cuerpos reales de aquella ejecución — incluidos los dos casos negativos, que
son la mitad importante: una detección demasiado laxa archivaría un fallo real
del proxy como «protegido» y pasaría en verde sobre un despliegue roto.

El trabajo `deploy` **falla con un error explícito** si falta alguno de los tres
obligatorios, y nombra cuál. Es deliberado: un trabajo de despliegue en verde que no ha desplegado
nada informa de un despliegue que no ocurrió, que es peor que un rojo con
instrucciones.

### Un solo camino publica producción

El proyecto está enlazado a este repositorio, así que los dos caminos —la
integración Git y el trabajo `deploy`— apuntan al mismo alias de producción.
Decidido: **publica `ci.yml`**, y la integración Git queda para las *previews*
de PR, que es su mitad útil.

Lo hace `vercel.json`:

```json
{ "git": { "deploymentEnabled": { "main": false } } }
```

Tres cosas que esa línea decide y conviene no deshacer sin querer:

- **Solo `main`.** Las ramas que no se nombran siguen desplegando, así que cada
  PR mantiene su preview.
- **No es `deploymentEnabled: false`.** Esa forma apaga también las previews.
  `__tests__/config/ciPipeline.test.ts` afirma las dos cosas por separado.
- **Vive en el repositorio, no en el panel.** Un interruptor del dashboard no se
  revisa en una PR, no viaja con el repositorio y nadie se entera el día que
  alguien lo vuelve a encender. `$schema` en la cabecera del fichero hace que un
  editor avise si la clave se escribe mal — una clave inventada en `vercel.json`
  se acepta y no hace nada, que es la peor combinación posible.

La alternativa descartada era desplegar con la integración Git y eliminar el
trabajo `deploy`. Funciona sin depender de los minutos de Actions, a cambio de
dejar producción sin gates: exactamente el problema que esta auditoría encontró.

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

## 4. Protección de rama — activa, y lo que costó averiguar qué bloqueaba

Medido el 19 sep 2026 sobre el ruleset `23685996` (`Settings` → `Rules` →
`ruleset`, activo desde el 18 sep, alcance `refs/heads/main`):

| Regla | Estado |
|---|---|
| `deletion` / `non_fast_forward` | activas — ni borrado ni force-push sobre `main` |
| `pull_request` | activa. `required_approving_review_count: 0`, **`require_extra_approval_for_unattributed_changes: true`** |
| `required_status_checks` | activa, `strict` (la rama debe estar al día con `main`) |
| `bypass_actors` | **vacío**. Nadie salta el ruleset, tampoco el titular |

La sección anterior decía que `main` no tenía ninguna protección y recomendaba
exigir `Firestore rules (emulator)`. Las dos frases se quedaron viejas, y la
segunda dejó un defecto real en el repositorio. Esto es lo que hay que cambiar,
y sólo lo puede hacer el titular: el GitHub App de este agente no tiene permiso
de administración sobre el repositorio, y es correcto que no lo tenga —
modificar la protección de rama es la forma más directa de desactivar el
pipeline que la protección existe para hacer cumplir.

### 4.1 `Firestore rules (emulator)` es un check requerido que ya no existe

F9 borró `firestore.yml` con el resto de Firebase. Ese contexto no lo va a
reportar nadie nunca más, y un check requerido que no llega deja la PR en
*Expected — waiting for status to be reported*. **No bloquea sólo la PR de F9:
bloquea cualquier PR futura contra `main`**, para siempre.

Arreglo: *Settings* → *Rules* → `ruleset` → *Require status checks to pass* →
quitar `Firestore rules (emulator)`. Los cinco que quedan son los correctos:

- `Static gates (typecheck + lint + budgets + build)`
- `Merged coverage (thresholds)`
- `Playwright smoke (desktop + iPad)`
- `CodeQL (JavaScript/TypeScript)`
- `Dependency audit`

**Y no se sustituye por `database`**, que es el trabajo de contratos pgTAP, por
mucho que sea el heredero natural del que se va. `supabase.yml` se dispara por
rutas (`supabase/**`, `scripts/supabase/**`, `package.json`), así que en una PR
que no toque el esquema no se ejecuta — y un check requerido que no se ejecuta
es exactamente el problema que se acaba de quitar. Es la misma razón por la que
el trabajo `deploy` no lo declara en `needs`, y `__tests__/config/ciPipeline.test.ts`
lo afirma. Si algún día quiere exigirse, primero hay que quitarle las rutas para
que corra en todas las PR, aceptando sus ~3 minutos.

### 4.2 «Require extra approval for unattributed changes» — la hipótesis que se midió y no se cumplió

Se conserva la deducción entera porque era razonable y era **falsa**, y el modo
de equivocarse es instructivo.

`required_approving_review_count` es **0**, así que la aprobación que GitHub
mostraba como pendiente no venía de ahí; la única otra regla capaz de pedirla es
esta casilla. Un commit está *sin atribuir* cuando su autor no corresponde a
ninguna cuenta de GitHub, y los commits del agente se firman
`Claude <noreply@anthropic.com>`, que no es ninguna. Como además **el autor de
una PR no puede aprobarla**, en un repositorio de un solo colaborador la
conclusión parecía cerrada: nadie podía dar esa aprobación.

**Lo que ocurrió al arreglarlo.** El titular quitó `Firestore rules (emulator)`
de los checks obligatorios y la PR #32 pasó de `blocked` a `mergeable_state:
clean` — con la casilla **todavía activa**. De modo que el único bloqueo real
era el check que no podía reportar nunca; la casilla no estaba firmando nada
sobre estos commits.

Dos cosas que conviene quedarse:

- **`blocked` no dice qué bloquea.** Es un estado agregado, y con dos candidatos
  plausibles a la vez la única forma de saber cuál manda es quitar uno y volver
  a medir. Deducir cuál era, desde dos reglas que encajaban igual de bien, fue
  razonar en lugar de comprobar.
- **La casilla se queda puesta.** No cuesta nada mientras no bloquee, y el día
  que este repositorio tenga un segundo colaborador hace exactamente lo que
  promete. Desmarcarla ahora sería quitar un control por un problema que resultó
  no ser suyo.

Si algún día sí bloquea, las salidas son añadir un segundo colaborador que
apruebe, o desmarcarla. Hay una tercera que se anota para descartarla:
reescribir los commits para que figuren a nombre del titular haría pasar la
regla sin que nadie revise nada. Eso no es satisfacer el control, es
renombrarlo, y no debe hacerlo el agente por iniciativa propia.

---

## 5. Medición local de los gates (historial)

Con Actions desbloqueado (§2), **la evidencia es CI**; esta tabla se conserva
como el registro de lo que se midió mientras no lo era. Ejecutado sobre
`83485c4` con Node 22.22.2 en este entorno (la versión declarada es 24; la
diferencia se anota, no se esconde):

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

No ejecutados aquí y por qué: `e2e` necesita los navegadores de Playwright con
sus dependencias de sistema y una pila Supabase local, y `supabase.yml` necesita
Docker. Los dos corren en CI. `test:rules` desapareció con Firebase: los
contratos de autorización son ahora pgTAP contra una base real
(`bash scripts/supabase/local.sh test`).

---

## 6. Reversión

Un despliegue malo no se arregla con un commit de vuelta: eso publica otra vez,
con los mismos minutos de gates por delante. Se revierte el despliegue y después
se arregla el código.

1. **Inmediato** — *Instant Rollback* en el panel del proyecto, o
   `vercel rollback <url-del-despliegue-anterior> --token=…`. Devuelve el alias
   de producción al artefacto anterior sin reconstruir nada.
2. **Confirmar** — el resumen de cada ejecución del trabajo `deploy` (pestaña
   *Summary*) registra el commit y la URL publicada, así que la URL a la que
   volver está en la ejecución anterior, no hay que reconstruirla.
3. **Después** — arreglar en una rama, con su PR y sus gates. Un `git revert`
   directo sobre `main` vuelve a disparar el despliegue, que es correcto una vez
   que producción ya está a salvo y no antes.

Lo que hace posible el punto 1 es que cada despliegue sea inmutable y esté
atado a un commit del repositorio — que es justamente lo que H-1 había roto.

## 7. Referencias

- `.github/workflows/ci.yml` — gates + despliegue.
- `scripts/deploy/productionSmoke.mjs` — smoke del despliegue.
- `__tests__/config/ciPipeline.test.ts` — el pipeline como contrato comprobable.
- `docs/auditoria-f0-f8-2026-09-18.md` — auditoría completa de las nueve fases.
- `docs/fase-1/adrs.md` ADR-006 — decisión de hosting.
