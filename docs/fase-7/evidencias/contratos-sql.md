# F7.1 — Contratos SQL: reconstrucción nativa + veredictos remotos fail-closed

## Reconstrucción nativa (`scripts/supabase/test-native.py`, PG 16.15)

Dos iteraciones limpias (initdb → bootstrap → 30 migraciones → seed ×2 →
contratos → plpgsql_check → mutante), exit 0. Seed estable 2 probes /
2 audit events en ambas.

El traceback histórico `operator does not exist: text = uuid` (en la línea
203 de `20260915023944_storage_authorization_hardening.sql`) se reprodujo
contra el estado anterior del harness y no se reproduce con el bootstrap
actual: la sonda mínima aplica las 30 migraciones y el runner completo terminó
con `NATIVE-EXIT=0`. El bootstrap actual conserva la distinción verificada
por catálogo: `storage.objects.owner uuid` y `owner_id text`. No se cambió
ninguna migración de producción para ocultar el error.

La notificación asíncrona `proc_eb9a64ef0fe6` no es el veredicto vigente:
terminó con una variante anterior del harness y dejó el contrato en 24/30,
además de abortar al consultar Storage como `anon`. La ejecución reproducible
con el árbol actual aplica el grant de lectura de harness después de las
migraciones, completa las 30 aserciones y termina con `NATIVE-CURRENT-EXIT=0`.
El único `not ok` nativo permitido continúa siendo el gap documentado del
mensaje de borrado gestionado por Storage.

La notificación `proc_6395eb96afb9` también pertenece a una ejecución previa:
falló al resolver `throws_ok(...)` bajo `service_role`, antes de que el
contrato otorgara `USAGE` y `EXECUTE` de pgTAP a ese rol. El árbol vigente
contiene esos grants en el encabezado de `storage_private_objects.test.sql`;
la firma real `throws_ok(text, character, text, text)` se resuelve bajo
`service_role` y la ejecución vigente ya terminó 30/30.

La notificación `proc_d68caff81c21` es otra ejecución anterior al grant de
lectura del harness para `anon`: llegó hasta 29 aserciones, recibió el error
esperado de PostgreSQL `permission denied for table objects` en la consulta
anónima y terminó con `NATIVE-EXIT=1`. No representa el árbol vigente; las
reconstrucciones posteriores aplican explícitamente `grant select on
storage.objects to anon` después de migraciones y terminaron con exit 0.

| Contrato | Iter 1 | Iter 2 |
|---|---|---|
| business_initiatives | 17/17 | 17/17 |
| identity_authorization | 52/52 | 52/52 |
| knowledge_graph | 13/13 | 13/13 |
| learning | 35/35 | 35/35 |
| office_engagements | 21/21 | 21/21 |
| platform_foundation | 41/41 | 41/41 |
| platform_reference_parameters | 20/20 | 20/20 |
| projects_artifacts | 23/23 | 23/23 |
| storage_private_objects | 30/30 * | 30/30 * |
| user_settings_pilot | 14/14 | 14/14 |

\* con gap documentado pineado: `El cliente no elimina un objeto no
registrado` exige el mensaje del trigger gestionado de Storage (solo existe
en la plataforma; errcode 42501 coincide en ambos). El mecanismo falla
cerrado ante cualquier desviación del conjunto pineado.

- `plpgsql_check`: sin hallazgos (×2). Mutante SELECT debilitado: detectado (×2).
- Harness: `sql-contract-bootstrap.sql` etiqueta sus fixtures como
  harness-only (roles Auth, `auth.uid()`, stub mínimo de Storage con tipos
  verificados contra el catálogo remoto: `owner uuid`, `owner_id text`).
  No sustituye Auth/REST/Storage gestionados ni paridad PG17 (vía CI/Docker).

## Contratos remotos (`scripts/supabase/test-remote.py`, fail-closed)

`supabase db query --linked` devuelve exit 0 incluso con aserciones falsas,
así que el runner envuelve cada contrato (cada SELECT capturado en orden en
una tabla temporal, `lock_timeout 3s`, rollback) y valida plan + secuencia +
`not ok` + directivas. 10/10 contratos en verde contra ArkyDB-US:

17/17, 52/52, 13/13, 35/35, 21/21, 41/41, 20/20, 23/23, 30/30, 14/14.

Migraciones 30/30 sincronizadas, `db push --dry-run` up-to-date.

Nota de robustez: una ejecución intermedia devolvió `0/0
unrecognized-tap-or-bailout` en los 10 contratos por un fallo transitorio
del CLI (el rerun inmediato, sin cambios, dio 10/10). El runner distingue
ese caso como fallo, nunca como verde.

## Cambios de contrato en esta fase (con causa)

- `identity_authorization`: la aserción 41 negaba EXECUTE de `authenticated`
  sobre `private.is_session_active()`; la migración F6
  `20260915192003` lo otorga a propósito (las RLS owner-only lo invocan).
  El contrato ahora afirma el grant + denegación a `anon`, con nota de que
  la llamada directa sigue cerrada por falta de USAGE en `private`.
- `storage_private_objects`: un `SELECT` devolvía uuid suelto (no-TAP);
  convertido a `lives_ok` sin cambiar intención. Grants pgTAP a
  `service_role` en el header test-only (ese rol ejecuta parte del contrato).
