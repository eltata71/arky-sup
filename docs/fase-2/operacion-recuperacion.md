# F2.5–F2.6 — Operación y recuperación de la PoC

## Estado y alcance

Un solo proyecto Supabase **existente**, aplicación en **Vercel**, datos de PoC. No se crean proyectos, ambientes remotos, servicios pagados ni tareas programadas. Base de diseño: [cierre F1](../fase-1/cierre-fase-1.md), [ADR-006](../fase-1/adrs.md), [modelo PostgreSQL](../fase-1/modelo-postgresql.md) y [autorización](../fase-1/modelo-autorizacion.md).

- **Implementado y probado offline:** CLI real de respaldo PostgreSQL + descarga de binarios Storage; manifiesto SHA-256; verificación; restauración exclusivamente local; reconciliación de conteos PostgreSQL y lectura completa de los objetos restaurados; logs por allowlist; evaluador manual de umbrales.
- **No se hizo backup ni escritura remota.** Las pruebas HTTP hablan con un servidor de fixtures en loopback, no con Supabase.
- **F2.6 no se declara ensayada de extremo a extremo:** en esta sesión faltan `pg_dump`, `pg_restore`, `psql`, Docker y servicios locales PostgreSQL/Storage. La CLI Supabase está presente, pero no reemplaza un motor PostgreSQL/Storage ni demuestra recuperación.
- **F2.5 es una base operativa manual**, no alertas SaaS activadas ni auditoría de negocio ya conectada a la aplicación. La instrumentación de cada comando sensible corresponde a sus cortes F4/F5. No se modificaron `package*`, CI ni `supabase/` desde este trabajo.

## Herramientas y contratos

| Archivo | Función |
| --- | --- |
| `scripts/operations/recovery.py` | `backup`, `verify`, `restore-local`, PostgreSQL nativo y Storage HTTP |
| `scripts/operations/metrics.py` | Entrada JSON numérica por stdin; evalúa umbrales sin red |
| `scripts/operations/test_*.py` | Unitarias, filesystem y HTTP local con fixtures explícitos |

Requisitos: Python 3.12 estándar, sin paquetes Python adicionales; `pg_dump`, `pg_restore`, `psql` en PATH para operaciones reales. Usar clientes PostgreSQL compatibles con la versión del origen y comprobar sus `--version`/`--help`. No instalar globalmente como parte de estas pruebas.

### Qué contiene un respaldo

- `database.dump`: `pg_dump --format=custom` de la base completa, incluyendo Auth y metadatos Storage accesibles a la cuenta. Se valida su catálogo con `pg_restore --list`. No incluye roles globales, contraseñas de roles, secretos del dashboard, funciones desplegadas ni configuración de Vercel.
- `blobs/00000000.bin`, etc.: **bytes reales descargados**, no solamente filas `storage.objects`. Los nombres originales nunca son rutas locales; están en el manifiesto protegido.
- `manifest.json`: versión, momento UTC, reconocimiento de congelación de escrituras, configuración de buckets estándar, nombres de objetos, MIME, tamaños y SHA-256 de cada archivo; conteos por tabla PostgreSQL salvo `storage` y catálogos internos.
- `manifest.sha256`: recibo de integridad del manifiesto. **Conservar su digest también por un canal independiente confiable**. Un hash junto al archivo detecta corrupción accidental, no manipulación de ambos por un atacante.

La captura es secuencial, no una transacción distribuida PostgreSQL/Storage. Antes de empezar, el operador debe detener escrituras desde UI, jobs, Auth y otros clientes; `--ack-writes-paused` registra esa responsabilidad, **no pausa nada**. Se vuelve a listar Storage y se rechaza un inventario modificado, pero esto no sustituye la congelación. Los conteos se capturan después del dump con el origen aún quieto. No se garantiza coherencia ante cambios concurrentes.

## Seguridad y límites de restauración (leer antes)

