# F2 — Cierre: plataforma Supabase y controles de entrega (PoC)

Rama: `feature/fase2-plataforma-supabase`. Alcance vigente: `docs/fase-2/plataforma-poc.md`
(un solo proyecto existente **ArkyDB**, hosting **Vercel**, datos de PoC, sin multi-ambiente).

## F2.1 Descubrimiento verificado (lectura + catálogo, sin escrituras previas)

- Proyecto: ArkyDB (`hgpemicaeriizllgaezj`), región `ca-central-1` (existente, se conserva),
  estado `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.166`, CLI `2.117.0`.
- `supabase projects list` y `supabase db query --linked --project-ref …` funcionan.
- Catálogo previo: **ninguna tabla de negocio**; Plan/cuotas y destinatario de alertas sin verificar
  (no se presuponen gratuitos ni se autoriza gasto).

## F2.2–F2.4 Fundación, grants/RLS y CI

- `supabase/.cli-version`: `2.117.0`. `supabase/config.toml`: PG17, solo esquema `api` expuesto
  (`schemas = ["api"]`, `auto_expose_new_tables = false`), signup y sign-in anónimo deshabilitados.
- Migración imperativa (`supabase migration new`):
  `supabase/migrations/20260912001855_platform_foundation.sql` — esquemas `api`/`private`,
  deny-by-default (`revoke` + `alter default privileges`), tabla sintética `api.platform_probes`
  (FK `auth.users`, RLS por propietario, grants de columna mínimos), auditoría
  `private.audit_events` sin payload con helper `SECURITY DEFINER` de `search_path` vacío y
  `EXECUTE` revocado. Es **fundación**, no los dominios F4/F5; el seed (`supabase/seed.sql`)
  es fixture local y **nunca se despliega**.
- Pruebas pgTAP `supabase/tests/database/platform_foundation.test.sql`: **41/41** positivas y
  negativas, verificadas dos veces en reconstrucciones limpias sobre PostgreSQL 16.15 nativo
  (`scripts/supabase/test-native.py`), más `plpgsql_check` sin hallazgos y detección de una
  política SELECT deliberadamente debilitada. Paridad PG17, `db reset` CLI y servicios
  Auth/REST/Storage requieren Docker (ausente aquí) y quedan para el stack de CI.
- Tipos `supabase/database.types.ts`: **generación real** con
  `supabase gen types typescript --project-id hgpemicaeriizllgaezj --schema api`
  (CLI 2.117.0, solo lectura). Sin refs del proyecto, marcas de tiempo ni esquema `private`.
  `scripts/supabase/types.sh` rechaza sustitutos escritos a mano y la línea base ausente.
- Despliegue controlado al PoC: `supabase db push --linked --project-ref hgpemicaeriizllgaezj --dry-run`
  mostró solo `20260912001855_platform_foundation.sql` (sin seeds/roles); el push aplicó **solo**
  esa migración. Verificación posterior por catálogo: `api.platform_probes` y
  `private.audit_events` con `rowsecurity`, 4 políticas de propietario, grants solo a
  `authenticated` (más `postgres`), **ninguno a `anon`**.
- `.github/workflows/supabase.yml`: stack local efímero, reset, pgTAP, lint, advisors, drift de
  tipos y segunda reconstrucción; sin `pull_request_target`, sin refs remotas, sin secrets,
  sin despliegue. Escrito, no ejecutado aquí (requiere GitHub Actions con Docker).

## F2.5–F2.6 Operación y recuperación

- Detalle: `docs/fase-2/operacion-recuperacion.md`.
- `scripts/operations/recovery.py`: backup (`pg_dump` custom + blobs Storage reales + manifiesto
  SHA-256 + `manifest.sha256`), `verify`, `restore-local` solo a loopback literal con
  `RESTORE_DISPOSABLE_LOCAL`; credenciales solo por entorno, `PGPASSWORD` al subproceso,
  TLS `verify-full`, `umask 077`, allowlist de logs. `scripts/operations/metrics.py`: umbrales
  manuales sin red. Pruebas: `python3 -m unittest discover -s scripts/operations -p 'test_*.py'`
  → **18/18 OK** (contrato offline, HTTP contra fixtures loopback, inyección/libpq, allowlist).
- **F2.6 no ensayada de extremo a extremo**: sin `pg_dump/psql`, Docker ni Storage local aquí;
  ensayo real pendiente en entorno con servicios. F2.5 es base manual, no alertas SaaS.

## Calidad y cambios de esta rama

- `npm run lint`: 0 errores. Se añadió a `eslint.config.js` el ignore de
  `docs/fase-0/evidencias/**` (sondas F0 congeladas, no código distribuido; rompían el gate
  con 29 errores preexistentes — la rama F2 no toca ese archivo).
- `npm run quality` (con `NODE_OPTIONS=--max-old-space-size=6144` por el heap del sandbox):
  **exit 0** — typecheck, strict, lint, any-budget, orphan-scripts, module-size, tests+coverage,
  build:placeholders, bundle-secrets y bundle-budget en verde. Log local en
  `docs/fase-2/evidencias/quality.log` (excluido de Git por `*.log` en `.gitignore`).
- `supabase/database.types.ts` (nuevo, generación real desde ArkyDB).
- Nota de entorno: `tsc` necesita `NODE_OPTIONS=--max-old-space-size=6144` en este sandbox
  (heap por defecto agota 8 GB); no es cambio del repo.
- Sin cambios de dependencias, sin secretos en Git, sin commits de otros agentes.

## Pendientes externos (no bloquean F3 con contratos)

1. Ejecutar `.github/workflows/supabase.yml` en GitHub Actions (Docker) y confirmar tipos sin drift.
2. Ensayo real de backup/restore con servicios (F2.6 extremo a extremo).
3. Activar alertas/AUDIT de negocio al conectar cortes F4/F5; Plan/cuotas y responsable de gasto.
4. `config.toml` es local: revisar Auth/Data API **remota** por dashboard antes de exponer clientes.
