# Auditoría independiente de las Fases 0 a 8

**Fecha:** 2026-09-18. **Base auditada:** `83485c4` (`origin/main`).
**Alcance:** `docs/plan-transformacion-supabase-ddd.md` §4, tareas F0.1–F8.6.
**Método:** no se acepta ninguna afirmación de un acta de cierre sin volver a
comprobarla contra el código, contra el proyecto Supabase remoto, contra la API
de GitHub o contra el despliegue en Vercel. Donde una comprobación no se pudo
ejecutar aquí, se dice cuál y por qué en lugar de heredar el resultado.

---

## 0. Resumen ejecutivo

El plan define **55 tareas** entre F0.1 y F8.6. El recuento, tarea a tarea, es:

| | Tareas | Detalle |
|---|---|---|
| ✅ Implementadas y verificadas | **46** | F0 (6/6), F1 (7/7 — F1.7 se cierra en este cambio), F2 (6/6), F3 (6/6), F4 (4 de 6), F5 (6 de 7), F6 (3 de 5), F7 (5 de 6), F8 (3 de 6) |
| ➖ No aplican al PoC, por decisión registrada | **6** | F4.4, F4.5 (sin usuarios reales, proveedor único), F5.5 (sin datos que cargar), F6.4 (sin migración histórica), F8.3, F8.5 (sin corte productivo) |
| 🔒 Abiertas, requieren una persona o una acción de cuenta | **3** | F6.5 (carga/descarga real), F7.6 (UAT), F8.4 (smoke por rol) |

Las tres abiertas son la misma dependencia vista tres veces: **una sesión humana
contra el despliegue**. No hay ninguna tarea del plan bloqueada por trabajo de
código pendiente.

El apartado §4.1 documenta el caso aparte: el gate del 429 llevaba tres actas
abierto, no por falta de esa sesión humana, sino porque **el código no podía
atribuirlo aunque alguien lo reprodujera**. Ese defecto se corrige aquí.

El trabajo de dominio, datos, autorización y almacenamiento está hecho y es
verificable de forma independiente: **30 migraciones aplicadas al proyecto
remoto**, la matriz de 63 permisos duplicada en SQL con pruebas de paridad,
RLS y RPC auditadas, Storage privado sin objetos, y una suite de **4 347
pruebas en verde**.

**Los dos hallazgos serios de esta auditoría no están en las fases: están en la
entrega.**

| # | Hallazgo | Gravedad |
|---|---|---|
| **H-1** | **El proyecto de Vercel no está enlazado a este repositorio.** `arkypro-1-0` apunta a `eltata71/arkypro-1.0`. Ningún merge a `main` de `arky-sup` ha desplegado nunca. Lo que sirve producción se subió con `vercel --force` desde una estación de trabajo, y sus commits **no existen en el repositorio** | Alta |
| **H-2** | **GitHub Actions no ejecuta nada desde el 2026-09-13.** Los trabajos terminan en 2–3 s con `duration_ms: 0` y sin logs: nunca se les asignó runner. Es un bloqueo de la cuenta, no del repositorio | Alta |
| **H-3** | **La aplicación desplegada está detrás de Vercel Authentication y no tiene dominio propio.** `ssoProtection: all_except_custom_domains`, `domains: []`: solo la abre quien pertenece al equipo de Vercel. La UAT de F7.6 con un usuario que no sea miembro no puede ejecutarse tal cual | Media |
| **H-4** | **`npm run quality` llevaba rojo desde F7 y ninguna acta lo notó**, porque el umbral que falla solo se evalúa en el informe de cobertura fusionado — el trabajo de CI que nunca se ejecutó. Corregido en este cambio | Media |

La consecuencia combinada es que **el código fusionado en `main` no está
desplegado y no hay ningún gate automático entre un merge y producción**. Los
dos commits más recientes de `main` —`d5cb2c5` (F8: botón de cierre de sesión,
Node 24) y `83485c4`— no llegaron nunca a producción.

---

## 1. Evidencia de los dos hallazgos de entrega

### H-1 · El despliegue no sale del repositorio