1. `restore-local` solo admite hosts **literales** `127.0.0.1` o `::1` en ambos endpoints y la confirmación exacta `RESTORE_DISPOSABLE_LOCAL`. Rechaza DNS incluso `localhost`, query strings, fragmentos, redirecciones HTTP, proxies de entorno y nombres de base interpretables como conninfo. No existe `--force-remote`.
2. Un túnel hacia el proyecto remoto también puede escuchar en loopback: **prohibido usar túneles, forwarders o proxies a remoto**. Verificar el proceso dueño del puerto; ejecutar el ensayo en un sandbox local sin salida a red. El guard de URL no es un firewall.
3. Solo restaurar respaldos de origen confiable. Un dump PostgreSQL puede ejecutar SQL con funciones o triggers; el checksum no convierte SQL hostil en seguro.
4. `pg_restore --clean --if-exists --single-transaction --exit-on-error --no-owner --exclude-schema=storage` **destruye/recrea objetos fuera de Storage en la base local indicada**. La base debe ser desechable y tener roles/extensiones/versiones compatibles. No se usa `--create`, para no cambiar de base según el nombre guardado en el dump. Auth y servicios que escriben deben estar detenidos durante la fase de base de datos.
5. El Storage local debe estar inicializado, sin buckets y con su esquema gestionado compatible. Sus políticas iniciales no deben depender de funciones/tablas que la restauración vaya a borrar. **No se restaura por SQL `storage.objects`**: sus versiones/metadatos no reconstruyen archivos del backend. Buckets y blobs se recrean por la API. `x-upsert=false`; no borra ni sobrescribe objetos existentes. Un destino con buckets se rechaza antes de restaurar PostgreSQL.
6. Las políticas/grants/índices de aplicación sobre `storage` **se deben reaplicar desde las migraciones revisadas del repositorio**, no desde el dump. No ejecutar `db reset` después de restaurar: borraría lo recuperado. `--no-owner` tampoco conserva propietarios SQL; revisar funciones `SECURITY DEFINER`, roles y grants antes de cualquier aceptación funcional.
7. La API administrativa recrea objetos con IDs/timestamps/versiones nuevos y **sin el `owner_id` original**. Se recuperan bucket/ruta/bytes/MIME y configuración básica del bucket, no todas las propiedades originales. Si existen políticas que dependen de `owner_id`, referencias a `storage.objects.id`, metadatos personalizados, lifecycle, caché o configuraciones adicionales, **el ensayo funcional queda bloqueado** hasta definir y probar su reconciliación vía API/flujo autorizado. No parchear tablas gestionadas Storage directamente. El dump conserva los metadatos originales como evidencia restringida.
8. Soporta buckets `STANDARD`, no Analytics/Vector. Upload estándar acotado a **50 MiB por objeto como límite de esta herramienta**, no como cuota del plan. Se rechazan objetos superiores antes de escribir la base destino; el backup puede conservarlos, pero requerirán otro transporte de restauración probado. No hay reanudación automática ni retry de escrituras.
9. PostgreSQL se restaura en una transacción; PostgreSQL + Storage **no** forman una sola transacción. Si falla la carga o lectura de un blob, el código sale distinto de cero y puede quedar un destino parcialmente reconstruido. Investigar y recrear **solo el sandbox local** antes de reintentar; no borrar objetos automáticamente.
10. Verificar un archivo y contar filas no prueba la semántica del dominio, continuidad de sesiones, RLS ni igualdad de todos los valores SQL. El éxito técnico requiere además smoke tests e invariantes F1. `restore_verified` significa conteos/archivos reconciliados, no autorización funcional aprobada ni aceptación de producción.

### Credenciales y datos

Credenciales únicamente mediante variables de entorno. Nunca `VITE_*`, argumentos, commits, capturas ni logs; desactivar `set -x`. La conexión de origen usa TLS `verify-full`, con `ARKY_PGSSLROOTCERT` opcional para la CA del proyecto; elegir conexión directa o session pooler, no transaction pooler. La URL PostgreSQL debe indicar una base con nombre simple y no incluir parámetros; el script descompone la URL y descarta variables `PG*` heredadas que puedan cambiar host/servicio. Contraseñas viajan al subproceso en `PGPASSWORD`, no en argv: requiere una máquina y usuario de sistema confiables.

Storage admite secret keys `sb_secret_…` en `apikey` sin enviarlas como Bearer; para instalaciones locales antiguas admite JWT `service_role` (el servidor valida su firma). Rechaza claves públicas y tokens que no declaren ese rol para evitar respaldos vacíos por RLS. El operador debe comprobar que ambos endpoints origen pertenecen al mismo proyecto; la herramienta no deriva el vínculo entre las credenciales PostgreSQL y Storage.

