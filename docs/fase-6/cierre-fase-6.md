# Fase 6 — Cierre: contrato de Storage privado preparado para el PoC

Rama: `main`. Base: `eb703aa` (`origin/main`).
Fecha de cierre técnico: `2026-09-15`. Sin push.

## 1. Estado por tarea

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| F6.1 Inventario de archivos, URLs, incrustaciones y proveedores | Hecha para fuentes versionadas; se excluye la migración histórica de Firebase | `docs/fase-6/evidencias/inventario-storage.md`, `docs/fase-6/evidencias/inventario-storage.json` |
| F6.2 Diseño de buckets, rutas, metadata, límites, retención y borrado | Hecha | `docs/fase-6/diseno-storage-fase-6.md` |
| F6.3 Políticas, metadata, estados y permisos de Storage | Hecha para el PoC y aplicada al proyecto remoto; owner-only y sesión activa; ACL interna administrada documentada | migraciones Storage hasta `20260915192003` |
| F6.4 Migración de binarios y manifest desde Firebase | No aplicable al PoC; no se ejecuta | Decisión de alcance registrada en este documento y en `docs/fase-6/plan-fase-6.md` |
| F6.5 Carga, descarga, previews, exportaciones y reconciliación | Movida a Fase 7 | `docs/fase-6/plan-fase-6.md`, F7.1/F7.6 |

## 2. Resultados verificados

- `node --test scripts/storage/storageInventory.test.mjs`: exit `0`; 6/6 pruebas correctas.
- `PATH=/home/tata/.local/node-v20.20.2-linux-x64/bin:$PATH npm run storage:inventory -- --root /home/tata/workspace/arky-sup`: exit `0`; 845 fuentes versionadas escaneadas y evidencia Markdown/JSON generada sin contenido fuente completo.
- `npm run typecheck`, `npm run typecheck:strict`, `npm run lint` y los checks mecánicos: exit `0` con heap controlado; una ejecución posterior de `quality:static` terminó en `exit 137` por presión de memoria del entorno y no se presenta como gate verde actual.
- `supabase db push --linked --dry-run`: exit `0`; no quedaron migraciones locales pendientes antes del cierre.
- `supabase migration list --linked`: exit `0`; 30/30 migraciones locales y remotas sincronizadas.
- `supabase db query --linked --file supabase/tests/database/storage_private_objects.test.sql`: exit `0`; 29/29 controles del contrato correctos.
- `supabase db query --linked --file scripts/supabase/storage-private-objects-remote-probe.sql`: exit `0`; 20/20 controles correctos y la transacción revirtió sus fixtures.
- Variante deliberadamente alterada de la sonda: exit `1` con `Storage probe failed`, demostrando el comportamiento fail-closed.
- Revisión independiente y correcciones: lectura limitada al propietario; bucket/contexto, ruta y metadata física deben coincidir; solo el backend confiable promueve `ready`; esos objetos no se actualizan ni eliminan desde el cliente; `anon` queda bloqueado por RLS; el inventario usa `git ls-files` y excluye fixtures/evidencias.
- `supabase db query --linked "... catálogo de buckets, objetos y metadata ..."`: proyecto remoto con dos buckets privados, 0 objetos y 0 filas de metadata de `api.file_objects`.
- Revisión de catálogo remoto: `api.file_objects` tiene RLS y `FORCE ROW LEVEL SECURITY`; el cliente autenticado solo tiene `SELECT`, sin `INSERT`, `UPDATE` ni `DELETE`. En `storage.objects`, Supabase mantiene grants gestionados de `UPDATE` y `DELETE`, pero las políticas RLS y el trigger nativo bloquean la mutación directa; las funciones RPC son `SECURITY DEFINER`, fijan `search_path` vacío y no son ejecutables por `anon`.
- `supabase db advisors --linked --type security --level info --fail-on none --output-format json`: exit `0`; no reportó una alerta específica de los objetos/buckets de esta implementación. Reportó pendientes preexistentes, incluido HIBP desactivado y tablas RLS sin políticas, que permanecen fuera de este cierre.
- `supabase db advisors --linked --type performance --level warn --fail-on none --output-format json`: exit `0`; reportó una advertencia preexistente sobre políticas permisivas de `api.user_profiles`, fuera de F6.3.
- `supabase/database.types.ts` conserva el contrato generado compartido del proyecto; en este corte solo se consumen los símbolos de `api.file_objects` y sus RPC de Storage. No se modificaron migraciones ni comportamiento de Fase 5.
- `git diff --check`: sin errores.