| Comprobación | Resultado |
|---|---|
| `list_projects` (Vercel) | `arkypro-1-0` → `link: { org: "eltata71", repo: "arkypro-1.0" }` |
| Despliegue de producción vigente | `dpl_CbbGrKVfLjwYXekidrz3V9wXdeMM`, creado 2026-09-17T05:34:56Z, commit `275bb88` |
| `git cat-file -e 275bb88` | **No existe** en el repositorio |
| `git ls-remote origin` | `275bb88`, `9346076`, `b9fc7dd`, `3df94a4` no aparecen en ninguna referencia |
| `main` en el remoto | `83485c4`, 2026-09-18T01:51Z — **posterior al despliegue y no desplegado** |
| Metadatos de los deploys | `actor: hermes-agent`, `gitDirty: 1`, sin `branchAlias` ni `githubRepoId`: son despliegues por CLI, no por integración Git |
| Producción responde | `GET /` → `200 text/html`, cabeceras de seguridad presentes, activo `index-BMrd6E_4.js` |

Producción funciona. Lo que no existe es la trazabilidad: no hay forma de
reconstruir desde el repositorio el binario que está sirviendo, ni de saber qué
gates pasó, porque el commit del que salió no está versionado.

### H-2 · Los workflows no se ejecutan

| Comprobación | Resultado |
|---|---|
| Última ejecución correcta de `CI` | run #23, `58ea544`, 2026-09-13 20:22Z, `run_duration_ms: 179 000` |
| Ejecuciones #24 a #39 | **todas** `failure` |
| Run #39 (`main`, `83485c4`) | 7 trabajos, `duration_ms: 0` cada uno, `run_duration_ms: 3 000` |
| Logs de esos trabajos | HTTP 404 |
| Alcance | `CI`, `E2E`, `Security` y `Supabase local contracts`; en `main`, en PR de rama y en PR de Dependabot |
| Ficheros de workflow entre #23 y #24 | sin cambios |

Un trabajo con cero milisegundos de cómputo y sin logs no llegó a hacer
`checkout`. Ningún error de sintaxis YAML produce eso. La causa compatible con
toda la evidencia es el agotamiento o la suspensión del derecho de ejecución de
Actions de la cuenta en un repositorio **privado**. Procedimiento de desbloqueo
en `docs/ci-cd-pipeline.md` §2.

El acta de F5 ya lo describió como «fallo de infraestructura» el 2026-09-14 y la
decisión **5B** de F8 aceptó evidencia local como sustituto temporal. Esta
auditoría confirma el diagnóstico, lo cuantifica y añade que **cuatro fases se
han cerrado desde entonces sin que CI ejecutara ni una vez**.


### H-4 · El gate completo estaba rojo y la evidencia local no lo veía

`npm run quality` —la cadena que el trabajo `coverage` de CI ejecuta— terminaba
en **exit 1** sobre `83485c4`:

```
ERROR: Coverage for statements (76.92%) does not meet "services/ai/byokConsent.ts" threshold (80%)
ERROR: Coverage for branches (75%) does not meet "services/ai/byokConsent.ts" threshold (80%)
```

`services/ai/byokConsent.ts` decide si una clave de proveedor puede salir del
navegador, y por eso tiene un suelo propio de 80/80/90/85. F7 le añadió el hueco
de clave de Anthropic (`785535f`) **sin prueba**, y la cobertura del fichero cayó
por debajo de su suelo.

Lo interesante es por qué nadie lo vio, porque es el modo de fallo exacto de la
decisión **5B** («evidencia local en lugar de CI»):

- CI evalúa este umbral **solo** en el trabajo `coverage`, que fusiona los cuatro
  shards. Los shards corren con `VITEST_SKIP_THRESHOLDS=1` a propósito. Ese
  trabajo no se ha ejecutado desde el 2026-09-13 (H-2).
- La evidencia local de F7 y F8 fue `quality:static` + `test:ci`. **Ninguno de
  los dos calcula cobertura**, así que los dos daban exit 0 con el gate rojo
  debajo.

Corregido cubriendo las dos ramas defensivas que faltaban —`localStorage` que
lanza (Safari en modo privado) y `localStorage` ausente—, ambas con el mismo
resultado: **no hay consentimiento**, es decir, no se llama al proveedor con la
clave del operador. `byokConsent.ts` pasa de 76.92/75 a **92.3/87.5/100/100**.

