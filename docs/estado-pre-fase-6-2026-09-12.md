# Estado pre-Fase 6 — ejecución y bloqueos verificables

**Fecha:** 2026-09-12  
**Rama:** `feature/fase5-piloto-configuracion`  
**Destino:** ArkyDB-US (`btbhkmckrazoayaoorys`, us-east-1)

## Decisión de avance

**No iniciar F6 todavía.** F5 está técnicamente preparado, pero no puede cerrarse
ni activarse porque no existen identidades Supabase, cohorte piloto ni exportación
consistente de la PoC para ejecutar ETL y reconciliación. No se inventaron UUID,
usuarios, roles ni datos.

## Ejecutado y verificado en esta sesión

| Área | Resultado | Evidencia ejecutada |
| --- | --- | --- |
| Toolchain | Node 20.20.2 y npm 10.8.2 instalados en espacio de usuario; Java Temurin 21.0.12.1 instalado en espacio de usuario. | `node --version`, `npm --version`, `java -version` |
| F4 — reglas Firebase | Verde. | `npm run test:rules`: 59/59 |
| F5.6 — LMS | Migración `20260912190000_learning.sql` aplicada; cuatro tablas, diez RPC, RLS y grants verificados. | `supabase db push --linked`; sonda `scripts/supabase/learning-remote-probe.sql`: 11/11 OK y rollback |
| Tipos | Regenerados desde ArkyDB-US. | `supabase gen types typescript --linked --schema api` |
| Migraciones | Local y remoto reconciliados. | `supabase db push --linked --dry-run`: `upToDate: true` |
| Calidad | Verde. | `npm run quality`: 442 archivos y 4,283 pruebas pasadas; 59 omitidas; bundle eager 435.0/450.0 KB gzip; escáner de secretos OK |
| ETL F5 existente | Verde. | 20 pruebas Python de settings, iniciativas, proyectos/artefactos y oficina |
| Recuperación F2 | Herramientas offline verdes. | 18 pruebas `scripts/operations`; guard de restauración local y verificación de manifiesto |
| Dependencias producción | Sin vulnerabilidades reportadas. | `npm audit --omit=dev --json` |
| Entrega | Vercel alineado con el runtime del repositorio. | Proyecto `arkypro-1-0`: Node 20.x |
| CI remoto | Flujos CI y E2E con corridas verdes recientes. | `gh run list` |

## Cambios realizados

- Se añadió el adaptador LMS `services/learning/SupabaseLearningRepository.ts` y
  sus pruebas unitarias.
- Se añadió la migración LMS, pruebas SQL y sonda remota auto-revertible.
- Se regeneró `supabase/database.types.ts` desde el proyecto remoto.
- Se añadió `https://*.supabase.co` y `wss://*.supabase.co` a la CSP de Vercel,
  todavía en modo `Report-Only`.
- Se alineó el runtime del proyecto Vercel de Node 24.x a Node 20.x.

## Estado por fase

| Fase | Estado | Límite actual |
| --- | --- | --- |
| F0 | Verificada de nuevo | E2E local iPad bloqueada por librerías del sandbox; CI es la ruta válida. |
| F1 | Implementada | `CLAUDE.md` conserva texto histórico frontend-first; requiere actualización controlada. |
| F2 | Implementada parcialmente | Faltan `pg_dump`, `pg_restore`, PostgreSQL 17, Storage local y un backup autorizado para ensayar restore real. |
| F3 | Cerrada | Sin bloqueo nuevo detectado. |
| F4 | Base técnica verificada | Adaptador Supabase no cableado; provisionamiento Auth requiere backend confiable. |
| F5 | Preparada, no cerrada | No hay cohorte/identidades, mapa Firebase UID→UUID ni exportación/carga/reconciliación real. |

## Bloqueos y propietario

### Requieren organización / responsable de la PoC

1. Designar una cohorte piloto y crear sus identidades en Supabase Auth mediante
   un backend confiable; ArkyDB-US tiene actualmente 0 usuarios Auth y 0 perfiles
   activos.
2. Proporcionar el mapa explícito Firebase UID → UUID Supabase para cada persona
   y actor embebido que se vaya a migrar.
3. Autorizar una exportación consistente de Firestore `arquitecto-cdd6b` y de los
   objetos Storage que entren al alcance. No usar `arky10` como sustituto: es otro
   proyecto accesible.
4. Configurar en Vercel, por canal seguro, `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY` y los overrides de backend únicamente para la
   cohorte autorizada. Hoy Vercel solo tiene variables Firebase.
5. Proveer un sandbox PostgreSQL 17 + Storage y un backup autorizado para el
   ensayo F2.6; no existe evidencia de restore extremo a extremo.
6. Aceptar la ausencia de protección de rama o cambiar el plan/repositorio: GitHub
   devuelve 403 para esa capacidad en el repositorio privado actual.

### Bloqueados por el entorno local

- E2E iPad: desktop pasó 8 pruebas; iPad falla antes de ejecutar casos por
  librerías `libgav1.so.1` y `libyuv.so.0` tras un intento user-space. CI ya
  ejecuta ese recorrido en Ubuntu con dependencias administradas.
- Arnés SQL nativo: faltan PostgreSQL 17, pgTAP y `plpgsql_check`. La sonda contra
  PostgreSQL 17 remoto verificó el contrato LMS; no sustituye reset/Auth/REST/Storage
  local.

### Pendiente de implementación, después de los insumos anteriores

1. Cablear `loadIdentityPort` en `AuthContext` y provisionar usuarios únicamente
   por Edge Function/backend confiable.
2. Conectar `VITE_BACKEND_LEARNING=supabase` al servicio LMS y activar el flag solo
   cuando una identidad piloto pueda autenticarse y tenga perfil activo.
3. Ejecutar ETL, carga RPC autorizada, manifiesto y reconciliación por corte; no
   hay dual-write.
4. Activar por cohorte, hacer smoke/E2E por rol y ensayar reversión quitando el
   override antes de considerar F5 cerrada.
