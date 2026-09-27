# Runbook — Aplicar una migración a `ArkyDB-US`

**Cuándo:** una PR añade un fichero a `supabase/migrations/`.
**Quién:** quien tenga el CLI de Supabase enlazado al proyecto de producción
(`btbhkmckrazoayaoorys`), **con la aprobación explícita del propietario para esa
migración**. La aprobación no se hereda de una migración anterior.

El despliegue de `ci.yml` publica la aplicación, **no el esquema**. Una
migración sin aplicar no rompe el build: rompe producción cuando el código
nuevo llama a una RPC que no existe. Pasó en F4-06.

**Desde F6-10 el despliegue lo comprueba.** Antes de construir, el paso
*Production has every migration of this commit*
(`scripts/deploy/assertProductionMigrations.mjs`) pregunta a producción, por
cada fichero de `supabase/migrations/`, si está aplicado
(`deploy_status.migration_applied`, con la clave publicable). Si falta alguno,
o no puede preguntar, **no publica** y nombra la migración. Se aplica
siguiendo este runbook y se relanza el trabajo `deploy`
(`gh run rerun <id> --failed`). La comprobación no aplica nada: la aprobación
sigue siendo humana.

## Orden

**La migración se aplica antes de fusionar el código que la usa. Nunca al
revés.** Las migraciones de este repositorio son aditivas respecto a la
aplicación en ejecución: el código viejo sigue funcionando con el esquema
nuevo, pero el código nuevo no funciona con el esquema viejo.

## Pasos

1. **CI en verde en la PR**, incluido el trabajo `database` de `supabase.yml`.
   Es el único sitio donde los contratos pgTAP corren contra una base real.
   Sin Docker local no hay otra forma de ejecutarlos.
2. **Ver qué falta en producción:**
   ```bash
   supabase migration list --linked
   ```
   La migración nueva debe aparecer con versión local y sin versión remota, y
   debe ser **la única** en ese estado. Si hay otra pendiente, alguien la dejó
   a medias: se para y se pregunta.
3. **Ensayo:**
   ```bash
   supabase db push --linked --dry-run
   ```
   Debe listar exactamente esa migración.
4. **Pedir la aprobación al propietario**, con el nombre de la migración, qué
   cambia y cómo se revierte. Sólo 3 de las 45 migraciones traen hoy su
   reversión en la cabecera. Si la nueva no la trae, se escribe en la PR antes
   de pedir la aprobación.
5. **Aplicar:**
   ```bash
   supabase db push --linked
   ```
6. **Verificar sin credenciales**, llamando a cada RPC nueva o modificada con
   la clave publicable y sin sesión:
   ```bash
   curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/<rpc>" \
     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" \
     -H "Content-Profile: api" -H "Content-Type: application/json" -d '{}'
   ```
   - `42501`: la RPC existe y exige sesión. **Correcto.**
   - `PGRST202`: PostgREST no la conoce. La migración no se aplicó, o el
     esquema no se recargó.
   - `404` en **todas** las RPC: el esquema `api` salió de *Exposed schemas*.
     Ver CLAUDE.md, *Desplegar el esquema*.
7. **Sonda con datos, cuando la migración cambia comportamiento:**
   `scripts/supabase/*-remote-probe.sql`, a través de
   `python3 scripts/supabase/test-remote.py`. Las sondas se revierten al
   terminar, y el ejecutor nunca imprime valores de filas.
8. **Fusionar la PR** y vigilar el trabajo `Deploy to Vercel (production)`.

## Si algo sale mal

- **La aplicación falla tras fusionar y la migración estaba aplicada:** el
  código se revierte con el runbook de `docs/ci-cd-pipeline.md` § 6. El esquema
  se queda: es aditivo.
- **La migración falla a medias:** 42 de las 45 migraciones abren su propia
  transacción (`begin; … commit;`). Si una de ésas falla, no se aplicó nada, y
  `supabase migration list` no la registra. Una migración nueva debe llevarla.
  Se corrige en la PR y se vuelve al paso 1.
- **Hay que revertir el esquema:** la reversión se escribe como una migración
  **nueva**, nunca editando la aplicada: `supabase migration list` compara versiones, no
  contenido.

## Nunca

- Aplicar desde el panel de Supabase copiando SQL: la versión no queda
  registrada y el paso 2 miente la próxima vez.