Queda una rama sin cubrir y documentada como tal: `if (!storageKey) return
false`, inalcanzable hoy porque `Settings['aiConfig']['provider']` solo admite
`gemini | openrouter | anthropic` y los tres tienen hueco de clave. Se conserva
como guarda para cuando ese tipo crezca.

---

## 2. Matriz de las 49 tareas

Leyenda: **✅** implementada y verificada · **➖** no aplica al PoC por decisión
registrada · **🔒** bloqueada por la organización · **🔧** corregida en este
cambio.

### F0 — Línea base y protección del producto

| Tarea | Estado | Verificación en esta auditoría |
|---|---|---|
| F0.1 inventario funcional | ✅ | `docs/fase-0/inventario-funcional-datos.md`, aceptación aprobada 2026-09-12 |
| F0.2 entorno reproducible | ✅ | `npm ci` exit 0 aquí; `.nvmrc`=24, `engines.node`=24.x |
| F0.3 quality + reglas + E2E + build | ✅ | `quality:static` exit 0; `test:ci` 455/4 347; build + bundle exit 0 |
| F0.4 auditoría arquitectura/seguridad | ✅ | `check:module-boundaries` y `check:module-size` exit 0; `npm audit --omit=dev` **0 vulnerabilidades** |
| F0.5 inventario de datos | ✅ | aprobado 2026-09-12 |
| F0.6 backlog de deuda D-01…D-20 | ✅ | revisado ítem a ítem, §3 |

### F1 — Diseño de dominio y arquitectura de transición

| Tarea | Estado | Verificación |
|---|---|---|
| F1.1 lenguaje ubicuo | ✅ | `docs/fase-1/lenguaje-ubicuo.md` |
| F1.2 bounded contexts y context map | ✅ | 7 contextos, `docs/fase-1/mapa-contextos.md` |
| F1.3 agregados, invariantes, eventos | ✅ | `docs/fase-1/agregados-invariantes-eventos.md`; `noAggregateLiterals.test.ts` en verde |
| F1.4 autorización por permiso y alcance | ✅ | `docs/fase-1/modelo-autorizacion.md`; 63 celdas |
| F1.5 modelo PostgreSQL | ✅ | `docs/fase-1/modelo-postgresql.md`; contrastado con las 30 migraciones remotas |
| F1.6 ADR | ✅ | ADR-001…008; ADR-006 hosting = Vercel |
| **F1.7 actualizar AGENTS.md y CLAUDE.md** | **🔧** | **Estaba parcial desde el 2026-09-12**: `AGENTS.md` tenía la nota, `CLAUDE.md` no. `CLAUDE.md` gana ahora la sección «Transición a Supabase — aprobada en Fase 1 (F1.7)» con la tabla de lo que cambia y lo que no, y tres entradas nuevas en *What NOT to Do* |

### F2 — Plataforma Supabase y controles de entrega

| Tarea | Estado | Verificación |
|---|---|---|
| F2.1 proyecto, región, plan | ✅ | `list_projects`: **ArkyDB-US** `btbhkmckrazoayaoorys`, `us-east-1`, `ACTIVE_HEALTHY`, PostgreSQL 17.6.1 |
| F2.2 CLI, migraciones, tipos | ✅ | `supabase/.cli-version` 2.117.0; 30 ficheros locales |
| F2.3 esquemas, grants, RLS deny-by-default | ✅ | `get_advisors`: los 14 avisos `rls_enabled_no_policy` son **INFO** y son la postura deny-by-default declarada; ninguna tabla expuesta sin RLS |
| F2.4 CI de SQL, contratos y drift | ✅ (escrito) / 🔒 (ejecución) | `.github/workflows/supabase.yml` existe y es correcto; nunca se ha ejecutado por H-2 |
| F2.5 logs, alertas, auditoría | ✅ | `scripts/operations/metrics.py`; base manual, no SaaS |
| F2.6 respaldo y restauración | ✅ | ensayado en F7, `docs/fase-7/evidencias/recuperacion-f26.md` |

