# Fase 5 — Corte vertical 4: encargos de Oficina y decisiones ARB

**Rama:** `feature/fase5-piloto-configuracion`
**Proyecto remoto:** ArkyDB-US (`btbhkmckrazoayaoorys`, `us-east-1`)
**Migraciones:** `20260912170000_office_engagements.sql` y `20260912181347_office_engagements_guards.sql` — aplicadas.
**Estado:** persistencia, autorización, contrato SQL, ETL y repositorio completos; **no activado** y sin carga de datos de la PoC.

## Unidad del corte

Cada encargo (`projects/{id}/engagements/{id}`) se migró con su registro de
decisiones ARB (`…/arbDecisions/{id}`), porque las decisiones son inmutables y
el espejo que porta el documento del encargo es sólo una vista de lectura. El
enlace al proyecto se conserva como **clave textual** (`project_id`): durante la
cohorte el encargo no exige que la raíz del proyecto esté migrada, y el
propietario del encargo es la frontera de autorización.

## Separación de funciones, igual que en Firestore

Un encargo llega a `delivered` sólo vía `decideEngagement`, que exige
`arb:decide` en cliente y en `firestore.rules`. El corte replica la misma
regla en PostgreSQL:

- `api.record_arb_decision` exige permiso `arb:decide`, sesión activa y que el
  actor firmante sea exactamente `auth.uid()` — un cliente no puede firmar con
  el nombre de otro.
- El registro `api.office_arb_decisions` **no tiene UPDATE ni DELETE** para el
  cliente: una decisión escrita no se altera ni se borra por RPC.
- La decisión queda bajo el **propietario del encargo**, no bajo el firmante:
  el comité firma sobre encargos ajenos porque el autor no aprueba su propio
  trabajo.
- Un veredicto `changes-requested`/`rejected` sin motivo escrito se rechaza
  (22023), igual que la regla Firestore «keeps a recorded decision immutable».

## Esquema y superficie autorizada

| Componente | Responsabilidad |
| --- | --- |
| `api.office_engagements` | encargo completo como documento JSON, propietario, proyecto textual, revisión optimista |
| `api.office_arb_decisions` | registro inmutable: id, encargo, proyecto, propietario y decisión firmada |
| `api.save_engagement(project_id, engagement, expected_revision)` | `project:write` + sesión activa; valida forma, estado del ciclo de vida, presupuesto y sin `apiKey` |
| `api.load_engagements(project_id)` | `portfolio:read` + sesión; lista encargos propios con su espejo ARB |
| `api.delete_engagement(project_id, engagement_id)` | borra el encargo propio; no borra el registro ARB |
| `api.record_arb_decision(decision)` | única escritura del registro ARB, sólo-creación |

RLS activa en ambas tablas, sin privilegios directos para `authenticated` ni
`service_role`. La RPC `record_arb_decision` es deliberadamente **ajena al
propietario**: cualquier sesión con `arb:decide` y encargo existente puede
firmar, y el registro hereda el propietario del encargo.

### Guardas de gobernanza (revisión externa)

La primera revisión independiente detectó que `save_engagement` dejaba llegar a
`delivered` con sólo `project:write`, mientras `firestore.rules` exige
`canDecideArb()` para esa transición. La migración de guardas corrige la
discrepancia y añade paridad de borrado:

- `delivered` exige `arb:decide` en `api.save_engagement` (42501 en otro caso) y
  un encargo no puede re-entregarse desde el estado `delivered`.
- `api.delete_engagement` ahora firma `(project_id, engagement_id,
  expected_revision)` y falla con `P0001` si la revisión no coincide, igual que
  `delete_business_initiative`; el repositorio TypeScript envía la revisión
  observada.

Diferencias declaradas respecto de Firestore (por diseño, no por omisión): la
separación autor/firmante del ARB sigue dependiendo del rol —como en
firestore.rules, donde `allow create` sólo exige `canDecideArb` y actor
propio—, y la ETL reescribe `actor.id` de las decisiones al UUID destino pero
conserva `createdBy.id` y los `actor.id` del `auditTrail` como claves textuales
heredadas, coherente con cómo los cortes 1–3 preservan IDs de Firebase.

## Contrato SQL

Los estados de encargo admitidos son exactamente los del ciclo de vida
(`intake`, `planning`, `awaiting-charter`, `in-progress`, `awaiting-arb`,
`delivered`, `blocked`, `cancelled`). `charter`, `tasks`, `auditTrail` y
`budget` deben tener su forma base y presupuesto numérico no negativo. La
validación de dependencias del DAG, separación productor/revisor y transiciones
de estado siguen siendo del dominio TypeScript (`officeEngagementTransitions`,
`validateCharter`): la RPC defiende identidad y frontera, no reimplementa el
planificador.

## ETL y reconciliación

`scripts/migration/office_engagements_etl.py` reúne encargos y decisiones,
exige mapa Firebase UID → UUID para el autor (`createdBy.id`) **y para cada
actor firmante**, reescribe `actor.id` al UUID destino, rechaza estados fuera
del ciclo de vida, presupuestos negativos, secretos, decisiones sin actor
mapeado y decisiones huérfanas. Emite NDJSON y manifiesto
`office-engagements-etl-v1` con SHA-256 y `reconcile()`.

No se ejecutó exportación ni carga real: el mapa de identidades sigue sin
provisionar, igual que en los cortes 1–3.

## Validación ejecutada

| Control | Resultado |
| --- | --- |
| Contratos SQL PG 16, dos reconstrucciones | encargos **21/21**; proyectos/artefactos **23/23**; iniciativas **17/17**; identidad/autorización **51/51**; fundación **41/41**; preferencias **14/14** |
| Análisis `plpgsql_check` | sin hallazgos en ambas reconstrucciones |
| Sonda PostgreSQL 17 remota, transacción revertida | **5/5**: guardado/listado propio, firma del admin sobre encargo ajeno, autor no firma (`42501`), revisión obsoleta (`P0001`), `delivered` sin `arb:decide` (`42501`) |
| Tipos de base | regenerados desde ArkyDB-US con tablas y RPCs del corte |
| ETL de los cuatro cortes | **18/18** pruebas Python correctas |
| Repositorio Supabase de encargos | **5/5** pruebas Vitest (`supabaseOfficeEngagementRepository.test.ts`) |
| Suite de la Oficina | **34** archivos / **393** pruebas correctas |
| Cobertura completa Vitest | **440** archivos correctos, **4269** pruebas correctas y **59** omitidas; líneas **67,00 %**, sentencias **65,19 %** (`docs/fase-5/coverage-office-engagements.log`) |

## Activación y reversión

La bandera `VITE_BACKEND_OFFICEENGAGEMENTS=supabase` **no se habilita**; el
corte requiere el mismo prerrequisito de los anteriores: identidad Supabase
conectada al `AuthContext` de la cohorte piloto y mapa de identidades. El
repositorio Supabase queda disponible como adaptador, pero el routing por
contexto se conecta en la activación del piloto, junto con los cortes 1–3.
La reversión es retirar la bandera de cohorte; Firebase sigue siendo la fuente
activa hasta entonces.

## Siguiente corte

**Artefactos ya cubiertos en el corte 3**; sigue el **grafo de conocimiento
arquitectónico**, derivado y reconciliado desde proyectos y artefactos.