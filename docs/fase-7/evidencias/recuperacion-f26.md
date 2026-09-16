# F2.6 — Ensayo real de respaldo/restauración (drill desechable local)

**Fecha:** 2026-09-16Z. **Herramienta:** `scripts/operations/recovery.py`
(más dos correcciones validadas por este ensayo, abajo).
**Producción nunca contactada:** sin URLs remotas, sin credenciales remotas,
sin túneles. Clústeres PostgreSQL 16.15 desechables (usuario, sin sudo) y
stub Storage en `127.0.0.1` (solo drill, en `/tmp`, fuera del repo).
El wrapper del drill usa `set -euo pipefail` y cleanup por `trap`: si backup,
verify o restore falla, no continúa ni publica una evidencia verde. La
Las notificaciones históricas `proc_bf3249f14c48` y `proc_2af7e710d022`
ejecutaron el wrapper anterior (`set -u`) y reportaron el digest antiguo
`70c70ca2…`. `proc_bf3249f14c48` obtuvo `RESTORE-EXIT=1` por destino sin
esquema `api`, pero continuó y terminó con exit 0; `proc_2af7e710d022`
repitió ese wrapper antiguo. No son evidencia válida del árbol actual.

## Resultado

| Paso | Comando | Salida |
|---|---|---|
| Backup | `recovery.py backup --directory $D/archive --ack-writes-paused` | `backup_verified`, exit 0 (pg_dump custom real + 1 blob real + manifiesto) |
| Verify | `recovery.py verify --directory … --manifest-sha256 $DIGEST` | `archive_verified`, exit 0 |
| Restore | `recovery.py restore-local --confirm RESTORE_DISPOSABLE_LOCAL` | `restore_verified`, exit 0 (conteos + inventario + relectura byte a byte) |

- Origen: esquema migrado completo (bootstrap + 30 migraciones + seed),
  `api.platform_probes` 2 filas / `private.audit_events` 2 filas.
- Manifiesto: 1 bucket (`drill-bucket`), 1 objeto binario, 20 tablas;
  digest `9d246227aec0303c6251f2995b3bfc3850fb78434ea84904bc8892073292b349`
  (log completo en `/tmp/drill/evidence.log`).
- Destino: filas 2\|2 reconciliadas, bucket recreado por API, blob
  re-descargado con SHA-256 coincidente.

## Hallazgos reales del ensayo (con fix aplicado y verificado)

1. **`pg_restore --clean --exclude-schema=storage` destruye el shell de
   buckets** (`DROP SCHEMA storage` se emite igual). Fix en `recovery.py`:
   `restore()` filtra la TOC (`pg_restore --list` → `--use-list`) excluyendo
   el esquema `storage` por token exacto; los helpers `storage_*` de otros
   esquemas se conservan. Sin este fix, el restore falla.
2. **El destino debe proveer lo gestionado por la plataforma** (paso previo
   del operador, ahora documentado): roles `anon`/`authenticated`/
   `service_role` + shell `storage.buckets` con filas del manifiesto, porque
   `api.file_objects` tiene FK → `storage.buckets` y las políticas nombran
   roles cliente. Sin este paso, el restore falla (roles ausentes / FK rota).
3. **`LD_LIBRARY_PATH` no cruzaba el allowlist de entorno** del subproceso
   (builds reubicables sin sudo). Fix en `recovery.py`: pasa el valor propio
   del operador, sin escalar nada.
4. Unitarias offline tras los cambios: `test_*.py` **18/18 OK**.

## Límites (no se afirma más)

- Fuente y destino son PG 16.15 vanilla + stub HTTP, **no** Supabase
  (sin Auth/REST/Storage gestionados, sin paridad PG17).
- El stub no prueba compatibilidad con la API Storage real; prueba la
  mecánica del tool (dump/restore/manifiesto/reconciliación/relectura).
- El backup remoto autorizado (origen = proyecto) **no ejecutado**: requiere
  credencial de Storage con privilegio + confirmación del operador
  (ver `docs/fase-2/operacion-recuperacion.md`). Pendiente de operación/F8.
- RPO 24 h / RTO 2 h siguen propuestos, no medidos (el drill duró minutos
  con volumen fixture).