**Verificación independiente del remoto:** `list_migrations` devuelve
exactamente las **30** versiones que existen en `supabase/migrations/`, en el
mismo orden y con los mismos nombres. No hay drift.

### F3 — Fundaciones modulares

| Tarea | Estado | Verificación |
|---|---|---|
| F3.1 puertos | ✅ | `services/ports/`: `IdentityPort`, `ClockPort`, `FileStoragePort`, `RepositoryPort`; sin imports de React/SDK |
| F3.2 adaptadores | ✅ | `services/adapters/`; `resolveBackend` devuelve `firebase` por defecto y un valor desconocido cae al seguro |
| F3.3 reglas fuera de la UI | ✅ | `check:module-boundaries` exit 0 con presupuestos vigentes |
| F3.4 deuda acotada | ✅ | sin re-refactors; causa nombrada por grupo |
| F3.5 strict progresivo | ✅ | `typecheck:strict` exit 0 |
| F3.6 kernel IA y credenciales | ✅ | `api/ai.ts` rechaza `VITE_*`; cliente fail-closed en producción |

### F4 — Identidad, autorización y permisos

| Tarea | Estado | Verificación |
|---|---|---|
| F4.1 Supabase Auth | ✅ | `supabaseIdentityAdapter.ts` + `supabaseAuthClient.ts`, SDK cargado dinámicamente. **Pendiente conocido:** alta de usuarios con clave de servicio, que va en Edge Function |
| F4.2 roles, permisos y RLS | ✅ | migraciones `20260912044359` y `20260912052000` presentes en el remoto |
| F4.3 paridad de matriz y negativos | ✅ | `sqlMatrixParity` en verde dentro de la suite |
| F4.4 migración de usuarios | ➖ | decisión **4B**: el PoC no tiene usuarios reales |
| F4.5 convivencia temporal | ➖ | proveedor único (ADR-004) |
| F4.6 expiración y revocación | ✅ | `20260912060500_session_guard.sql` en el remoto |

**Matiz que conviene no perder:** el adaptador de identidad **sí** está ahora
cableado (`context/AuthContext.tsx` y `context/auth/useAuthSessionBootstrap.ts`
entran por `services/adapters`), al contrario de lo que decía el acta de F4. Lo
que sigue sin cambiar es el **proveedor activo**: `resolveBackend` devuelve
`firebase` mientras no se defina `VITE_BACKEND_<CONTEXTO>`.

### F5 — Migración de datos por cortes verticales

| Tarea | Estado | Verificación |
|---|---|---|
| F5.1 piloto de baja criticidad | ✅ | `settings/global` |
| F5.2 esquema, RLS, adaptador, contrato | ✅ | `20260913223956` + dos migraciones de guarda, en el remoto |
| F5.3 ETL versionada e idempotente | ✅ | `scripts/migration/platform_settings_etl.py` y cuatro ETL más, con sus pruebas |
| F5.4 reconciliación | ✅ | sonda remota transaccional 8/8 |
| F5.5 orden de migración por grafo | ➖ | esquemas de los cinco cortes creados y verificados; la **carga** de datos no aplica: PoC sin datos productivos |
| F5.6 transacciones, concurrencia, borradores | ✅ | bloqueo optimista por revisión; `MirroredList` nunca informa un borrador como escritura confirmada |
| F5.7 una sola fuente de escritura | ✅ | `resolveBackend` por contexto; sin dual-write |
| **F5 criterio (a): inferencia autenticada E2E** | **🔒 + 🔧** | Requiere sesión humana. **El defecto que impedía diagnosticarla está corregido** — ver §4 |

### F6 — Almacenamiento y documentos

| Tarea | Estado | Verificación |
|---|---|---|
| F6.1 inventario de archivos y URLs | ✅ | `scripts/storage/storageInventory.mjs`, 845 fuentes |
| F6.2 diseño de buckets y retención | ✅ | `docs/fase-6/diseno-storage-fase-6.md` |
| F6.3 políticas, metadata, permisos | ✅ | 12 migraciones de Storage, todas en el remoto; owner-only y sesión activa |
| F6.4 migración de binarios | ➖ | decisión del usuario 2026-09-15: el PoC no importa el bucket histórico |
| F6.5 carga, descarga, previews | 🔒 | necesita un flujo de producto y sesión humana; desplazada a F7.1/F7.6 |

