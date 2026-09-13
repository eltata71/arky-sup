# Fase 5 — Corte vertical 1: preferencias de usuario

**Rama:** `feature/fase5-piloto-configuracion`  
**Proyecto remoto:** ArkyDB-US (`btbhkmckrazoayaoorys`, `us-east-1`)  
**Estado:** piloto implementado y verificado. La fase continúa con los cortes de negocio, no se declara completada por este piloto.

## Decisión del corte (F5.1)

Se midió el código existente y se eligió `settings/user_{uid}` porque es un único
documento propietario, tiene su repositorio propio (`services/settings`) y no
referencia iniciativas, proyectos, encargos, artefactos ni archivos. Es el
corte de menor criticidad y acoplamiento observado.

Queda expresamente **fuera** del corte `settings/global`: no tiene propietario
autenticado y sigue en Firebase/local. Las claves BYOK no se persistían en el
tipo `Settings`, se guardan localmente por diseño y se excluyen de cualquier
payload remoto aunque sean inyectadas fuera del tipo.

## F5.2 — Modelo, RLS, adaptador y UI

- Migración: `20260912060510_user_settings_pilot.sql`.
- Tabla `api.user_settings`: `id` FK a `auth.users`, `settings jsonb`, revisión
  optimista, marcas de tiempo y restricciones de objeto JSON / ausencia de
  cualquier `apiKey` anidada.
- RLS: el autenticado solo puede leer su fila. No recibe `INSERT`/`UPDATE`
  directos ni el anónimo recibe acceso.
- Escritura: RPC `api.save_user_settings(settings, expected_revision)`, que
  comprueba permiso `settings:manage`, sesión activa y revisión esperada. El
  error `P0001` significa conflicto, no reintento ni éxito.
- Adaptador: `SupabaseSettingsRepository` recibe el cliente por inyección.
  `settingsRepository` decide por `VITE_BACKEND_SETTINGS=supabase`; sin la
  bandera, sin uid o para el documento global, se conserva la ruta anterior.
- No hay dual-write ni fallback a Firebase para un usuario autenticado cuando
  Supabase está activado. En una caída de red solo se conserva borrador local
  como no confirmado (`success: false`).
- El SDK se carga perezosamente en `services/adapters/supabaseDataBackend.ts`.
  No se usa ni se expone `service_role` en el navegador.

## F5.3 — ETL versionada e idempotente

`scripts/migration/settings_etl.py` es una herramienta local sin conexión a
Firebase ni Supabase. Recibe una exportación consistente en JSON y un mapa
explícito `{firebaseUid: supabaseUuid}`. No deriva UUIDs por suposición.

Produce NDJSON canónico y manifiesto `settings-etl-v1` con un checksum SHA-256
normalizado por registro. Rechaza documentos con forma inválida o sin mapa de
identidad; elimina `apiKey` recursivamente antes de escribir cualquier salida.
La carga efectiva debe ejecutarse después, con sesión/provisión Supabase y la
RPC autorizada; la ETL no contiene credenciales ni hace inserciones privilegiadas.

## F5.4, F5.6 y F5.7 — Integridad, concurrencia y transición

- Reconciliación: compara ids y checksums de los registros contra el manifiesto;
  faltantes, sobrantes o checksum distinto son hallazgos bloqueantes.
- Fechas/autoría/relaciones: no aplican al agregado de preferencias; la tabla
  conserva `created_at`/`updated_at` de destino. No se afirma preservar fechas
  de Firestore para este corte porque la exportación observada no está disponible.
- Concurrencia: revisión inicial 1 e incremento atómico en RPC; dos escrituras
  con la misma revisión solo permiten una. El conflicto se muestra al llamador.
- Suscripciones/paginación: no son necesarias para un único registro leído al
  arranque. El diseño no habilita Realtime por conveniencia.
- Offline: el borrador local no se anuncia como guardado; no hay cola de
  dual-write. Reconciliar antes de repetir la carga es obligatorio.
- Fuente única: durante la ventana del piloto, una vez habilitado
  `VITE_BACKEND_SETTINGS=supabase` para una cuenta piloto, Supabase es la única
  fuente de escritura de sus preferencias. La reversión es quitar esa bandera;
  no se borra Firebase ni se elimina la tabla durante el piloto.

## Evidencia ejecutada

| Comprobación | Resultado |
| --- | --- |
| Contrato SQL nativo PG 16, dos reconstrucciones | `user_settings_pilot`: 14/14; autorización: 51/51; fundación: 41/41; `plpgsql_check` sin hallazgos |
| Mutación deliberada de RLS | Detectada en ambas reconstrucciones |
| Sonda contra PG 17 remoto, transacción revertida | 26/26 casos, cero `FALLO`; incluye creación, conflicto y acceso cruzado de preferencias |
| Adaptadores y repositorio | 20 pruebas dirigidas en verde |
| ETL y reconciliación | 3 pruebas Python; corrida sintética: 1 registro, manifiesto reconciliado, sin filtración de clave |
| Tipos | Regenerados desde ArkyDB-US; incluyen `user_settings` y `save_user_settings` |

## Siguientes cortes F5.5

No se migraron iniciativas, proyectos/atenciones, encargos/ARB, artefactos,
publicación, conocimiento ni aprendizaje en este cambio. Requieren su propio
grafo de agregados, relaciones y una exportación real de la PoC. La consistencia
de cada agregado prevalecerá sobre el orden tentativo del plan.

Antes de activar este piloto en Vercel se necesitan: URL y clave publicable en
variables de entorno, `VITE_BACKEND_SETTINGS=supabase` solo para el piloto y
una identidad Supabase provisionada con perfil activo. No se incluyeron secretos
en el repositorio.