La CLI usa `umask 077`, directorio nuevo con permisos 0700 y archivos privados. **No cifra el respaldo.** Puede contener usuarios, hashes de contraseña, secretos de tablas/Vault y nombres privados: guardar fuera del repositorio en volumen cifrado, con copia externa cifrada y acceso restringido. No publicar ni el manifiesto. Un respaldo interrumpido permanece incompleto para diagnóstico local; sin recibo y verificación exitosa no es recuperable aceptado.

## Procedimiento de backup autorizado

Estos comandos se documentan para ejecución por el operador; **no se ejecutaron contra el proyecto remoto**.

```bash
# Bash; inyectar secretos desde gestor o prompts silenciosos, nunca escribirlos aquí.
set +x
umask 077
read -r -s -p 'DB origen: ' ARKY_SOURCE_DB_URL; printf '\n'
read -r -s -p 'URL Supabase origen: ' ARKY_SOURCE_STORAGE_URL; printf '\n'
read -r -s -p 'Secret Storage origen: ' ARKY_SOURCE_STORAGE_KEY; printf '\n'
export ARKY_SOURCE_DB_URL ARKY_SOURCE_STORAGE_URL ARKY_SOURCE_STORAGE_KEY
mkdir -p "$HOME/arky-backups"
BACKUP="$HOME/arky-backups/poc-001"  # Debe NO existir todavía.

# Solo tras congelar escrituras y confirmar que ambos endpoints son del mismo proyecto.
python3 scripts/operations/recovery.py backup \
  --directory "$BACKUP" --ack-writes-paused

# Guardar copia del digest en el registro seguro del operador antes de trasladar archivos.
IFS= read -r EXPECTED_SHA256 < "$BACKUP/manifest.sha256"
python3 scripts/operations/recovery.py verify \
  --directory "$BACKUP" --manifest-sha256 "$EXPECTED_SHA256"
unset ARKY_SOURCE_DB_URL ARKY_SOURCE_STORAGE_KEY
```

`backup` y `verify` devuelven 0 solo al completar su contrato; 1 en fallo operativo y 2 para argumentos inválidos. No inferir éxito de que exista `database.dump`. La salida deliberadamente no incluye excepciones, SQL, URLs, rutas, respuestas de proveedores ni secretos; ante fallo revisar primero prerrequisitos, permisos, versiones y espacio de disco mediante herramientas controladas, sin habilitar logging indiscriminado de credenciales.

## Ensayo local pendiente

1. Crear un sandbox desechable de PostgreSQL + Storage compatible siguiendo la guía local F2, **sin crear un segundo proyecto remoto**. Verificar dueños de puertos y ausencia de túneles. Preparar roles/extensiones y esquema gestionado Storage; no inyectar claves remotas en ese sandbox.
2. Obtener un backup confiable con al menos un objeto binario no vacío y tablas de PoC relacionadas. Verificarlo antes de empezar el reloj de recuperación.
3. Preparar endpoints locales mediante prompts silenciosos y ejecutar:

```bash
read -r -s -p 'DB local desechable: ' ARKY_TARGET_DB_URL; printf '\n'
read -r -s -p 'URL Supabase local: ' ARKY_TARGET_STORAGE_URL; printf '\n'
read -r -s -p 'Secret Storage local: ' ARKY_TARGET_STORAGE_KEY; printf '\n'
export ARKY_TARGET_DB_URL ARKY_TARGET_STORAGE_URL ARKY_TARGET_STORAGE_KEY
python3 scripts/operations/recovery.py restore-local \
  --directory "$BACKUP" --manifest-sha256 "$EXPECTED_SHA256" \
  --confirm RESTORE_DISPOSABLE_LOCAL
unset ARKY_TARGET_DB_URL ARKY_TARGET_STORAGE_KEY
```