### F7 — Calidad integral, resiliencia y experiencia

| Tarea | Estado | Verificación |
|---|---|---|
| F7.1 pruebas unitarias/contratos/RLS/E2E | ✅ | suite 4 347 en verde aquí; contratos SQL 10/10 en F7 |
| F7.2 seguridad de API, funciones, deps | ✅ | `npm audit --omit=dev` 0; `check:bundle-secrets` exit 0; advisors sin hallazgo nuevo |
| F7.3 rendimiento | ✅ (escala PoC) | eager **438.8 KB gz** de 450 |
| F7.4 resiliencia | ✅ 🔧 | reintentos y fail-closed verificados; **la atribución del 429 faltaba y se añade en este cambio** |
| F7.5 UX, a11y, i18n | ✅ (revisión) | WCAG 2.2 AA sigue siendo propuesta, no certificación |
| F7.6 UAT con usuarios | 🔒 | requiere sesión humana. Dueño: organización |

### F8 — Corte productivo y estabilización (en PoC: pre-corte)

| Tarea | Estado | Verificación |
|---|---|---|
| F8.1 ensayo de corte read-only | ✅ | `docs/fase-8/evidencias/`: `migration-list.txt`, advisors, smoke `/api/ai` |
| F8.2 ventana, responsables, rollback | ✅ (documental) | `plan-fase-8.md`; corte productivo = NO |
| F8.3 congelar escrituras y carga final | ➖ | no hay corte productivo que ejecutar |
| F8.4 smoke por rol y piloto | 🔒 | depende de F7.6 |
| F8.5 conservación de escrituras al revertir | ➖ | sin datos productivos |
| F8.6 soporte y acta de aceptación | **🔧** | **El acta de cierre de F8 no existía.** Se escribe en este cambio: `docs/fase-8/cierre-fase-8.md` |

---

## 3. Backlog de deuda D-01…D-20, revisado uno a uno

| ID | Estado verificado hoy |
|---|---|
| D-01 Node 20 EOL | ✅ cerrado — `.nvmrc`=24, `engines.node`=24.x, workflows por `node-version-file` |
| **D-02 workflow espejo destructivo** | **🔧 cerrado en este cambio.** `mirror-source.yml` seguía presente, con `rsync -a --delete` sobre el árbol y `git push origin HEAD:main`. Sobrevivió ocho fases de trabajo sobre ese mismo `main`. Retirado, y `__tests__/config/ciPipeline.test.ts` impide que vuelva |
| D-03 puertos y adaptadores | ✅ cerrado en F3 |
| D-04 reglas sin prueba negativa | ✅ cerrado — `npm run test:rules`, 59 casos |
| D-05 proxy sin membresía | ✅ cerrado — `verifySupabaseToken.ts` + `authenticateProxyCaller.ts` (F7) |
| D-06 `geminiService` monolítico | ⏳ vigente y presupuestado — 16 de los 23 `any`; deuda conocida, no bloqueante |
| D-07 aceptación e inventario | ✅ cerrado 2026-09-12 |
| D-08 deep imports UI→internals | ⏳ vigente bajo presupuesto decreciente |
| D-09 ciclo `services (raíz) ↔ services/ai` | ⏳ vigente; mover el motor empeora el censo (documentado en `CLAUDE.md`) |
| D-10 `js-yaml` high + vitest moderate | ✅ cerrado — `npm audit` **0 vulnerabilidades** |
| D-11 gate de configuración desactivado en despliegue | ✅ cerrado — `__tests__/config/vercelRuntimeGate.test.ts` lo fija |
| D-12 cuota del proxy en memoria | ⏳ vigente — sigue siendo por proceso; aceptable en PoC, no con usuarios reales |
| D-13 perfil propio con campos fuera de rol | ⏳ **parcial** — cerrado en Supabase (RPC auditada para rol y estado); en Firestore, que es el proveedor activo, `firestore.rules` protege `role` pero no acota el resto de campos del propio documento |
| D-14 strict progresivo | ⏳ vigente y avanzando |
| **D-15 SBOM que escribe `{}`** | **🔧 cerrado en este cambio.** El paso subía un `{}` como artefacto llamado «sbom», indistinguible de un inventario que declara cero dependencias. Ahora falla explícito si el SBOM no tiene `bomFormat` o no tiene componentes |
| D-16 BYOK en localStorage + CSP informativa | ⏳ vigente — CSP sigue en `Report-Only` |
| D-17…D-20 | ⏳ P2, sin cambios |

