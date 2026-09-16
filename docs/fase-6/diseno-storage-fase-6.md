# F6 — Diseño de Storage y documentos

**Fecha:** 2026-09-15
**Estado:** F6.1, F6.2 y F6.3 cerradas; F6.4 no aplicable al PoC; F6.5 movida a F7

## Decisión de alcance

El inventario de código y la consulta remota de Supabase no encontraron una carga
binaria activa:

- el repositorio configura `storageBucket` de Firebase, pero no importa ni llama
  al SDK `firebase/storage`;
- no había migraciones, políticas ni llamadas a `supabase.storage` en el estado
  previo a esta implementación;
- Supabase Storage no devolvió objetos al listar el proyecto linkado antes de
  crear estos buckets; el destino nuevo permanece vacío;
- los documentos de iniciativas son URL o texto inline;
- los artefactos se persisten como contenido/IR en Firestore y los `Blob` actuales
  solo sirven para descargas temporales del navegador.

Por decisión de alcance del PoC, el bucket Firebase no es una dependencia de
esta fase: no se migrarán documentos históricos ni se creará una carga ficticia.
La ausencia de una consulta operativa no se transforma en una afirmación de
vacío; simplemente queda fuera del corte de migración.

Evidencia: [`inventario-storage.md`](./evidencias/inventario-storage.md),
[`inventario-storage.json`](./evidencias/inventario-storage.json).

## Diseño aprobado para cuando exista un origen binario

### Buckets

| Bucket | Uso | Acceso | Estado |
|---|---|---|---|
| `artifact-files` | binarios asociados a artefactos y sus versiones | privado; acceso solo tras autorización | creado y vacío |
| `initiative-documents` | adjuntos de documentos de iniciativa | privado; acceso solo para propietario o rol autorizado | creado y vacío |
| `export-archives` | no se crea ahora; las exportaciones actuales son descargas temporales | — | diferido hasta existir retención requerida |

No se usará un bucket público. Una URL de Storage no será una prueba de
autorización: toda lectura pasa por la política de `storage.objects` y por la
fila de metadata del dominio.

### Rutas

```text
{owner_uuid}/{context}/{aggregate_uuid}/{entity_uuid}/v{version}/{object_uuid}.{ext}
```

El `owner_uuid` se obtiene de la identidad migrada y no de un nombre introducido
por el navegador. El nombre original nunca forma parte de la autorización ni de
la ruta; si debe mostrarse, se conserva como metadata saneada.

### Metadata mínima

La tabla de dominio que acompañe a cada objeto debe conservar, como mínimo:

- `id`, `owner_id`, `context`, `aggregate_id`, `entity_id` y `version`;
- `bucket`, `path`, `mime_type`, `size_bytes` y `sha256`;
- `state`: `pending`, `ready`, `quarantined`, `failed` o `deleted`;
- `source_provider` y una referencia opaca al origen, nunca el payload ni un
  secreto;
- `created_by`, `created_at`, `updated_at` y, si aplica, `deleted_at`.

El registro compara MIME, tamaño, propietario y checksum declarado contra la
metadata física de `storage.objects`. El checksum criptográfico de los bytes no
se considera verificado por esta RPC: la promoción a `ready` queda reservada a
`service_role`, que deberá calcularlo/verificarlo fuera de SQL en F7. No se
guardan emails, credenciales, tokens ni URLs firmadas en manifests o metadata.

### Límites y seguridad

- Allowlist de MIME por bucket; el MIME declarado por el cliente no es
  suficiente y debe contrastarse con el contenido cuando el tipo lo requiera.
- Límite por objeto explícito y distinto por bucket; no se hereda sin revisión
  del límite local de 50 MiB.
- Carga inicialmente en `pending`; solo `ready` puede descargarse.
- Cuarentena/escaneo para formatos no confiables o cuando la operación lo exija;
  un fallo de escaneo no se convierte en `ready`.
- Reemplazo mediante nueva versión y nuevo `object_uuid`, nunca sobrescritura
  destructiva del blob anterior.
- Descargas mediante URL firmada de vida corta; no se persisten URLs firmadas.
- Eliminación lógica primero y borrado físico reconciliado después; los objetos
  con metadata ausente no se borran automáticamente.
