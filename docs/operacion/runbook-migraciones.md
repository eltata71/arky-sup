# Runbook — Aplicar una migración a `ArkyDB-US`

**Cuándo:** una PR añade un fichero a `supabase/migrations/`.
**Quién:** quien tenga el CLI de Supabase enlazado al proyecto de producción
(`btbhkmckrazoayaoorys`), **con la aprobación explícita del propietario para esa
migración**. La aprobación no se hereda de una migración anterior.

El despliegue de `ci.yml` publica la aplicación, **no el esquema** (F6-10, pospuesta).
Una migración sin aplicar no rompe el build: rompe producción cuando el código
nuevo llama a una RPC que no existe. Pasó en F4-06.

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