---

## 4. Lo que este cambio corrige

### 4.1 El 429 no se podía atribuir, y por eso tres actas lo arrastraron

**Síntoma registrado el 2026-09-14:** un usuario piloto ejecutó el Laboratorio
de IA del LMS en producción y recibió *«El proxy de IA está limitando las
solicitudes»* dos veces, separadas 25 segundos. El límite local del proxy es de
60 peticiones por minuto: dos llamadas no pueden tocarlo. El acta de F5 lo dejó
como salvedad, F7 lo trasladó y `plan-fase-8.md` lo puso como **gate bloqueante**
del corte.

**Causa, encontrada leyendo el código:**

1. `streamAiProxyDetailed` —el camino que usa el Laboratorio de IA— **descartaba
   el cuerpo de la respuesta de error**. Se quedaba con el estado HTTP. El
   envoltorio del proxy, que distingue `proxy_rate_limited` de
   `provider_rate_limited` y trae el `requestId` de su línea de log, se perdía
   entero en esa rama.
2. `AiProxyFailure` no tenía dónde guardar esa atribución ni siquiera en el
   camino que sí leía el cuerpo: lo metía como texto en `detail`.
3. `assertDirectCallAllowed` registraba en observabilidad `reason`, `status`,
   `retryable`, `traceId` y `strictProxy` — **y nada más**. Los dos 429 quedaban
   escritos como el mismo hecho.
4. El mensaje al usuario era uno solo y aconsejaba *esperar unos segundos*,
   que es exactamente el consejo equivocado cuando la cuota del proveedor se ha
   agotado.

**Corrección:** un `readProxyErrorEnvelope` compartido por los dos caminos;
`serverCode`, `serverSource` y `provider` en el fallo; el `requestId` del proxy
manda sobre el id acuñado en el cliente; `rateLimitOrigin()` devuelve
`proxy | provider | unknown` —y **`unknown` cuando no se pudo determinar**, en
vez de elegir el más probable—; tres mensajes distintos; y la atribución
completa en el evento de observabilidad. La regla de «proxy sin clave de
proveedor es configuración, no caída» pasa a aplicarse también en streaming,
donde faltaba. **Nueve pruebas nuevas.**

Esto no cierra el gate —sigue haciendo falta que una persona inicie sesión y
ejecute una petición— pero convierte una sesión de diagnóstico a ciegas en la
lectura de un evento.

### 4.2 El pipeline

- **`npm run quality` vuelve a exit 0** (H-4): dos pruebas nuevas cubren las
  ramas defensivas de `byokConsent.ts`.
- `mirror-source.yml` retirado (D-02).

  `docs/fase-0/entorno-y-entrega.md` advertía de la trampa: el workflow se
  disparaba **al modificar ese mismo fichero** en `main`, así que retirarlo
  parecía poder ejecutar precisamente lo que se quiere impedir. No lo hace. En
  un evento `push`, GitHub evalúa los workflows **tal como están en el commit
  empujado**: un fichero borrado en ese commit ya no existe y no se evalúa, y
  uno cuyo `on:` cambió se evalúa con el `on:` nuevo. La versión anterior no
  interviene. Y hoy, además, Actions no asigna runner a nada (H-2), así que el
  margen es doble.
- Trabajo `deploy` en `ci.yml`, con `needs: [quality, coverage, rules]`:
  `vercel pull` → `build` → **`check:bundle-secrets` sobre el artefacto real**
  → `deploy --prebuilt --prod` → smoke de producción.
- `scripts/deploy/productionSmoke.mjs`: comprueba que la SPA sirve HTML y que
  `/api/ai` y `/api/gemini` contestan `401 unauthenticated` en vez del HTML del
  SPA — el fallo de rewrite que ya costó una sesión en F5.