4. La CLI verifica **todos** los checksums antes de escribir, cuenta tablas tras restaurar y descarga otra vez **todos** los blobs para comparar bytes/SHA-256, además del inventario/configuración básica de buckets.
5. Reaplicar exclusivamente las políticas Storage de aplicación revisadas, resolver los límites de ownership señalados arriba, arrancar los servicios locales detenidos y ejecutar las pruebas RLS/contratos F2.4 y smoke tests por rol/invariantes F1. Un login exitoso no basta; probar rechazo anónimo, referencias entre agregados y descarga autorizada/denegada.
6. Registrar en acta restringida: revisión Git, versiones servidor/cliente, digest independiente, horas de inicio/fin, filas esperadas/observadas, objetos/bytes esperados/observados, resultado por rol, incidencias y aceptación humana. No registrar identidades ni URLs firmadas. Medir RTO real; no rellenarlo con el tiempo de unit tests.

**Objetivos iniciales para acordar, no SLA medidos:** RPO 24 h durante actividad PoC y backup adicional antes de cada cambio destructivo; RTO 2 h pendiente de ensayo. Retención propuesta: últimos 7 respaldos diarios verificados y un respaldo previo al último cambio. No hay borrado automático; aprobar retención y protección de datos con el responsable.

## F2.5 — Logs, auditoría y revisión manual

`recovery.log_event` acepta exclusivamente eventos `backup_verified`, `archive_verified`, `restore_verified`, `operation_failed`; campos numéricos finitos no negativos `duration_ms`, `objects`, `bytes`. Todo campo extra se descarta. Ni errores crudos ni nombres de archivos/tablas/usuarios salen por ese logger. Esta allowlist protege **estas herramientas**, no sanea automáticamente logs de Supabase/Vercel.

Revisión antes de cada sesión PoC y tras cambios; responsable humano de la PoC, suplente por designar. En Supabase usar Reports/Logs Explorer; en Vercel revisar errores del despliegue y requests de API si están disponibles en el plan. No activar Sentry, drains o Analytics pagados sin autorización. Acceso mínimo a dashboards; no exportar `event_message`, bodies, headers Authorization/Cookie, JWT, emails, IP, prompts, SQL con parámetros ni URLs firmadas a repositorios/chat. Usar agregados por servicio/operación/resultado y ventana temporal. La retención real de proveedores queda pendiente de verificar en sus dashboards.

**Auditoría de negocio separada:** los comandos provisionar, cambiar rol, decidir ARB, publicar y rotar clave deberán escribir desde backend confiable la operación, resultado, timestamp y correlación opaca; actor/recurso mínimos quedan en la tabla restringida de auditoría, no en stdout. Payloads libres, contenido de artefactos y secretos quedan fuera. Revisar RLS de lectura y prohibir UPDATE/DELETE desde cliente; el modelo F1 es diseño, no evidencia de instrumentación ya desplegada. No se afirma que exista esa conexión por añadir este runbook.

### Métricas y acciones (política local de PoC)

| Observación | Aviso desde | Crítico desde | Acción manual |
| --- | --- | --- | --- |
| Edad último backup verificado | 24 h | 48 h | No hacer cambios destructivos; generar/verificar backup |
| Edad último ensayo real | 30 días | 45 días | Agendar ensayo; no expandir piloto sin aceptación |
| HTTP 5xx / requests, ventana 15 min | 1 % | 5 % | Correlacionar despliegue, Auth/DB/Storage; detener pruebas de carga |
| p95 API, ventana 15 min | 1000 ms | 3000 ms | Revisar consultas, bloqueos y reintentos; no escalar por reflejo |
| Conexiones DB / límite **observado** | 70 % | 90 % | Revisar clientes/pooling/conexiones ociosas |
| Uso / cuota **confirmada** | 70 % | 90 % | Revisar tamaño DB, Storage, egress, requests y retención |
| Gasto / presupuesto **aprobado** | 70 % | 90 % | Avisar al responsable; pausar cargas no esenciales; no comprar automáticamente |
| Edad evento outbox pendiente | 300 s | 900 s | Inspeccionar consumidor/idempotencia sin imprimir payload |

Usar porcentajes sobre denominadores conocidos y registrar ventana/tamaño de muestra en la bitácora. Con tráfico muy bajo, un porcentaje alto requiere inspección de los eventos contados; no es evidencia estadística de degradación sostenida. Outbox se mide solo cuando esté implementada. No inventar datos faltantes ni tratarlos como cero.

```bash
# observaciones.json privado: solo valores numéricos obtenidos del dashboard/medición.
python3 scripts/operations/metrics.py < /ruta/privada/observaciones.json
```

