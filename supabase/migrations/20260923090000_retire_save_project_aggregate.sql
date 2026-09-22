-- F4-06 — Una sola ruta de escritura para el Proyecto (ADR-106 §5).
--
-- `api.save_project_aggregate` recibía el proyecto y la lista entera de sus
-- artefactos, y borraba los que no viajaban en ella. F4-03 la dejó como ruta de
-- transición con una guarda: sobre un proyecto existente sólo aceptaba la lista
-- ya almacenada, y su único uso legítimo era **crear** un proyecto con sus
-- artefactos iniciales.
--
-- Ese uso no existe. El cliente creaba siempre con la lista vacía, y desde
-- F4-04 la raíz del proyecto (`ProjectRoot`) no tiene artefactos que enviar:
-- crear es `api.save_project` con revisión esperada 0, que inserta con revisión
-- 1 y rechaza con `P0001` un segundo intento con el mismo id. El último
-- llamante migró en el mismo cambio que esta migración.
--
-- Una puerta que ya nadie usa pero que sigue concedida es superficie: quien la
-- encuentre por PostgREST puede crear un proyecto con artefactos que no pasaron
-- por sus comandos. Se retira como se retiró la sobrecarga de F2-07:
-- `revoke` y `drop`, con dos gates estáticos que impiden su vuelta
-- (`rpcSurface.test.ts`, que falla con una concesión sin consumidor, y
-- `retiredRpcs.test.ts`, que falla si una migración posterior la recrea o el
-- cliente la vuelve a llamar).
--
-- ## Compatibilidad
--
-- **No es aditiva respecto a un cliente anterior a F4-06**, que crearía
-- proyectos por esta RPC y recibiría un 404 de PostgREST. Es la degradación
-- correcta —la creación falla con un error visible y la aplicación se
-- recarga— y la ventana es la del despliegue: el esquema se aplica antes que el
-- código (CLAUDE.md, *Desplegar el esquema*) y la base de la PoC no tiene datos
-- productivos (F4-01). Ninguna fila se toca.
--
-- ## Reversión
--
-- Re-aplicar la definición de `api.save_project_aggregate(jsonb, jsonb,
-- bigint)` de `20260922180000_artifact_commands.sql` (§6) con su `revoke` y su
-- `grant execute ... to authenticated`. Las funciones privadas que usaba
-- (`private.assert_project_writer`, `private.assert_artifact_writable`,
-- `private.refresh_project_artifact_index`) y `api.save_project` siguen vivas
-- porque los comandos de artefacto las usan, así que la definición vuelve a
-- compilar tal cual. Revertir sólo hace falta si se revierte también el
-- cliente.

begin;

revoke all on function api.save_project_aggregate(jsonb, jsonb, bigint)
  from public, anon, authenticated, service_role;
drop function if exists api.save_project_aggregate(jsonb, jsonb, bigint);

comment on function api.save_project(jsonb, bigint) is
  'La única escritura de la raíz del proyecto (F4-06): con revisión esperada 0 la crea; con otra, la actualiza si sigue siendo la almacenada. Nunca toca artefactos, contador ni índice (ADR-106).';

commit;