- `e2e.yml` y `security.yml` dejan de dispararse en `push` a `main`: analizaban
  el mismo árbol que la PR acababa de analizar, y ese consumo duplicado es parte
  de cómo se agotó la asignación de minutos.
- SBOM que falla en vez de mentir (D-15).
- `__tests__/config/ciPipeline.test.ts`: el pipeline como contrato comprobable.
- `.env.example` y `env.d.ts` documentan por fin `VITE_BACKEND*`,
  `VITE_SUPABASE_*` y los tres secretos del despliegue. Ninguno estaba escrito,
  en un fichero que `CLAUDE.md` describe como «la lista autoritativa».

### 4.3 F1.7 y F8.6

`CLAUDE.md` retira la restricción «frontend-only con Firebase» y la sustituye
por la arquitectura aprobada en F1, con sus límites explícitos.
`docs/fase-8/cierre-fase-8.md` es el acta que faltaba.

---

## 5. Lo que queda abierto, con dueño

| # | Abierto | Dueño | Bloquea |
|---|---|---|---|
| 1 | Enlazar el proyecto de Vercel a `arky-sup` **o** configurar `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` | titular de la cuenta | Que un merge despliegue |
| 2 | Desbloquear GitHub Actions (repo público, subir límite de gasto o runner autoalojado) | titular de la cuenta | Todo el CI |
| 3 | Protección de rama sobre `main` | titular de la cuenta | Que el pipeline sea un contrato y no una costumbre |
| 4 | Decidir el acceso a producción para la UAT: dominio propio o ajuste de la protección de despliegue (H-3) | titular de la cuenta | Que la UAT la pueda ejecutar alguien de fuera del equipo de Vercel |
| 5 | UAT humana + inferencia autenticada (F7.6, decisiones 1A y 2A) | organización | Cualquier corte productivo |
| 6 | HIBP, mapa UID, backup remoto, SLO/RPO/RTO | operación y negocio | Uso con datos reales |

Los puntos 1 a 3 son **acciones de configuración de cuenta**: no se pueden
ejecutar desde el repositorio y no se han intentado desde aquí. El
procedimiento exacto de cada uno está en `docs/ci-cd-pipeline.md` §§2–4.

---

## 6. Comprobaciones ejecutadas para esta auditoría

| Comando / consulta | Resultado |
|---|---|
| `npm ci` | exit 0 |
| `npm run quality:static` | exit 0 |
| `npm run quality` (cadena completa, con cobertura) | **exit 1 sobre `83485c4`** → H-4; **exit 0 tras la corrección** |
| `npm run test:ci` | exit 0 — **455 ficheros pasados + 1 omitido; 4 347 pruebas pasadas + 59 omitidas** |
| `npm run build:placeholders` | exit 0 |
| `npm run check:bundle-secrets` | exit 0 |
| `npm run check:bundle-budget` | exit 0 — eager 438.8 / 450.0 KB gz |
| Cobertura fusionada | 65.20 statements / 56.53 branches / 57.64 functions / 67.03 lines — por encima de los cuatro suelos globales |
| `npm audit --audit-level=high` | 0 vulnerabilidades |
| `npm run test:rules` (emulador Firestore, JDK 21) | 59/59 |
| Supabase `list_migrations` (remoto) | 30/30, sin drift |
| Supabase `get_advisors` security | 14 INFO deny-by-default + 1 WARN HIBP (diferido, decisión 3C) |
| GitHub `list_workflow_runs` + `get_workflow_run_usage` | H-2, §1 |
| Vercel `list_projects` + `list_deployments` + `GET /` | H-1, §1 |
| Vercel `get_project_deployment_protection` | H-3: `ssoProtection.enabled = true`, `deploymentType: all_except_custom_domains`, sin dominios |

**No ejecutado aquí:** Playwright con WebKit (faltan dependencias de sistema) y
el stack local de Supabase por CLI. Ambos corren en CI cuando CI pueda correr.
El entorno de esta auditoría usa Node 22.22.2; la versión declarada del proyecto
es 24, y la diferencia se anota en vez de esconderse.
