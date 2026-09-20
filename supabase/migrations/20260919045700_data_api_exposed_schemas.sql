-- F9.1 — Qué esquemas expone la Data API, versionado en vez de en un panel.
--
-- Todo el producto entra por RPC del esquema `api`. Si PostgREST no lo tiene en
-- `db-schemas`, el cliente recibe 404 en cada llamada y la aplicación se lee
-- como si no hubiera datos. Esa configuración vivía **solo** en el panel de
-- Supabase: no se revisa en una PR, no viaja con el repositorio y nadie se
-- entera el día que alguien la cambia. Es el mismo argumento que puso el
-- interruptor de despliegue en `vercel.json` en vez de en el panel de Vercel.
--
-- PostgREST admite configuración en base de datos por rol, así que aquí queda,
-- reproducible y con historia. `public` y `graphql_public` se conservan porque
-- quitarlos apagaría GraphQL y los endpoints que Supabase da por hechos.
--
-- Aviso operativo: cambiar «Exposed schemas» desde el panel reescribe la
-- configuración del contenedor y puede volver a dejar fuera a `api`. Si un día
-- la aplicación devuelve 404 en todas las RPC, este es el primer sitio donde
-- mirar — el runbook lo dice también.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, api';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