- El frontend nunca recibe `service_role` ni una credencial privilegiada.
- La tabla `storage.objects` conserva grants estándar administrados por el
  propietario interno de Supabase Storage; `postgres` no puede revocarlos en
  este proyecto. El contrato no expone el esquema `storage` por la Data API y
  toda operación de cliente queda restringida por RLS/políticas. Si se habilita
  SQL directo para roles de cliente, esta limitación debe resolverse con
  Supabase antes de producción.

### Políticas previstas

Las políticas de `storage.objects` comprueban simultáneamente:

1. sesión `authenticated` para el cliente;
2. propietario derivado de la primera carpeta y coincidente con `storage.objects.owner`;
3. permiso del contexto para escritura; la lectura queda limitada al propietario en este PoC;
4. estado y bucket permitidos;
5. `WITH CHECK` en insert/update para impedir reasignar propietario o ruta.

La política no se basa en `user_metadata`. El acceso de revisores y
administradores a objetos de otros propietarios queda deliberadamente diferido
hasta que exista una autorización por agregado/tenant; no se concede lectura
global por permisos como `arb:decide` o `users:read`.
La implementación SQL está en `supabase/migrations/20260915012714_storage_private_objects.sql`,
`supabase/migrations/20260915013614_storage_policy_error_guards.sql`,
`supabase/migrations/20260915023944_storage_authorization_hardening.sql`,
`supabase/migrations/20260915024652_storage_privilege_hardening.sql`,
`supabase/migrations/20260915024929_storage_anon_guard.sql`,
`supabase/migrations/20260915150556_storage_integrity_and_probe_hardening.sql` y
`supabase/migrations/20260915151825_storage_backend_schema_grant.sql`,
`supabase/migrations/20260915155724_storage_readiness_and_acl_hardening.sql` y
`supabase/migrations/20260915163356_storage_bucket_mime_and_mutation_hardening.sql` y
`supabase/migrations/20260915180409_storage_ready_claim_fail_closed.sql`,
`supabase/migrations/20260915191743_storage_owner_session_visibility.sql` y
`supabase/migrations/20260915192003_storage_session_guard_grant.sql`. La sonda
transaccional reproducible está en
`scripts/supabase/storage-private-objects-remote-probe.sql` y el contrato pgTAP
en `supabase/tests/database/storage_private_objects.test.sql`.

## Flujo de migración diferido

1. Exportar un listado de origen sin secretos: identidad de origen opaca,
   proveedor, locator opaco, tamaño, MIME, checksum y estado.
2. Resolver propietario y referencias mediante el mapa de identidades aprobado;
   rechazar todo lo no mapeado.
3. Descargar el blob del origen, verificar tamaño/MIME/checksum y escribirlo con
   ruta determinista y versión nueva.
4. Crear o actualizar metadata de dominio de forma idempotente.
5. Actualizar la referencia de la entidad solo después de tener objeto `ready`.
6. Emitir manifest con conteos, checksums normalizados y rechazos; reconciliar
   filas, referencias y objetos.
7. Ensayar restauración y rollback antes de cambiar ninguna ruta de lectura.

Con el inventario actual este flujo produce un **corte autorizado de cero
binarios**, no una carga ficticia. Antes de ejecutarlo debe existir una consulta
Firebase Storage funcional y una decisión sobre si las URLs externas se
importan como enlaces o se convierten en adjuntos.

## Estado y siguiente fase

| Tarea | Estado | Evidencia / dueño |
|---|---|---|
| F6.1 Inventario de archivos, URLs, incrustaciones y proveedores | cerrada para fuentes versionadas; migración del bucket Firebase excluida | `evidencias/inventario-storage.*`; entorno/dev |
| F6.2 Buckets, rutas, metadata, límites y retención | diseño cerrado | este documento; dev |
| F6.3 Políticas, metadata y estados de Storage | cerrada para PoC; owner-only y sesión activa; ACL interna documentada | migraciones SQL + pgTAP 29/29 + sonda remota 20/20 |
| F6.4 Migración de binarios y manifest | no aplicable al PoC | no se importan documentos históricos de Firebase |
| F6.5 carga, descarga, previews, exportaciones y reconciliación | movida a F7.1/F7.6 | requiere pruebas de usuario e integración funcional |

La inferencia E2E autenticada, HIBP, CI, pgTAP local y las pruebas de usuario se
mantienen fuera de este corte de Storage y se retiran de la ejecución de F6 hacia
F7, sin declararlas completadas.