Claves admitidas: `backup_age_hours`, `restore_drill_age_days`, `api_5xx_percent`, `api_p95_ms`, `db_connections_percent`, `quota_used_percent`, `budget_used_percent`, `outbox_oldest_seconds`. Campos desconocidos no se propagan. Salida explicita `missing` y `scope=supplied_observations_only`: `ok` solo aplica a las mediciones entregadas, no a toda la plataforma. Códigos 0 saludable, 1 aviso, 2 crítico, 3 desconocido/entrada inválida. No hay watcher ni notificaciones enviadas; el operador revisa el código y avisa por el canal acordado.

### Plan y costes: verificación pendiente

Consultar en el **proyecto existente** y la cuenta Vercel: plan real, región, cuota por producto, gasto del periodo, presupuesto autorizado, disponibilidad/retención de backups administrados, PITR y coste incremental antes de activarlo. Registrar valores y fuente/fecha en la bitácora privada. **No se atribuye un plan ni un coste a esta PoC.** Los respaldos nativos PostgreSQL no incluyen binarios Storage; una descarga manual consume tráfico/egress y el almacenamiento externo también puede tener coste. No presuponer que un plan permite descargar todos los backups físicos o que PITR está contratado.

## Evidencia ejecutada en esta implementación

```bash
python3 -m unittest discover -s scripts/operations -p 'test_*.py' -v
python3 scripts/operations/recovery.py --help
git diff --check
npm run quality
```

- **18 pruebas aprobadas**: guard de destino local, query/conninfo, secreto no Bearer, rechazo de claves públicas, allowlist, archivo/manifiesto corrupto/incompleto, traversal/symlink/duplicados, límite previo a escritura, entorno PG saneado, argumentos sin secretos, backup/restauración mediante adaptadores ficticios y HTTP real sobre fixture loopback con paginación/rutas anidadas/binarios/redirecciones.
- Test de CLI de métricas sin observaciones: salida `unknown`, ocho mediciones faltantes, exit 3; no simuló gasto real.
- `git diff --check`: sin errores. `--help`: exit 0.
- `npm run quality`: typecheck y typecheck strict pasaron; se detuvo en lint con **29 errores preexistentes** de `docs/fase-0/evidencias/f04-local-probes.cjs` (`require`, globals Node). Archivo rastreado y no modificado en esta tarea. Coverage/build/gates posteriores no llegaron a ejecutarse; no se afirma quality verde.
- `command -v` y puertos locales: no `pg_dump`, `pg_restore`, Docker ni listeners PostgreSQL/Storage habituales; por tanto **no hay evidencia de un ensayo PostgreSQL+Storage real**. Los fixtures nunca se presentan como dumps o respuestas reales del proyecto.

## Documentación vigente consultada

Consulta durante esta implementación; se revisó primero el [changelog](https://supabase.com/changelog.md).

- [Backups de base de datos](https://supabase.com/docs/guides/platform/backups): exclusión de binarios Storage y disponibilidad según plan.
- [Backup/restore CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore): conexión directa/session pooler y prerrequisitos.
- [API Storage](https://supabase.com/docs/reference/self-hosting-storage): endpoints de buckets, listado, descarga y upload.
- [Esquema Storage](https://supabase.com/docs/guides/storage/schema/design): tratar metadatos como solo lectura y modificar objetos por API.
- [Ownership Storage](https://supabase.com/docs/guides/storage/security/ownership): `owner_id`, ausencia de dueño al crear con clave administrativa.
- [API keys](https://supabase.com/docs/guides/api/api-keys): secret frente a JWT `service_role`, no Bearer para secret keys.
- [Monitoring and debugging](https://supabase.com/docs/guides/monitoring-and-debugging).
- [Cambio logs.all → logs](https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint): usar dashboard o nueva API ClickHouse, no implementar integraciones sobre el endpoint retirado. Estas herramientas no llaman ninguno de los dos.
- [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html): transacción, limpieza, exclusión de esquemas, conninfo y confianza del dump.

La ruta inicialmente consultada `storage/management/backup-and-restore.md` devolvió 404; se reemplazó por las referencias oficiales de API, esquema y ownership anteriores, no por supuestos de funcionamiento.
