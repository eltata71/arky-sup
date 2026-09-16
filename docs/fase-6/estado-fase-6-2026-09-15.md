# Estado de Fase 6 — iteración 2026-09-15

## Resultado

Se ejecutó la pista Storage de la fase sin activar una migración ficticia.
F6.1, F6.2 y F6.3 quedan cerradas para el destino Supabase. F6.4 no aplica al
PoC porque no se migrarán documentos históricos de Firebase; F6.5 queda en F7
porque requiere integración funcional y pruebas de usuario.

Los escenarios que requieren sesión o decisión humana se movieron a F7:

- inferencia autenticada E2E → F7.6;
- carga/descarga, preview, exportación y reconciliación → F7.1/F7.6;
- diagnóstico 429, HIBP, CI y pgTAP → F7 según el plan operativo.

## Cambios

- `scripts/storage/storageInventory.mjs`: escáner PII-safe de fuentes
  versionadas, con categorías separadas para configuración, uso real del SDK,
  URLs, contenido inline, incrustaciones, blobs transitorios y puerto abstracto.
- `scripts/storage/storageInventory.test.mjs`: seis pruebas Node del inventario,
  incluida una regresión contra falsos positivos de `download()`/`remove()`.
- `package.json`: comando `storage:inventory`.
- `docs/fase-6/evidencias/inventario-storage.{json,md}`: salida reproducible.
- `docs/fase-6/diseno-storage-fase-6.md`: buckets, rutas, metadata, límites,
  estados, políticas previstas y flujo de migración diferido.
- `docs/fase-6/plan-fase-6.md`: estados actualizados y pruebas de usuario
  desplazadas a F7.
- `supabase/migrations/20260915012714_storage_private_objects.sql`,
  `20260915013614_storage_policy_error_guards.sql`,
  `20260915023944_storage_authorization_hardening.sql`,
  `20260915024652_storage_privilege_hardening.sql` y
  `20260915024929_storage_anon_guard.sql`,
  `20260915150556_storage_integrity_and_probe_hardening.sql` y
  `20260915151825_storage_backend_schema_grant.sql`,
  `20260915155724_storage_readiness_and_acl_hardening.sql`,
  `20260915163356_storage_bucket_mime_and_mutation_hardening.sql` y
  `20260915180409_storage_ready_claim_fail_closed.sql`,
  `20260915191743_storage_owner_session_visibility.sql` y
  `20260915192003_storage_session_guard_grant.sql`: buckets privados, metadata,
  estados, RPC, rutas, RLS y guardas restrictivas.
- `supabase/tests/database/storage_private_objects.test.sql`: contrato pgTAP
  remoto, 29/29 controles correctos.
- `scripts/supabase/storage-private-objects-remote-probe.sql`: sonda remota
  transaccional, 20/20 controles correctos.
- `supabase/database.types.ts`: contrato API acotado a `file_objects` y sus RPC
  de Storage; no añade tipos de la tabla ni RPC de referencia de plataforma de Fase 5.

## Verificación ejecutada

| Comando | Resultado |
|---|---|
| `node --test scripts/storage/storageInventory.test.mjs` con Node 20 local | **6/6 pruebas correctas**, exit 0 |
| `PATH=/home/tata/.local/node-v20.20.2-linux-x64/bin:$PATH npm run storage:inventory -- --root /home/tata/workspace/arky-sup` | **845 fuentes versionadas escaneadas**, incluyendo configuraciones, `scripts` y contextos; excluye tests/evidencias, exit 0 |
| `npm run typecheck`, `npm run typecheck:strict`, `npm run lint` y checks mecánicos | **correctos** con heap controlado; la ejecución agregada de `quality:static` queda limitada por `exit 137` del entorno |
| `git diff --check` | sin errores |
| `supabase --version` | CLI `2.117.0` |
| `supabase migration list --linked` | **30/30 migraciones** local/remoto sincronizadas |
| `supabase db query --linked --file supabase/tests/database/storage_private_objects.test.sql` | **29/29 controles pgTAP correctos**, exit 0 |
| `supabase db query --linked --file scripts/supabase/storage-private-objects-remote-probe.sql` | **20/20 controles correctos**, exit 0; transacción revertida |
| `supabase storage ls --linked --experimental --output json` | sin objetos históricos importados; los buckets nuevos permanecen vacíos |

El inventario estático observó el bucket configurado en `firebase.ts`, pero no
observó uso del SDK Firebase Storage. La decisión de alcance evita importar ese
bucket histórico. Supabase Storage sí tiene ahora un destino vacío y protegido. La lectura está
limitada al propietario, las rutas se validan contra la metadata, los objetos
`ready` no se mutan directamente, solo el backend confiable puede promoverlos y
`anon` queda bloqueado por una guarda RLS restrictiva; la sonda no dejó fixtures
persistentes. La ACL interna de `storage.objects` mantiene grants administrados
por Supabase que `postgres` no puede revocar; no se trata como una superficie de
la Data API y queda documentado como condición previa a habilitar SQL directo.

## Pendientes por dueño

### Acción del desarrollo ahora

- Mantener sin objetos los buckets del PoC hasta que exista un flujo de producto.
- Si posteriormente se decide administrar archivos reales, integrar el cliente
  contra los RPC y ejecutar las pruebas funcionales de F7.
- No crear ETL, manifest ni carga ficticia desde Firebase.

### Contexto de entorno no requerido para este PoC

- El CLI Firebase instalado no arrancó: `/usr/bin/env: ‘node’: permission denied`.
  No bloquea F6 porque el usuario decidió excluir la migración histórica.
- El stack local Supabase/Docker y pgTAP local siguen siendo materia de F7.1;
  el contrato remoto ya fue ejecutado correctamente.

### Organización / usuario

- Prueba de inferencia autenticada E2E, movida a F7.6.
- Decisión HIBP, mapa UID y recuperación/acuerdo de CI, según plan.
- Aprobación de si las URLs externas deben permanecer como enlaces o convertirse
  en archivos administrados.

## Estado de salida

La pista de Storage queda cerrada para el alcance del PoC: **F6.1, F6.2 y
F6.3 completadas; F6.4 no aplicable; F6.5 desplazada a F7**. La revisión
independiente encontró y se corrigieron autorización de lectura global, rutas sin
validar, prueba anónima vacua y mutación directa de objetos `ready`. Existe
contrato Storage vacío y protegido por RLS en la superficie de aplicación, pero
no migración de binarios ni pruebas funcionales de usuario. La verificación de
bytes/checksum real queda en F7 junto con el flujo de carga.