La tabla `storage.objects` mantiene los grants estándar del subsistema Storage,
incluido `TRUNCATE` administrado por `supabase_storage_admin`; el rol de
migración `postgres` no puede revocarlo. La superficie de aplicación queda
filtrada por RLS y por las políticas `storage_poc_*`, y el esquema `storage` no
forma parte del esquema API declarado por este proyecto. Si se habilita SQL
directo para roles de cliente, debe resolverse esta limitación con Supabase
antes de producción. No se creó ningún bucket público ni se importó ningún
objeto del bucket histórico de Firebase.

## 3. Pendientes

**Míos, accionables ahora**

- No queda una tarea técnica de Fase 6 abierta dentro del alcance del PoC.
- Mantener los buckets sin objetos hasta que exista un flujo de producto.
- No crear ETL, manifest ni carga ficticia desde Firebase.

**Míos, bloqueados por el entorno**

- El pgTAP local y la ejecución completa de CI siguen pendientes por la falta de
  stack local/runners; el contrato equivalente quedó probado contra el proyecto
  remoto mediante la sonda transaccional. Se retoma en F7.1.
- La prueba funcional de carga/descarga todavía no se ejecuta porque no existe un
  cliente de producto que use estos buckets. Se retoma en F7.1/F7.6.

**De la organización**

- Decisión HIBP, mapa Firebase UID → UUID Supabase y recuperación/acuerdo de CI,
  según el plan operativo.
- Prueba de inferencia autenticada E2E y diagnóstico del `429` del proxy IA,
  movidos a F7.
- Decidir en F7 si las URLs externas permanecen como enlaces o se convierten en
  archivos administrados.

**Cerrados en este cierre**

- Exclusión de la migración histórica del bucket Firebase: alcance del PoC
  confirmado por el usuario el `2026-09-15`; referenciado en `plan-fase-6.md` y
  `diseno-storage-fase-6.md`.
- Contrato Storage privado: aplicado al remoto y verificado con 29/29 controles
  pgTAP y 20/20 casos de sonda transaccional, incluyendo owner-only y cuenta
  deshabilitada.
- Pruebas que requieren sesión de usuario: desplazadas a Fase 7; no se declaran
  realizadas desde SQL.

## 4. Cambios en el árbol

- `supabase/migrations/20260915012714_storage_private_objects.sql` y las
  migraciones aditivas `20260915013614_storage_policy_error_guards.sql`,
  `20260915023944_storage_authorization_hardening.sql`,
  `20260915024652_storage_privilege_hardening.sql`,
  `20260915024929_storage_anon_guard.sql`,
  `20260915150556_storage_integrity_and_probe_hardening.sql`,
  `20260915151825_storage_backend_schema_grant.sql` y
  `20260915155724_storage_readiness_and_acl_hardening.sql`,
  `20260915163356_storage_bucket_mime_and_mutation_hardening.sql`,
  `20260915180409_storage_ready_claim_fail_closed.sql`,
  `20260915191743_storage_owner_session_visibility.sql` y
  `20260915192003_storage_session_guard_grant.sql` — esquema, buckets, estados, RPC,
  rutas y políticas.
- `supabase/tests/database/storage_private_objects.test.sql` — contrato pgTAP.
- `scripts/supabase/storage-private-objects-remote-probe.sql` — verificación
  transaccional remota.
- `scripts/storage/` y `package.json` — inventario reproducible.
- `docs/fase-6/` — actas, plan, diseño y evidencias. `docs/fase-5/cierre-fase-5.md`
  queda fuera de este staging y de este commit.
- Sin cambios de dependencias, secretos ni documentos del bucket Firebase.

## 5. Siguiente paso recomendado

Iniciar F7.1 con pruebas de calidad, CI/pgTAP y revisión de seguridad transversal.
Después resolver el diagnóstico `429` y la inferencia autenticada E2E antes de
cualquier corte productivo. F6 no requiere más trabajo de Storage hasta que
exista un flujo funcional que justifique cargar objetos.

## 6. Commits

- Commit base: `eb703aa`.
- Commit de implementación Storage: se registrará al separar y verificar el
  cambio de código de este cierre.
- El cierre documental se realizará en un commit independiente, sin push.