- Usar la clave `service_role` en el paso 6: prueba otra cosa.
- Imprimir claves en un log, en una PR o en un chat.

## Anexo — cómo se revierte cada migración de la transformación

Escrito en la revisión de deuda técnica del 2026-09-26 (deuda R-14). El
criterio de cierre de la fase 4 pedía «migraciones con compatibilidad y
reversión», y 8 de las 13 migraciones de la transformación no decían cómo
deshacerse. **Las migraciones aplicadas no se editan**, porque
`supabase migration list` compara versiones y no contenido. Por eso la
reversión de cada una va aquí, y se aplica como una migración **nueva** que
siga este runbook.

Revertir una de éstas casi nunca es la respuesta. Cinco cierran hallazgos de
seguridad o de consistencia. Lo normal es revertir el **código**
(`docs/ci-cd-pipeline.md` § 6): todas se escribieron compatibles con la
aplicación anterior.

| Migración | Qué hizo | Reversión (migración nueva) | Qué reabre |
|---|---|---|---|
| `20260920120000_engagement_overload_and_initiative_references` | Retiró `delete_engagement(text, text)`; `delete_business_initiative` se niega si un proyecto la cita; bloqueo `for key share` al guardar | Recrear la función de dos argumentos con la definición de `20260912170000` y la de borrado de iniciativas con la de `20260912060520` | **H09 y H08**: un borrado sin revisión y proyectos con iniciativas rotas. No revertir |
| `20260920160000_decide_engagement_atomic` | `api.decide_engagement`: decisión y transición en una transacción; columna `office_arb_decisions.decided_revision` | `drop function api.decide_engagement(text, jsonb, bigint, jsonb)`. La columna puede quedarse: es aditiva y nulable. Antes, el cliente anterior tiene que volver a escribir con `record_arb_decision` | **H01**: decisión y entrega en dos escrituras. No revertir sin volver a desplegar el cliente anterior |
| `20260920213000_reject_arb_decision_id_collisions` | `decide_engagement` falla con `23505` si el id de la decisión ya existe | `create or replace` con la definición de `20260920160000` | Que un id repetido «firme» otro encargo |
| `20260920224928_phase_2_governance_guards` | Transiciones legales (`office_engagement_transition_allowed`), bandeja del comité (`load_arb_engagements`), el autor no firma lo suyo, revocación de cuatro RPC huérfanas, confirmación de archivos por disparador | Por partes: `drop function private.office_engagement_transition_allowed(text, text)` tras restaurar `save_engagement` de `20260912181347`; `drop function api.load_arb_engagements()`; volver a `grant execute` las cuatro revocadas | **H02**: saltos de estado arbitrarios y autoaprobación. No revertir |
| `20260921060000_canonicalize_arb_decision_evidence` | La evidencia de la decisión la canoniza el servidor, no la envía el cliente | `create or replace` de `decide_engagement` con la definición de `20260920224928` | Evidencia escrita por el cliente (parte de H02) |
| `20260921070000_grant_office_arb_decisions_read` | `grant select on api.office_arb_decisions to authenticated` | `revoke select on api.office_arb_decisions from authenticated` | Nada: la lectura la filtra además la política de la siguiente |
| `20260921080000_rls_office_arb_decisions_read_own` | Política `office_arb_decisions_read_own` | `drop policy office_arb_decisions_read_own on api.office_arb_decisions`. **Hay que revertir también la anterior en la misma migración**, o la tabla queda sin filas visibles | — |
| `20260922180000_artifact_commands` | El Artefacto como raíz de agregado (ADR-106): cinco comandos por artefacto, `save_project`, columnas generadas `version_group_id`/`version`, índice único `project_artifacts_version_unique` | **Sólo junto con `20260923090000`**, que retiró `save_project_aggregate`: primero recrear esa RPC (su definición está en `20260920120000`), luego `drop` de los cinco comandos, de `save_project` y del índice, y quitar las dos columnas generadas | **H05**: una edición reescribe el agregado entero. Revertirla sola deja a los clientes sin ninguna ruta de escritura |

Las otras cinco migraciones de la transformación traen su reversión en la
cabecera: `20260923090000`, `20260924120000`, `20260925090000`,
`20260926090000` y `20260926140000`. **Toda migración nueva la trae también**,
y el paso 4 de este runbook lo pide antes de la aprobación.
